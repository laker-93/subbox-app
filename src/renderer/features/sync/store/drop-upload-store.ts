import isElectron from 'is-electron';
import { parseBlob } from 'music-metadata';
import { createWithEqualityFn } from 'zustand/traditional';

import { api } from '/@/renderer/api';
import { fbResourceExists, fbResourceUpload } from '/@/renderer/api/filebrowser/filebrowser-api';
import { PymixController } from '/@/renderer/api/pymix/pymix-controller';
import { urlConfig } from '/@/renderer/config/url-config';
import {
    type DroppedFile,
    type SkippedFile,
} from '/@/renderer/features/sync/utils/collect-dropped-files';
import { invalidateTrackLists } from '/@/renderer/features/trash/api/track-trash';
import { queryClient } from '/@/renderer/lib/react-query';
import { useAuthStore } from '/@/renderer/store';
import { toast } from '/@/shared/components/toast/toast';
import { Song, SongListSort, SortOrder } from '/@/shared/types/domain-types';

/**
 * The one drag-and-drop upload that is running, or has just finished (#293).
 *
 * The files go to the user's server-side `watch/` folder, the same place the Watch
 * uploader sends them, and pymix's watch poller imports them from there: it tags
 * each with a subbox_id as it stages it, so this path doesn't skip tagging. The
 * dropped file on the user's own disk is *not* tagged — a browser can't write to it
 * — which the dropzone says up front.
 *
 * A run lives here rather than in the component for the same reason the Rekordbox
 * and Serato runs do (#195): it has to outlive the screen that started it. Leaving
 * Sync mid-upload must not stop the upload, or lose the result.
 *
 * "Done" means the tracks are in the library, not that the bytes arrived. Watch
 * shows a clean N/N while the import behind it fails, and this must not. pymix gives
 * a watch import no job id the client can find, so the run watches the two things it
 * can see: the batch folder leaving `watch/` (pymix has staged it, the import has
 * begun), then the tracks turning up in Navidrome's recently-added list.
 */

const ipcless = !isElectron();

/** Files uploading at once. Enough to fill the pipe; few enough that a retry is cheap. */
const UPLOAD_CONCURRENCY = 3;
const UPLOAD_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [2_000, 6_000];
const POLL_MS = 5_000;
/**
 * pymix waits for 15 s of quiet in `watch/`, then for every file to be stable,
 * before it stages anything. Five minutes is far past that: a batch still sitting
 * there means the poller isn't running for this user.
 */
const STAGING_TIMEOUT_MS = 5 * 60_000;
/**
 * How long the library may go without a new track before the run gives up on the
 * rest. Navidrome sees nothing until beets has finished the whole batch, so this
 * grows with the batch.
 */
const importQuietMs = (nFiles: number) => Math.max(5 * 60_000, nFiles * 3_000);

export type DropPhase =
    | 'cancelled'
    | 'checking'
    | 'done'
    | 'error'
    | 'importing'
    | 'staging'
    | 'storage'
    | 'uploading';

export interface DropRun {
    activeFiles: string[];
    bytesTotal: number;
    bytesUploaded: number;
    error: null | string;
    /** Uploaded and found in the library. */
    imported: string[];
    /** Uploaded, but never turned up in the library. */
    notImported: string[];
    phase: DropPhase;
    /** Not uploaded: wrong type, hidden folder, unreadable. */
    skipped: SkippedFile[];
    storageInfo: null | { currentUsageBytes: number; maxStorageBytes: number };
    total: number;
    uploaded: number;
    /** Every upload attempt for the file failed. */
    uploadFailed: SkippedFile[];
}

interface DropUploadState {
    run: DropRun | null;
}

export const useDropUploadStore = createWithEqualityFn<DropUploadState>()(() => ({
    run: null,
}));

export const useDropRun = () => useDropUploadStore((s) => s.run);

export const isDropRunActive = (run: DropRun | null) =>
    !!run && ['checking', 'importing', 'staging', 'uploading'].includes(run.phase);

const patch = (update: Partial<DropRun>) =>
    useDropUploadStore.setState((s) => (s.run ? { run: { ...s.run, ...update } } : s));

let abortController: AbortController | null = null;

export const clearDropRun = () => {
    if (isDropRunActive(useDropUploadStore.getState().run)) return;
    useDropUploadStore.setState({ run: null });
};

/** Stops the uploads still to go. What already reached the server is imported anyway. */
export const cancelDropRun = () => abortController?.abort();

// A browser tab can be closed in the middle of an upload with nothing to say so.
// Not in Electron: there a beforeunload handler that sets returnValue silently
// blocks the window from closing.
const warnBeforeUnload = (e: BeforeUnloadEvent) => {
    e.preventDefault();
    e.returnValue = '';
};

const sleep = (ms: number, signal?: AbortSignal) =>
    new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, ms);
        signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            resolve();
        });
    });

