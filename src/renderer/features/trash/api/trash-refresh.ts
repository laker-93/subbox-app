import { QueryClient } from '@tanstack/react-query';

import { queryKeys } from '/@/renderer/api/query-keys';
import { infiniteLoaderDataQueryKey } from '/@/renderer/components/item-list/helpers/item-list-infinite-loader';
import { playlistTreeQuery } from '/@/renderer/features/playlist-tree/hooks/use-playlist-tree';
import { LibraryItem } from '/@/shared/types/domain-types';

// Subbox-only (subbox-app#150).

/** Ask pymix for the tree now, whatever the cache holds. */
export const fetchFreshTree = (queryClient: QueryClient, serverId: string) =>
    queryClient.fetchQuery({ ...playlistTreeQuery(serverId), staleTime: 0 });

/**
 * After a delete, restore or purge: the tree first, so the lists refetch against the
 * new `hidden_playlist_ids`, then the lists and the trash.
 */
export const refreshAfterTrashChange = async (queryClient: QueryClient, serverId: string) => {
    await fetchFreshTree(queryClient, serverId).catch(() => undefined);
    queryClient.invalidateQueries({ exact: false, queryKey: queryKeys.playlists.root(serverId) });
    queryClient.invalidateQueries({
        exact: false,
        queryKey: infiniteLoaderDataQueryKey(serverId, LibraryItem.PLAYLIST),
    });
    queryClient.invalidateQueries({ queryKey: queryKeys.trash.root(serverId) });
};
