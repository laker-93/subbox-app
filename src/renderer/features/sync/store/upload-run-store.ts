import isElectron from 'is-electron';
import { createWithEqualityFn } from 'zustand/traditional';

import { isUploadForbidden, PymixController } from '/@/renderer/api/pymix/pymix-controller';
import { urlConfig } from '/@/renderer/config/url-config';
import { refreshPlaylistsAfterImport } from '/@/renderer/features/playlist-tree/hooks/use-playlist-tree';
import { describeJobWork, type ImportProgress } from '/@/renderer/features/sync/components/shared';
import { queryClient } from '/@/renderer/lib/react-query';
import { toast } from '/@/shared/components/toast/toast';

/**
 * The one Rekordbox or Serato upload that is running, or has just finished.
 *
 * This lives here and not in the flow components because a run has to outlive the
 * screen that started it (laker-93/subbox-app#195). The file upload already runs in
 * the main process and carried on after the user left Upload, and so did the pymix
 * job it started. What didn't survive was the component: its poll loop stopped when
 * it unmounted, so the toast, the playlist refresh and any failure were lost, and
 * Upload came back on a fresh idle screen. That reads as "the upload failed", and the
 * obvious reaction, uploading again, overlaps two runs in `uploads/`.
 *
 * The components render a run from here and start one through `startRekordboxUpload`
 * / `startSeratoUpload`. Everything before the run (picking the XML or the crates,
 * the preview) stays component state, since leaving that behind loses nothing.
 *
 * Not persisted. A renderer reload or an app restart still loses the run, because
 * the job id is only held in memory; finding a job again needs it persisted, or a
 * pymix "active jobs for this user" route.
 */

const ipc = isElectron() ? window.api.ipc : null;

export interface RekordboxUploadProgress {
    activeTracks?: string[];
    currentTrack: string;
    phase: 'done' | 'error' | 'mapping-metadata' | 'matching' | 'uploading';
    total: number;
    uploaded: number;
}

/** What a Rekordbox run was started with, kept so "Retry" can start it again. */
export interface RekordboxUploadRequest {
    metadataOnly: boolean;
    /** Leaf names, for the main process's upload. */
    playlistNames: string[];
    /** Full paths for pymix, or null for "every track" (metadata-only, none selected). */
    selectedPlaylistPaths: null | string[][];
    xmlPath: string;
}

// `dropped` holds tracks the XML lists that could never be uploaded: their tags leave
// nothing to match on. They are counted in neither totalTracksInXml nor the preview
// badge, so the completion screen names them rather than letting them vanish into a
// gap between two numbers.
export interface RekordboxUploadResult {
    dropped?: TrackProblem[];
    failed?: TrackProblem[];
    skipped: number;
    totalTracksInXml?: number;
    uploaded: number;
}

export interface SeratoUploadProgress {
    activeTracks?: string[];
    currentTrack: string;
    phase: 'checking' | 'done' | 'error' | 'identifying' | 'mapping-metadata' | 'uploading';
    total: number;
    uploaded: number;
}

export interface SeratoUploadRequest {
    crateKeys: string[][];
    cratesOnly: boolean;
    seratoFolder: string;
}

export interface SeratoUploadResult {
    dropped?: TrackProblem[];
    failed?: TrackProblem[];
    skipped: number;
    totalTracksInCrates: number;
    trackIdentities: Array<{ crate_path: string; subbox_id: string }>;
    uploaded: number;
}

export type UploadFormat = 'rekordbox' | 'serato';

export type UploadRun =
    | (UploadRunBase & {
          format: 'rekordbox';
          progress: null | RekordboxUploadProgress;
          request: RekordboxUploadRequest;
          uploadResult: null | RekordboxUploadResult;
      })
    | (UploadRunBase & {
          format: 'serato';
          progress: null | SeratoUploadProgress;
          request: SeratoUploadRequest;
          uploadResult: null | SeratoUploadResult;
      });

/** The parts of the current server a run needs. */
export interface UploadRunServer {
    fbToken?: string;
    id: string;
    username: string;
}

