import { initClient, initContract } from '@ts-rest/core';
import axios, { AxiosError, AxiosResponse, isAxiosError, Method, ResponseType } from 'axios';
import qs from 'qs';

import i18n from '/@/i18n/i18n';
import { authenticationFailure } from '/@/renderer/api/utils';
import { urlConfig } from '/@/renderer/config/url-config';
import { useAuthStore } from '/@/renderer/store';
import { credentialStore } from '/@/renderer/utils/credential-store';
import { pymixType } from '/@/shared/api/pymix/pymix-types';
import { resultWithHeaders } from '/@/shared/api/utils';

const c = initContract();

export const contract = c.router({
    create: {
        body: pymixType._parameters.create,
        method: 'POST',
        path: 'user/create',
        responses: {
            200: resultWithHeaders(pymixType._response.create),
            500: resultWithHeaders(pymixType._response.error),
        },
    },
    deleteDuplicates: {
        body: null,
        method: 'DELETE',
        path: 'beets/duplicates',
        responses: {
            200: resultWithHeaders(pymixType._response.deleteDuplicates),
            500: resultWithHeaders(pymixType._response.error),
        },
    },
    deleteSong: {
        body: pymixType._parameters.deleteSong,
        method: 'DELETE',
        path: 'track',
        responses: {
            200: resultWithHeaders(pymixType._response.deleteSong),
            500: resultWithHeaders(pymixType._response.error),
        },
    },
    // Streams a file /sync/playlists or /rekordbox/export already wrote to the
    // (session-resolved) user's downloads dir, using the pymix session cookie
    // instead of a separate filebrowser credential — see issue #66: the `demo`
    // account's filebrowser token is scoped to its own (unrelated) account, so a
    // direct filebrowser fetch 404s even though require_reader correctly proxies
    // demo's pymix reads to demoadmin.
    download: {
        method: 'GET',
        path: 'sync/download/:filename',
        // `cache_bust` is a client-side concern, not a server one — see the note on
        // downloadParameters: the url is identical for every user and every export, so
        // a cache in front of pymix can serve a stale (or foreign) file.
        query: pymixType._parameters.download,
        responses: {
            200: resultWithHeaders(pymixType._response.download),
            500: resultWithHeaders(pymixType._response.error),
        },
    },
    getLibrarySize: {
        method: 'GET',
        path: 'user/library_size',
        responses: {
            200: resultWithHeaders(pymixType._response.librarySize),
            500: resultWithHeaders(pymixType._response.error),
        },
    },
    import: {
        body: pymixType._parameters.import,
        method: 'POST',
        path: 'beets/import',
        responses: {
            200: resultWithHeaders(pymixType._response.importJob),
            500: resultWithHeaders(pymixType._response.error),
        },
    },
    importProgress: {
        method: 'GET',
        path: 'beets/import/progress',
        query: pymixType._parameters.importProgress,
        responses: {
            200: resultWithHeaders(pymixType._response.beetsImportProgress),
            500: resultWithHeaders(pymixType._response.error),
        },
    },
    // Unauthenticated: the caller is a prospective user with no session cookie, so this
    // is the one contract entry that can't 401 — and must not, or the reauth interceptor
    // below would try to refresh a session that never existed. 400 is the server's flat
    // "we couldn't use that" (bad email / unknown dj_software); 429 is the per-IP cap.
    inviteRequest: {
        body: pymixType._parameters.inviteRequest,
        method: 'POST',
        path: 'invite-request',
        responses: {
            200: resultWithHeaders(pymixType._response.inviteRequest),
            400: resultWithHeaders(pymixType._response.error),
            429: resultWithHeaders(pymixType._response.error),
            500: resultWithHeaders(pymixType._response.error),
        },
    },
    login: {
        body: pymixType._parameters.login,
        method: 'POST',
        path: 'user/login',
        responses: {
            200: resultWithHeaders(pymixType._response.login),
            500: resultWithHeaders(pymixType._response.error),
        },
    },
    matchTracks: {
        body: pymixType._parameters.matchTracks,
        method: 'POST',
        path: 'sync/match_tracks',
        responses: {
            200: resultWithHeaders(pymixType._response.matchTracks),
            500: resultWithHeaders(pymixType._response.error),
        },
    },
    rbDownload: {
        body: pymixType._parameters.exportJob,
        method: 'POST',
        path: 'rekordbox/export',
        responses: {
            200: resultWithHeaders(pymixType._response.exportJob),
            500: resultWithHeaders(pymixType._response.error),
        },
    },
    rbImport: {
        body: pymixType._parameters.rbImport,
        method: 'POST',
        path: 'rekordbox/import',
        responses: {
            200: resultWithHeaders(pymixType._response.importJob),
            500: resultWithHeaders(pymixType._response.error),
        },
    },
    seratoExport: {
        body: pymixType._parameters.seratoExport,
        method: 'POST',
        path: 'serato/export',
        responses: {
            200: resultWithHeaders(pymixType._response.seratoExport),
            500: resultWithHeaders(pymixType._response.error),
        },
    },
    seratoImport: {
        body: pymixType._parameters.seratoImport,
        method: 'POST',
        path: 'serato/import',
        responses: {
            200: resultWithHeaders(pymixType._response.importJob),
            403: resultWithHeaders(pymixType._response.error),
            500: resultWithHeaders(pymixType._response.error),
        },
    },
    storageCheck: {
        method: 'GET',
        path: 'user/storage_check',
        query: pymixType._parameters.storageCheck,
        responses: {
            200: resultWithHeaders(pymixType._response.storageCheck),
            500: resultWithHeaders(pymixType._response.error),
        },
    },
    sync: {
        body: pymixType._parameters.sync,
        method: 'POST',
        path: 'sync',
        responses: {
            200: resultWithHeaders(pymixType._response.sync),
            500: resultWithHeaders(pymixType._response.error),
        },
    },
    syncPlan: {
        body: pymixType._parameters.syncPlan,
        method: 'POST',
        path: 'sync/plan',
        responses: {
            200: resultWithHeaders(pymixType._response.syncPlan),
            500: resultWithHeaders(pymixType._response.error),
        },
    },
    syncPlaylists: {
        body: pymixType._parameters.syncPlaylists,
        method: 'POST',
        path: 'sync/playlists',
        responses: {
            200: resultWithHeaders(pymixType._response.syncPlaylists),
            500: resultWithHeaders(pymixType._response.error),
        },
    },
    syncTracks: {
        body: pymixType._parameters.syncTracks,
        method: 'POST',
        path: 'sync',
        responses: {
            200: resultWithHeaders(pymixType._response.syncTracks),
            500: resultWithHeaders(pymixType._response.error),
        },
    },
    validateToken: {
        method: 'GET',
        path: 'user/is_valid_token',
        query: pymixType._parameters.isValidToken,
        responses: {
            200: resultWithHeaders(pymixType._response.isValidToken),
            500: resultWithHeaders(pymixType._response.error),
        },
    },
    wishlistBulkCreate: {
        body: pymixType._parameters.wishlistBulkCreate,
        method: 'POST',
        path: 'wishlist/bulk',
        responses: {
            200: resultWithHeaders(pymixType._response.wishlistBulkCreateResponse),
            500: resultWithHeaders(pymixType._response.error),
        },
    },
    wishlistCreate: {
        body: pymixType._parameters.wishlistCreate,
        method: 'POST',
        path: 'wishlist',
        responses: {
            200: resultWithHeaders(pymixType._response.wishlistItemResponse),
            500: resultWithHeaders(pymixType._response.error),
        },
    },
    wishlistDelete: {
        method: 'DELETE',
        path: 'wishlist/:id',
        responses: {
            200: resultWithHeaders(pymixType._response.wishlistDeleteResponse),
            500: resultWithHeaders(pymixType._response.error),
        },
    },
    wishlistList: {
        method: 'GET',
        path: 'wishlist',
        responses: {
            200: resultWithHeaders(pymixType._response.wishlistList),
            500: resultWithHeaders(pymixType._response.error),
        },
    },
    wishlistMatchMetadata: {
        body: pymixType._parameters.wishlistMatchMetadata,
        method: 'POST',
        path: 'wishlist/match-metadata',
        responses: {
            200: resultWithHeaders(pymixType._response.matchMetadataResponse),
            400: resultWithHeaders(pymixType._response.error),
            500: resultWithHeaders(pymixType._response.error),
        },
    },
    wishlistMatchYoutube: {
        body: null,
        method: 'POST',
        path: 'wishlist/:id/match-youtube',
        responses: {
            200: resultWithHeaders(pymixType._response.matchYoutubeResponse),
            500: resultWithHeaders(pymixType._response.error),
        },
    },
    wishlistParseLink: {
        body: pymixType._parameters.wishlistParseLink,
        method: 'POST',
        path: 'wishlist/parse-link',
        responses: {
            200: resultWithHeaders(pymixType._response.parseLinkResponse),
            400: resultWithHeaders(pymixType._response.error),
            500: resultWithHeaders(pymixType._response.error),
        },
    },
    wishlistSetSheet: {
        body: pymixType._parameters.wishlistSetSheet,
        method: 'PATCH',
        path: 'wishlist/sheet',
        responses: {
            200: resultWithHeaders(pymixType._response.wishlistSetSheetResponse),
            500: resultWithHeaders(pymixType._response.error),
        },
    },
    wishlistSheetStatus: {
        method: 'GET',
        path: 'wishlist/sheet/status',
        responses: {
            200: resultWithHeaders(pymixType._response.wishlistSheetStatusResponse),
            500: resultWithHeaders(pymixType._response.error),
        },
    },
    wishlistUpdate: {
        body: pymixType._parameters.wishlistUpdate,
        method: 'PATCH',
        path: 'wishlist/:id',
        responses: {
            200: resultWithHeaders(pymixType._response.wishlistItemResponse),
            500: resultWithHeaders(pymixType._response.error),
        },
    },
});

