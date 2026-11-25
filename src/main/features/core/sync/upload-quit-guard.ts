import { BrowserWindow, dialog } from 'electron';

import { abandonActiveDownloads } from '/@/main/features/core/sync/download-telemetry';
import {
    abandonActiveUploads,
    activeUploads,
    uploadLog,
    type UploadRun,
} from '/@/main/features/core/sync/upload-telemetry';

// ── Asking before an exit that would cut an upload short ────────────────────
//
// The audio goes from this process straight to filebrowser, so quitting the app
// stops it, and so does closing the window: the upload reports its progress to the
// window's renderer, and sending to a destroyed one throws. Before this nothing
// asked. The renderer can't (a `beforeunload` handler in Electron silently blocks
// the window from closing), so it is a native prompt from here, wired into each of
// main/index.ts's exit paths.

// Runs the user already agreed to give up. Per run, not a flag: on macOS closing
// the window leaves the app running, and a later upload deserves its own prompt.
const confirmed = new WeakSet<UploadRun>();

// One quit can ask twice: on macOS a single app.quit() reached the before-quit
// handler twice in testing. A "no" just given answers the second ask too, rather
// than putting the same prompt up again.
const ANSWER_HOLDS_MS = 1000;
let declinedAt = 0;

/**
 * True when it's fine to quit or close now: nothing is uploading, the user
 * already said yes, or they say yes to the prompt. Asking is synchronous so a
 * `before-quit` or window `close` handler can still `preventDefault` on a no.
 */
export function mayExitDuringUpload(win: BrowserWindow | null, verb: 'close' | 'quit'): boolean {
    const ok = asked(win, verb);
    // A download carries on with the window closed, so only a quit abandons one.
    // Its last report says so; without it the server reads the silence the same way.
    if (ok && verb === 'quit') abandonActiveDownloads();
    return ok;
}

function asked(win: BrowserWindow | null, verb: 'close' | 'quit'): boolean {
    const runs = activeUploads();
    if (runs.every((r) => confirmed.has(r))) return true;
    if (Date.now() - declinedAt < ANSWER_HOLDS_MS) return false;

    const options = {
        buttons: ['Keep uploading', verb === 'quit' ? 'Quit anyway' : 'Close anyway'],
        cancelId: 0,
        defaultId: 0,
        detail:
            `${runs.map((r) => r.progressLine()).join('; ')}. ` +
            `${verb === 'quit' ? 'Quitting' : 'Closing the window'} now stops the upload. ` +
            'If you do, start it again later: files already sent are skipped.',
        message: 'An upload is still running',
        type: 'warning' as const,
    };
    const choice =
        win && !win.isDestroyed()
            ? dialog.showMessageBoxSync(win, options)
            : dialog.showMessageBoxSync(options);
    if (choice !== 1) {
        declinedAt = Date.now();
        uploadLog.info(`${verb} cancelled: the user chose to keep uploading`);
        return false;
    }
    for (const r of runs) confirmed.add(r);
    abandonActiveUploads();
    return true;
}
