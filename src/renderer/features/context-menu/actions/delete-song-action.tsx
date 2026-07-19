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

interface DeleteSongConfirmProps {
    items: Song[];
    serverId: string;
}

// Rendered *inside* the modal so it re-renders on the mutation's pending state —
// that drives the ConfirmModal spinner / disabled buttons while pymix works
// through the batch (which can take a moment for many tracks). The imperatively
// opened modal in `openDeleteSongModal` can't observe hook state on its own.
const DeleteSongConfirm = ({ items, serverId }: DeleteSongConfirmProps) => {
    const { t } = useTranslation();
    const deleteSongMutation = useDeleteSong({});

    const handleDeleteSong = useCallback(async () => {
        const subboxIds = items
            .map((song) => {
                const id = song.tags?.subboxid?.[0] || song.tags?.subbox_id?.[0];
                if (!id) {
                    console.warn(
                        '[DeleteSong] No subboxid found for song:',
                        song.name,
                        'Available tags:',
                        Object.keys(song.tags || {}),
                    );
                }
                return id;
            })
            .filter((id): id is string => !!id);

        if (subboxIds.length === 0) {
            console.error(
                '[DeleteSong] No subboxid found for any selected tracks. Items:',
                items.map((s) => ({ name: s.name, tags: s.tags })),
            );
            toast.error({
                message: 'No subboxid found for the selected tracks',
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
                message:
                    subboxIds.length > 1
                        ? `${subboxIds.length} tracks deleted`
                        : t('form.deleteSong.success', { postProcess: 'sentenceCase' }),
            });
        } catch (err: any) {
            // A partial failure still deleted some tracks (and the mutation's
            // onSettled already invalidated the list). Tell the user how many
            // failed and why, rather than a blanket error.
            const results: Array<{ success: boolean }> | undefined = err?.data?.results;
            if (results?.length) {
                const failedCount = results.filter((r) => !r.success).length;
                const okCount = results.length - failedCount;
                toast.error({
                    message:
                        okCount > 0
                            ? `Deleted ${okCount}, failed ${failedCount}: ${err.message}`
                            : err.message,
                    title: t('error.genericError', { postProcess: 'sentenceCase' }),
                });
            } else {
                toast.error({
                    message: err.message,
                    title: t('error.genericError', { postProcess: 'sentenceCase' }),
                });
            }
        }

        closeAllModals();
    }, [deleteSongMutation, items, serverId, t]);

    return (
        <ConfirmModal loading={deleteSongMutation.isPending} onConfirm={handleDeleteSong}>
            <Text>
                {items.length > 1
                    ? `${t('common.areYouSure', { postProcess: 'sentenceCase' })} (${items.length} tracks)`
                    : t('common.areYouSure', { postProcess: 'sentenceCase' })}
            </Text>
        </ConfirmModal>
    );
};

export const DeleteSongAction = ({ disabled, items }: DeleteSongActionProps) => {
    const { t } = useTranslation();
    const serverId = useCurrentServerId();

    const openDeleteSongModal = useCallback(() => {
        if (items.length === 0 || !serverId) return;

        openModal({
            children: <DeleteSongConfirm items={items} serverId={serverId} />,
            title: t('form.deleteSong.title', { postProcess: 'sentenceCase' }),
        });
    }, [items, serverId, t]);

    if (items.length === 0) return null;

    return (
        <ContextMenu.Item disabled={disabled} leftIcon="remove" onSelect={openDeleteSongModal}>
            {t('action.deleteSong', { postProcess: 'sentenceCase' })}
        </ContextMenu.Item>
    );
};
