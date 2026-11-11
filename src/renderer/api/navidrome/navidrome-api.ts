import { initClient, initContract } from '@ts-rest/core';
import axios, { AxiosError, AxiosResponse, isAxiosError, Method } from 'axios';
import debounce from 'lodash/debounce';
import omitBy from 'lodash/omitBy';
import qs from 'qs';

import i18n from '/@/i18n/i18n';
import { authenticationFailure } from '/@/renderer/api/utils';
import { urlConfig } from '/@/renderer/config/url-config';
import { useAuthStore } from '/@/renderer/store';
import { credentialStore } from '/@/renderer/utils/credential-store';
import { getServerUrl } from '/@/renderer/utils/normalize-server-url';
import { ndType } from '/@/shared/api/navidrome/navidrome-types';
import { resultWithHeaders } from '/@/shared/api/utils';
import { toast } from '/@/shared/components/toast/toast';
import { ServerListItemWithCredential } from '/@/shared/types/domain-types';

const c = initContract();

export const contract = c.router({
    addToPlaylist: {
        body: ndType._parameters.addToPlaylist,
        method: 'POST',
        path: 'playlist/:id/tracks',
        responses: {
            200: resultWithHeaders(ndType._response.addToPlaylist),
            500: resultWithHeaders(ndType._response.error),
        },
    },
    authenticate: {
        body: ndType._parameters.authenticate,
        method: 'POST',
        path: 'auth/login',
        responses: {
            200: resultWithHeaders(ndType._response.authenticate),
            500: resultWithHeaders(ndType._response.error),
        },
    },
    createPlaylist: {
        body: ndType._parameters.createPlaylist,
        method: 'POST',
        path: 'playlist',
        responses: {
            200: resultWithHeaders(ndType._response.createPlaylist),
            500: resultWithHeaders(ndType._response.error),
        },
    },
    deletePlaylist: {
        body: null,
        method: 'DELETE',
        path: 'playlist/:id',
        responses: {
            200: resultWithHeaders(ndType._response.deletePlaylist),
            500: resultWithHeaders(ndType._response.error),
        },
    },
    getAlbumArtistDetail: {
        method: 'GET',
        path: 'artist/:id',
        responses: {
            200: resultWithHeaders(ndType._response.albumArtist),
            500: resultWithHeaders(ndType._response.error),
        },
    },
    getAlbumArtistList: {
        method: 'GET',
        path: 'artist',
        query: ndType._parameters.albumArtistList,
        responses: {
            200: resultWithHeaders(ndType._response.albumArtistList),
            500: resultWithHeaders(ndType._response.error),
        },
    },
    getAlbumDetail: {
        method: 'GET',
        path: 'album/:id',
        responses: {
            200: resultWithHeaders(ndType._response.album),
            500: resultWithHeaders(ndType._response.error),
        },
    },
    getAlbumList: {
        method: 'GET',
        path: 'album',
        query: ndType._parameters.albumList,
        responses: {
            200: resultWithHeaders(ndType._response.albumList),
            500: resultWithHeaders(ndType._response.error),
        },
    },
    getGenreList: {
        method: 'GET',
        path: 'genre',
        query: ndType._parameters.genreList,
        responses: {
            200: resultWithHeaders(ndType._response.genreList),
            500: resultWithHeaders(ndType._response.error),
        },
    },
    getPlaylistDetail: {
        method: 'GET',
        path: 'playlist/:id',
        responses: {
            200: resultWithHeaders(ndType._response.playlist),
            500: resultWithHeaders(ndType._response.error),
        },
    },
    getPlaylistList: {
        method: 'GET',
        path: 'playlist',
        query: ndType._parameters.playlistList,
        responses: {
            200: resultWithHeaders(ndType._response.playlistList),
            500: resultWithHeaders(ndType._response.error),
        },
    },
    getPlaylistSongList: {
        method: 'GET',
        path: 'playlist/:id/tracks',
        query: ndType._parameters.songList,
        responses: {
            200: resultWithHeaders(ndType._response.playlistSongList),
            500: resultWithHeaders(ndType._response.error),
        },
    },
    getQueue: {
        method: 'GET',
        path: 'queue',
        responses: {
            200: resultWithHeaders(ndType._response.queue),
            500: resultWithHeaders(ndType._response.error),
        },
    },
    getSongDetail: {
        method: 'GET',
        path: 'song/:id',
        responses: {
            200: resultWithHeaders(ndType._response.song),
            500: resultWithHeaders(ndType._response.error),
        },
    },
    getSongList: {
        method: 'GET',
        path: 'song',
        query: ndType._parameters.songList,
        responses: {
            200: resultWithHeaders(ndType._response.songList),
            500: resultWithHeaders(ndType._response.error),
        },
    },
    getTagList: {
        method: 'GET',
        path: 'tag',
        query: ndType._parameters.tagList,
        responses: {
            200: resultWithHeaders(ndType._response.tagList),
            500: resultWithHeaders(ndType._response.error),
        },
    },
    getUserList: {
        method: 'GET',
        path: 'user',
        query: ndType._parameters.userList,
        responses: {
            200: resultWithHeaders(ndType._response.userList),
            500: resultWithHeaders(ndType._response.error),
        },
    },
    movePlaylistItem: {
        body: ndType._parameters.moveItem,
        method: 'PUT',
        path: 'playlist/:playlistId/tracks/:trackNumber',
        responses: {
            200: resultWithHeaders(ndType._response.moveItem),
            400: resultWithHeaders(ndType._response.error),
        },
    },
    removeFromPlaylist: {
        body: null,
        method: 'DELETE',
        path: 'playlist/:id/tracks',
        query: ndType._parameters.removeFromPlaylist,
        responses: {
            200: resultWithHeaders(ndType._response.removeFromPlaylist),
            500: resultWithHeaders(ndType._response.error),
        },
    },
    saveQueue: {
        body: ndType._parameters.saveQueue,
        method: 'POST',
        path: 'queue',
        responses: {
            200: resultWithHeaders(ndType._response.saveQueue),
            500: resultWithHeaders(ndType._response.error),
        },
    },
    shareItem: {
        body: ndType._parameters.shareItem,
        method: 'POST',
        path: 'share',
        responses: {
            200: resultWithHeaders(ndType._response.shareItem),
            404: resultWithHeaders(ndType._response.error),
            500: resultWithHeaders(ndType._response.error),
        },
    },
    updatePlaylist: {
        body: ndType._parameters.updatePlaylist,
        method: 'PUT',
        path: 'playlist/:id',
        responses: {
            200: resultWithHeaders(ndType._response.updatePlaylist),
            500: resultWithHeaders(ndType._response.error),
        },
    },
});

