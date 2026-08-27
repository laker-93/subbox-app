import axios, { AxiosRequestConfig, AxiosResponse, isAxiosError } from 'axios';
import { session } from 'electron';
import * as https from 'https';

import { getStoredPassword } from '/@/main/features/core/settings';

// ── Auth for the two servers the main process talks to ──────────────────────
//
// Everything in here was extracted verbatim from the Rekordbox sync flow in
// ./index.ts so the Serato flow in ./serato.ts can use the same self-healing
// auth rather than growing a second, subtly different copy of it. Both servers
// hand out short-lived credentials that routinely lapse in the middle of a long
// upload, and getting that wrong looks to the user like a random failure
// halfway through a transfer.

/** Shared agent: dev runs against self-signed certs. */
export const httpsAgent = new https.Agent({ rejectUnauthorized: false });

export interface FbAuth {
    /** The current filebrowser token (updated in place after a refresh). */
    getToken(): string;
    /**
     * Re-login via the stored password and return the new token, or null when no
     * stored password is available (e.g. the user never opted into "remember me").
     */
    refresh(): Promise<null | string>;
}

export interface PymixAuth {
    /** Cookie header for pymix requests; empty when nothing has logged in yet. */
    getCookieHeader(): Promise<string>;
    /**
     * Re-login via the stored password and return the refreshed cookie header, or null
     * when we can't (no serverId/username, or no stored password).
     */
    refresh(): Promise<null | string>;
}

/**
 * Build a filebrowser auth helper that can silently re-login when its short-lived
 * (~2h) token expires mid-operation. The token outlives by far less than a long
 * download, so refresh it in place on a 401 instead of failing the whole flow.
 * On refresh it notifies the renderer (`sync:filebrowser-token-refreshed`) so the
 * store stays canonical. Refreshes are deduped so concurrent 401s trigger a single
 * login. Mirrors the watch poller's refresh logic.
 */
export function createFbAuth(args: {
    event: Electron.IpcMainInvokeEvent;
    filebrowserUrl: string;
    initialToken: string;
    serverId?: string;
    username?: string;
}): FbAuth {
    let token = args.initialToken;
    let inFlight: null | Promise<null | string> = null;

    const refresh = (): Promise<null | string> => {
        if (!inFlight) {
            inFlight = (async () => {
                if (!args.serverId || !args.username) return null;
                const password = getStoredPassword(args.serverId);
                if (!password) return null;
                const res = await axios.post<string>(
                    `${args.filebrowserUrl}/api/login`,
                    { password, username: args.username },
                    { httpsAgent },
                );
                token = res.data;
                args.event.sender.send('sync:filebrowser-token-refreshed', token);
                return token;
            })().finally(() => {
                inFlight = null;
            });
        }
        return inFlight;
    };

    return { getToken: () => token, refresh };
}

/**
 * Build a pymix auth helper for the main process.
 *
 * pymix identifies the caller solely by the httponly `session_id` cookie from
 * `/user/login`, and 401s when it's missing, unknown or expired. Main reads that cookie
 * out of Electron's jar, but it can legitimately be absent — the watch poller outlives
 * any given renderer login, and nothing guarantees the renderer ever called pymix — and
 * it can lapse mid-download. So mirror `createFbAuth` and the renderer's pymix
 * interceptor: on a 401, log back in with the stored password, write the fresh cookie
 * into the jar (which the renderer shares), and let the caller replay once. Refreshes
 * are deduped so concurrent 401s trigger a single login.
 */
export function createPymixAuth(args: {
    pymixUrl: string;
    serverId?: string;
    username?: string;
}): PymixAuth {
    let inFlight: null | Promise<null | string> = null;

    const refresh = (): Promise<null | string> => {
        if (!inFlight) {
            inFlight = (async () => {
                if (!args.serverId || !args.username) return null;
                const password = getStoredPassword(args.serverId);
                if (!password) return null;

                const res = await axios.post(
                    `${args.pymixUrl}/user/login`,
                    { password, username: args.username },
                    { httpsAgent },
                );

                // axios goes through Node's http stack, which doesn't share Electron's
                // cookie jar, so the refreshed session_id has to be written back by hand
                // for getCookiesForUrl (and the renderer) to see it.
                const setCookie: string[] = res.headers['set-cookie'] ?? [];
                const value = setCookie
                    .map((c) => /(?:^|;\s*)session_id=([^;]+)/.exec(c)?.[1])
                    .find((v): v is string => Boolean(v));
                if (!value) return null;

                await session.defaultSession.cookies.set({
                    httpOnly: true,
                    name: 'session_id',
                    sameSite: 'no_restriction',
                    secure: true,
                    url: args.pymixUrl,
                    value,
                });

                return getCookiesForUrl(args.pymixUrl);
            })().finally(() => {
                inFlight = null;
            });
        }
        return inFlight;
    };

    return { getCookieHeader: () => getCookiesForUrl(args.pymixUrl), refresh };
}

/**
 * Issue a filebrowser request that refreshes the token once on a 401 and retries —
 * the same self-healing behaviour `createFbAuth`'s doc comment promises.
 */
export async function fbRequest<T = any>(
    fbAuth: FbAuth,
    config: AxiosRequestConfig,
    retried = false,
): Promise<AxiosResponse<T>> {
    try {
        return await axios.request<T>({
            ...config,
            headers: { ...config.headers, 'X-Auth': fbAuth.getToken() },
            httpsAgent,
        });
    } catch (err) {
        if (!retried && isAxiosError(err) && err.response?.status === 401) {
            const token = await fbAuth.refresh();
            if (token) return fbRequest<T>(fbAuth, config, true);
        }
        throw err;
    }
}

export async function getCookiesForUrl(url: string): Promise<string> {
    const cookies = await session.defaultSession.cookies.get({ url });
    return cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}

/**
 * Send a session-expired event to the renderer that triggered the IPC call.
 * The renderer's global handler will log the user out automatically.
 */
export function sendSessionExpired(
    event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent,
): void {
    event.sender.send('sync:session-expired');
}

/**
 * Run a pymix request with the session cookie, refreshing it once on a 401 (the only
 * auth failure pymix reports). `run` must build the request from the cookie header it
 * is handed rather than closing over a stale one.
 */
export async function withPymixAuth<T>(
    auth: PymixAuth,
    run: (cookieHeader: string) => Promise<AxiosResponse<T>>,
): Promise<AxiosResponse<T>> {
    const cookie = await auth.getCookieHeader();
    try {
        return await run(cookie);
    } catch (err) {
        if (!isAxiosError(err) || err.response?.status !== 401) throw err;
        const refreshed = await auth.refresh();
        if (refreshed === null) throw err;
        return run(refreshed);
    }
}