/** Lower-case letters and digits only, so "Track (Original Mix)" meets "track original mix". */
const normalise = (s: string) =>
    s
        .normalize('NFKD')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, '');

const stemOf = (name: string) => name.replace(/\.[^.]+$/, '');

/**
 * What the track may be called once it is in the library: its title tag, or, if it
 * has none, its file name, which is what beets and Navidrome fall back to.
 */
const namesFor = async (file: File): Promise<Set<string>> => {
    const names = new Set([normalise(stemOf(file.name))]);
    try {
        const meta = await parseBlob(file, { duration: false, skipCovers: true });
        if (meta.common.title) names.add(normalise(meta.common.title));
    } catch {
        // An unreadable tag still uploads; matching falls back to the file name.
    }
    names.delete('');
    return names;
};

const recentSongs = async (serverId: string, limit: number): Promise<Song[]> => {
    const res = await api.controller.getSongList({
        apiClientProps: { serverId },
        query: {
            limit,
            sortBy: SongListSort.RECENTLY_ADDED,
            sortOrder: SortOrder.DESC,
            startIndex: 0,
        },
    });
    return res?.items ?? [];
};

/** Runs `worker` over `items`, `limit` at a time. */
const pool = async <T>(items: T[], limit: number, worker: (item: T) => Promise<void>) => {
    let next = 0;
    await Promise.all(
        Array.from({ length: Math.min(limit, items.length) }, async () => {
            while (next < items.length) {
                await worker(items[next++]);
            }
        }),
    );
};

const describeUploadError = (err: unknown) => {
    const status = (err as { response?: { status?: number } })?.response?.status;
    if (status === 403) return 'the server refused it (403)';
    if (status) return `the server answered ${status}`;
    return err instanceof Error ? err.message : 'the upload failed';
};

const isRetryable = (err: unknown) => {
    const status = (err as { response?: { status?: number } })?.response?.status;
    return !status || status >= 500 || status === 408 || status === 429;
};

