import { QueryClient, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { PymixController } from '/@/renderer/api/pymix/pymix-controller';
import { queryKeys } from '/@/renderer/api/query-keys';
import { infiniteLoaderDataQueryKey } from '/@/renderer/components/item-list/helpers/item-list-infinite-loader';
import { urlConfig } from '/@/renderer/config/url-config';
import { usePlaylistPlace } from '/@/renderer/features/playlist-tree/hooks/use-playlist-places';
import { invalidatePlaylistTree } from '/@/renderer/features/playlist-tree/hooks/use-playlist-tree';
import {
    applyInsert,
    applyMove,
    applyRename,
    NodeMove,
} from '/@/renderer/features/playlist-tree/utils/tree-ops';
import { useCurrentServerId } from '/@/renderer/store';
import { PlaylistNodeWritten, PlaylistTree } from '/@/shared/api/pymix/pymix-types';
import { toast } from '/@/shared/components/toast/toast';
import { LibraryItem } from '/@/shared/types/domain-types';

// Subbox-only: the playlist tree's structural verbs (subbox-app#148, design §11.2).
// Nothing here destroys anything, so moves and renames are optimistic: the sidebar
// changes at once and rolls back if pymix refuses. Every write ends with a tree
// refetch, so what's shown is always the server's answer in the end.

// Shared by every tree write, so a refetch waits for the last of a burst (a few quick
// keyboard moves) instead of landing between two and undoing the second's optimism.
const TREE_WRITE = ['playlistTreeWrite'];

const refetchWhenIdle = (queryClient: QueryClient, serverId: string) => {
    if (queryClient.isMutating({ mutationKey: TREE_WRITE }) <= 1) {
        invalidatePlaylistTree(queryClient, serverId);
    }
};

type NodeUpdate = { move: NodeMove; name?: undefined } | { move?: undefined; name: string };

interface NodeUpdateVariables {
    nodeId: string;
    update: NodeUpdate;
}

export const useUpdatePlaylistNode = () => {
    const { t } = useTranslation();
    const queryClient = useQueryClient();
    const serverId = useCurrentServerId();
    const treeKey = queryKeys.playlistTree.root(serverId);

    return useMutation<
        PlaylistNodeWritten,
        Error,
        NodeUpdateVariables,
        { previous: null | PlaylistTree | undefined }
    >({
        mutationFn: ({ nodeId, update }) =>
            PymixController.updatePlaylistNode({
                baseUrl: urlConfig.pymix,
                body: update.move ?? { name: update.name },
                nodeId,
            }),
        mutationKey: TREE_WRITE,
        onError: (_err, { update }, context) => {
            if (context?.previous) queryClient.setQueryData(treeKey, context.previous);
            toast.error({
                message: t(
                    update.move ? 'form.playlistTree.moveFailed' : 'form.playlistTree.renameFailed',
                    { postProcess: 'sentenceCase' },
                ),
            });
        },
        onMutate: async ({ nodeId, update }) => {
            await queryClient.cancelQueries({ queryKey: treeKey });
            const previous = queryClient.getQueryData<null | PlaylistTree>(treeKey);
            if (previous) {
                queryClient.setQueryData(
                    treeKey,
                    update.move
                        ? applyMove(previous, nodeId, update.move)
                        : applyRename(previous, nodeId, update.name),
                );
            }
            return { previous };
        },
        onSettled: () => refetchWhenIdle(queryClient, serverId),
    });
};

export const useCreatePlaylistFolder = () => {
    const { t } = useTranslation();
    const queryClient = useQueryClient();
    const serverId = useCurrentServerId();

    return useMutation({
        mutationFn: (body: { name: string; parent_id: null | string }) =>
            PymixController.createPlaylistFolder({ baseUrl: urlConfig.pymix, body }),
        mutationKey: TREE_WRITE,
        onError: () => {
            toast.error({
                message: t('form.playlistTree.createFailed', { postProcess: 'sentenceCase' }),
            });
        },
        onSettled: () => refetchWhenIdle(queryClient, serverId),
        onSuccess: (node) => {
            // Shown at once, so the new folder's row can open in rename.
            queryClient.setQueryData<null | PlaylistTree>(
                queryKeys.playlistTree.root(serverId),
                (tree) => (tree ? applyInsert(tree, node) : tree),
            );
        },
    });
};

/** POST /playlists: a Navidrome playlist and its node under a folder, in one call. */
export const useCreatePlaylistInFolder = () => {
    const queryClient = useQueryClient();
    const serverId = useCurrentServerId();

    return useMutation({
        mutationFn: (body: { name: string; parent_id: string }) =>
            PymixController.createPlaylistInFolder({ baseUrl: urlConfig.pymix, body }),
        mutationKey: TREE_WRITE,
        onSettled: () => {
            // As upstream's create does; the tree follows the list invalidation.
            queryClient.invalidateQueries({
                exact: false,
                queryKey: queryKeys.playlists.root(serverId),
            });
            queryClient.invalidateQueries({
                exact: false,
                queryKey: infiniteLoaderDataQueryKey(serverId, LibraryItem.PLAYLIST),
            });
            refetchWhenIdle(queryClient, serverId);
        },
    });
};

/**
 * A playlist rename, for upstream's edit modal (subbox-app#173). For a playlist in the
 * tree, pymix writes Navidrome's name from the tree (pymix#229): the leaf, or for a
 * `path` user the full path. So the modal edits the leaf and renames through pymix;
 * sending the leaf to Navidrome itself would drop the folders from the name.
 *
 * Null with no tree, or for a playlist not in it: the modal renames in Navidrome as
 * upstream does, and pymix takes a bare name as the leaf anyway.
 */
export const useTreePlaylistRename = (playlistId: string | undefined) => {
    const queryClient = useQueryClient();
    const serverId = useCurrentServerId();
    const place = usePlaylistPlace(playlistId);
    const { mutateAsync } = useUpdatePlaylistNode();

    if (!place || place.leaf === null) return null;
    const { leaf, nodeId } = place;
    return {
        leaf,
        rename: async (name: string) => {
            if (name === leaf) return;
            await mutateAsync({ nodeId, update: { name } });
            // Navidrome's name changed too: the flat lists and the playlist page show it.
            queryClient.invalidateQueries({
                exact: false,
                queryKey: queryKeys.playlists.root(serverId),
            });
        },
    };
};
