import { initClient, initContract } from '@ts-rest/core';
import axios, { AxiosError, AxiosResponse, isAxiosError, Method } from 'axios';
import qs from 'qs';

import i18n from '/@/i18n/i18n';
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
    seratoDownload: {
        body: pymixType._parameters.exportJob,
        method: 'POST',
        path: 'serato/export',
        responses: {
            200: resultWithHeaders(pymixType._response.exportJob),
            500: resultWithHeaders(pymixType._response.error),
        },
    },
    seratoImport: {
        body: null,
        method: 'POST',
        path: 'serato/import',
        responses: {
            200: resultWithHeaders(pymixType._response.seratoImport),
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
    validateToken: {
        method: 'GET',
        path: 'user/is_valid_token',
        query: pymixType._parameters.isValidToken,
        responses: {
            200: resultWithHeaders(pymixType._response.isValidToken),
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

axiosClient.interceptors.response.use(
    (response) => response,
    (error) => {
        if (isAxiosError(error) && error.code === 'ERR_NETWORK') {
            throw new Error(
                i18n.t('error.networkError', { postProcess: 'sentenceCase' }) as string,
            );
        }
        return Promise.reject(error);
    },
);

export const pymixApiClient = (args: { baseUrl: string; signal?: AbortSignal; token?: string }) => {
    const { baseUrl, signal, token } = args;

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
