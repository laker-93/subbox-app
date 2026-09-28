import { playlistTreeQuery } from '/@/renderer/features/playlist-tree/hooks/use-playlist-tree';
import { queryClient } from '/@/renderer/lib/react-query';
import { PlaylistTree } from '/@/shared/api/pymix/pymix-types';

// Subbox-only (subbox-app#150, design §8.2, §11.1). A deleted playlist is only hidden:
// it stays in Navidrome, with its id and entries, until its trash batch is purged, so
// every playlist list must leave it out. They all go through the controller's
// getPlaylistList, which calls this, so no surface can miss it.

const hiddenPlaylistIds = async (serverId: string): Promise<Set<string>> => {
    const { queryKey } = playlistTreeQuery(serverId);
    let tree: null | PlaylistTree | undefined;
    if (queryClient.getQueryState(queryKey)) {
        // Whatever the tree query last answered, without waiting on a refetch: a list
        // shouldn't stall on pymix, and a delete refreshes the tree before the lists.
        tree = queryClient.getQueryData<null | PlaylistTree>(queryKey);
    } else {
        // Nothing asked yet (the first list at startup): ask once, so a hidden playlist
        // doesn't flash up. No tree, or no answer, hides nothing.
        tree = await queryClient.fetchQuery(playlistTreeQuery(serverId)).catch(() => null);
    }
    return new Set(tree?.hidden_playlist_ids ?? []);
};

/**
 * The list without the playlists in the trash. A page may come back a few rows short
 * and its total still counts them: only a handful are ever hidden.
 */
export const withoutHiddenPlaylists = async <T extends { items: { id: string }[] }>(
    serverId: string,
    list: Promise<T>,
): Promise<T> => {
    const [result, hidden] = await Promise.all([list, hiddenPlaylistIds(serverId)]);
    if (!hidden.size) return result;
    return { ...result, items: result.items.filter((item) => !hidden.has(item.id)) };
};