const axiosClient = axios.create({ withCredentials: true });

axiosClient.defaults.paramsSerializer = (params) => {
    return qs.stringify(params, { arrayFormat: 'repeat' });
};

const parsePath = (fullPath: string) => {
    const [path, params] = fullPath.split('?');
    const parsedParams = qs.parse(params);

    const newParams: Record<string, unknown> = {};
    Object.keys(parsedParams).forEach((key) => {
        const isIndexedArrayObject =
            typeof parsedParams[key] === 'object' &&
            Object.keys(parsedParams[key] || {}).includes('0');

        if (!isIndexedArrayObject) {
            newParams[key] = parsedParams[key];
        } else {
            newParams[key] = Object.values(parsedParams[key] || {});
        }
    });

    return { params: newParams, path };
};

// pymix authenticates via the httponly `session_id` cookie set by `/user/login`, and
// 401s when that session lapses or never made it onto the request. Mirror the
// navidrome/filebrowser reauth flow: on such an auth failure, silently log back in to
// refresh the cookie and replay the request once. Deduped so concurrent failures
// trigger a single login.
let pymixReauthPromise: null | Promise<boolean> = null;

const reauthenticatePymix = (): Promise<boolean> => {
    if (!pymixReauthPromise) {
        pymixReauthPromise = (async () => {
            const currentServer = useAuthStore.getState().currentServer;

            if (!currentServer?.savePassword) {
                return false;
            }

            const password = await credentialStore.get(currentServer.id);
            if (!password) {
                return false;
            }

            // Use plain axios (not axiosClient) so the login itself can't recurse
            // back through this interceptor. withCredentials lets the refreshed
            // session_id cookie land in the shared cookie jar.
            await axios.post(
                `${urlConfig.pymix}/user/login`,
                { password, username: currentServer.username },
                { withCredentials: true },
            );

            return true;
        })().finally(() => {
            pymixReauthPromise = null;
        });
    }

    return pymixReauthPromise;
};

