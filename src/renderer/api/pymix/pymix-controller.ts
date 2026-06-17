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

type SyncTracksArgs = {
    body: z.infer<typeof pymixType._parameters.syncTracks>;
};

type ValidateTokenArgs = {
    query: z.infer<typeof pymixType._parameters.isValidToken>;
};

type WishlistCreateArgs = {
    body: z.infer<typeof pymixType._parameters.wishlistCreate>;
};

type WishlistDeleteArgs = {
    params: { id: string };
};

type WishlistMatchYoutubeArgs = {
    params: { id: string };
};

type WishlistSetSheetArgs = {
    body: z.infer<typeof pymixType._parameters.wishlistSetSheet>;
};

type WishlistUpdateArgs = {
    body: z.infer<typeof pymixType._parameters.wishlistUpdate>;
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

    syncTracks: async (args: PymixClientArgs & SyncTracksArgs) => {
        const { baseUrl, body, signal, token } = args;
        const res = await pymixApiClient({ baseUrl, signal, token }).syncTracks({ body });

        if (res.status !== 200) {
            throw new Error('Failed to sync tracks');
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

    wishlistCreate: async (args: PymixClientArgs & WishlistCreateArgs) => {
        const { baseUrl, body, signal, token } = args;
        const res = await pymixApiClient({ baseUrl, signal, token }).wishlistCreate({ body });

        if (res.status !== 200) {
            throw new Error('Failed to create wishlist item');
        }

        return res.body.data;
    },

    wishlistDelete: async (args: PymixClientArgs & WishlistDeleteArgs) => {
        const { baseUrl, params, signal, token } = args;
        const res = await pymixApiClient({ baseUrl, signal, token }).wishlistDelete({ params });

        if (res.status !== 200) {
            throw new Error('Failed to delete wishlist item');
        }

        return res.body.data;
    },

    wishlistList: async (args: PymixClientArgs) => {
        const { baseUrl, signal, token } = args;
        const res = await pymixApiClient({ baseUrl, signal, token }).wishlistList();

        if (res.status !== 200) {
            throw new Error('Failed to get wishlist');
        }

        return res.body.data;
    },

    wishlistMatchYoutube: async (args: PymixClientArgs & WishlistMatchYoutubeArgs) => {
        const { baseUrl, params, signal, token } = args;
        const res = await pymixApiClient({ baseUrl, signal, token }).wishlistMatchYoutube({
            params,
        });

        if (res.status !== 200) {
            throw new Error('Failed to match YouTube video');
        }

        return res.body.data;
    },

    wishlistSetSheet: async (args: PymixClientArgs & WishlistSetSheetArgs) => {
        const { baseUrl, body, signal, token } = args;
        const res = await pymixApiClient({ baseUrl, signal, token }).wishlistSetSheet({ body });

        if (res.status !== 200) {
            throw new Error('Failed to set wishlist sheet');
        }

        return res.body.data;
    },

    wishlistUpdate: async (args: PymixClientArgs & WishlistDeleteArgs & WishlistUpdateArgs) => {
        const { baseUrl, body, params, signal, token } = args;
        const res = await pymixApiClient({ baseUrl, signal, token }).wishlistUpdate({
            body,
            params,
        });

        if (res.status !== 200) {
            throw new Error('Failed to update wishlist item');
        }

        return res.body.data;
    },
};
