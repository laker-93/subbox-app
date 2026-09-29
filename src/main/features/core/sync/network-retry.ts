import axios, { isAxiosError } from 'axios';
import { ipcMain, powerSaveBlocker } from 'electron';
import * as https from 'https';
import * as tus from 'tus-js-client';

// ── Riding out a dropped connection ─────────────────────────────────────────
//
// A Rekordbox upload of a big library runs for hours, and over that long a wifi
// blip or a laptop sleep is likely. Before this, one 30s outage failed every track
// still in the queue within ~17s and then failed map_meta too, ending the run on
// "Tagging Failed" (subbox-app#203). A network error is now waited out, at three
// levels: each request retries with backoff, the upload queue pauses while the
// server is unreachable, and map_meta isn't sent until it's reachable again.

/** Node's codes for a request that never got a response: DNS, refused, reset, down. */
const NETWORK_ERROR_CODES = new Set([
    'EAI_AGAIN',
    'ECONNABORTED',
    'ECONNREFUSED',
    'ECONNRESET',
    'EHOSTUNREACH',
    'ENETDOWN',
    'ENETUNREACH',
    'ENOTFOUND',
    'EPIPE',
    'ERR_NETWORK',
    'ETIMEDOUT',
]);

/**
 * Statuses a proxy answers with when it can't reach what's behind it: Traefik's
 * 502/503/504, and Cloudflare's 52x for an origin that is down or timing out.
 */
const GATEWAY_STATUSES = new Set([502, 503, 504, 520, 521, 522, 523, 524]);

/**
 * Backoff for one request, ~4.5 minutes in all: long enough for a wifi reconnect
 * or a laptop waking up, short enough that the queue-level pause takes over for a
 * real outage.
 */
const REQUEST_RETRY_DELAYS_MS = [
    1_000, 2_000, 4_000, 8_000, 15_000, 30_000, 30_000, 30_000, 30_000, 30_000, 30_000, 30_000,
];

/**
 * The same kind of budget for tus's own retries of a HEAD/PATCH mid-file. Its
 * default, [0, 1000, 3000, 5000], gave up after ~9s. Kept one shorter than
 * tus-upload's MAX_RETRIES so a single outage can use all of it.
 */
export const TUS_RETRY_DELAYS_MS = [0, 1_000, 3_000, 5_000, 10_000, 20_000, 30_000, 60_000, 60_000];

/** How long the upload queue waits for the server to come back before giving up. */
export const CONNECTION_WAIT_MS = 30 * 60 * 1000;
const PROBE_INTERVAL_MS = 5_000;
const PROBE_TIMEOUT_MS = 10_000;

// Its own agent rather than pymix-auth's, which imports this module. Dev runs
// against self-signed certs.
const probeAgent = new https.Agent({ rejectUnauthorized: false });

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** `ipcMain.handle`, with the machine kept awake while each call runs. */
export function handleKeepingAwake<A extends unknown[], R>(
    channel: string,
    handler: (event: Electron.IpcMainInvokeEvent, ...args: A) => Promise<R>,
): void {
    ipcMain.handle(channel, (event, ...args) => keepAwake(() => handler(event, ...(args as A))));
}

/**
 * True when `err` says the server couldn't be reached, not that it refused: no
 * response at all, or a proxy reporting its upstream as down. Those are worth
 * waiting out; a 4xx or a plain 500 is an answer and is not.
 */
export function isNetworkError(err: unknown): boolean {
    if (isAxiosError(err)) {
        if (err.response) return GATEWAY_STATUSES.has(err.response.status);
        return err.code === undefined || NETWORK_ERROR_CODES.has(err.code);
    }
    if (err instanceof tus.DetailedError) {
        // A tus error carries a request only when one was sent; with no response
        // behind it, the connection failed.
        if (!err.originalRequest) return false;
        const status = err.originalResponse?.getStatus();
        return status === undefined || GATEWAY_STATUSES.has(status);
    }
    const code = (err as null | { code?: unknown })?.code;
    return typeof code === 'string' && NETWORK_ERROR_CODES.has(code);
}

/**
 * Keep the machine from suspending while `run` is in flight. Idle sleep otherwise
 * stops a long upload partway through. It doesn't stop a closed lid sleeping.
 * Independent of playback's own blocker in src/main/index.ts: each start has its
 * own id, and releasing one leaves the other held.
 */
export async function keepAwake<T>(run: () => Promise<T>): Promise<T> {
    const id = powerSaveBlocker.start('prevent-app-suspension');
    try {
        return await run();
    } finally {
        powerSaveBlocker.stop(id);
    }
}