// pymix resolves every user-scoped endpoint through one dependency that 401s when the
// session cookie is missing, unknown or expired, so 401 is the whole contract. The
// 400/404 shapes below predate that and are kept only so a client running against an
// older pymix still reauths instead of logging the user out.
const isPymixAuthError = (status?: number, data?: unknown): boolean => {
    if (status === 401) return true;
    const detail =
        typeof (data as { detail?: unknown })?.detail === 'string'
            ? ((data as { detail: string }).detail.toLowerCase() as string)
            : '';
    if (status === 400 && detail.includes('session id to identify user')) return true;
    if (status === 404 && detail === 'user not found') return true;
    return false;
};

axiosClient.interceptors.response.use(
    (response) => response,
    async (error) => {
        if (isAxiosError(error) && error.code === 'ERR_NETWORK') {
            throw new Error(
                i18n.t('error.networkError', { postProcess: 'sentenceCase' }) as string,
            );
        }

        const config = error.config as
            | (typeof error.config & { _pymixRetried?: boolean })
            | undefined;
        const status = error.response?.status;
        const isLoginRequest = config?.url?.includes('user/login');

        if (
            config &&
            !config._pymixRetried &&
            !isLoginRequest &&
            isPymixAuthError(status, error.response?.data)
        ) {
            let reauthed = false;
            try {
                reauthed = await reauthenticatePymix();
            } catch {
                // fall through to the logout path below
            }

            if (reauthed) {
                config._pymixRetried = true;
                return axiosClient.request(config);
            }

            // The pymix session lapsed and we couldn't silently refresh it — no saved
            // password to re-login with (e.g. on web, sessionStorage was cleared when
            // the tab closed even though the persisted auth store restored the server).
            // Log the user out so they re-authenticate cleanly instead of being stuck
            // on silent 401s. authenticationFailure no-ops once the server is cleared,
            // so concurrent failures don't stack toasts.
            authenticationFailure(useAuthStore.getState().currentServer);
        }

        return Promise.reject(error);
    },
);

export const pymixApiClient = (args: {
    baseUrl: string;
    responseType?: ResponseType;
    signal?: AbortSignal;
    token?: string;
}) => {
    const { baseUrl, responseType, signal, token } = args;

    return initClient(contract, {
        api: async ({ body, headers, method, path }) => {
            const { params, path: api } = parsePath(path);

            try {
                const result = await axiosClient.request({
                    data: body,
                    headers: {
                        ...headers,
                        ...(token && { Authorization: `Bearer ${token}` }),
                    },
                    method: method as Method,
                    params,
                    responseType: responseType || 'json',
                    signal,
                    url: `${baseUrl}/${api}`,
                });

                return {
                    body: { data: result.data, headers: result.headers },
                    headers: result.headers as any,
                    status: result.status,
                };
            } catch (e: any | AxiosError | Error) {
                if (isAxiosError(e)) {
                    const error = e as AxiosError;
                    const response = error.response as AxiosResponse;
                    return {
                        body: { data: response?.data, headers: response?.headers },
                        headers: response?.headers as any,
                        status: response?.status,
                    };
                }
                throw e;
            }
        },
        baseHeaders: {
            'Content-Type': 'application/json',
        },
        baseUrl: '',
        jsonQuery: false,
    });
};
