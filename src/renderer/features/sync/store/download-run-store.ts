import type { SeratoWriteResult } from '/@/renderer/features/sync/components/shared/use-serato-crates';

import isElectron from 'is-electron';
import { createWithEqualityFn } from 'zustand/traditional';

import { toast } from '/@/shared/components/toast/toast';

/**
 * The one desktop Download that is running, or has just finished.
 *
 * Here and not in SyncDownload for the reason the upload run is in its own store
 * (upload-run-store.ts, laker-93/subbox-app#195): a whole-library download takes
 * hours (subbox-app#328), and the user has to be able to browse and play while it
 * runs. The download itself runs in the main process and never depended on the
 * screen; what didn't survive leaving it was the screen's own state, so Download
 * came back on a fresh select screen with no sign of the run, its progress or its
 * result. The screen now renders a run from here and starts one through
 * `startDownloadRun`. Everything before it (the selection, the preview) stays
 * component state.
 *
 * Not persisted: a renderer reload or an app restart loses the run (and the main
 * process's download with it). Pressing Download again resumes: finished files
 * are skipped.
 */

const ipc = isElectron() ? window.api.ipc : null;

/** What the main process reports while a download job runs. */
export interface DownloadProgress {
    activeTracks: string[];
    bytesDone: number;
    bytesTotal: number;
    nDone: number;
    nTotal: number;
    phase: 'collect' | 'manifest' | 'tracks' | 'xml';
    tracksFailed: number;
    tracksSkipped: number;
}

export interface DownloadRun {
    error: null | string;
    includeRekordboxXml: boolean;
    includeTracks: boolean;
    progress: DownloadProgress | null;
    result: DownloadRunResult | null;
    seratoResult: null | SeratoWriteResult;
    /** The server this run belongs to, so a run is never shown to another account. */
    serverId: string;
    step: 'done' | 'downloading' | 'error';
}

export interface DownloadRunResult {
    musicPath?: string;
    tracksExported: number;
    tracksInPlace?: number;
    warnings?: string;
    xmlPath?: string;
}

interface DownloadRunState {
    run: DownloadRun | null;
    /** Bumped per run, so a late update from a finished run can't land on its successor. */
    runToken: number;
}

export const useDownloadRunStore = createWithEqualityFn<DownloadRunState>()(() => ({
    run: null,
    runToken: 0,
}));

export const isDownloadRunActive = (run: DownloadRun | null): boolean =>
    run?.step === 'downloading';

/** The current server's run, if any. */
export const useDownloadRun = (serverId: string | undefined): DownloadRun | null =>
    useDownloadRunStore((state) =>
        state.run && state.run.serverId === serverId ? state.run : null,
    );

export const useDownloadRunActive = (): boolean =>
    useDownloadRunStore((state) => isDownloadRunActive(state.run));

/** Forget a finished run, so Download goes back to its first screen. A running one
 *  is kept: it is cancelled with Cancel, not forgotten. */
export const clearDownloadRun = () => {
    if (isDownloadRunActive(useDownloadRunStore.getState().run)) return;
    useDownloadRunStore.setState({ run: null });
};

const update = (token: number, patch: Partial<DownloadRun>) => {
    const state = useDownloadRunStore.getState();
    if (state.runToken !== token || !state.run) return;
    useDownloadRunStore.setState({ run: { ...state.run, ...patch } });
};

// One listener for the life of the renderer, not one per mounted screen: progress
// keeps arriving while the user is in the library.
if (ipc) {
    ipc.on('sync:download-progress', (_event: unknown, progress: DownloadProgress) => {
        const { run, runToken } = useDownloadRunStore.getState();
        if (run?.step === 'downloading') update(runToken, { progress });
    });
}

/** Electron's IPC bridge prefixes a main-process error with "Error invoking remote
 *  method '...': Error: ". The user should see only the message. */
export const ipcErrorMessage = (err: unknown): string =>
    ((err as Error | undefined)?.message ?? '').replace(
        /^Error invoking remote method '[^']*': (Error: )?/,
        '',
    );

/**
 * Start a desktop download and see it through to the end, whether or not the
 * Download screen is still open.
 *
 * `downloadArgs` is sync:download-playlists' argument, or null for a crates-only
 * run that fetches nothing. `afterAudio` writes the Serato crates, after the audio
 * and only then (a crate names files that must already be there); it returns what
 * it wrote, or nothing when no crates were asked for.
 */
export async function startDownloadRun(args: {
    afterAudio: (musicPath: string) => Promise<null | SeratoWriteResult | undefined>;
    downloadArgs: null | Record<string, unknown>;
    includeRekordboxXml: boolean;
    includeTracks: boolean;
    serverId: string;
}): Promise<void> {
    if (!ipc) return;
    if (isDownloadRunActive(useDownloadRunStore.getState().run)) return;
    const token = useDownloadRunStore.getState().runToken + 1;
    useDownloadRunStore.setState({
        run: {
            error: null,
            includeRekordboxXml: args.includeRekordboxXml,
            includeTracks: args.includeTracks,
            progress: null,
            result: null,
            seratoResult: null,
            serverId: args.serverId,
            step: 'downloading',
        },
        runToken: token,
    });

    try {
        const result: DownloadRunResult = args.downloadArgs
            ? ((await ipc.invoke(
                  'sync:download-playlists',
                  args.downloadArgs,
              )) as DownloadRunResult)
            : { tracksExported: 0 };
        update(token, { result });
        const seratoResult = (await args.afterAudio(result.musicPath ?? '')) ?? null;
        update(token, { seratoResult, step: 'done' });
        if (args.downloadArgs) {
            toast.success({
                message: args.includeTracks
                    ? `Download complete: ${result.tracksExported} track${result.tracksExported === 1 ? '' : 's'}.`
                    : 'Rekordbox XML downloaded.',
            });
        }
    } catch (err) {
        const message = ipcErrorMessage(err) || 'Download failed';
        toast.error({ message });
        update(token, { error: message, step: 'error' });
    }
}
