import { useQueries, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { playlistsQueries } from '/@/renderer/features/playlists/api/playlists-api';
import {
    Playlist,
    PlaylistListSort,
    SongListResponse,
    SortOrder,
} from '/@/shared/types/domain-types';

// No supported server exposes a "playlists containing song" lookup, so membership
// is derived client-side from the per-playlist song lists already cached by the
// playlist detail pages. Add/remove-from-playlist mutations invalidate those same
// queries, so the result stays fresh without extra wiring.
const MEMBERSHIP_STALE_TIME = 1000 * 60 * 5;

export const usePlaylistsContainingSong = (
    serverId: string | undefined,
    songId: string | undefined,
) => {
    const playlistList = useQuery({
        ...playlistsQueries.list({
            query: {
                excludeSmartPlaylists: true,
                sortBy: PlaylistListSort.NAME,
                sortOrder: SortOrder.ASC,
                startIndex: 0,
            },
            serverId: serverId ?? '',
        }),
        enabled: Boolean(serverId),
        staleTime: MEMBERSHIP_STALE_TIME,
    });

    const allPlaylists = useMemo(() => playlistList.data?.items ?? [], [playlistList.data?.items]);

    const membership = useQueries({
        combine: (results) => ({
            isLoading: results.some((result) => result.isLoading),
            songIdSets: results.map((result) => result.data),
        }),
        queries: allPlaylists.map((playlist) => ({
            ...playlistsQueries.songList({
                query: { id: playlist.id },
                serverId: serverId ?? '',
            }),
            enabled: Boolean(serverId) && Boolean(songId),
            select: (data: SongListResponse) => new Set((data?.items ?? []).map((song) => song.id)),
            staleTime: MEMBERSHIP_STALE_TIME,
        })),
    });

    const playlists = useMemo(() => {
        if (!songId) {
            return [];
        }

        const containing: Playlist[] = [];
        allPlaylists.forEach((playlist, index) => {
            if (membership.songIdSets[index]?.has(songId)) {
                containing.push(playlist);
            }
        });

        return containing;
    }, [allPlaylists, membership.songIdSets, songId]);

    return {
        isLoading: playlistList.isLoading || membership.isLoading,
        playlists,
    };
};
