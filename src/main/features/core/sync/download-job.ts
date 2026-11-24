import axios, { AxiosResponse, isAxiosError } from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { Transform } from 'stream';
import { pipeline } from 'stream/promises';

import { withNetworkRetry } from '/@/main/features/core/sync/network-retry';
import { httpsAgent, PymixAuth, withPymixAuth } from '/@/main/features/core/sync/pymix-auth';

// ── A Download as a server job plus one request per track ──────────────────
//
// A whole-library Download used to be one POST /sync/playlists that built the XML
// and a zip of every track, then one stream of that zip, then an unzip. For a
// user's 110 GB library on a new laptop that was a Cloudflare 524 twice: the
// server-side work takes hours and Cloudflare cuts a request at 100 s
// (laker-93/pymix#344). Even had it finished, one 110 GB stream can't resume and
// the unzip needs twice the space.
//
// Now (laker-93/pymix#346, #347, subbox-app#328): start a job, poll it, then
// fetch each track in its manifest, a few at a time, each retried, each written
// to a temporary name and renamed when whole. A file already there at the right
// size is skipped, so pressing Download again after a drop fetches only what's
// missing.

/** Tracks fetched at once. Enough to fill a home connection, few enough not to
 *  crowd the one-CPU server other users share. */
const TRACK_CONCURRENCY = 4;

/** Per-track attempts for an answer that isn't a network error (a 5xx, a short
 *  body). Network errors get withNetworkRetry's longer budget on top. */
const TRACK_ATTEMPTS = 4;

/** How long a stalled transfer may go without a byte before it is retried. */
const TRACK_IDLE_TIMEOUT_MS = 60_000;

/** Poll intervals, settling at the last. */
const POLL_DELAYS_MS = [500, 1_000, 2_000, 3_000, 5_000];

/** Suffix of a track still being written. Never taken for a finished file. */
export const PARTIAL_SUFFIX = '.subbox-part';

export interface DownloadJobStatus {
    inProgress: boolean;
    jobId: string;
    nProcessed: number;
    nTotal: number;
    nTracks: number;
    phase: null | string;
    reason: string;
    result: boolean | null;
    totalBytes: number;
    tracks: ManifestEntry[] | null;
    warnings: string;
    xmlFilename: null | string;
}

export interface DownloadProgress {
    /** The tracks in flight, for the progress screen. */
    activeTracks: string[];
    bytesDone: number;
    bytesTotal: number;
    /** The server's own counts while it prepares; tracks done/total after. */
    nDone: number;
    nTotal: number;
    phase: 'collect' | 'manifest' | 'tracks' | 'xml';
    tracksFailed: number;
    tracksSkipped: number;
}

