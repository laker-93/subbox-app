import * as tus from 'tus-js-client';
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

type TusUploadArgs = {
    file: File;
    onProgress?: (progress: number) => void;
};

type UploadArgs = {
    body: ArrayBuffer;
    filename: string;
};

export const FilebrowserController = {
    tusUpload: async (args: FBClientArgs & TusUploadArgs): Promise<void> => {
        const { baseUrl, file, onProgress = () => {}, token } = args;
        const resourcePath = `${baseUrl}/api/tus/uploads/${file.name}?override=true`;

        const resp = await fetch(resourcePath, {
            headers: {
                'X-Auth': token ?? '',
                'upload-length': `${file.size}`,
            },
            method: 'POST',
        });

        if (resp.status !== 201) {
            throw new Error(`Failed to create TUS upload: ${resp.status} ${resp.statusText}`);
        }

        return new Promise<void>((resolve, reject) => {
            const uploader = new tus.Upload(file, {
                chunkSize: 20 * 1024 * 1024,
                headers: { 'X-Auth': token ?? '' },
                onError: reject,
                onProgress: (bytesUploaded, bytesTotal) => {
                    onProgress(parseFloat(((bytesUploaded / bytesTotal) * 100).toFixed(2)));
                },
                onSuccess: () => resolve(),
                uploadUrl: resourcePath,
            });
            uploader.start();
        });
    },

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
