import { useQuery } from '@tanstack/react-query';

import { playlistTreeQuery } from '/@/renderer/features/playlist-tree/hooks/use-playlist-tree';
import { useCurrentServerId } from '/@/renderer/store';
import { PlaylistTree } from '/@/shared/api/pymix/pymix-types';

// Subbox-only: where a playlist sits in the tree, for the places that show playlists
// outside it (subbox-app#149, design §11.3). Names are leaf-only, so two `Deep`s are
// expected, and those surfaces show the folder path when a name isn't unique.

export interface PlaylistPlace {
    /** Another playlist in the tree has the same name. */
    duplicate: boolean;
    /** Folder names from the root down, empty at the top level. */
    folders: string[];
}

// Computed once per tree answer, not once per row that asks.
const cache = new WeakMap<PlaylistTree, Map<string, PlaylistPlace>>();

/** Every playlist in the tree, by Navidrome id. */
export const playlistPlaces = (tree: PlaylistTree) => {
    const cached = cache.get(tree);
    if (cached) return cached;

    const byId = new Map(tree.nodes.map((node) => [node.node_id, node]));
    const nameCount = new Map<string, number>();
    for (const node of tree.nodes) {
        if (node.kind !== 'playlist' || node.name === null) continue;
        nameCount.set(node.name, (nameCount.get(node.name) ?? 0) + 1);
    }

    const places = new Map<string, PlaylistPlace>();
    for (const node of tree.nodes) {
        if (node.kind !== 'playlist' || !node.navidrome_playlist_id) continue;
        const folders: string[] = [];
        // A playlist can sit under another playlist (a Serato sub-crate); it names it too.
        for (let p = node.parent_id; p; p = byId.get(p)?.parent_id ?? null) {
            folders.unshift(byId.get(p)?.name ?? '');
        }
        places.set(node.navidrome_playlist_id, {
            duplicate: (nameCount.get(node.name ?? '') ?? 0) > 1,
            folders,
        });
    }
    cache.set(tree, places);
    return places;
};

/**
 * Reads the tree the sidebar already holds. It fetches only when nothing is cached
 * yet, never because a row mounted: grids mount rows as they scroll.
 */
export const usePlaylistPlaces = () => {
    const serverId = useCurrentServerId();
    const { data } = useQuery({
        ...playlistTreeQuery(serverId),
        enabled: Boolean(serverId),
        refetchOnMount: false,
        refetchOnWindowFocus: false,
    });
    return data ? playlistPlaces(data) : null;
};

/** `House › 2024`, or null when the name is unique or the playlist isn't in the tree. */
export const formatPlaylistPath = (place: PlaylistPlace | undefined) => {
    if (!place?.duplicate) return null;
    return place.folders.length ? place.folders.join(' › ') : null;
};

/** The folder path to show beside a playlist's name, or null to show the name alone. */
export const usePlaylistPath = (playlistId: string | undefined) => {
    const places = usePlaylistPlaces();
    return playlistId ? formatPlaylistPath(places?.get(playlistId)) : null;
};