export const startDropUpload = async (files: DroppedFile[], skipped: SkippedFile[]) => {
    if (isDropRunActive(useDropUploadStore.getState().run)) return;
    const server = useAuthStore.getState().currentServer;
    if (!server) return;
    const serverId = server.id;

    abortController = new AbortController();
    const { signal } = abortController;
    const bytesTotal = files.reduce((sum, f) => sum + f.file.size, 0);
    useDropUploadStore.setState({
        run: {
            activeFiles: [],
            bytesTotal,
            bytesUploaded: 0,
            error: null,
            imported: [],
            notImported: [],
            phase: 'checking',
            skipped,
            storageInfo: null,
            total: files.length,
            uploaded: 0,
            uploadFailed: [],
        },
    });

    if (files.length === 0) {
        patch({ phase: 'done' });
        return;
    }

    if (ipcless) window.addEventListener('beforeunload', warnBeforeUnload);
    try {
        // ── Room for it? Refuse the whole drop up front rather than fill the
        //    quota part-way through, as the Rekordbox upload does.
        try {
            const storage = await PymixController.checkStorage({
                baseUrl: urlConfig.pymix,
                query: { uploadSizeBytes: bytesTotal },
            });
            if (storage.allowed === false) {
                patch({
                    error: storage.reason || null,
                    phase: 'storage',
                    storageInfo: {
                        currentUsageBytes: storage.currentUsageBytes,
                        maxStorageBytes: storage.maxStorageBytes,
                    },
                });
                return;
            }
        } catch (err) {
            // A check that can't be made isn't a refusal; the import still runs
            // against the real quota.
            console.warn('[drop-upload] storage check failed, uploading anyway', err);
        }

        // ── What each track will be called in the library, and what the library
        //    looks like before it arrives.
        const names = new Map<DroppedFile, Set<string>>();
        await pool(files, 4, async (f) => {
            names.set(f, await namesFor(f.file));
        });
        const listLimit = files.length + 50;
        let before: Set<string>;
        try {
            before = new Set((await recentSongs(serverId, listLimit)).map((s) => s.id));
        } catch (err) {
            patch({
                error: `Couldn't read your library before uploading: ${describeUploadError(err)}`,
                phase: 'error',
            });
            return;
        }

        // ── Upload into a folder of its own, so this drop's files can't collide
        //    with a same-named file still waiting in watch/ and the run can tell
        //    when pymix has picked them up. No leading "." — beets skips those.
        const batch = `subbox-drop-${new Date().toISOString().replace(/[:.]/g, '-')}`;
        patch({ phase: 'uploading' });
        const loaded = new Map<DroppedFile, number>();
        const uploadedFiles: DroppedFile[] = [];
        const uploadFailed: SkippedFile[] = [];
        const active = new Set<string>();
        const report = () =>
            patch({
                activeFiles: Array.from(active),
                bytesUploaded: Array.from(loaded.values()).reduce((a, b) => a + b, 0),
                uploaded: uploadedFiles.length,
                uploadFailed: [...uploadFailed],
            });

        await pool(files, UPLOAD_CONCURRENCY, async (f) => {
            if (signal.aborted) return;
            active.add(f.relativePath);
            report();
            for (let attempt = 1; attempt <= UPLOAD_ATTEMPTS; attempt++) {
                try {
                    await fbResourceUpload({
                        baseUrl: urlConfig.filebrowser,
                        body: f.file,
                        onUploadProgress: (bytes) => {
                            loaded.set(f, bytes);
                            report();
                        },
                        resourcePath: `watch/${batch}/${f.relativePath}`,
                        signal,
                        // Read per attempt: the interceptor may have refreshed it.
                        token: useAuthStore.getState().currentServer?.fbToken,
                    });
                    loaded.set(f, f.file.size);
                    uploadedFiles.push(f);
                    break;
                } catch (err) {
                    if (signal.aborted) break;
                    if (attempt === UPLOAD_ATTEMPTS || !isRetryable(err)) {
                        loaded.delete(f);
                        uploadFailed.push({
                            reason: describeUploadError(err),
                            relativePath: f.relativePath,
                        });
                        break;
                    }
                    await sleep(RETRY_DELAYS_MS[attempt - 1], signal);
                }
            }
            active.delete(f.relativePath);
            report();
        });

        if (ipcless) window.removeEventListener('beforeunload', warnBeforeUnload);

        if (signal.aborted) {
            patch({ activeFiles: [], phase: 'cancelled' });
            return;
        }
        if (uploadedFiles.length === 0) {
            patch({
                activeFiles: [],
                error: 'None of the files could be uploaded.',
                phase: 'error',
            });
            return;
        }

        // ── Wait for pymix to stage the batch out of watch/.
        patch({ activeFiles: [], phase: 'staging' });
        const stagingDeadline = Date.now() + STAGING_TIMEOUT_MS;
        for (;;) {
            let present = true;
            try {
                present = await fbResourceExists({
                    baseUrl: urlConfig.filebrowser,
                    resourcePath: `watch/${batch}`,
                    token: useAuthStore.getState().currentServer?.fbToken,
                });
            } catch {
                // A blip; ask again next time round.
            }
            if (!present) break;
            if (Date.now() > stagingDeadline) {
                patch({
                    error:
                        'Your files were uploaded, but Sub-box hasn’t started importing them. ' +
                        'They are kept and will import when it does; if they still haven’t ' +
                        'appeared in a few minutes, let us know on Discord.',
                    notImported: uploadedFiles.map((f) => f.relativePath),
                    phase: 'error',
                });
                return;
            }
            await sleep(POLL_MS);
        }

        // ── Wait for the tracks to land in the library.
        patch({ phase: 'importing' });
        const pending = new Set(uploadedFiles);
        const imported: string[] = [];
        let lastProgress = Date.now();
        const quietMs = importQuietMs(uploadedFiles.length);
        for (;;) {
            let newSongs: Song[] = [];
            try {
                newSongs = (await recentSongs(serverId, listLimit)).filter(
                    (s) => !before.has(s.id),
                );
            } catch {
                // Try again next poll.
            }
            const claimed = new Set<string>();
            for (const f of Array.from(pending)) {
                const match = newSongs.find(
                    (s) => !claimed.has(s.id) && names.get(f)?.has(normalise(s.name)),
                );
                if (match) {
                    claimed.add(match.id);
                    pending.delete(f);
                    imported.push(f.relativePath);
                    lastProgress = Date.now();
                }
            }
            // As many new tracks as files uploaded is done, even if a title didn't
            // match the way it was guessed (beets can rewrite one).
            if (newSongs.length >= uploadedFiles.length) {
                imported.push(...Array.from(pending, (f) => f.relativePath));
                pending.clear();
            }
            patch({ imported: [...imported] });
            if (pending.size === 0 || Date.now() - lastProgress > quietMs) break;
            await sleep(POLL_MS);
        }

        invalidateTrackLists(queryClient, serverId);
        const notImported = Array.from(pending, (f) => f.relativePath);
        patch({ imported, notImported, phase: notImported.length ? 'error' : 'done' });
        if (notImported.length) {
            toast.error({
                message: `${notImported.length} of ${uploadedFiles.length} uploaded tracks didn’t reach your library.`,
                title: 'Upload finished with problems',
            });
        } else {
            toast.success({
                message: `${imported.length} track${imported.length === 1 ? '' : 's'} added to your library.`,
                title: 'Upload complete',
            });
        }
    } catch (err) {
        console.error('[drop-upload] failed', err);
        patch({
            activeFiles: [],
            error: err instanceof Error ? err.message : 'The upload failed.',
            phase: 'error',
        });
    } finally {
        if (ipcless) window.removeEventListener('beforeunload', warnBeforeUnload);
        abortController = null;
    }
};
