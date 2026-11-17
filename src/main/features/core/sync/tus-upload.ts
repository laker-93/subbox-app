import type { ClientRequest } from 'http';

import * as fs from 'fs';
import * as tus from 'tus-js-client';

import { TUS_RETRY_DELAYS_MS } from '/@/main/features/core/sync/network-retry';
import { FbAuth, fbRequest } from '/@/main/features/core/sync/pymix-auth';
import { uploadLog, UploadRun } from '/@/main/features/core/sync/upload-telemetry';

// ── TUS upload to filebrowser ───────────────────────────────────────────────
//
// Shared by the Rekordbox (./index.ts) and Serato (./serato.ts) upload flows,
// which each used to carry their own copy of this and drifted apart.

/**
 * Small enough that one chunk clears a 60s proxy read timeout — Traefik's
 * default, which prod runs with — on a ~2 Mbit/s upstream shared by three
 * concurrent uploads. At 20 MB a chunk needed ~8 Mbit/s and was cut off
 * mid-body on slower home links (subbox-app#136). Chunk size is the client's
 * only defence against any proxy timeout between it and filebrowser.
 */
const CHUNK_SIZE = 5 * 1024 * 1024;

/**
 * Retries allowed on a `409` (offset mismatch). One is worth it: the retry
 * re-reads the offset with HEAD and can resync. Past that, filebrowser's view
 * of the offset and the bytes on disk disagree and every PATCH will 409 until
 * the upload is dropped — prod looped on this for 40 minutes.
 */
const MAX_OFFSET_CONFLICT_RETRIES = 1;

/**
 * Retries allowed across one upload attempt, whatever the cause. tus resets its
 * own attempt counter whenever the offset advances, so on its own it will retry
 * a chunk that keeps getting cut off forever.
 */
const MAX_RETRIES = 10;

/**
 * How long a request may move no bytes, either way, before it is aborted and
 * retried. tus-js-client sets no timeout of its own, so a connection that dies
 * without a reset (a wifi or NAT drop mid-chunk is the usual case) left its PATCH
 * waiting on the OS. On 2026-11-16 that froze all three uploads of a beta user's
 * 18 GB Serato upload for 11 minutes, and then froze them for good, 4 GB in.
 * Aborted, the request fails like any dropped connection: tus
 * retries it, resuming from the offset the server has, and a real outage pauses
 * the queue. 60s is Traefik's own read timeout, so nothing slower would ever have
 * succeeded anyway, and at CHUNK_SIZE a working link never goes that long idle.
 */
export const STALL_TIMEOUT_MS = 60_000;

/**
 * tus's Node HTTP stack with an idle timeout on every request. A socket idle for
 * `STALL_TIMEOUT_MS` (no bytes written or read) is destroyed with an `ETIMEDOUT`
 * error, which tus and `isNetworkError` both treat as a network failure.
 */
class StallTimeoutHttpStack implements tus.HttpStack {
    private readonly inner = new tus.DefaultHttpStack({ rejectUnauthorized: false });

    constructor(private readonly onStall: () => void) {}

    createRequest(method: string, url: string): tus.HttpRequest {
        const req = this.inner.createRequest(method, url);
        const send = req.send.bind(req);
        req.send = (body: unknown) => {
            const sent = send(body);
            // The Node stack creates its ClientRequest synchronously inside send().
            const raw = req.getUnderlyingObject() as ClientRequest | null;
            raw?.setTimeout(STALL_TIMEOUT_MS, () => {
                this.onStall();
                raw.destroy(
                    Object.assign(
                        new Error(`no data moved for ${STALL_TIMEOUT_MS / 1000}s on ${method}`),
                        { code: 'ETIMEDOUT' },
                    ),
                );
            });
            return sent;
        };
        return req;
    }

    getName(): string {
        return 'StallTimeoutHttpStack';
    }
}

/** One line for a tus error: status if there was a response, else the cause. */
const describeTusError = (err: unknown): string => {
    if (err instanceof tus.DetailedError) {
        const status = err.originalResponse?.getStatus();
        const method = err.originalRequest?.getMethod();
        if (status) return `${method ?? 'request'} answered ${status}`;
        const cause = err.causingError as (Error & { code?: string }) | null;
        if (cause)
            return `${method ?? 'request'} failed: ${cause.code ?? ''} ${cause.message}`.trim();
    }
    return err instanceof Error ? err.message : String(err);
};

