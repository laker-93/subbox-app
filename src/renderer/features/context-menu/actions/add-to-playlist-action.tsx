import { openContextModal } from '@mantine/modals';
import { useQuery } from '@tanstack/react-query';
import Fuse from 'fuse.js';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { PlaylistPath } from '/@/renderer/features/playlist-tree/components/playlist-path';
import { playlistsQueries } from '/@/renderer/features/playlists/api/playlists-api';
import { useAddItemsToPlaylist } from '/@/renderer/features/playlists/hooks/use-add-items-to-playlist';
import { useRecentPlaylists } from '/@/renderer/features/playlists/hooks/use-recent-playlists';
import { useCurrentServer, useCurrentServerId } from '/@/renderer/store';
import { Checkbox } from '/@/shared/components/checkbox/checkbox';
import { ContextMenu } from '/@/shared/components/context-menu/context-menu';
import { Icon } from '/@/shared/components/icon/icon';
import { Spinner } from '/@/shared/components/spinner/spinner';
import { TextInput } from '/@/shared/components/text-input/text-input';
import { Tooltip } from '/@/shared/components/tooltip/tooltip';
import { LibraryItem, PlaylistListSort, SortOrder } from '/@/shared/types/domain-types';

interface AddToPlaylistActionProps {
    items: string[];
    itemType: LibraryItem;
}