export type UploadRunStep =
    | 'done'
    | 'importing'
    | 'storage-exceeded'
    /** The tracks are on the server but tagging them didn't finish, so the way on
     *  is finishing the import, not uploading again (laker-93/pymix#237). */
    | 'tagging-failed'
    /** The upload threw before anything was imported. The flow takes the error back
     *  to its preview screen, where the user can try again, and clears the run. */
    | 'upload-error'
    | 'upload-failed'
    | 'upload-forbidden'
    | 'uploading';

interface TrackProblem {
    reason: string;
    trackName: string;
}

interface UploadRunBase {
    error: null | string;
    importProgress: ImportProgress | null;
    jobId: null | string;
    /** The server this run belongs to, so a run is never shown to another account. */
    serverId: string;
    step: UploadRunStep;
    storageInfo: null | {
        currentUsageBytes: number;
        maxStorageBytes: number;
        remainingBytes?: number;
    };
}

interface UploadRunState {
    run: null | UploadRun;
    /** Bumped per run, so a late update from a finished run can't land on its successor. */
    runToken: number;
}

export const useUploadRunStore = createWithEqualityFn<UploadRunState>()(() => ({
    run: null,
    runToken: 0,
}));

const IMPORT_POLL_MS = 3000;

export const isUploadRunActive = (run: null | UploadRun): boolean =>
    run?.step === 'uploading' || run?.step === 'importing';

/** The current server's run, if any. A run started by another account is not shown. */
export const useUploadRun = (serverId: string | undefined): null | UploadRun =>
    useUploadRunStore((state) => (state.run && state.run.serverId === serverId ? state.run : null));

export const useUploadRunActive = (): boolean =>
    useUploadRunStore((state) => isUploadRunActive(state.run));

/** Forget a finished run, so Upload goes back to its first screen. A running one is
 *  kept: there is no cancel, and forgetting it is exactly the bug this store fixes. */
export const clearUploadRun = () => {
    const { run } = useUploadRunStore.getState();
    if (isUploadRunActive(run)) return;
    useUploadRunStore.setState({ run: null });
};

const update = (token: number, patch: Partial<UploadRunBase> & Record<string, unknown>) => {
    const state = useUploadRunStore.getState();
    if (state.runToken !== token || !state.run) return;
    useUploadRunStore.setState({ run: { ...state.run, ...patch } as UploadRun });
};

/**
 * Claim the one run slot. Overlapping runs aren't safe: pymix imports everything in
 * the user's `uploads/`, not just one run's files (laker-93/subbox-app#138), so a
 * second run would import the first's files half-uploaded.
 */
const beginRun = (run: UploadRun): null | number => {
    if (isUploadRunActive(useUploadRunStore.getState().run)) {
        toast.warn({
            message:
                'An upload is already running. Wait for it to finish before starting another; running two at once can import one run’s files half-uploaded.',
        });
        return null;
    }
    const token = useUploadRunStore.getState().runToken + 1;
    useUploadRunStore.setState({ run, runToken: token });
    return token;
};

const baseRun = (serverId: string): UploadRunBase => ({
    error: null,
    importProgress: null,
    jobId: null,
    serverId,
    step: 'uploading',
    storageInfo: null,
});

/**
 * Pre-flight storage check. Renderer-side and approximate: the main process does an
 * exact one once it knows what it is actually sending. Returns the figures when the
 * account is already full, and null otherwise, including when the check itself fails.
 */
const checkStorageFull = async (): Promise<UploadRunBase['storageInfo']> => {
    try {
        const storage = await PymixController.checkStorage({
            baseUrl: urlConfig.pymix,
            query: { uploadSizeBytes: 0 },
        });
        if (storage.allowed) return null;
        console.warn('[storage-check] pre-flight blocked:', storage);
        return {
            currentUsageBytes: storage.currentUsageBytes,
            maxStorageBytes: storage.maxStorageBytes,
            remainingBytes: storage.remainingBytes,
        };
    } catch (storageErr) {
        console.warn('[storage-check] pre-flight threw — proceeding anyway:', storageErr);
        return null;
    }
};