const statusOf = (err: unknown): null | number =>
    err instanceof tus.DetailedError ? (err.originalResponse?.getStatus() ?? null) : null;

/**
 * Statuses that mean the upload can't be resumed, only started again: `409`, an
 * offset mismatch, and `404`/`410`, the upload is gone. filebrowser deletes an
 * upload that has had no PATCH for ~3 minutes, about as long as tus's own retry
 * backoff, so a stall of a few minutes ends with the retry landing on a deleted
 * upload (subbox-app#208).
 */
const RESTART_STATUSES = new Set([404, 409, 410]);

/**
 * Auth and retry policy for one `tus.Upload`.
 *
 * `X-Auth` is read from `fbAuth` on every request rather than fixed when the
 * upload is built, so a token refreshed by any other request is picked up
 * (subbox-app#137). A 401 refreshes the token in `onAfterResponse` — tus awaits
 * that hook, whereas `onShouldRetry` is synchronous and can't — and the retry
 * then goes out with the new token.
 */
const tusOptions = (
    fbAuth: FbAuth,
    trackName: string,
    run?: UploadRun,
): Pick<tus.UploadOptions, 'onAfterResponse' | 'onBeforeRequest' | 'onShouldRetry'> => {
    let refreshed = false;
    let conflicts = 0;
    let retries = 0;

    return {
        onAfterResponse: async (_req, res) => {
            if (res.getStatus() === 401) {
                refreshed = (await fbAuth.refresh()) !== null;
            }
        },
        onBeforeRequest: (req) => {
            req.setHeader('X-Auth', fbAuth.getToken());
        },
        onShouldRetry: (err, retryAttempt, options) => {
            const retry = (() => {
                if (++retries > MAX_RETRIES) return false;
                const status = statusOf(err);
                if (status === 401) return refreshed;
                if (status === 409) return ++conflicts <= MAX_OFFSET_CONFLICT_RETRIES;
                return tus.defaultOptions.onShouldRetry?.(err, retryAttempt, options) ?? false;
            })();
            // Each retry is logged with its cause: what's missing from a run that
            // went wrong is usually *why* the chunk failed, not that it did.
            if (retry) {
                const reason = `${describeTusError(err)} (retry ${retries}/${MAX_RETRIES})`;
                if (run) run.retried(trackName, reason);
                else uploadLog.warn(`retrying "${trackName}": ${reason}`);
            }
            return retry;
        },
    };
};

/**
 * Upload one file to filebrowser's `uploads/` at `stagingPath`.
 *
 * Creates the upload with `?override=true`, then sends it in chunks. If the
 * upload ends on an offset mismatch or is found deleted, it is re-created from
 * offset 0 once — the override create discards any partial file — and a second
 * failure rejects, so the caller can record the track as failed rather than spin
 * on it.
 */
