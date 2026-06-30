import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { openEditWishlistModal } from '/@/renderer/features/wishlist/components/edit-wishlist-modal';
import { WishlistStatusBadge } from '/@/renderer/features/wishlist/components/wishlist-status-badge';
import { useDeleteWishlistItem } from '/@/renderer/features/wishlist/hooks/use-delete-wishlist-item';
import { useMatchYoutube } from '/@/renderer/features/wishlist/hooks/use-match-youtube';
import { useUpdateWishlistItem } from '/@/renderer/features/wishlist/hooks/use-update-wishlist-item';
import { Button } from '/@/shared/components/button/button';
import { Flex } from '/@/shared/components/flex/flex';
import { Group } from '/@/shared/components/group/group';
import { Icon } from '/@/shared/components/icon/icon';
import { closeAllModals, ConfirmModal, openModal } from '/@/shared/components/modal/modal';
import { Paper } from '/@/shared/components/paper/paper';
import { Stack } from '/@/shared/components/stack/stack';
import { Text } from '/@/shared/components/text/text';
import { toast } from '/@/shared/components/toast/toast';
import { WishlistItem, YoutubeMatch } from '/@/shared/types/wishlist-types';

interface WishlistCardProps {
    item: WishlistItem;
}

export const WishlistCard = ({ item }: WishlistCardProps) => {
    const { t } = useTranslation();
    const updateMutation = useUpdateWishlistItem({});
    const deleteMutation = useDeleteWishlistItem({});
    const matchMutation = useMatchYoutube({});

    const [expanded, setExpanded] = useState(false);
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

    return (
        <Paper p="sm">
            <Flex
                align="center"
                gap="sm"
                justify="space-between"
                onClick={() => setExpanded((prev) => !prev)}
                style={{ cursor: 'pointer' }}
            >
                <Group gap="sm" style={{ flex: 1, minWidth: 0 }} wrap="nowrap">
                    <Text fw={500} size="sm" truncate>
                        {isInbox
                            ? item.raw_note
                            : item.title || t('common.unknown', { postProcess: 'sentenceCase' })}
                    </Text>
                    {!isInbox && (
                        <Text isMuted size="sm" truncate>
                            {item.artist || t('common.unknown', { postProcess: 'sentenceCase' })}
                            {item.album ? ` — ${item.album}` : ''}
                        </Text>
                    )}
                </Group>
                <Group gap="xs" wrap="nowrap">
                    <WishlistStatusBadge status={item.status} />
                    <Icon color="muted" icon={expanded ? 'arrowUpS' : 'arrowDownS'} size="sm" />
                </Group>
            </Flex>
            {expanded && isInbox && (
                <Stack gap="xs" mt="sm">
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
            )}
            {expanded && !isInbox && (
                <Stack gap="xs" mt="sm">
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
                                <Button
                                    onClick={() => setStatus('downloaded')}
                                    size="sm"
                                    variant="default"
                                >
                                    {t('action.markDownloaded', { postProcess: 'sentenceCase' })}
                                </Button>
                                <Button
                                    onClick={() => setStatus('ignored')}
                                    size="sm"
                                    variant="subtle"
                                >
                                    {t('action.ignore', { postProcess: 'sentenceCase' })}
                                </Button>
                            </>
                        )}
                        {item.status === 'downloaded' && (
                            <>
                                <Button
                                    onClick={() => setStatus('available')}
                                    size="sm"
                                    variant="default"
                                >
                                    {t('action.markAvailable', { postProcess: 'sentenceCase' })}
                                </Button>
                                <Button
                                    onClick={() => setStatus('wishlist')}
                                    size="sm"
                                    variant="subtle"
                                >
                                    {t('action.markWishlist', { postProcess: 'sentenceCase' })}
                                </Button>
                            </>
                        )}
                        {item.status === 'ignored' && (
                            <Button
                                onClick={() => setStatus('wishlist')}
                                size="sm"
                                variant="default"
                            >
                                {t('action.markWishlist', { postProcess: 'sentenceCase' })}
                            </Button>
                        )}
                        <Button onClick={handleDelete} size="sm" variant="state-error">
                            {t('common.delete', { postProcess: 'sentenceCase' })}
                        </Button>
                    </Group>
                </Stack>
            )}
        </Paper>
    );
};
