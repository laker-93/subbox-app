import { initClient, initContract } from '@ts-rest/core';
import axios, { AxiosError, AxiosResponse, isAxiosError, Method } from 'axios';
import qs from 'qs';

import i18n from '/@/i18n/i18n';
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
