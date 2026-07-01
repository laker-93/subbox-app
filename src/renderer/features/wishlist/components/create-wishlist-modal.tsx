import { t } from 'i18next';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { useCreateWishlistItem } from '/@/renderer/features/wishlist/hooks/use-create-wishlist-item';
import { useCreateWishlistItemsBulk } from '/@/renderer/features/wishlist/hooks/use-create-wishlist-items-bulk';
import { useParseWishlistLink } from '/@/renderer/features/wishlist/hooks/use-parse-wishlist-link';
import { Group } from '/@/shared/components/group/group';
import { closeAllModals, openModal } from '/@/shared/components/modal/modal';
import { ModalButton } from '/@/shared/components/modal/model-shared';
import { Stack } from '/@/shared/components/stack/stack';
import { TextInput } from '/@/shared/components/text-input/text-input';
import { toast } from '/@/shared/components/toast/toast';
import { useForm } from '/@/shared/hooks/use-form';
import { WishlistLinkMetadata } from '/@/shared/types/wishlist-types';

interface CreateWishlistFormValues {
    album: string;
    artist: string;
    link: string;
    title: string;
}

type ResolvedLink = {
    metadata: WishlistLinkMetadata;
    url: string;
};

const CreateWishlistForm = ({ onCancel }: { onCancel: () => void }) => {
    const { t } = useTranslation();
    const mutation = useCreateWishlistItem({});
    const bulkMutation = useCreateWishlistItemsBulk({});
    const parseLinkMutation = useParseWishlistLink({});
    const resolvedLinkRef = useRef<null | ResolvedLink>(null);

    const form = useForm<CreateWishlistFormValues>({
        initialValues: {
            album: '',
            artist: '',
            link: '',
            title: '',
        },
        validate: {
            artist: (value, values) =>
                value.trim() || values.title.trim() || values.link.trim()
                    ? null
                    : t('form.createWishlistItem.needsArtistOrTitle', {
                          postProcess: 'sentenceCase',
                      }),
            title: (value, values) =>
                value.trim() || values.artist.trim() || values.link.trim()
                    ? null
                    : t('form.createWishlistItem.needsArtistOrTitle', {
                          postProcess: 'sentenceCase',
                      }),
        },
    });

    // Resolves and caches link metadata. Both the blur-time prefetch (for UX
    // auto-fill) and submit (the only place that *must* resolve, since Enter-key
    // submission never fires onBlur on the focused input) share this cache.
    const resolveLink = async (url: string): Promise<WishlistLinkMetadata> => {
        if (resolvedLinkRef.current?.url === url) {
            return resolvedLinkRef.current.metadata;
        }

        const metadata = await parseLinkMutation.mutateAsync({ url });
        resolvedLinkRef.current = { metadata, url };
        return metadata;
    };

    const handleLinkBlur = async () => {
        const url = form.values.link.trim();
        if (!url || resolvedLinkRef.current?.url === url) return;

        try {
            const metadata = await resolveLink(url);
            if (!metadata.is_collection) {
                if (metadata.artist) form.setFieldValue('artist', metadata.artist);
                if (metadata.title) form.setFieldValue('title', metadata.title);
                if (metadata.album) form.setFieldValue('album', metadata.album);
            }
        } catch {
            // Best-effort prefill only — submit re-resolves and surfaces any error.
        }
    };

    const handleSubmit = form.onSubmit(async (values) => {
        const url = values.link.trim();

        let metadata: undefined | WishlistLinkMetadata;
        if (url) {
            try {
                metadata = await resolveLink(url);
            } catch (error) {
                toast.error({
                    message: (error as Error).message,
                    title: t('error.genericError', { postProcess: 'sentenceCase' }) as string,
                });
                return;
            }
        }

        if (metadata?.is_collection) {
            bulkMutation.mutate(
                {
                    items: metadata.tracks.map((track) => ({
                        album: track.album ?? undefined,
                        artist: track.artist,
                        bandcamp_url: track.bandcamp_url ?? undefined,
                        soundcloud_url: track.soundcloud_url ?? undefined,
                        title: track.title,
                        youtube_url: track.youtube_url ?? undefined,
                        youtube_video_id: track.youtube_video_id ?? undefined,
                    })),
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
                    onSuccess: (data) => {
                        toast.success({
                            message: t('form.createWishlistItem.successCollection', {
                                count: data.items.length,
                            }) as string,
                        });
                        closeAllModals();
                    },
                },
            );
            return;
        }

        mutation.mutate(
            {
                album: values.album || metadata?.album || undefined,
                artist: values.artist || metadata?.artist || '',
                bandcamp_url: metadata?.bandcamp_url ?? undefined,
                soundcloud_url: metadata?.soundcloud_url ?? undefined,
                title: values.title || metadata?.title || '',
                youtube_url: metadata?.youtube_url ?? undefined,
                youtube_video_id: metadata?.youtube_video_id ?? undefined,
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
                    description={t('form.createWishlistItem.linkDescription', {
                        postProcess: 'sentenceCase',
                    })}
                    label={t('form.createWishlistItem.input', {
                        context: 'link',
                        postProcess: 'titleCase',
                    })}
                    onBlur={handleLinkBlur}
                    {...form.getInputProps('link')}
                />
                <TextInput
                    label={t('form.createWishlistItem.input', {
                        context: 'artist',
                        postProcess: 'titleCase',
                    })}
                    {...form.getInputProps('artist')}
                />
                <TextInput
                    label={t('form.createWishlistItem.input', {
                        context: 'title',
                        postProcess: 'titleCase',
                    })}
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
                    <ModalButton
                        loading={
                            mutation.isPending ||
                            parseLinkMutation.isPending ||
                            bulkMutation.isPending
                        }
                        type="submit"
                        variant="filled"
                    >
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
