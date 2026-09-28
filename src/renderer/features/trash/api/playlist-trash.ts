import { QueryClient } from '@tanstack/react-query';

import i18n from '/@/i18n/i18n';
import { PymixController } from '/@/renderer/api/pymix/pymix-controller';
import { urlConfig } from '/@/renderer/config/url-config';
import { playlistTreeQuery } from '/@/renderer/features/playlist-tree/hooks/use-playlist-tree';
import {
    fetchFreshTree,
    refreshAfterTrashChange,
} from '/@/renderer/features/trash/api/trash-refresh';
import { showNodesDeletedToast } from '/@/renderer/features/trash/components/trash-toasts';
import { PlaylistNodesDeleted, PlaylistTree } from '/@/shared/api/pymix/pymix-types';

// Subbox-only: deleting playlists and folders through pymix's trash (subbox-app#150,
// design §4.4, §8.2, §11.4). A delete there only hides the playlists, so it can be
// undone, synchronously, with the same Navidrome ids.

/** The tree query couldn't say whether the user has a tree: a delete must wait. */
export class TreeUnreachableError extends Error {
    constructor() {
        super(i18n.t('form.trash.unreachable', { postProcess: 'sentenceCase' }) as string);
        this.name = 'TreeUnreachableError';
    }
}

/**
 * The user's tree, or null when the tree query definitely said there isn't one (demo,
 * an older pymix, a user not migrated): only then may a playlist delete go straight to
 * Navidrome. Any other failure throws TreeUnreachableError, never falls back: going
 * direct would send a `live` user's delete past the trash, with no Undo.
 */
export const treeForDelete = async (
    queryClient: QueryClient,
    serverId: string,
): Promise<null | PlaylistTree> => {
    const { queryKey } = playlistTreeQuery(serverId);
    if (queryClient.getQueryState(queryKey)?.status === 'success') {
        return queryClient.getQueryData<null | PlaylistTree>(queryKey) ?? null;
    }
    // Not asked yet, or the last answer was a failure: ask again now.
    try {
        return await fetchFreshTree(queryClient, serverId);
    } catch {
        throw new TreeUnreachableError();
    }
};

/** Delete nodes, each with everything under it, as one trash batch, with an Undo toast. */
export const deletePlaylistNodes = async (
    queryClient: QueryClient,
    serverId: string,
    nodeIds: string[],
    name: null | string,
): Promise<PlaylistNodesDeleted> => {
    const result = await PymixController.deletePlaylistNodes({
        baseUrl: urlConfig.pymix,
        nodeIds,
    });
    await refreshAfterTrashChange(queryClient, serverId);
    showNodesDeletedToast({ name, queryClient, result, serverId });
    return result;
};

const nodeIdsFor = (tree: PlaylistTree, playlistIds: string[]) => {
    const byPlaylist = new Map(
        tree.nodes
            .filter((node) => node.kind === 'playlist' && node.navidrome_playlist_id)
            .map((node) => [node.navidrome_playlist_id as string, node]),
    );
    const nodes = playlistIds.map((id) => byPlaylist.get(id));
    return nodes.every(Boolean) ? nodes.map((node) => node!) : null;
};

const deletePlaylistsNow = async (
    queryClient: QueryClient,
    serverId: string,
    tree: PlaylistTree,
    playlistIds: string[],
) => {
    // A playlist made moments ago may not be in the tree we hold: pymix adopts it on
    // its next read.
    const nodes =
        nodeIdsFor(tree, playlistIds) ??
        nodeIdsFor(
            (await fetchFreshTree(queryClient, serverId).catch(() => null)) ?? tree,
            playlistIds,
        );
    if (!nodes) {
        throw new Error(i18n.t('form.trash.notInTree', { postProcess: 'sentenceCase' }) as string);
    }
    return deletePlaylistNodes(
        queryClient,
        serverId,
        nodes.map((node) => node.node_id),
        nodes.length === 1 ? nodes[0].name : null,
    );
};

// Deleting several selected playlists calls the mutation once per playlist, all at
// once. Requests that arrive in the same turn of the event loop go as one delete, so
// they make one trash batch and one Undo, not one toast each.
let pending: null | {
    ids: string[];
    result: Promise<PlaylistNodesDeleted>;
    serverId: string;
} = null;

export const deletePlaylistThroughTree = (
    queryClient: QueryClient,
    serverId: string,
    tree: PlaylistTree,
    playlistId: string,
): Promise<PlaylistNodesDeleted> => {
    if (pending && pending.serverId === serverId) {
        pending.ids.push(playlistId);
        return pending.result;
    }
    const batch = { ids: [playlistId], serverId };
    const result = new Promise<PlaylistNodesDeleted>((resolve, reject) => {
        setTimeout(() => {
            pending = null;
            deletePlaylistsNow(queryClient, serverId, tree, batch.ids).then(resolve, reject);
        }, 0);
    });
    pending = { ...batch, result };
    return result;
};
