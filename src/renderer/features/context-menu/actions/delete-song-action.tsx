import { closeAllModals, openModal } from '@mantine/modals';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useDeleteSong } from '/@/renderer/features/songs/mutations/delete-song-mutation';
import { useCurrentServerId } from '/@/renderer/store';
import { ContextMenu } from '/@/shared/components/context-menu/context-menu';
import { ConfirmModal } from '/@/shared/components/modal/modal';
import { Text } from '/@/shared/components/text/text';
import { toast } from '/@/shared/components/toast/toast';
import { Song } from '/@/shared/types/domain-types';

interface DeleteSongActionProps {
    disabled?: boolean;
    items: Song[];
}

export const DeleteSongAction = ({ disabled, items }: DeleteSongActionProps) => {
    const { t } = useTranslation();
    const serverId = useCurrentServerId();
    const deleteSongMutation = useDeleteSong({});

    const handleDeleteSong = useCallback(async () => {
        if (items.length === 0 || !serverId) return;

        const subboxIds = items
            .map((song) => song.tags?.subbox_id?.[0])
            .filter((id): id is string => !!id);

        if (subboxIds.length === 0) {
            toast.error({
                message: 'No subbox_id found for the selected tracks',
                title: t('error.genericError', { postProcess: 'sentenceCase' }),
            });
            closeAllModals();
            return;
        }

        try {
            await deleteSongMutation.mutateAsync({
                ids: subboxIds,
                serverId,
            });

            toast.success({
                message: t('form.deleteSong.success', { postProcess: 'sentenceCase' }),
            });
        } catch (err: any) {
            toast.error({
                message: err.message,
                title: t('error.genericError', { postProcess: 'sentenceCase' }),
            });
        }

        closeAllModals();
    }, [deleteSongMutation, items, serverId, t]);

    const openDeleteSongModal = useCallback(() => {
        if (items.length === 0) return;

        openModal({
            children: (
                <ConfirmModal onConfirm={handleDeleteSong}>
                    <Text>{t('common.areYouSure', { postProcess: 'sentenceCase' })}</Text>
                </ConfirmModal>
            ),
            title: t('form.deleteSong.title', { postProcess: 'sentenceCase' }),
        });
    }, [handleDeleteSong, items.length, t]);

    if (items.length === 0) return null;

    return (
        <ContextMenu.Item disabled={disabled} leftIcon="remove" onSelect={openDeleteSongModal}>
            {t('action.deleteSong', { postProcess: 'sentenceCase' })}
        </ContextMenu.Item>
    );
};
