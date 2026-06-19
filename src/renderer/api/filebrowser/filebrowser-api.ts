import { initClient, initContract } from '@ts-rest/core';
import axios, { AxiosError, AxiosResponse, isAxiosError, Method } from 'axios';
import qs from 'qs';

import i18n from '/@/i18n/i18n';
import { urlConfig } from '/@/renderer/config/url-config';
import { useAuthStore } from '/@/renderer/store';
import { credentialStore } from '/@/renderer/utils/credential-store';
import { FBResponseType, fbType } from '/@/shared/api/filebrowser/filebrowser-types';
import { resultWithHeaders } from '/@/shared/api/utils';

const c = initContract();

export const contract = c.router({
    authenticate: {
        body: fbType._parameters.authenticate,
        method: 'POST',
        path: 'api/login',
        responses: {
            200: resultWithHeaders(fbType._response.authenticate),
            500: resultWithHeaders(fbType._response.error),
        },
    },
    download: {
        method: 'GET',
        path: 'api/raw/downloads/:filename',
        responses: {
            200: resultWithHeaders(fbType._response.download),
            500: resultWithHeaders(fbType._response.error),
        },
    },
    listUploads: {
        method: 'GET',
        path: 'api/resources/uploads',
        responses: {
            200: resultWithHeaders(fbType._response.listUploads),
            500: resultWithHeaders(fbType._response.error),
        },
    },
    upload: {
        body: fbType._parameters.fileBytes,
        contentType: 'multipart/form-data',
        method: 'POST',
        path: 'api/resources/uploads/:filename',
        responses: {
            200: resultWithHeaders(fbType._response.upload),
            500: resultWithHeaders(fbType._response.error),
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

// The filebrowser token (fbToken) is short-lived (~2h observed) and expires well
// before the navidrome token (~24h), so the navidrome reauth paths never fire when
// it lapses. Refresh it here, where every filebrowser request flows through, so an
// expired token self-heals instead of failing the request. Works on both desktop
// and web via credentialStore. Deduped so concurrent 401s trigger a single login.
let fbReauthPromise: null | Promise<null | string> = null;

const reauthenticateFilebrowser = (): Promise<null | string> => {
    if (!fbReauthPromise) {
        fbReauthPromise = (async () => {
            const currentServer = useAuthStore.getState().currentServer;

            if (!currentServer?.savePassword) {
                return null;
            }

            const password = await credentialStore.get(currentServer.id);
            if (!password) {
                return null;
            }

            // Use plain axios (not axiosClient) so the login itself can't recurse
            // back through this interceptor.
            const res = await axios.post<string>(`${urlConfig.filebrowser}/api/login`, {
                password,
                username: currentServer.username,
            });
            const token = res.data;

            useAuthStore.getState().actions.updateServer(currentServer.id, {
                fbToken: token,
            });

            return token;
        })().finally(() => {
            fbReauthPromise = null;
        });
    }

    return fbReauthPromise;
};

axiosClient.interceptors.response.use(
    (response) => response,
    async (error) => {
        if (isAxiosError(error) && error.code === 'ERR_NETWORK') {
            throw new Error(
                i18n.t('error.networkError', { postProcess: 'sentenceCase' }) as string,
            );
        }

        const config = error.config as (typeof error.config & { _fbRetried?: boolean }) | undefined;
        const status = error.response?.status;
        const isLoginRequest = config?.url?.includes('/api/login');

        // On an auth failure for a non-login request, try to refresh the token once
        // and replay the original request with it.
        if (status === 401 && config && !config._fbRetried && !isLoginRequest) {
            try {
                const token = await reauthenticateFilebrowser();
                if (token) {
                    config._fbRetried = true;
                    config.headers = config.headers ?? {};
                    config.headers['X-Auth'] = token;
                    return axiosClient.request(config);
                }
            } catch {
                // fall through to reject with the original error
            }
        }

        return Promise.reject(error);
    },
);

export const fbApiClient = (args: {
    baseUrl: string;
    responseType?: FBResponseType;
    signal?: AbortSignal;
    token?: string;
}) => {
    const { baseUrl, responseType, signal, token } = args;

    return initClient(contract, {
        api: async ({ body, headers, method, path }) => {
            const { params, path: api } = parsePath(path);

            const isUpload = body instanceof ArrayBuffer;

            try {
                const result = await axiosClient.request({
                    data: body,
                    headers: {
                        ...headers,
                        ...(token && { 'X-Auth': token }),
                        ...(isUpload && { 'Content-Type': 'application/octet-stream' }),
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
        baseHeaders: {},
        baseUrl: '',
        jsonQuery: false,
    });
};
