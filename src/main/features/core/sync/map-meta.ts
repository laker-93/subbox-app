import axios, { isAxiosError } from 'axios';
import * as fs from 'fs';

import {
    CONNECTION_WAIT_MS,
    waitForServer,
    withNetworkRetry,
} from '/@/main/features/core/sync/network-retry';
import { httpsAgent, PymixAuth, withPymixAuth } from '/@/main/features/core/sync/pymix-auth';

/**
 * What an upload's `/sync/map_meta` call carries per track: where the file was
 * uploaded to under `uploads/`, and where it came from on this machine.
 */
export interface TrackMetaToMap {
    originalAlbum: null | string;
    originalArtist: null | string;
    originalName: null | string;
    stagingLocation: string;
    userLocation: string;
}

/**
 * The error message prefix for a map_meta failure. The renderer matches on it, as it
 * does on `STORAGE_LIMIT_EXCEEDED:`, because an IPC rejection carries only a message.
 * The tracks are on the server by then, so the renderer offers to finish the import
 * (the metadata-only path), not to upload again (laker-93/pymix#237).
 */
export const MAP_META_FAILED_PREFIX = 'MAP_META_FAILED:';

interface MapMetaProgress {
    detail: null | { untagged_count?: number };
    in_progress: boolean;
    n_tracks: number;
    n_tracks_processed: number;
    reason: string;
    result: boolean | null;
}

const POLL_INTERVAL_MS = 1000;
// A blip while polling must not throw away an upload that took hours: the job goes
// on without us. Give up only after this many failed polls in a row.
const MAX_CONSECUTIVE_POLL_ERRORS = 30;
// pymix caps a /sync/staged_sizes request at 2000 paths.
const STAGED_SIZES_CHUNK = 1000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const mapMetaFailed = (reason: string) => new Error(`${MAP_META_FAILED_PREFIX}${reason}`);

/**
 * The staging paths the server already holds whole: same size as the local file.
 *
 * A retry after a late failure (tagging, import) then re-sends nothing it already
 * sent. Existence alone is not enough: an interrupted TUS upload leaves a truncated
 * file at the final path. A file the server has since tagged differs in size too, so
 * it is sent again; that retry belongs on the "finish import" path anyway.
 *
 * Best effort: if pymix can't answer, nothing is skipped (laker-93/pymix#237).
 */
export async function findWhollyStaged(args: {
    items: Array<{ localPath: string; stagingPath: string }>;
    pymixAuth: PymixAuth;
    pymixUrl: string;
}): Promise<Set<string>> {
    const { items, pymixAuth, pymixUrl } = args;
    const whole = new Set<string>();
    try {
        for (let i = 0; i < items.length; i += STAGED_SIZES_CHUNK) {
            const chunk = items.slice(i, i + STAGED_SIZES_CHUNK);
            // Retried through a dropped connection: giving up here re-sends the
            // whole library.
            const res = await withNetworkRetry(() =>
                withPymixAuth<{ sizes: Record<string, null | number> }>(pymixAuth, (cookie) =>
                    axios.post(
                        `${pymixUrl}/sync/staged_sizes`,
                        { paths: chunk.map((c) => c.stagingPath) },
                        { headers: { Cookie: cookie }, httpsAgent },
                    ),
                ),
            );
            for (const { localPath, stagingPath } of chunk) {
                const serverSize = res.data.sizes[stagingPath];
                if (serverSize == null) continue;
                try {
                    if (fs.statSync(localPath).size === serverSize) whole.add(stagingPath);
                } catch {
                    // The local file is gone: it can't be uploaded either, and the
                    // caller has already checked it exists, so leave it to fail there.
                }
            }
        }
    } catch (err) {
        console.warn('Failed to check existing uploads, proceeding without dedup:', err);
        return new Set();
    }
    return whole;
}

/**
 * Tag the uploaded files with SUBBOX_ID and record them as the attempt the import
 * stages, and wait until pymix has done it.
 *
 * map_meta is a job on the server: one request tagging a whole library (~20ms a
 * file) outlived Cloudflare's 100s. The import refuses until the job has finished,
 * so this has to return only once it has (laker-93/pymix#237).
 */
export async function runMapMeta(args: {
    onProgress: (processed: number, total: number) => void;
    pymixAuth: PymixAuth;
    pymixUrl: string;
    tracks: TrackMetaToMap[];
}): Promise<void> {
    const { onProgress, pymixAuth, pymixUrl, tracks } = args;

    // Not while the server is unreachable: the upload before this may have just
    // ridden out a dropped connection, and a map_meta sent into it can only fail
    // (subbox-app#203).
    if (!(await waitForServer(pymixUrl))) {
        throw mapMetaFailed(
            `couldn't reach the server for ${CONNECTION_WAIT_MS / 60_000} minutes. ` +
                'Check your connection, then finish the import.',
        );
    }

    let jobId: string;
    try {
        const res = await withNetworkRetry(() =>
            withPymixAuth<{ job_id: string; n_tracks: number }>(pymixAuth, (cookie) =>
                axios.post(
                    `${pymixUrl}/sync/map_meta`,
                    { tracks },
                    { headers: { Cookie: cookie }, httpsAgent },
                ),
            ),
        );
        jobId = res.data.job_id;
    } catch (err) {
        if (isAxiosError(err) && err.response?.status === 409) {
            throw mapMetaFailed(
                'the server is still tagging an earlier upload. Try again in a few minutes.',
            );
        }
        throw mapMetaFailed(err instanceof Error ? err.message : String(err));
    }

    let consecutiveErrors = 0;
    while (true) {
        await sleep(POLL_INTERVAL_MS);
        let prog: MapMetaProgress;
        try {
            const res = await withNetworkRetry(() =>
                withPymixAuth<MapMetaProgress>(pymixAuth, (cookie) =>
                    axios.get(`${pymixUrl}/sync/map_meta/progress`, {
                        headers: { Cookie: cookie },
                        httpsAgent,
                        params: { job_id: jobId },
                    }),
                ),
            );
            prog = res.data;
            consecutiveErrors = 0;
        } catch (err) {
            consecutiveErrors++;
            console.warn(`[map_meta] progress poll failed (${consecutiveErrors}):`, err);
            if (consecutiveErrors >= MAX_CONSECUTIVE_POLL_ERRORS) {
                throw mapMetaFailed(
                    'lost contact with the server while it was tagging your tracks.',
                );
            }
            continue;
        }

        onProgress(prog.n_tracks_processed, prog.n_tracks);
        if (prog.in_progress) continue;
        if (prog.result) return;

        console.error('[map_meta] tagging failed:', prog.reason, prog.detail);
        const untagged = prog.detail?.untagged_count;
        throw mapMetaFailed(
            untagged
                ? `${untagged} ${untagged === 1 ? 'track' : 'tracks'} could not be tagged on the server.`
                : prog.reason || 'tagging on the server failed.',
        );
    }
}