/** Turn an upload-stage error into the step it belongs on. */
const failUpload = (token: number, err: any) => {
    if (isUploadForbidden(err)) {
        update(token, { step: 'upload-forbidden' });
        return;
    }
    const msg: string = err?.message || 'Upload failed';
    // Matched as prefixes: the main process's message arrives wrapped by IPC.
    const mapMetaPrefix = 'MAP_META_FAILED:';
    const mapMetaIdx = msg.indexOf(mapMetaPrefix);
    const storagePrefix = 'STORAGE_LIMIT_EXCEEDED:';
    const idx = msg.indexOf(storagePrefix);
    if (mapMetaIdx !== -1) {
        update(token, {
            error: msg.slice(mapMetaIdx + mapMetaPrefix.length),
            step: 'tagging-failed',
        });
    } else if (idx !== -1) {
        update(token, { error: msg.slice(idx + storagePrefix.length), step: 'storage-exceeded' });
    } else {
        update(token, { error: msg, step: 'upload-error' });
    }
};

/** Start the pymix import and poll it to the end. */
const runImport = async (
    token: number,
    serverId: string,
    startImport: () => Promise<undefined | { job_id?: null | string; reason?: null | string }>,
    successMessage: (prog: ImportProgress) => string,
) => {
    let jobId: string;
    try {
        const importResult = await startImport();
        if (!importResult?.job_id) {
            throw new Error(`Import failed: ${importResult?.reason || 'Unknown error'}`);
        }
        jobId = importResult.job_id;
    } catch (importErr: any) {
        // A refused write is an account limit, not a failure: say so instead of
        // showing "Import Failed" over something that was never going to work.
        if (isUploadForbidden(importErr)) {
            update(token, { step: 'upload-forbidden' });
        } else {
            update(token, { error: importErr?.message || 'Import failed', step: 'done' });
        }
        return;
    }

    // Poll even when nothing was uploaded: pymix runs the playlist and metadata
    // passes for a metadata-only or playlists-only import too, and the job is the
    // only thing that can say it finished (laker-93/subbox-app#55).
    update(token, { importProgress: null, jobId, step: 'importing' });

    for (;;) {
        let prog: ImportProgress;
        try {
            prog = (await PymixController.importProgress({
                baseUrl: urlConfig.pymix,
                query: { job_id: jobId, public: false },
            })) as ImportProgress;
        } catch (err: any) {
            update(token, {
                error: err?.message || 'Failed to check import progress',
                step: 'done',
            });
            return;
        }
        if (useUploadRunStore.getState().runToken !== token) return;
        update(token, { importProgress: prog });

        if (!prog.in_progress) {
            // The import made playlists (and tree nodes), even if it failed part way.
            refreshPlaylistsAfterImport(queryClient, serverId);
            if (prog.result) {
                update(token, { step: 'done' });
                toast.success({ message: successMessage(prog) });
            } else {
                const reason = prog.reason || 'Import failed';
                update(token, { error: reason, step: 'done' });
                // The user may be anywhere in the app by now, and the Upload screen
                // is the only other place this would ever be said.
                toast.error({ message: `Import failed: ${reason}` });
            }
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, IMPORT_POLL_MS));
    }
};

/** Forward the main process's progress events for as long as the upload runs. */
const listenForProgress = (token: number, channel: string): (() => void) => {
    if (!ipc) return () => {};
    const handler = (_event: unknown, progress: unknown) => update(token, { progress });
    ipc.on(channel, handler);
    return () => ipc.removeListener(channel, handler);
};