/**
 * Wait until `url` answers, polling every few seconds. Any response short of a
 * gateway error counts: a 401 or 404 still proves the server is reachable.
 * Resolves true once it answers, false if it hasn't within `timeoutMs`.
 */
export async function waitForServer(url: string, timeoutMs = CONNECTION_WAIT_MS): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        try {
            const res = await axios.get(url, {
                httpsAgent: probeAgent,
                timeout: PROBE_TIMEOUT_MS,
                validateStatus: () => true,
            });
            if (!GATEWAY_STATUSES.has(res.status)) return true;
        } catch {
            // Unreachable: keep waiting.
        }
        if (Date.now() >= deadline) return false;
        await sleep(PROBE_INTERVAL_MS);
    }
}

/** Run `request`, retrying it with backoff while it fails with a network error. */
export async function withNetworkRetry<T>(request: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
        try {
            return await request();
        } catch (err) {
            if (attempt >= REQUEST_RETRY_DELAYS_MS.length || !isNetworkError(err)) throw err;
            console.warn(
                `[network] request failed (${(err as Error).message}), retry ${attempt + 1} in ` +
                    `${REQUEST_RETRY_DELAYS_MS[attempt] / 1000}s`,
            );
            await sleep(REQUEST_RETRY_DELAYS_MS[attempt]);
        }
    }
}

/**
 * The error an upload run ends with when the server stayed unreachable past
 * CONNECTION_WAIT_MS. The run stops here rather than going on to map_meta, which
 * could only fail. Running the upload again resumes it: what reached the server
 * is skipped (findWhollyStaged).
 */
export const connectionLostError = (sent: number, unsent: number) =>
    new Error(
        `Lost the connection to the server for over ${CONNECTION_WAIT_MS / 60_000} minutes. ` +
            `${sent} ${sent === 1 ? 'track was' : 'tracks were'} uploaded and ${unsent} ` +
            `${unsent === 1 ? 'was' : 'were'} not. Upload again once you're back online: ` +
            `tracks already on the server won't be sent twice.`,
    );

/**
 * Run `uploadOne` over `items` with bounded concurrency, riding out a lost
 * connection instead of failing the rest of the queue.
 *
 * A track that fails with a network error (after its own request retries) is put
 * back on the queue, and that worker waits for `probeUrl` to answer before taking
 * more work, so a dropped connection pauses the queue rather than draining it one
 * failure per round trip. A track that fails the same way `MAX_NETWORK_REQUEUES`
 * times is recorded as failed like any other error. If the server stays
 * unreachable for CONNECTION_WAIT_MS the run stops: returns `connectionLost` with
 * the tracks that never went, and the caller must not go on to map_meta.
 */
export async function runUploadQueue<T>(args: {
    concurrency: number;
    items: T[];
    onFailed: (item: T, reason: string) => void;
    probeUrl: string;
    uploadOne: (item: T) => Promise<void>;
}): Promise<{ connectionLost: boolean; unsent: T[] }> {
    const { concurrency, items, onFailed, probeUrl, uploadOne } = args;
    const MAX_NETWORK_REQUEUES = 3;
    const queue = [...items];
    const requeues = new Map<T, number>();
    let connectionLost = false;
    // One wait shared by every worker, so three workers probe as one.
    let waiting: null | Promise<boolean> = null;

    const waitForConnection = () => {
        if (!waiting) {
            console.warn(`[network] server unreachable, pausing the upload queue`);
            waiting = waitForServer(probeUrl).finally(() => {
                waiting = null;
            });
        }
        return waiting;
    };

    const workers = Array.from({ length: concurrency }, async () => {
        while (queue.length > 0 && !connectionLost) {
            // Don't take new work while another worker is waiting for the server.
            if (waiting && !(await waiting)) {
                connectionLost = true;
                break;
            }
            const item = queue.shift()!;
            try {
                await uploadOne(item);
            } catch (err) {
                const n = requeues.get(item) ?? 0;
                if (isNetworkError(err) && n < MAX_NETWORK_REQUEUES) {
                    requeues.set(item, n + 1);
                    queue.unshift(item);
                    // Another worker has already waited the full time and given up.
                    if (connectionLost) break;
                    if (!(await waitForConnection())) {
                        connectionLost = true;
                        break;
                    }
                    console.warn(`[network] server reachable again, resuming the upload queue`);
                    continue;
                }
                onFailed(item, err instanceof Error ? err.message : String(err));
            }
        }
    });
    await Promise.all(workers);

    return { connectionLost, unsent: connectionLost ? queue : [] };
}