const axiosClient = axios.create({});

axiosClient.defaults.paramsSerializer = (params) => {
    return qs.stringify(params, { arrayFormat: 'repeat' });
};

const parsePath = (fullPath: string) => {
    const [path, params] = fullPath.split('?');

    const parsedParams = qs.parse(params);

    // Convert indexed object to array
    const newParams: Record<string, any> = {};
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

    const notNilParams = omitBy(newParams, (value) => value === 'undefined' || value === 'null');

    return {
        params: notNilParams,
        path,
    };
};

// A lapsed `x-nd-authorization` JWT (ND_SESSIONTIMEOUT, 24h on subbox) makes every
// in-flight native API call 401 at once. Refresh it with one login, shared by every
// request that failed, then replay each of them with the new token.
//
// This used to be a pair of module flags polled once a second. A request that 401'd
// while another was logging in gave up after five polls and logged the user out with
// "Your session has expired", even though the login it was waiting for then
// succeeded: any login slower than ~5s did it. It also replayed with the stale token
// it was sent with, so each waiter forced a login of its own.
type ReauthResult =
    | { credential: string; kind: 'ok' }
    | { kind: 'invalid' } // the saved password is gone or wrong: only a re-login fixes it
    | { kind: 'transient' }; // the server couldn't answer the login right now

let ndReauthPromise: null | Promise<ReauthResult> = null;

const statusOf = (error: unknown) => (isAxiosError(error) ? error.response?.status : undefined);

// Install a fresh Navidrome login: the JWT for the native API and a new Subsonic
// salt/token pair.
const applyLogin = (
    server: ServerListItemWithCredential,
    login: { subsonicSalt: string; subsonicToken: string; token: string },
): ReauthResult => {
    useAuthStore.getState().actions.updateServer(server.id, {
        credential: `u=${server.username}&s=${login.subsonicSalt}&t=${login.subsonicToken}`,
        ndCredential: login.token,
    });
    return { credential: login.token, kind: 'ok' };
};

// With no saved password, ask pymix to log in on our behalf (subbox-app#319). The
// web player keeps the password only for the life of the tab (credentialStore), so
// a new tab opened after the 24h JWT lapsed used to log the user out here. The pymix
// session cookie outlasts the tab, and pymix holds the account password.
const reissueFromPymix = async (server: ServerListItemWithCredential): Promise<ReauthResult> => {
    try {
        // Plain axios: neither this interceptor nor pymix's own (which logs the user
        // out on a 401) should see this call.
        const res = await axios.post(`${urlConfig.pymix}/user/navidrome_token`, null, {
            withCredentials: true,
        });
        return applyLogin(server, res.data);
    } catch (error) {
        const status = statusOf(error);
        // 401: the pymix session is gone as well. 403: Navidrome refused the login,
        // or the user has none. 404: a pymix older than the route. Each of these
        // needs a real login, which is what happened before the route existed.
        if (status === 401 || status === 403 || status === 404) return { kind: 'invalid' };
        console.error('Navidrome token reissue via pymix failed: ', error);
        return { kind: 'transient' };
    }
};

