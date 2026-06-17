import { t } from 'i18next';
import { useTranslation } from 'react-i18next';

import { useCreateWishlistItem } from '/@/renderer/features/wishlist/hooks/use-create-wishlist-item';
import { Group } from '/@/shared/components/group/group';
import { closeAllModals, openModal } from '/@/shared/components/modal/modal';
import { ModalButton } from '/@/shared/components/modal/model-shared';
import { Stack } from '/@/shared/components/stack/stack';
import { TextInput } from '/@/shared/components/text-input/text-input';
import { toast } from '/@/shared/components/toast/toast';
import { useForm } from '/@/shared/hooks/use-form';
import { CreateWishlistItemRequest } from '/@/shared/types/wishlist-types';

const CreateWishlistForm = ({ onCancel }: { onCancel: () => void }) => {
    const { t } = useTranslation();
    const mutation = useCreateWishlistItem({});

    const form = useForm<CreateWishlistItemRequest>({
        initialValues: {
            album: '',
            artist: '',
            title: '',
        },
        validate: {
            artist: (value) =>
                value.trim()
                    ? null
                    : t('form.createWishlistItem.required', { postProcess: 'sentenceCase' }),
            title: (value) =>
                value.trim()
                    ? null
                    : t('form.createWishlistItem.required', { postProcess: 'sentenceCase' }),
        },
    });

    const handleSubmit = form.onSubmit((values) => {
        mutation.mutate(
            {
                album: values.album || undefined,
                artist: values.artist,
                title: values.title,
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
                <TextInput
                    label={t('form.createWishlistItem.input', {
                        context: 'artist',
                        postProcess: 'titleCase',
                    })}
                    required
                    {...form.getInputProps('artist')}
                />
                <TextInput
                    label={t('form.createWishlistItem.input', {
                        context: 'title',
                        postProcess: 'titleCase',
                    })}
                    required
                    {...form.getInputProps('title')}
                />
                <TextInput
                    label={t('form.createWishlistItem.input', {
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
                        {t('common.create', { postProcess: 'sentenceCase' })}
                    </ModalButton>
                </Group>
            </Stack>
        </form>
    );
};

export const openCreateWishlistModal = () => {
    openModal({
        children: <CreateWishlistForm onCancel={closeAllModals} />,
        title: t('action.addToWishlist', { postProcess: 'titleCase' }) as string,
    });
};
