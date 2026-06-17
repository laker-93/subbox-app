import { t } from 'i18next';
import { useTranslation } from 'react-i18next';

import { useUpdateWishlistItem } from '/@/renderer/features/wishlist/hooks/use-update-wishlist-item';
import { Group } from '/@/shared/components/group/group';
import { closeAllModals, openModal } from '/@/shared/components/modal/modal';
import { ModalButton } from '/@/shared/components/modal/model-shared';
import { Stack } from '/@/shared/components/stack/stack';
import { TextInput } from '/@/shared/components/text-input/text-input';
import { Text } from '/@/shared/components/text/text';
import { toast } from '/@/shared/components/toast/toast';
import { useForm } from '/@/shared/hooks/use-form';
import { WishlistItem } from '/@/shared/types/wishlist-types';

interface EditWishlistFormValues {
    album: string;
    artist: string;
    title: string;
}

const EditWishlistForm = ({ item, onCancel }: { item: WishlistItem; onCancel: () => void }) => {
    const { t } = useTranslation();
    const mutation = useUpdateWishlistItem({});

    const form = useForm<EditWishlistFormValues>({
        initialValues: {
            album: item.album ?? '',
            artist: item.artist,
            title: item.title,
        },
        validate: {
            artist: (value) =>
                value.trim()
                    ? null
                    : t('form.editWishlistItem.required', { postProcess: 'sentenceCase' }),
            title: (value) =>
                value.trim()
                    ? null
                    : t('form.editWishlistItem.required', { postProcess: 'sentenceCase' }),
        },
    });

    const handleSubmit = form.onSubmit((values) => {
        mutation.mutate(
            {
                body: {
                    album: values.album || undefined,
                    artist: values.artist,
                    status: item.status === 'inbox' ? 'wishlist' : undefined,
                    title: values.title,
                },
                wishlistId: item.wishlist_id,
            },
            {
                onError: (error) => {
                    toast.error({
                        message: (error as Error).message,
                        title: t('error.genericError', {
                            postProcess: 'sentenceCase',
                        }) as string,
                    });
                },
                onSuccess: () => {
                    closeAllModals();
                },
            },
        );
    });

    return (
        <form onSubmit={handleSubmit}>
            <Stack gap="md">
                {item.status === 'inbox' && item.raw_note && (
                    <Text isMuted size="sm">
                        {t('page.wishlist.inboxRawNote', { postProcess: 'sentenceCase' })}:{' '}
                        {item.raw_note}
                    </Text>
                )}
                <TextInput
                    label={t('form.editWishlistItem.input', {
                        context: 'artist',
                        postProcess: 'titleCase',
                    })}
                    required
                    {...form.getInputProps('artist')}
                />
                <TextInput
                    label={t('form.editWishlistItem.input', {
                        context: 'title',
                        postProcess: 'titleCase',
                    })}
                    required
                    {...form.getInputProps('title')}
                />
                <TextInput
                    label={t('form.editWishlistItem.input', {
                        context: 'album',
                        postProcess: 'titleCase',
                    })}
                    {...form.getInputProps('album')}
                />
                <Group justify="flex-end">
                    <ModalButton onClick={onCancel} variant="subtle">
                        {t('common.cancel', { postProcess: 'sentenceCase' })}
                    </ModalButton>
                    <ModalButton loading={mutation.isPending} type="submit" variant="filled">
                        {item.status === 'inbox'
                            ? t('action.confirmWishlistItem', { postProcess: 'sentenceCase' })
                            : t('common.save', { postProcess: 'sentenceCase' })}
                    </ModalButton>
                </Group>
            </Stack>
        </form>
    );
};

export const openEditWishlistModal = (item: WishlistItem) => {
    openModal({
        children: <EditWishlistForm item={item} onCancel={closeAllModals} />,
        title: t('action.editWishlistItem', { postProcess: 'titleCase' }) as string,
    });
};
