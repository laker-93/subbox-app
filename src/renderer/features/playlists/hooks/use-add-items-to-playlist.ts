import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { api } from '/@/renderer/api';
import { queryKeys } from '/@/renderer/api/query-keys';
import {
    getAlbumArtistSongsById,
    getAlbumSongsById,
    getGenreSongsById,
    getPlaylistSongsById,
    getSongsByFolder,
} from '/@/renderer/features/player/utils';
import { useAddToPlaylist } from '/@/renderer/features/playlists/mutations/add-to-playlist-mutation';
import { useCurrentServerId } from '/@/renderer/store';
import { toast } from '/@/shared/components/toast/toast';
import { useLocalStorage } from '/@/shared/hooks/use-local-storage';
import { LibraryItem } from '/@/shared/types/domain-types';

// Add items to one playlist straight away, with no modal: what the context menu's
// "Add to playlist" submenu and a drop onto a sidebar playlist both do. Albums,
// artists, genres, folders and playlists are expanded to their songs first. Honours
// the same "skip duplicates" setting (localStorage) as the modal and the submenu.
export const useAddItemsToPlaylist = () => {
    const { t } = useTranslation();
    const serverId = useCurrentServerId();
    const queryClient = useQueryClient();
    const [skipDuplicates, setSkipDuplicates] = useLocalStorage({
        defaultValue: true,
        key: 'playlist-skip-duplicate',
    });
    const addToPlaylistMutation = useAddToPlaylist({});

    const resolveSongIds = useCallback(
        async (items: string[], itemType: LibraryItem): Promise<null | string[]> => {
            const ids: string[] = [];
            switch (itemType) {
                case LibraryItem.ALBUM:
                    for (const id of items) {
                        const songs = await getAlbumSongsById({ id: [id], queryClient, serverId });
                        ids.push(...(songs?.items?.map((song) => song.id) || []));
                    }
                    return ids;
                case LibraryItem.ALBUM_ARTIST:
                case LibraryItem.ARTIST:
                    for (const id of items) {
                        const songs = await getAlbumArtistSongsById({
                            id: [id],
                            queryClient,
                            serverId,
                        });
                        ids.push(...(songs?.items?.map((song) => song.id) || []));
                    }
                    return ids;
                case LibraryItem.FOLDER: {
                    for (const id of items) {
                        const songs = await getSongsByFolder({ id: [id], queryClient, serverId });
                        ids.push(...(songs?.items?.map((song) => song.id) || []));
                    }
                    return ids;
                }
                case LibraryItem.GENRE: {
                    const songs = await getGenreSongsById({ id: items, queryClient, serverId });
                    return songs?.items?.map((song) => song.id) || [];
                }
                case LibraryItem.PLAYLIST:
                    for (const id of items) {
                        const songs = await getPlaylistSongsById({ id, queryClient, serverId });
                        ids.push(...(songs?.items?.map((song) => song.id) || []));
                    }
                    return ids;
                case LibraryItem.PLAYLIST_SONG:
                case LibraryItem.QUEUE_SONG:
                case LibraryItem.SONG:
                    return items;
                default:
                    return null;
            }
        },
        [queryClient, serverId],
    );

    const addItemsToPlaylist = useCallback(
        async (playlistId: string, items: string[], itemType: LibraryItem) => {
            if (items.length === 0 || !serverId) return;

            const successToast = (count: number) =>
                toast.success({
                    message: t('form.addToPlaylist.success', {
                        message: count,
                        numOfPlaylists: 1,
                        postProcess: 'sentenceCase',
                    }),
                });

            try {
                const allSongIds = await resolveSongIds(items, itemType);
                if (allSongIds === null) return;

                let songsToAdd = allSongIds;
                if (skipDuplicates && songsToAdd.length > 0) {
                    const playlistSongsRes = await queryClient.fetchQuery({
                        queryFn: ({ signal }) =>
                            api.controller.getPlaylistSongList({
                                apiClientProps: { serverId, signal },
                                query: { id: playlistId },
                            }),
                        queryKey: queryKeys.playlists.songList(serverId, playlistId),
                    });
                    const existing = new Set(playlistSongsRes?.items?.map((song) => song.id));
                    songsToAdd = songsToAdd.filter((id) => !existing.has(id));
                }

                if (songsToAdd.length === 0) {
                    successToast(0);
                    return;
                }

                await addToPlaylistMutation.mutateAsync({
                    apiClientProps: { serverId },
                    body: { songId: songsToAdd },
                    query: { id: playlistId },
                });
                successToast(songsToAdd.length);
            } catch (error) {
                toast.error({
                    message: (error as Error).message,
                    title: t('error.genericError', { postProcess: 'sentenceCase' }),
                });
            }
        },
        [addToPlaylistMutation, queryClient, resolveSongIds, serverId, skipDuplicates, t],
    );

    return { addItemsToPlaylist, setSkipDuplicates, skipDuplicates };
};