export const AddToPlaylistAction = ({ items, itemType }: AddToPlaylistActionProps) => {
    const { t } = useTranslation();
    const server = useCurrentServer();
    const serverId = useCurrentServerId();
    const [searchTerm, setSearchTerm] = useState('');
    const { addItemsToPlaylist, setSkipDuplicates, skipDuplicates } = useAddItemsToPlaylist();

    const playlistsQuery = useQuery(
        playlistsQueries.list({
            query: {
                excludeSmartPlaylists: true,
                sortBy: PlaylistListSort.NAME,
                sortOrder: SortOrder.ASC,
                startIndex: 0,
            },
            serverId: server?.id,
        }),
    );

    const { recentPlaylistId } = useRecentPlaylists(serverId);

    const playlists = playlistsQuery.data?.items;

    const fuse = useMemo(() => {
        if (!playlists) return null;

        return new Fuse(playlists, {
            fieldNormWeight: 1,
            ignoreLocation: true,
            keys: ['name'],
            threshold: 0.3,
        });
    }, [playlists]);

    const recentPlaylist = useMemo(() => {
        if (!playlists || !recentPlaylistId) return null;

        const playlist = playlists.find((p) => p.id === recentPlaylistId);
        if (!playlist) return null;

        if (searchTerm && fuse) {
            const results = fuse.search(searchTerm);
            const found = results.find((result) => result.item.id === recentPlaylistId);
            if (!found) return null;
        }

        return playlist;
    }, [playlists, recentPlaylistId, searchTerm, fuse]);

    const filteredPlaylists = useMemo(() => {
        if (!playlists) return [];
        if (!searchTerm || !fuse) {
            // Exclude recent playlist from the list if it exists
            return recentPlaylistId
                ? playlists.filter((p) => p.id !== recentPlaylistId)
                : playlists;
        }

        const results = fuse.search(searchTerm);
        const filtered = results.map((result) => result.item);
        // Exclude recent playlist from the filtered results if it exists
        return recentPlaylistId ? filtered.filter((p) => p.id !== recentPlaylistId) : filtered;
    }, [playlists, searchTerm, fuse, recentPlaylistId]);

    const handleAddToPlaylist = useCallback(
        (playlistId: string) => addItemsToPlaylist(playlistId, items, itemType),
        [addItemsToPlaylist, itemType, items],
    );

    const handleOpenModal = useCallback(() => {
        const modalProps: {
            albumId?: string[];
            artistId?: string[];
            folderId?: string[];
            genreId?: string[];
            initialSelectedIds?: string[];
            playlistId?: string[];
            songId?: string[];
        } = {};

        switch (itemType) {
            case LibraryItem.ALBUM:
                modalProps.albumId = items;
                break;
            case LibraryItem.ALBUM_ARTIST:
            case LibraryItem.ARTIST:
                modalProps.artistId = items;
                break;
            case LibraryItem.FOLDER:
                modalProps.folderId = items;
                break;
            case LibraryItem.GENRE:
                modalProps.genreId = items;
                break;
            case LibraryItem.PLAYLIST:
                modalProps.playlistId = items;
                break;
            case LibraryItem.PLAYLIST_SONG:
            case LibraryItem.QUEUE_SONG:
            case LibraryItem.SONG:
                modalProps.songId = items;
                break;
            default:
                return;
        }

        openContextModal({
            innerProps: {
                ...modalProps,
            },
            modalKey: 'addToPlaylist',
            size: 'lg',
            title: t('page.contextMenu.addToPlaylist', { postProcess: 'sentenceCase' }),
        });
    }, [itemType, items, t]);

    if (items.length === 0) return null;

    const searchInput = (
        <TextInput
            autoFocus
            leftSection={<Icon icon="search" />}
            onChange={(e) => setSearchTerm(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            pb="xs"
            placeholder={t('common.search', { postProcess: 'sentenceCase' })}
            rightSection={
                <Tooltip
                    label={t('form.addToPlaylist.input', {
                        context: 'skipDuplicates',
                        postProcess: 'titleCase',
                    })}
                >
                    <Checkbox
                        checked={skipDuplicates}
                        onChange={(e) => {
                            setSkipDuplicates(e.target.checked);
                            e.stopPropagation();
                        }}
                        onClick={(e) => e.stopPropagation()}
                        size="sm"
                    />
                </Tooltip>
            }
            size="sm"
            value={searchTerm}
        />
    );

    return (
        <ContextMenu.Submenu isCloseDisabled>
            <ContextMenu.SubmenuTarget>
                <ContextMenu.Item
                    leftIcon="playlist"
                    onSelect={handleOpenModal}
                    rightIcon="arrowRightS"
                >
                    {t('page.contextMenu.addToPlaylist', { postProcess: 'sentenceCase' })}
                </ContextMenu.Item>
            </ContextMenu.SubmenuTarget>
            <ContextMenu.SubmenuContent stickyContent={searchInput}>
                {playlistsQuery.isLoading && (
                    <ContextMenu.Item disabled>
                        <Spinner container />
                    </ContextMenu.Item>
                )}
                {playlistsQuery.isError && (
                    <ContextMenu.Item disabled>
                        {t('error.genericError', { postProcess: 'sentenceCase' })}
                    </ContextMenu.Item>
                )}
                {recentPlaylist && (
                    <>
                        <ContextMenu.Item
                            key={recentPlaylist.id}
                            onSelect={() => handleAddToPlaylist(recentPlaylist.id)}
                        >
                            {recentPlaylist.name}
                            <PlaylistPath playlistId={recentPlaylist.id} />
                        </ContextMenu.Item>
                        {filteredPlaylists.length > 0 && <ContextMenu.Divider />}
                    </>
                )}
                {filteredPlaylists.length === 0 && !playlistsQuery.isLoading && (
                    <ContextMenu.Item disabled>
                        {t('common.noResultsFromQuery', { postProcess: 'sentenceCase' })}
                    </ContextMenu.Item>
                )}
                {filteredPlaylists.map((playlist) => (
                    <ContextMenu.Item
                        key={playlist.id}
                        onSelect={() => handleAddToPlaylist(playlist.id)}
                    >
                        {playlist.name}
                        <PlaylistPath playlistId={playlist.id} />
                    </ContextMenu.Item>
                ))}
            </ContextMenu.SubmenuContent>
        </ContextMenu.Submenu>
    );
};