export interface ManifestEntry {
    index: number;
    relativePath: string;
    size: number;
    subboxId: null | string;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface FetchTracksResult {
    /** Files written by this run, for the SUBBOX_ID cache. */
    downloaded: string[];
    failed: Array<{ reason: string; relativePath: string }>;
    /** Already there from an earlier run, at the right size. */
    skipped: number;
}

export class DownloadCancelled extends Error {
    constructor() {
        super('Download cancelled.');
    }
}

/** True when a finished copy is already there: same size as the server's. */
export function alreadyDownloaded(dest: string, size: number): boolean {
    try {
        const stat = fs.statSync(dest);
        return stat.isFile() && stat.size === size;
    } catch {
        return false;
    }
}

/**
 * Where a manifest entry goes: `relativePath` under the music folder, as the
 * XML's Location points. Null for a path that would land outside it, which the
 * server never sends, but a file is never written on its say-so alone.
 */
export function destinationFor(musicPath: string, relativePath: string): null | string {
    const parts = relativePath.split('/').filter((p) => p.length > 0);
    if (parts.length === 0 || parts.some((p) => p === '..' || p === '.')) return null;
    const root = path.resolve(musicPath);
    const dest = path.resolve(root, ...parts);
    return dest.startsWith(root + path.sep) ? dest : null;
}

/** One file from the user's downloads dir on the server, by its pymix name. */
export async function fetchDownloadsFile(
    auth: PymixAuth,
    pymixUrl: string,
    filename: string,
    dest: string,
): Promise<void> {
    const partial = dest + PARTIAL_SUFFIX;
    const response = await withNetworkRetry(() =>
        withPymixAuth<NodeJS.ReadableStream>(
            auth,
            (cookie) =>
                axios.get(`${pymixUrl}/sync/download/${encodeURIComponent(filename)}`, {
                    headers: { Cookie: cookie },
                    httpsAgent,
                    responseType: 'stream',
                    timeout: 60_000,
                }) as Promise<AxiosResponse<NodeJS.ReadableStream>>,
        ),
    );
    try {
        await pipeline(response.data, fs.createWriteStream(partial));
        fs.renameSync(partial, dest);
    } catch (err) {
        try {
            fs.unlinkSync(partial);
        } catch {
            // ignore
        }
        throw err;
    }
}

/**
 * Fetch every manifest entry into `musicPath`, TRACK_CONCURRENCY at a time.
 * A track that fails every attempt is recorded and the rest carry on: one bad
 * file shouldn't cost the other thousands.
 */
export async function fetchTracks(args: {
    auth: PymixAuth;
    entries: ManifestEntry[];
    jobId: string;
    musicPath: string;
    onProgress: (progress: DownloadProgress) => void;
    pymixUrl: string;
    signal: AbortSignal;
}): Promise<FetchTracksResult> {
    const { auth, entries, jobId, musicPath, onProgress, pymixUrl, signal } = args;
    const result: FetchTracksResult = { downloaded: [], failed: [], skipped: 0 };
    const bytesTotal = entries.reduce((sum, e) => sum + e.size, 0);
    let bytesDone = 0;
    let nDone = 0;
    const active = new Set<string>();
    let lastReport = 0;

    const report = (force = false) => {
        const now = Date.now();
        if (!force && now - lastReport < 250) return;
        lastReport = now;
        onProgress({
            activeTracks: [...active],
            bytesDone,
            bytesTotal,
            nDone,
            nTotal: entries.length,
            phase: 'tracks',
            tracksFailed: result.failed.length,
            tracksSkipped: result.skipped,
        });
    };

    const queue = [...entries];
    const worker = async () => {
        for (let entry = queue.shift(); entry; entry = queue.shift()) {
            if (signal.aborted) return;
            const dest = destinationFor(musicPath, entry.relativePath);
            if (!dest) {
                result.failed.push({
                    reason: 'the server named a path outside the music folder',
                    relativePath: entry.relativePath,
                });
                nDone++;
                continue;
            }
            if (alreadyDownloaded(dest, entry.size)) {
                result.skipped++;
                bytesDone += entry.size;
                nDone++;
                report();
                continue;
            }
            const label = path.basename(entry.relativePath);
            active.add(label);
            report(true);
            try {
                await fetchTrack(
                    auth,
                    pymixUrl,
                    jobId,
                    entry,
                    dest,
                    (n) => {
                        bytesDone += n;
                        report();
                    },
                    signal,
                );
                result.downloaded.push(dest);
            } catch (err) {
                if (err instanceof DownloadCancelled || signal.aborted) return;
                const reason = isAxiosError(err)
                    ? (err.response?.status ?? err.message).toString()
                    : (err as Error).message;
                console.error(`[download] ${entry.relativePath} failed for good: ${reason}`);
                result.failed.push({ reason, relativePath: entry.relativePath });
            } finally {
                active.delete(label);
                nDone++;
                report(true);
            }
        }
    };

    await Promise.all(Array.from({ length: TRACK_CONCURRENCY }, worker));
    if (signal.aborted) throw new DownloadCancelled();
    report(true);
    return result;
}

/** Bytes free on the volume holding `dir` (or its nearest existing parent). */
export async function freeBytes(dir: string): Promise<null | number> {
    let probe = path.resolve(dir);
    while (!fs.existsSync(probe)) {
        const parent = path.dirname(probe);
        if (parent === probe) return null;
        probe = parent;
    }
    try {
        const stats = await fs.promises.statfs(probe);
        return stats.bavail * stats.bsize;
    } catch {
        return null;
    }
}

/**
 * Start the download job, or null when this pymix predates it (a 404 or 405 on
 * the route): the caller then falls back to the one-zip /sync/playlists.
 */
export async function startDownloadJob(
    auth: PymixAuth,
    pymixUrl: string,
    body: unknown,
): Promise<DownloadJobStatus | null> {
    try {
        const response = await withNetworkRetry(() =>
            withPymixAuth<DownloadJobStatus>(auth, (cookie) =>
                axios.post(`${pymixUrl}/sync/download/jobs`, body, {
                    headers: { Cookie: cookie },
                    httpsAgent,
                    timeout: 60_000,
                }),
            ),
        );
        return response.data;
    } catch (err) {
        if (isAxiosError(err) && (err.response?.status === 404 || err.response?.status === 405)) {
            return null;
        }
        throw err;
    }
}

/**
 * Poll the job until it finishes, reporting its phase. A network error is waited
 * out (withNetworkRetry), so a wifi drop while the server prepares doesn't end
 * the download. Throws the job's own reason when it failed.
 */
export async function waitForDownloadJob(
    auth: PymixAuth,
    pymixUrl: string,
    started: DownloadJobStatus,
    onStatus: (status: DownloadJobStatus) => void,
    signal: AbortSignal,
): Promise<DownloadJobStatus> {
    let status = started;
    for (let poll = 0; status.inProgress; poll++) {
        onStatus(status);
        await sleep(POLL_DELAYS_MS[Math.min(poll, POLL_DELAYS_MS.length - 1)]);
        if (signal.aborted) throw new DownloadCancelled();
        const response = await withNetworkRetry(() =>
            withPymixAuth<DownloadJobStatus>(auth, (cookie) =>
                axios.get(`${pymixUrl}/sync/download/jobs/${status.jobId}`, {
                    headers: { Cookie: cookie },
                    httpsAgent,
                    timeout: 30_000,
                }),
            ),
        );
        status = response.data;
    }
    onStatus(status);
    if (!status.result) {
        throw new Error(status.reason || 'The server could not prepare this download.');
    }
    return status;
}

/**
 * Fetch one track to `dest`, through a temporary file renamed only once every
 * byte the manifest promised has arrived.
 */
async function fetchTrack(
    auth: PymixAuth,
    pymixUrl: string,
    jobId: string,
    entry: ManifestEntry,
    dest: string,
    onBytes: (n: number) => void,
    signal: AbortSignal,
): Promise<void> {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const partial = dest + PARTIAL_SUFFIX;
    for (let attempt = 1; ; attempt++) {
        let received = 0;
        try {
            const response = await withNetworkRetry(() =>
                withPymixAuth<NodeJS.ReadableStream>(
                    auth,
                    (cookie) =>
                        axios.get(`${pymixUrl}/sync/download/jobs/${jobId}/tracks/${entry.index}`, {
                            headers: { Cookie: cookie },
                            httpsAgent,
                            responseType: 'stream',
                            signal,
                            timeout: TRACK_IDLE_TIMEOUT_MS,
                        }) as Promise<AxiosResponse<NodeJS.ReadableStream>>,
                ),
            );
            const body = response.data as NodeJS.ReadableStream & {
                destroy?: (err?: Error) => void;
            };
            // A transfer that stops sending without closing would otherwise hang
            // this worker for ever.
            let idle: NodeJS.Timeout | undefined;
            const arm = () => {
                if (idle) clearTimeout(idle);
                idle = setTimeout(
                    () => body.destroy?.(new Error('the transfer stalled')),
                    TRACK_IDLE_TIMEOUT_MS,
                );
            };
            const counter = new Transform({
                transform(chunk: Buffer, _encoding, done) {
                    received += chunk.length;
                    onBytes(chunk.length);
                    arm();
                    done(null, chunk);
                },
            });
            arm();
            try {
                await pipeline(body, counter, fs.createWriteStream(partial));
            } finally {
                if (idle) clearTimeout(idle);
            }
            const written = fs.statSync(partial).size;
            if (written !== entry.size) {
                throw new Error(`got ${written} of ${entry.size} bytes`);
            }
            fs.renameSync(partial, dest);
            return;
        } catch (err) {
            onBytes(-received);
            try {
                fs.unlinkSync(partial);
            } catch {
                // nothing written yet
            }
            if (signal.aborted) throw new DownloadCancelled();
            if (attempt >= TRACK_ATTEMPTS || !retryable(err)) throw err;
            const wait = 2_000 * 2 ** (attempt - 1);
            console.warn(
                `[download] ${entry.relativePath} failed (${(err as Error).message}), ` +
                    `attempt ${attempt + 1} in ${wait / 1000}s`,
            );
            await sleep(wait);
        }
    }
}

function retryable(err: unknown): boolean {
    if (err instanceof DownloadCancelled) return false;
    if (isAxiosError(err)) {
        const status = err.response?.status;
        // 404: the file has gone from the server since the job ran. Retrying
        // won't bring it back; pressing Download again builds a new list.
        return status === undefined || status >= 500 || status === 429;
    }
    // A short body, a write error: worth another go.
    return true;
}
