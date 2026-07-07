import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { openEditWishlistModal } from '/@/renderer/features/wishlist/components/edit-wishlist-modal';
import { useDeleteWishlistItem } from '/@/renderer/features/wishlist/hooks/use-delete-wishlist-item';
import { useMatchYoutube } from '/@/renderer/features/wishlist/hooks/use-match-youtube';
import { useUpdateWishlistItem } from '/@/renderer/features/wishlist/hooks/use-update-wishlist-item';
import { Button } from '/@/shared/components/button/button';
import { Group } from '/@/shared/components/group/group';
import { closeAllModals, ConfirmModal, openModal } from '/@/shared/components/modal/modal';
import { Stack } from '/@/shared/components/stack/stack';
import { Text } from '/@/shared/components/text/text';
import { toast } from '/@/shared/components/toast/toast';
import { WishlistItem, YoutubeMatch } from '/@/shared/types/wishlist-types';

interface WishlistItemDetailProps {
    item: WishlistItem;
}

// The expanded detail for a single wishlist row: source embeds (YouTube / SoundCloud /
// Bandcamp), YouTube match review, edit, per-item status transitions and delete. Extracted
// from the old card so the datagrid row can reveal it inline while the summary lives in the
// table columns.
export const WishlistItemDetail = ({ item }: WishlistItemDetailProps) => {
    const { t } = useTranslation();
    const updateMutation = useUpdateWishlistItem({});
    const deleteMutation = useDeleteWishlistItem({});
    const matchMutation = useMatchYoutube({});

    const [candidates, setCandidates] = useState<null | YoutubeMatch[]>(null);
    const [candidateIndex, setCandidateIndex] = useState(0);

    const handleError = (error: Error) => {
        toast.error({
            message: error.message,
            title: t('error.genericError', { postProcess: 'sentenceCase' }) as string,
        });
    };

    const setStatus = (status: WishlistItem['status']) => {
        updateMutation.mutate(
            { body: { status }, wishlistId: item.wishlist_id },
            { onError: handleError },
        );
    };

    const handleDelete = () => {
        openModal({
            children: (
                <ConfirmModal
                    labels={{
                        cancel: t('common.cancel', { postProcess: 'sentenceCase' }),
                        confirm: t('common.delete', { postProcess: 'sentenceCase' }),
                    }}
                    loading={deleteMutation.isPending}
                    onConfirm={() => {
                        deleteMutation.mutate(
                            { wishlistId: item.wishlist_id },
                            { onError: handleError },
                        );
                        closeAllModals();
                    }}
                >
                    <Text>{t('common.areYouSure', { postProcess: 'sentenceCase' })}</Text>
                </ConfirmModal>
            ),
            title: t('common.delete', { postProcess: 'titleCase' }) as string,
        });
    };

    const handleMatchYoutube = () => {
        matchMutation.mutate(
            { wishlistId: item.wishlist_id },
            {
                onError: handleError,
                onSuccess: (data) => {
                    if (data.matches.length === 0) {
                        toast.info({
                            message: t('page.wishlist.noMatchesFound', {
                                postProcess: 'sentenceCase',
                            }) as string,
                        });
                        return;
                    }

                    setCandidateIndex(0);
                    setCandidates(data.matches);
                },
            },
        );
    };

    const handleConfirmMatch = () => {
        if (!candidates) return;
        const candidate = candidates[candidateIndex];

        updateMutation.mutate(
            {
                body: {
                    youtube_url: candidate.youtube_url,
                    youtube_video_id: candidate.youtube_video_id,
                },
                wishlistId: item.wishlist_id,
            },
            {
                onError: handleError,
                onSuccess: () => {
                    setCandidates(null);
                },
            },
        );
    };

    const handleCancelReview = () => {
        setCandidates(null);
    };

    const handleEditEntry = () => {
        setCandidates(null);
        openEditWishlistModal(item);
    };

    const candidate = candidates?.[candidateIndex];
    const isInbox = item.status === 'inbox';

    if (isInbox) {
        return (
            <Stack gap="xs" p="sm">
                <Text isMuted size="sm">
                    {t('page.wishlist.inboxRawNote', { postProcess: 'sentenceCase' })}
                </Text>
                <Group gap="xs" wrap="wrap">
                    <Button onClick={handleEditEntry} size="sm" variant="default">
                        {t('action.editWishlistItem', { postProcess: 'sentenceCase' })}
                    </Button>
                    <Button onClick={handleDelete} size="sm" variant="state-error">
                        {t('common.delete', { postProcess: 'sentenceCase' })}
                    </Button>
                </Group>
            </Stack>
        );
    }

    return (
        <Stack gap="xs" p="sm">
            {candidate ? (
                <Stack gap="xs">
                    <div style={{ aspectRatio: '16 / 9', maxWidth: 400 }}>
                        <iframe
                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                            allowFullScreen
                            frameBorder="0"
                            height="100%"
                            src={`https://www.youtube.com/embed/${candidate.youtube_video_id}`}
                            title={candidate.youtube_title}
                            width="100%"
                        />
                    </div>
                    <Text isMuted size="xs">
                        {t('page.wishlist.matchCandidate', {
                            confidence: Math.round(candidate.confidence),
                            index: candidateIndex + 1,
                            total: candidates.length,
                        })}
                    </Text>
                    <Group gap="xs" wrap="wrap">
                        <Button
                            disabled={candidateIndex === 0}
                            onClick={() => setCandidateIndex((idx) => idx - 1)}
                            size="sm"
                            variant="subtle"
                        >
                            {t('action.previousMatch', { postProcess: 'sentenceCase' })}
                        </Button>
                        <Button
                            disabled={candidateIndex === candidates!.length - 1}
                            onClick={() => setCandidateIndex((idx) => idx + 1)}
                            size="sm"
                            variant="subtle"
                        >
                            {t('action.nextMatch', { postProcess: 'sentenceCase' })}
                        </Button>
                        <Button
                            loading={updateMutation.isPending}
                            onClick={handleConfirmMatch}
                            size="sm"
                            variant="filled"
                        >
                            {t('action.confirmMatch', { postProcess: 'sentenceCase' })}
                        </Button>
                        <Button onClick={handleEditEntry} size="sm" variant="default">
                            {t('action.editWishlistItem', { postProcess: 'sentenceCase' })}
                        </Button>
                        <Button onClick={handleCancelReview} size="sm" variant="subtle">
                            {t('common.cancel', { postProcess: 'sentenceCase' })}
                        </Button>
                    </Group>
                </Stack>
            ) : item.bandcamp_url ? (
                <Group gap="xs" wrap="wrap">
                    <Button
                        component="a"
                        href={item.bandcamp_url}
                        rel="noopener noreferrer"
                        size="sm"
                        target="_blank"
                        variant="default"
                    >
                        {t('action.openOnBandcamp', { postProcess: 'sentenceCase' })}
                    </Button>
                    <Button onClick={handleEditEntry} size="sm" variant="subtle">
                        {t('action.editWishlistItem', { postProcess: 'sentenceCase' })}
                    </Button>
                </Group>
            ) : item.soundcloud_url ? (
                <Stack gap="xs">
                    <iframe
                        allow="autoplay"
                        frameBorder="no"
                        height="166"
                        scrolling="no"
                        src={`https://w.soundcloud.com/player/?url=${encodeURIComponent(
                            item.soundcloud_url,
                        )}&color=%23ff5500&auto_play=false&show_comments=false`}
                        style={{ maxWidth: 400 }}
                        title={
                            item.artist || item.title
                                ? `${item.artist ?? ''} - ${item.title ?? ''}`
                                : t('common.unknown', { postProcess: 'sentenceCase' })
                        }
                        width="100%"
                    />
                    <Group gap="xs" wrap="wrap">
                        <Button
                            component="a"
                            href={item.soundcloud_url}
                            rel="noopener noreferrer"
                            size="sm"
                            target="_blank"
                            variant="default"
                        >
                            {t('action.openOnSoundcloud', { postProcess: 'sentenceCase' })}
                        </Button>
                        <Button onClick={handleEditEntry} size="sm" variant="subtle">
                            {t('action.editWishlistItem', { postProcess: 'sentenceCase' })}
                        </Button>
                    </Group>
                </Stack>
            ) : item.youtube_url ? (
                <Stack gap="xs">
                    <div style={{ aspectRatio: '16 / 9', maxWidth: 400 }}>
                        <iframe
                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                            allowFullScreen
                            frameBorder="0"
                            height="100%"
                            src={`https://www.youtube.com/embed/${item.youtube_video_id}`}
                            title={
                                item.artist || item.title
                                    ? `${item.artist ?? ''} - ${item.title ?? ''}`
                                    : t('common.unknown', { postProcess: 'sentenceCase' })
                            }
                            width="100%"
                        />
                    </div>
                    <Group gap="xs" wrap="wrap">
                        <Button
                            loading={matchMutation.isPending}
                            onClick={handleMatchYoutube}
                            size="sm"
                            variant="default"
                        >
                            {t('action.findAnotherMatch', { postProcess: 'sentenceCase' })}
                        </Button>
                        <Button onClick={handleEditEntry} size="sm" variant="subtle">
                            {t('action.editWishlistItem', { postProcess: 'sentenceCase' })}
                        </Button>
                    </Group>
                </Stack>
            ) : (
                <Group gap="xs" wrap="wrap">
                    <Button
                        loading={matchMutation.isPending}
                        onClick={handleMatchYoutube}
                        size="sm"
                        variant="default"
                    >
                        {t('action.matchYoutubePreview', { postProcess: 'sentenceCase' })}
                    </Button>
                    <Button onClick={handleEditEntry} size="sm" variant="subtle">
                        {t('action.editWishlistItem', { postProcess: 'sentenceCase' })}
                    </Button>
                </Group>
            )}
            <Group gap="xs" wrap="wrap">
                {item.status === 'wishlist' && (
                    <>
                        <Button onClick={() => setStatus('downloaded')} size="sm" variant="default">
                            {t('action.markDownloaded', { postProcess: 'sentenceCase' })}
                        </Button>
                        <Button onClick={() => setStatus('ignored')} size="sm" variant="subtle">
                            {t('action.ignore', { postProcess: 'sentenceCase' })}
                        </Button>
                    </>
                )}
                {item.status === 'downloaded' && (
                    <>
                        <Button onClick={() => setStatus('available')} size="sm" variant="default">
                            {t('action.markAvailable', { postProcess: 'sentenceCase' })}
                        </Button>
                        <Button onClick={() => setStatus('wishlist')} size="sm" variant="subtle">
                            {t('action.markWishlist', { postProcess: 'sentenceCase' })}
                        </Button>
                    </>
                )}
                {item.status === 'ignored' && (
                    <Button onClick={() => setStatus('wishlist')} size="sm" variant="default">
                        {t('action.markWishlist', { postProcess: 'sentenceCase' })}
                    </Button>
                )}
                <Button onClick={handleDelete} size="sm" variant="state-error">
                    {t('common.delete', { postProcess: 'sentenceCase' })}
                </Button>
            </Group>
        </Stack>
    );
};
