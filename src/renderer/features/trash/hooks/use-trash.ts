import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { PymixController } from '/@/renderer/api/pymix/pymix-controller';
import { queryKeys } from '/@/renderer/api/query-keys';
import { urlConfig } from '/@/renderer/config/url-config';
import { deletePlaylistNodes } from '/@/renderer/features/trash/api/playlist-trash';
import { refreshAfterTrashChange } from '/@/renderer/features/trash/api/trash-refresh';
import { useCurrentServerId } from '/@/renderer/store';
import { toast } from '/@/shared/components/toast/toast';

// Subbox-only: pymix's trash (subbox-app#150, design §8, §10). The Trash screen that
// lists it is #152.

export const useTrash = (options?: { enabled?: boolean; refetchOnMount?: 'always' }) => {
    const serverId = useCurrentServerId();
    return useQuery({
        enabled: Boolean(serverId) && (options?.enabled ?? true),
        queryFn: ({ signal }) => PymixController.getTrash({ baseUrl: urlConfig.pymix, signal }),
        queryKey: queryKeys.trash.root(serverId),
        refetchOnMount: options?.refetchOnMount ?? true,
    });
};

/** A trash batch put back. A playlist/folder batch answers with what came back how. */
export const useRestoreTrashBatch = () => {
    const queryClient = useQueryClient();
    const serverId = useCurrentServerId();
    return useMutation({
        mutationFn: (batchId: string) =>
            PymixController.restoreTrashBatch({ baseUrl: urlConfig.pymix, batchId }),
        onSettled: () => refreshAfterTrashChange(queryClient, serverId),
    });
};

/** One batch destroyed now. For playlists, the only way they leave Navidrome. */
export const usePurgeTrashBatch = () => {
    const queryClient = useQueryClient();
    const serverId = useCurrentServerId();
    return useMutation({
        mutationFn: (batchId: string) =>
            PymixController.purgeTrashBatch({ baseUrl: urlConfig.pymix, batchId }),
        onSettled: () => refreshAfterTrashChange(queryClient, serverId),
    });
};

export const useEmptyTrash = () => {
    const queryClient = useQueryClient();
    const serverId = useCurrentServerId();
    return useMutation({
        mutationFn: () => PymixController.emptyTrash({ baseUrl: urlConfig.pymix }),
        onSettled: () => refreshAfterTrashChange(queryClient, serverId),
    });
};

/** A folder and everything in it, into the trash, with an Undo toast. */
export const useDeleteFolder = () => {
    const { t } = useTranslation();
    const queryClient = useQueryClient();
    const serverId = useCurrentServerId();
    return useMutation({
        mutationFn: ({ name, nodeId }: { name: string; nodeId: string }) =>
            deletePlaylistNodes(queryClient, serverId, [nodeId], name),
        onError: () => {
            toast.error({
                message: t('form.trash.deleteFailed', { postProcess: 'sentenceCase' }),
                title: t('error.genericError', { postProcess: 'sentenceCase' }),
            });
        },
    });
};
