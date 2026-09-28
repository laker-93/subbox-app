import { QueryClient, queryOptions, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';

import { PymixController } from '/@/renderer/api/pymix/pymix-controller';
import { queryKeys } from '/@/renderer/api/query-keys';
import { urlConfig } from '/@/renderer/config/url-config';
import { useCurrentServerId } from '/@/renderer/store';
import { useLocalStorage } from '/@/shared/hooks/use-local-storage';

// Subbox-only: pymix's playlist tree (subbox-app#147, design §4.4, §11.1).

/**
 * What the tree query says about the user, which is what decides how a playlist
 * delete may go (#150):
 * - `tree`: they have a tree. Deletes go through pymix, with Undo.
 * - `none`: they definitely don't (demo, an older pymix, a user not migrated). The
 *   flat list, and deletes go straight to Navidrome as they always have.
 * - `unknown`: the query failed some other way. The sidebar still draws what it has,
 *   but a delete must be refused: going direct could send a `live` user's delete past
 *   the trash.
 * - `loading`: not answered yet.
 */
export type PlaylistTreeState = 'loading' | 'none' | 'tree' | 'unknown';

export const playlistTreeQuery = (serverId: string) =>
    queryOptions({
        queryFn: ({ signal }) =>
            PymixController.getPlaylistTree({ baseUrl: urlConfig.pymix, signal }),
        queryKey: queryKeys.playlistTree.root(serverId),
    });

export const usePlaylistTree = () => {
    const serverId = useCurrentServerId();
    const query = useQuery({ ...playlistTreeQuery(serverId), enabled: Boolean(serverId) });

    let state: PlaylistTreeState;
    if (query.isError) state = 'unknown';
    else if (query.isPending) state = 'loading';
    else state = query.data ? 'tree' : 'none';

    // The last tree answered, even while a refetch is failing: the sidebar keeps
    // drawing it, and `state` says it can't be trusted for a delete.
    return { ...query, state, tree: query.data ?? null };
};

export const invalidatePlaylistTree = (queryClient: QueryClient, serverId: string) =>
    queryClient.invalidateQueries({ queryKey: queryKeys.playlistTree.root(serverId) });

/**
 * After a Rekordbox or Serato import job ends, whatever its verdict: an import adds
 * playlists and nodes, and even a failed one can have written some. Invalidating the
 * playlist lists refetches the tree too (useFollowPlaylistListInvalidations), but the
 * tree is invalidated directly as well, in case no sidebar is mounted to follow.
 */
export const refreshPlaylistsAfterImport = (queryClient: QueryClient, serverId: string) => {
    queryClient.invalidateQueries({ queryKey: queryKeys.playlists.list(serverId) });
    invalidatePlaylistTree(queryClient, serverId);
};

/**
 * Refetch the tree whenever a playlist list is invalidated. Every playlist create,
 * delete and edit (upstream mutations) already invalidates `playlists.list`, and pymix
 * reconciles with Navidrome on each read, so following those keeps the tree current
 * without touching the upstream mutations.
 */
export const useFollowPlaylistListInvalidations = () => {
    const queryClient = useQueryClient();
    const serverId = useCurrentServerId();

    useEffect(() => {
        if (!serverId) return undefined;
        let pending = false;

        return queryClient.getQueryCache().subscribe((event) => {
            if (event.type !== 'updated' || event.action.type !== 'invalidate') return;
            const [sid, group, kind] = event.query.queryKey;
            if (sid !== serverId || group !== 'playlists' || kind !== 'list') return;
            // One mutation invalidates several list queries at once: refetch once.
            if (pending) return;
            pending = true;
            queueMicrotask(() => {
                pending = false;
                invalidatePlaylistTree(queryClient, serverId);
            });
        });
    }, [queryClient, serverId]);
};

/**
 * Which folders are open in the sidebar, per device and server. Order and structure
 * are the server's; this is only a view convenience. Mantine's hook keeps every
 * instance in the window in step, so a modal can open the folder it moved into.
 */
export const useTreeExpanded = () => {
    const serverId = useCurrentServerId();
    const [expanded, setExpanded] = useLocalStorage<string[]>({
        defaultValue: [],
        key: `playlist_tree_expanded:${serverId || 'local'}`,
    });

    const toggle = useCallback(
        (nodeId: string) =>
            setExpanded((current) =>
                current.includes(nodeId)
                    ? current.filter((id) => id !== nodeId)
                    : [...current, nodeId],
            ),
        [setExpanded],
    );

    const expand = useCallback(
        (nodeId: null | string) => {
            if (!nodeId) return;
            setExpanded((current) => (current.includes(nodeId) ? current : [...current, nodeId]));
        },
        [setExpanded],
    );

    return { expand, expanded, toggle };
};
