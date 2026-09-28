import { closeAllModals, openModal } from '@mantine/modals';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

import { useIsDemoSession } from '/@/renderer/config/demo-config';
import { playlistsQueries } from '/@/renderer/features/playlists/api/playlists-api';
import { useRemoveFromPlaylist } from '/@/renderer/features/playlists/mutations/remove-from-playlist-mutation';
import {
    showRemovedFromPlaylistToast,
    snapshotRemoved,
} from '/@/renderer/features/playlists/undo/remove-from-playlist-undo';
import { useCurrentServerId } from '/@/renderer/store';
import { ContextMenu } from '/@/shared/components/context-menu/context-menu';
import { ConfirmModal } from '/@/shared/components/modal/modal';
import { Text } from '/@/shared/components/text/text';
import { toast } from '/@/shared/components/toast/toast';
import { Song } from '/@/shared/types/domain-types';

interface RemoveFromPlaylistActionProps {
    items: Song[];
}

export const RemoveFromPlaylistAction = ({ items }: RemoveFromPlaylistActionProps) => {
    const { t } = useTranslation();
    const serverId = useCurrentServerId();
    const { playlistId } = useParams() as { playlistId?: string };
    const removeFromPlaylistMutation = useRemoveFromPlaylist();
    const queryClient = useQueryClient();
    const isDemo = useIsDemoSession();
    // Already loaded by the playlist page this menu opens on: only its name is read.
    const { data: playlist } = useQuery({
        ...playlistsQueries.detail({ query: { id: playlistId || '' }, serverId }),
        enabled: Boolean(playlistId && serverId),
    });
    const playlistName = playlist?.name;

    const { ids } = useMemo(() => {
        const ids = items.map((item) => item.playlistItemId).filter((id) => id !== undefined);
        return { ids };
    }, [items]);

    const handleRemoveFromPlaylist = useCallback(async () => {
        if (ids.length === 0 || !serverId || !playlistId) return;

        // Taken before the call: afterwards the entry ids are renumbered.
        const removed = snapshotRemoved(items);

        try {
            await removeFromPlaylistMutation.mutateAsync({
                apiClientProps: { serverId },
                query: {
                    id: playlistId,
                    songId: ids,
                },
            });

            showRemovedFromPlaylistToast({
                playlistId,
                playlistName,
                queryClient,
                removed,
                serverId,
                t,
                withUndo: !isDemo,
            });
        } catch (err: any) {
            toast.error({
                message: err.message,
                title: t('error.genericError', { postProcess: 'sentenceCase' }),
            });
        }

        closeAllModals();
    }, [
        ids,
        isDemo,
        items,
        playlistId,
        playlistName,
        queryClient,
        removeFromPlaylistMutation,
        serverId,
        t,
    ]);

    const openRemoveFromPlaylistModal = useCallback(() => {
        if (ids.length === 0 || !playlistId) return;

        openModal({
            children: (
                <ConfirmModal onConfirm={handleRemoveFromPlaylist}>
                    <Text>{t('common.areYouSure', { postProcess: 'sentenceCase' })}</Text>
                </ConfirmModal>
            ),
            title: t('action.removeFromPlaylist', { postProcess: 'sentenceCase' }),
        });
    }, [handleRemoveFromPlaylist, ids, playlistId, t]);

    if (ids.length === 0 || !playlistId) return null;

    return (
        <ContextMenu.Item leftIcon="remove" onSelect={openRemoveFromPlaylistModal}>
            {t('action.removeFromPlaylist', { postProcess: 'sentenceCase' })}
        </ContextMenu.Item>
    );
};
