import { z } from 'zod';

import { pymixApiClient } from '/@/renderer/api/pymix/pymix-api';
import { pymixType } from '/@/shared/api/pymix/pymix-types';

type CreateArgs = {
    body: z.infer<typeof pymixType._parameters.create>;
};

type DeleteSongArgs = {
    body: z.infer<typeof pymixType._parameters.deleteSong>;
};

type ImportArgs = {
    body: z.infer<typeof pymixType._parameters.import>;
};

type ImportProgressArgs = {
    query: z.infer<typeof pymixType._parameters.importProgress>;
};

type LoginArgs = {
    body: z.infer<typeof pymixType._parameters.login>;
};

type MatchTracksArgs = {
    body: z.infer<typeof pymixType._parameters.matchTracks>;
};

type PymixClientArgs = {
    baseUrl: string;
    signal?: AbortSignal;
    token?: string;
};

type RbDownloadArgs = {
    body: z.infer<typeof pymixType._parameters.exportJob>;
};

type RbImportArgs = {
    body: z.infer<typeof pymixType._parameters.rbImport>;
};

type SeratoDownloadArgs = {
    body: z.infer<typeof pymixType._parameters.exportJob>;
};

type StorageCheckArgs = {
    query: z.infer<typeof pymixType._parameters.storageCheck>;
};

type SyncArgs = {
    body: z.infer<typeof pymixType._parameters.sync>;
};

type SyncPlanArgs = {
    body: z.infer<typeof pymixType._parameters.syncPlan>;
};

type SyncPlaylistsArgs = {
    body: z.infer<typeof pymixType._parameters.syncPlaylists>;
};

type ValidateTokenArgs = {
    query: z.infer<typeof pymixType._parameters.isValidToken>;
};

export const PymixController = {
    checkStorage: async (args: PymixClientArgs & StorageCheckArgs) => {
        const { baseUrl, query, signal, token } = args;
        const res = await pymixApiClient({ baseUrl, signal, token }).storageCheck({ query });

        if (res.status !== 200) {
            throw new Error('Failed to check storage');
        }

        return res.body.data;
    },

    create: async (args: CreateArgs & PymixClientArgs) => {
        const { baseUrl, body, signal, token } = args;
        const res = await pymixApiClient({ baseUrl, signal, token }).create({ body });

        if (res.status !== 200) {
            throw new Error('Failed to create user');
        }

        return res.body.data;
    },

    deleteDuplicates: async (args: PymixClientArgs) => {
        const { baseUrl, signal, token } = args;
        const res = await pymixApiClient({ baseUrl, signal, token }).deleteDuplicates();

        if (res.status !== 200) {
            throw new Error('Failed to delete duplicates');
        }

        return res.body.data;
    },

    deleteSong: async (args: DeleteSongArgs & PymixClientArgs) => {
        const { baseUrl, body, signal, token } = args;
        const res = await pymixApiClient({ baseUrl, signal, token }).deleteSong({ body });

        if (res.status !== 200) {
            throw new Error('Failed to delete song');
        }

        return res.body.data;
    },

    getLibrarySize: async (args: PymixClientArgs) => {
        const { baseUrl, signal, token } = args;
        const res = await pymixApiClient({ baseUrl, signal, token }).getLibrarySize();

        if (res.status !== 200) {
            throw new Error('Failed to get library size');
        }

        return res.body.data;
    },

    import: async (args: ImportArgs & PymixClientArgs) => {
        const { baseUrl, body, signal, token } = args;
        const res = await pymixApiClient({ baseUrl, signal, token }).import({ body });

        if (res.status !== 200) {
            throw new Error('Failed to start import');
        }

        return res.body.data;
    },

    importProgress: async (args: ImportProgressArgs & PymixClientArgs) => {
        const { baseUrl, query, signal, token } = args;
        const res = await pymixApiClient({ baseUrl, signal, token }).importProgress({ query });

        if (res.status !== 200) {
            throw new Error('Failed to get import progress');
        }

        return res.body.data;
    },

    login: async (args: LoginArgs & PymixClientArgs) => {
        const { baseUrl, body, signal, token } = args;
        const res = await pymixApiClient({ baseUrl, signal, token }).login({ body });

        if (res.status !== 200) {
            throw new Error('Failed to login');
        }

        return res.body.data;
    },

    matchTracks: async (args: MatchTracksArgs & PymixClientArgs) => {
        const { baseUrl, body, signal, token } = args;
        const res = await pymixApiClient({ baseUrl, signal, token }).matchTracks({ body });

        if (res.status !== 200) {
            throw new Error('Failed to match tracks');
        }

        return res.body.data;
    },

    rbDownload: async (args: PymixClientArgs & RbDownloadArgs) => {
        const { baseUrl, body, signal, token } = args;
        const res = await pymixApiClient({ baseUrl, signal, token }).rbDownload({ body });

        if (res.status !== 200) {
            throw new Error('Failed to export rekordbox');
        }

        return res.body.data;
    },

    rbImport: async (args: PymixClientArgs & RbImportArgs) => {
        const { baseUrl, body, signal, token } = args;
        const res = await pymixApiClient({ baseUrl, signal, token }).rbImport({ body });

        if (res.status !== 200) {
            throw new Error('Failed to import rekordbox');
        }

        return res.body.data;
    },

    seratoDownload: async (args: PymixClientArgs & SeratoDownloadArgs) => {
        const { baseUrl, body, signal, token } = args;
        const res = await pymixApiClient({ baseUrl, signal, token }).seratoDownload({ body });

        if (res.status !== 200) {
            throw new Error('Failed to export serato');
        }

        return res.body.data;
    },

    seratoImport: async (args: PymixClientArgs) => {
        const { baseUrl, signal, token } = args;
        const res = await pymixApiClient({ baseUrl, signal, token }).seratoImport();

        if (res.status !== 200) {
            throw new Error('Failed to import serato');
        }

        return res.body.data;
    },

    sync: async (args: PymixClientArgs & SyncArgs) => {
        const { baseUrl, body, signal, token } = args;
        const res = await pymixApiClient({ baseUrl, signal, token }).sync({ body });

        if (res.status !== 200) {
            throw new Error('Failed to sync');
        }

        return res.body.data;
    },

    syncPlan: async (args: PymixClientArgs & SyncPlanArgs) => {
        const { baseUrl, body, signal, token } = args;
        const res = await pymixApiClient({ baseUrl, signal, token }).syncPlan({ body });

        if (res.status !== 200) {
            throw new Error('Failed to get sync plan');
        }

        return res.body.data;
    },

    syncPlaylists: async (args: PymixClientArgs & SyncPlaylistsArgs) => {
        const { baseUrl, body, signal, token } = args;
        const res = await pymixApiClient({ baseUrl, signal, token }).syncPlaylists({ body });

        if (res.status !== 200) {
            throw new Error('Failed to sync playlists');
        }

        return res.body.data;
    },

    validateToken: async (args: PymixClientArgs & ValidateTokenArgs) => {
        const { baseUrl, query, signal, token } = args;
        const res = await pymixApiClient({ baseUrl, signal, token }).validateToken({ query });

        if (res.status !== 200) {
            throw new Error('Failed to validate token');
        }

        return res.body.data;
    },
};
