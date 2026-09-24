import * as fs from 'fs';
import * as tus from 'tus-js-client';

import { FbAuth, fbRequest } from '/@/main/features/core/sync/pymix-auth';

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

const statusOf = (err: unknown): null | number =>
    err instanceof tus.DetailedError ? (err.originalResponse?.getStatus() ?? null) : null;

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
            if (++retries > MAX_RETRIES) return false;
            const status = statusOf(err);
            if (status === 401) return refreshed;
            if (status === 409) return ++conflicts <= MAX_OFFSET_CONFLICT_RETRIES;
            return tus.defaultOptions.onShouldRetry?.(err, retryAttempt, options) ?? false;
        },
    };
};

/**
 * Upload one file to filebrowser's `uploads/` at `stagingPath`.
 *
 * Creates the upload with `?override=true`, then sends it in chunks. If the
 * upload ends on an offset mismatch, it is re-created from offset 0 once — the
 * override create discards the partial file — and a second failure rejects, so
 * the caller can record the track as failed rather than spin on it.
 */
export async function uploadFileViaTus(args: {
    fbAuth: FbAuth;
    filebrowserUrl: string;
    filePath: string;
    onProgress: (bytesUploaded: number, bytesTotal: number) => void;
    stagingPath: string;
    trackName: string;
}): Promise<void> {
    const { fbAuth, filebrowserUrl, filePath, onProgress, stagingPath, trackName } = args;
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
            const uploader = new tus.Upload(fileStream as unknown as Buffer, {
                ...tusOptions(fbAuth),
                chunkSize: CHUNK_SIZE,
                // Pass a custom HTTP stack so TUS respects self-signed certs in dev
                httpStack: new tus.DefaultHttpStack({ rejectUnauthorized: false }),
                onError: reject,
                onProgress,
                onSuccess: () => resolve(),
                uploadSize: fileSize,
                uploadUrl,
            });
            uploader.start();
        });
    };

    try {
        await attempt();
    } catch (err) {
        if (statusOf(err) !== 409) throw err;
        console.warn(
            `TUS offset mismatch for "${trackName}", restarting from 0:`,
            (err as Error).message,
        );
        await attempt();
    }
}
