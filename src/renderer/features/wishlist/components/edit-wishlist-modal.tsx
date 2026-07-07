import { t } from 'i18next';
import { useTranslation } from 'react-i18next';

import { useMatchMetadata } from '/@/renderer/features/wishlist/hooks/use-match-metadata';
import { useUpdateWishlistItem } from '/@/renderer/features/wishlist/hooks/use-update-wishlist-item';
import { Button } from '/@/shared/components/button/button';
import { Group } from '/@/shared/components/group/group';
import { Icon } from '/@/shared/components/icon/icon';
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
    const matchMutation = useMatchMetadata({});

    const form = useForm<EditWishlistFormValues>({
        initialValues: {
            album: item.album ?? '',
            artist: item.artist ?? '',
            title: item.title ?? '',
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

    // Runs the MusicBrainz matcher on the current field text (falling back to an inbox
    // item's raw note when both fields are still empty) and fills in the result.
    const handleFindMatch = () => {
        const artist = form.values.artist.trim();
        const title = form.values.title.trim();
        const query = !artist && !title ? (item.raw_note ?? '').trim() : undefined;

        if (!artist && !title && !query) {
            toast.warn({
                message: t('form.matchMetadata.needsText', { postProcess: 'sentenceCase' }),
            });
            return;
        }

        matchMutation.mutate(
            { artist: artist || undefined, query, title: title || undefined },
            {
                onError: (error) => {
                    toast.error({
                        message: (error as Error).message,
                        title: t('error.genericError', { postProcess: 'sentenceCase' }) as string,
                    });
                },
                onSuccess: (match) => {
                    if (!match) {
                        toast.warn({
                            message: t('form.matchMetadata.noMatch', {
                                postProcess: 'sentenceCase',
                            }),
                        });
                        return;
                    }
                    form.setFieldValue('artist', match.artist);
                    form.setFieldValue('title', match.title);
                    if (match.album && !form.values.album.trim()) {
                        form.setFieldValue('album', match.album);
                    }
                    toast.success({
                        message: t('form.matchMetadata.applied', {
                            artist: match.artist,
                            title: match.title,
                        }) as string,
                    });
                },
            },
        );
    };

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
                <Group justify="space-between">
                    <Button
                        leftSection={<Icon icon="search" size="sm" />}
                        loading={matchMutation.isPending}
                        onClick={handleFindMatch}
                        variant="default"
                    >
                        {t('action.findMetadataMatch', { postProcess: 'sentenceCase' })}
                    </Button>
                    <Group>
                        <ModalButton onClick={onCancel} variant="subtle">
                            {t('common.cancel', { postProcess: 'sentenceCase' })}
                        </ModalButton>
                        <ModalButton loading={mutation.isPending} type="submit" variant="filled">
                            {item.status === 'inbox'
                                ? t('action.confirmWishlistItem', { postProcess: 'sentenceCase' })
                                : t('common.save', { postProcess: 'sentenceCase' })}
                        </ModalButton>
                    </Group>
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