export const startRekordboxUpload = async (
    request: RekordboxUploadRequest,
    server: UploadRunServer,
): Promise<void> => {
    if (!ipc) return;
    const token = beginRun({
        ...baseRun(server.id),
        format: 'rekordbox',
        progress: null,
        request,
        uploadResult: null,
    });
    if (token === null) return;

    // The name the XML was uploaded under, so pymix imports this run's XML and not a
    // leftover of an earlier one beside it (laker-93/pymix#192).
    let xmlFileName: string;
    const stopListening = listenForProgress(token, 'sync:upload-progress');
    try {
        if (request.metadataOnly) {
            ({ xmlFileName } = await ipc.invoke('sync:upload-xml', {
                filebrowserToken: server.fbToken,
                filebrowserUrl: urlConfig.filebrowser,
                // serverId/username let the main process re-login for a fresh
                // filebrowser token if this upload outlives the current one.
                serverId: server.id,
                username: server.username,
                xmlPath: request.xmlPath,
            }));
            update(token, { uploadResult: { dropped: [], failed: [], skipped: 0, uploaded: 0 } });
        } else {
            const storageInfo = await checkStorageFull();
            if (storageInfo) {
                update(token, { step: 'storage-exceeded', storageInfo });
                return;
            }

            const result = await ipc.invoke('sync:upload-from-xml', {
                filebrowserToken: server.fbToken,
                filebrowserUrl: urlConfig.filebrowser,
                playlistNames: request.playlistNames,
                pymixUrl: urlConfig.pymix,
                // serverId lets the main process re-login for a fresh pymix session
                // cookie if this upload outlives the current one.
                serverId: server.id,
                username: server.username,
                xmlPath: request.xmlPath,
            });
            console.log('Upload result:', result);
            update(token, { uploadResult: result });
            xmlFileName = result.xmlFileName;

            // Every upload failed, so there is nothing of this run's to import. pymix
            // imports whatever is sitting in the user's uploads/ directory, not just
            // this run's files, so triggering it here imported leftovers of an
            // earlier run, untagged, while this run's playlists matched nothing
            // (laker-93/subbox-app#138).
            if (result.uploaded === 0 && result.failed.length > 0) {
                update(token, { step: 'upload-failed' });
                return;
            }
        }
    } catch (err: any) {
        failUpload(token, err);
        return;
    } finally {
        stopListening();
    }

    await runImport(
        token,
        server.id,
        () =>
            PymixController.rbImport({
                baseUrl: urlConfig.pymix,
                body: { playlistNames: request.selectedPlaylistPaths, xmlName: xmlFileName },
            }),
        (prog) => {
            // A metadata-only import lands no tracks, so "Imported 0 tracks" reads
            // like a failure on the run that is most often the point of re-importing
            // an XML. The server says what it did instead (#50).
            const [work] = describeJobWork(prog);
            return prog.n_tracks_processed > 0
                ? `Imported ${prog.n_tracks_processed} tracks`
                : (work ?? 'Library updated from your Rekordbox XML');
        },
    );
};

export const startSeratoUpload = async (
    request: SeratoUploadRequest,
    server: UploadRunServer,
): Promise<void> => {
    if (!ipc) return;
    const token = beginRun({
        ...baseRun(server.id),
        format: 'serato',
        progress: null,
        request,
        uploadResult: null,
    });
    if (token === null) return;

    let result: SeratoUploadResult;
    const stopListening = listenForProgress(token, 'sync:serato-progress');
    try {
        // Ask before reading tags off a few thousand files. "Playlists only" sends no
        // audio, so there is nothing to check.
        if (!request.cratesOnly) {
            const storageInfo = await checkStorageFull();
            if (storageInfo) {
                update(token, { step: 'storage-exceeded', storageInfo });
                return;
            }
        }

        result = await ipc.invoke('sync:upload-from-crates', {
            crateKeys: request.crateKeys,
            cratesOnly: request.cratesOnly,
            filebrowserToken: server.fbToken,
            filebrowserUrl: urlConfig.filebrowser,
            pymixUrl: urlConfig.pymix,
            seratoFolder: request.seratoFolder,
            // serverId/username let the main process re-login for a fresh filebrowser
            // token or pymix cookie if this outlives the current one.
            serverId: server.id,
            username: server.username,
        });
        update(token, { uploadResult: result });

        // Every upload failed: see the Rekordbox path. "Playlists only" uploads no
        // audio, so `failed` is always empty there and it still imports.
        if (result.uploaded === 0 && (result.failed?.length ?? 0) > 0) {
            update(token, { step: 'upload-failed' });
            return;
        }
    } catch (err: any) {
        failUpload(token, err);
        return;
    } finally {
        stopListening();
    }

    await runImport(
        token,
        server.id,
        // The manifest goes with the import, not with the upload: it is what tells
        // pymix which subbox track each crate entry means, and it covers tracks that
        // were already in the library as well as ones just sent.
        () =>
            PymixController.seratoImport({
                baseUrl: urlConfig.pymix,
                body: { track_identities: result.trackIdentities },
            }),
        (prog) =>
            prog.n_tracks_processed > 0
                ? `Imported ${prog.n_tracks_processed} tracks`
                : 'Your crates are now playlists in Sub-box',
    );
};
