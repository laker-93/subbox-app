import { z } from 'zod';

import { fbApiClient } from '/@/renderer/api/filebrowser/filebrowser-api';
import { FBResponseType, fbType } from '/@/shared/api/filebrowser/filebrowser-types';

type AuthenticateArgs = {
    body: z.infer<typeof fbType._parameters.authenticate>;
};

type DownloadArgs = {
    filename: string;
    responseType?: FBResponseType;
};

type FBClientArgs = {
    baseUrl: string;
    signal?: AbortSignal;
    token?: string;
};

type UploadArgs = {
    body: ArrayBuffer;
    filename: string;
};

export const FilebrowserController = {
    authenticate: async (args: AuthenticateArgs & FBClientArgs) => {
        const { baseUrl, body, signal, token } = args;
        const res = await fbApiClient({ baseUrl, signal, token }).authenticate({ body });

        if (res.status !== 200) {
            throw new Error('Failed to authenticate with filebrowser');
        }

        return res.body.data;
    },

    download: async (args: DownloadArgs & FBClientArgs) => {
        const { baseUrl, filename, responseType, signal, token } = args;
        const res = await fbApiClient({ baseUrl, responseType, signal, token }).download({
            params: { filename },
        });

        if (res.status !== 200) {
            throw new Error('Failed to download file');
        }

        return res.body.data;
    },

    listUploads: async (args: FBClientArgs) => {
        const { baseUrl, signal, token } = args;
        const res = await fbApiClient({ baseUrl, signal, token }).listUploads();

        if (res.status !== 200) {
            throw new Error('Failed to list uploads');
        }

        return res.body.data;
    },

    upload: async (args: FBClientArgs & UploadArgs) => {
        const { baseUrl, body, filename, signal, token } = args;
        const res = await fbApiClient({ baseUrl, signal, token }).upload({
            body,
            params: { filename },
        });

        if (res.status !== 200) {
            throw new Error('Failed to upload file');
        }

        return res.body.data;
    },
};
