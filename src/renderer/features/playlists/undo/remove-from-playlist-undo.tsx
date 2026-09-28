import type { QueryClient } from '@tanstack/react-query';
import type { TFunction } from 'i18next';

import { api } from '/@/renderer/api';
import { queryKeys } from '/@/renderer/api/query-keys';
import { Button } from '/@/shared/components/button/button';
import { Group } from '/@/shared/components/group/group';
import { toast } from '/@/shared/components/toast/toast';
import { Song } from '/@/shared/types/domain-types';

// Subbox-only: the Undo on "Remove from playlist" (subbox-app#146, design §11.4). It
// lives in the client alone, for the life of the toast: there is no server-side copy.

const UNDO_WINDOW_MS = 15_000;

// A removed entry: the song, and the 1-based position it held. Navidrome's playlist
// entry id *is* that position, counting missing tracks too, so it's the right one to
// put the song back at even when the list on screen hides missing tracks.
export interface RemovedEntry {
    position: number;
    songId: string;
}

export const snapshotRemoved = (items: Song[]): RemovedEntry[] =>
    items
        .flatMap((item) => {
            const position = Number(item.playlistItemId);
            return Number.isInteger(position) && position > 0
                ? [{ position, songId: item.id }]
                : [];
        })
        .sort((a, b) => a.position - b.position);

// The songs were added back, but not all of them could be moved to their old places.
class NotRepositionedError extends Error {}

// Re-add the removed songs (Navidrome appends them, in order, duplicates kept), then
// move each back to its old position, lowest first. Placing the lowest first means
// everything before a target position is already as it was, and a move out of the
// tail doesn't shift the entries still waiting behind it.
const restoreRemovedEntries = async (
    serverId: string,
    playlistId: string,
    removed: RemovedEntry[],
) => {
    await api.controller.addToPlaylist({
        apiClientProps: { serverId },
        body: { songId: removed.map((entry) => entry.songId) },
        query: { id: playlistId },
    });

    // The appended entries are the last ones, and none is missing, so their own entry
    // ids are their true positions whatever the list leaves out.
    const { items } = await api.controller.getPlaylistSongList({
        apiClientProps: { serverId },
        query: { id: playlistId },
    });
    const appended = items.slice(-removed.length);
    if (
        appended.length !== removed.length ||
        appended.some((item, index) => item.id !== removed[index].songId)
    ) {
        // Something else changed the playlist meanwhile: moving by position now could
        // move the wrong entries.
        throw new NotRepositionedError();
    }

    try {
        for (const [index, entry] of removed.entries()) {
            const from = Number(appended[index].playlistItemId);
            if (from === entry.position) continue;
            // The controller sends insert_before = endingIndex + 1, and Navidrome puts
            // the entry at that 1-based position.
            await api.controller.movePlaylistItem({
                apiClientProps: { serverId },
                query: {
                    endingIndex: entry.position - 1,
                    playlistId,
                    startingIndex: from,
                    trackId: entry.songId,
                },
            });
        }
    } catch {
        throw new NotRepositionedError();
    }
};

const invalidatePlaylist = (queryClient: QueryClient, serverId: string, playlistId: string) => {
    queryClient.invalidateQueries({ queryKey: queryKeys.playlists.list(serverId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.playlists.detail(serverId, playlistId) });
    queryClient.invalidateQueries({
        queryKey: queryKeys.playlists.songList(serverId, playlistId),
    });
};

interface RemovedToastArgs {
    playlistId: string;
    playlistName?: string;
    queryClient: QueryClient;
    removed: RemovedEntry[];
    serverId: string;
    t: TFunction;
    withUndo: boolean;
}

export const showRemovedFromPlaylistToast = ({
    playlistId,
    playlistName,
    queryClient,
    removed,
    serverId,
    t,
    withUndo,
}: RemovedToastArgs) => {
    const count = removed.length;
    const message = playlistName
        ? t('form.removeFromPlaylist.removed', { count, name: playlistName })
        : t('form.removeFromPlaylist.removedUnnamed', { count });

    if (!withUndo || count === 0) {
        toast.success({ message });
        return;
    }

    const id = `remove-from-playlist-${playlistId}-${Date.now()}`;

    const undo = async () => {
        toast.update({
            autoClose: false,
            id,
            loading: true,
            message: t('form.removeFromPlaylist.restoring', { count }),
            withCloseButton: false,
        });

        try {
            await restoreRemovedEntries(serverId, playlistId, removed);
            toast.hide(id);
            toast.success({
                message: playlistName
                    ? t('form.removeFromPlaylist.restored', { count, name: playlistName })
                    : t('form.removeFromPlaylist.restoredUnnamed', { count }),
            });
        } catch (err) {
            toast.hide(id);
            toast.error({
                message:
                    err instanceof NotRepositionedError
                        ? t('form.removeFromPlaylist.notRepositioned', { count })
                        : t('form.removeFromPlaylist.restoreFailed', { count }),
                title: t('error.genericError', { postProcess: 'sentenceCase' }),
            });
        } finally {
            invalidatePlaylist(queryClient, serverId, playlistId);
        }
    };

    toast.success({
        autoClose: UNDO_WINDOW_MS,
        id,
        message: (
            <Group gap="sm" justify="space-between" wrap="nowrap">
                <span>{message}</span>
                <Button onClick={undo} size="compact-sm" style={{ flexShrink: 0 }} variant="subtle">
                    {t('form.removeFromPlaylist.undo', { postProcess: 'sentenceCase' })}
                </Button>
            </Group>
        ),
    });
};