export async function uploadFileViaTus(args: {
    fbAuth: FbAuth;
    filebrowserUrl: string;
    filePath: string;
    onProgress: (bytesUploaded: number, bytesTotal: number) => void;
    /** The run this file belongs to, told about its retries, stalls and restarts. */
    run?: UploadRun;
    stagingPath: string;
    trackName: string;
}): Promise<void> {
    const { fbAuth, filebrowserUrl, filePath, onProgress, run, stagingPath, trackName } = args;
    const startedAt = Date.now();
    // Fail fast and cleanly on a file this process can't read (permission denied, a
    // cloud-sync placeholder, a lock held by another app). `statSync` above would
    // succeed even on a chmod-000 file (it only needs directory traverse permission,
    // not read access to the file itself) — if left to tus-js-client, each retry
    // opens the file itself via its own internal fs.createReadStream with no error
    // listener, which throws as an uncaught exception instead of rejecting here.
    fs.accessSync(filePath, fs.constants.R_OK);
    const fileSize = fs.statSync(filePath).size;
    // Encode each path segment individually so `/` separators remain real slashes in
    // the URL. Using encodeURIComponent on the whole path encodes `/` as `%2F` which
    // causes filebrowser to track the TUS upload state at a different URL than the
    // one the client uses for HEAD/PATCH, producing 404s on resume.
    const encodedStagingPath = stagingPath.split('/').map(encodeURIComponent).join('/');
    const resourcePath = `${filebrowserUrl}/api/tus/uploads/${encodedStagingPath}?override=true`;

    const attempt = async () => {
        const createResp = await fbRequest(fbAuth, {
            data: null,
            headers: { 'upload-length': fileSize },
            method: 'post',
            // axios has no timeout by default either: the same silent drop would
            // hang the create as it did a PATCH.
            timeout: STALL_TIMEOUT_MS,
            url: resourcePath,
        });
        if (createResp.status !== 201) {
            throw new Error(`Failed to create TUS upload for "${trackName}": ${createResp.status}`);
        }

        // Use the Location header returned by the server as the canonical TUS upload URL.
        // The creation URL (with ?override=true) is only for creation; HEAD/PATCH must
        // use the URL the server assigned to the upload. The header is server-root-relative
        // and already includes filebrowser's own base path (e.g. "/browser/api/tus/..." when
        // VITE_FILEBROWSER_URL is ".../browser") — resolve it against the origin only, not
        // the full filebrowserUrl, or that base path gets doubled.
        const rawLocation = createResp.headers['location'] as string | undefined;
        const uploadUrl = rawLocation
            ? rawLocation.startsWith('http')
                ? rawLocation
                : `${new URL(filebrowserUrl).origin}${rawLocation}`
            : resourcePath;

        await new Promise<void>((resolve, reject) => {
            const fileStream = fs.createReadStream(filePath);
            // tus-js-client's Node FileReader sees this is a ReadStream with a `.path`
            // and reads the file itself via that path (FileSource), never consuming
            // `fileStream` as a stream — so when creating `fileStream` fails to open
            // the file (permission denied, deleted/locked between the pre-upload
            // existsSync check and here), the resulting 'error' event has no listener
            // and Node rethrows it as an uncaught exception. The global handler in
            // src/main/index.ts swallows that, but the ipc call this promise belongs
            // to then never resolves, hanging the renderer forever instead of failing
            // just this one track (found live via a chmod'd-unreadable fixture file).
            fileStream.on('error', reject);
            const uploader = new tus.Upload(fileStream as unknown as Buffer, {
                ...tusOptions(fbAuth, trackName, run),
                chunkSize: CHUNK_SIZE,
                // Accepts dev's self-signed certs, and aborts a request that stalls.
                httpStack: new StallTimeoutHttpStack(() => {
                    if (run) run.stalled(trackName, STALL_TIMEOUT_MS / 1000);
                    else uploadLog.warn(`"${trackName}": no data moved, aborting the request`);
                }),
                onError: reject,
                onProgress: (bytesUploaded, bytesTotal) => {
                    run?.fileProgress(trackName, bytesUploaded);
                    onProgress(bytesUploaded, bytesTotal);
                },
                onSuccess: () => resolve(),
                // Ride out a dropped connection mid-file (subbox-app#203).
                retryDelays: TUS_RETRY_DELAYS_MS,
                uploadSize: fileSize,
                uploadUrl,
            });
            uploader.start();
        });
    };

    try {
        try {
            await attempt();
        } catch (err) {
            const status = statusOf(err);
            if (status === null || !RESTART_STATUSES.has(status)) throw err;
            if (run) run.restarted(trackName, status);
            else uploadLog.warn(`"${trackName}" can't be resumed (${status}), restarting from 0`);
            await attempt();
        }
    } catch (err) {
        // Rethrown with the cause in the message: the caller records only the
        // message, and tus's own reads "failed to upload chunk at offset N".
        const reason = describeTusError(err);
        if (err instanceof Error && !err.message.includes(reason)) {
            err.message = `${err.message} [${reason}]`;
        }
        throw err;
    }
    run?.fileSent(trackName, fileSize, Date.now() - startedAt);
}