const reauthenticateNavidrome = (server: ServerListItemWithCredential): Promise<ReauthResult> => {
    if (!ndReauthPromise) {
        ndReauthPromise = (async (): Promise<ReauthResult> => {
            const password = await credentialStore.get(server.id);
            if (!password) return reissueFromPymix(server);

            try {
                // Plain axios, not axiosClient, so the login can't recurse through
                // this interceptor.
                const res = await axios.post(`${server.url}/auth/login`, {
                    password,
                    username: server.username,
                });

                return applyLogin(server, res.data);
            } catch (loginError) {
                const status = statusOf(loginError);
                if (status === 401 || status === 403) return { kind: 'invalid' };

                console.error('Navidrome reauthentication failed: ', loginError);
                if (status === 429) {
                    toast.error({
                        message: i18n.t('error.loginRateError', {
                            postProcess: 'sentenceCase',
                        }) as string,
                    });
                }
                return { kind: 'transient' };
            }
        })().finally(() => {
            ndReauthPromise = null;
        });
    }

    return ndReauthPromise;
};

const limitedFail = debounce(authenticationFailure, 1000);

const bearer = (credential: string) => `Bearer ${credential}`;

axiosClient.interceptors.response.use(
    (response) => {
        const serverId = useAuthStore.getState().currentServer?.id;

        if (serverId) {
            const headerCredential = response.headers['x-nd-authorization'] as string | undefined;

            if (headerCredential) {
                useAuthStore.getState().actions.updateServer(serverId, {
                    ndCredential: headerCredential,
                });
            }
        }

        return response;
    },
    async (error) => {
        const config = error.config as (typeof error.config & { _ndRetried?: boolean }) | undefined;

        if (
            error.response?.status !== 401 ||
            !config ||
            config._ndRetried ||
            config.url?.includes('auth/login')
        ) {
            return Promise.reject(error);
        }

        const currentServer = useAuthStore.getState().currentServer;
        if (!currentServer) return Promise.reject(error);

        config._ndRetried = true;

        // Someone else already refreshed the token since this request went out:
        // replay with that one instead of logging in again.
        const sentWith = config.headers?.['x-nd-authorization'];
        const latest = currentServer.ndCredential;
        if (latest && sentWith && sentWith !== bearer(latest)) {
            config.headers['x-nd-authorization'] = bearer(latest);
            return axiosClient.request(config);
        }

        const result = currentServer.savePassword
            ? await reauthenticateNavidrome(currentServer)
            : ({ kind: 'invalid' } as const);

        if (result.kind === 'ok') {
            config.headers['x-nd-authorization'] = bearer(result.credential);
            return axiosClient.request(config);
        }

        // Only a credential the server has actually refused ends the session. A
        // login that timed out, 5xx'd or was rate limited leaves the user logged in:
        // this request fails, and the next one tries again.
        if (result.kind === 'invalid') {
            limitedFail(currentServer);
        }

        return Promise.reject(error);
    },
);

export const ndApiClient = (args: {
    server: null | ServerListItemWithCredential;
    signal?: AbortSignal;
    url?: string;
}) => {
    const { server, signal, url } = args;

    return initClient(contract, {
        api: async ({ body, headers, method, path }) => {
            let baseUrl: string | undefined;
            let token: string | undefined;

            const { params, path: api } = parsePath(path);

            if (server) {
                const serverUrl = getServerUrl(server);
                baseUrl = serverUrl ? `${serverUrl}/api` : undefined;
                token = server?.ndCredential;
            } else {
                baseUrl = url;
            }

            try {
                // A token refresh is in flight: wait for it rather than send a request
                // that is bound to 401 with the token it is about to replace.
                if (ndReauthPromise && server) {
                    await ndReauthPromise;
                    token = useAuthStore.getState().serverList[server.id]?.ndCredential ?? token;
                }

                const result = await axiosClient.request({
                    data: body,
                    headers: {
                        ...headers,
                        ...(token && { 'x-nd-authorization': `Bearer ${token}` }),
                    },
                    method: method as Method,
                    params,
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
                    if (e.code === 'ERR_NETWORK') {
                        throw new Error(
                            i18n.t('error.networkError', {
                                postProcess: 'sentenceCase',
                            }) as string,
                        );
                    }

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
