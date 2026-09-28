import { useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { PageHeader } from '/@/renderer/components/page-header/page-header';
import { AnimatedPage } from '/@/renderer/features/shared/components/animated-page';
import { LibraryHeaderBar } from '/@/renderer/features/shared/components/library-header-bar';
import { PageErrorBoundary } from '/@/renderer/features/shared/components/page-error-boundary';
import { restoreTrackBatch } from '/@/renderer/features/trash/api/track-trash';
import { restoredLines } from '/@/renderer/features/trash/components/reimport-undo';
import { showNodesRestoredToast } from '/@/renderer/features/trash/components/trash-toasts';
import {
    useEmptyTrash,
    usePurgeTrashBatch,
    useRestoreTrashBatch,
    useTrash,
} from '/@/renderer/features/trash/hooks/use-trash';
import { useCurrentServerId } from '/@/renderer/store';
import { formatSizeString } from '/@/renderer/utils/format';
import { TrashBatch } from '/@/shared/api/pymix/pymix-types';
import { Button } from '/@/shared/components/button/button';
import { Flex } from '/@/shared/components/flex/flex';
import { Group } from '/@/shared/components/group/group';
import { Icon } from '/@/shared/components/icon/icon';
import { closeAllModals, ConfirmModal, openModal } from '/@/shared/components/modal/modal';
import { ScrollArea } from '/@/shared/components/scroll-area/scroll-area';
import { Spinner } from '/@/shared/components/spinner/spinner';
import { Stack } from '/@/shared/components/stack/stack';
import { Text } from '/@/shared/components/text/text';
import { toast } from '/@/shared/components/toast/toast';

// Subbox-only: the Trash screen (subbox-app#152, design §11.4). Every restorable
// delete, what it was, when it goes for good and the space it holds, with restore and
// purge. It's where undo lives once a toast has gone.

const KIND_ICON = {
    nodes: 'playlist',
    playlist_entries: 'playlist',
    track: 'track',
} as const;

const confirm = (title: string, body: string, onConfirm: () => void) =>
    openModal({
        children: (
            <ConfirmModal
                onConfirm={() => {
                    closeAllModals();
                    onConfirm();
                }}
            >
                <Text>{body}</Text>
            </ConfirmModal>
        ),
        title,
    });

const TrashBatchRow = ({ batch }: { batch: TrashBatch }) => {
    const { t } = useTranslation();
    const queryClient = useQueryClient();
    const serverId = useCurrentServerId();
    const restore = useRestoreTrashBatch();
    const purge = usePurgeTrashBatch();
    const [restoring, setRestoring] = useState(false);
    const count = batch.items?.length ?? 1;
    const label =
        batch.kind === 'playlist_entries' ? t('page.trash.reimportLabel', { count }) : batch.label;

    const doRestore = async () => {
        setRestoring(true);
        // Its delete's toast, if still up, would offer an Undo that no longer applies.
        toast.hide(`trash-${batch.batch_id}`);
        try {
            if (batch.kind === 'track') {
                // A job: the toast follows it, and says "Restored" only once it has.
                await restoreTrackBatch({ batchId: batch.batch_id, count, queryClient, serverId });
                return;
            }
            const result = await restore.mutateAsync(batch.batch_id);
            if (batch.kind === 'nodes') {
                showNodesRestoredToast(result);
            } else {
                const lines = restoredLines(t, result);
                (lines.length > 1 ? toast.warn : toast.success)({
                    message: (
                        <Stack gap={4}>
                            {lines.map((line, index) => (
                                <span key={index}>{line}</span>
                            ))}
                        </Stack>
                    ),
                });
            }
        } catch {
            toast.error({
                message: t('form.trash.restoreFailed', { postProcess: 'sentenceCase' }),
                title: t('error.genericError', { postProcess: 'sentenceCase' }),
            });
        } finally {
            setRestoring(false);
        }
    };

    const onRestore = () =>
        batch.kind === 'playlist_entries'
            ? // Rewrites the playlists: anything changed in them since is lost.
              confirm(
                  t('page.trash.restore', { postProcess: 'sentenceCase' }),
                  t('page.trash.confirmReimportRestore', { count }),
                  doRestore,
              )
            : doRestore();

    const onPurge = () =>
        confirm(
            t('page.trash.purge', { postProcess: 'sentenceCase' }),
            t('page.trash.confirmPurge', { label }),
            () =>
                purge.mutate(batch.batch_id, {
                    onError: () =>
                        toast.error({
                            message: t('page.trash.purgeFailed'),
                            title: t('error.genericError', { postProcess: 'sentenceCase' }),
                        }),
                }),
        );

    const details = [
        t('page.trash.deleted', { when: dayjs.unix(batch.deleted_at).fromNow() }),
        t('page.trash.expires', { when: dayjs.unix(batch.expires_at).fromNow() }),
        batch.bytes > 0 ? formatSizeString(batch.bytes) : null,
    ].filter(Boolean);

    return (
        <Group data-batch-id={batch.batch_id} justify="space-between" p="sm" wrap="nowrap">
            <Group gap="md" wrap="nowrap">
                <Icon color="muted" icon={KIND_ICON[batch.kind]} size="lg" />
                <Stack gap={2}>
                    <Text fw={500}>{label}</Text>
                    <Text isMuted size="sm">
                        {details.join(' · ')}
                    </Text>
                </Stack>
            </Group>
            <Group gap="xs" wrap="nowrap">
                <Button loading={restoring} onClick={onRestore} size="compact-md" variant="default">
                    {t('page.trash.restore', { postProcess: 'sentenceCase' })}
                </Button>
                <Button
                    disabled={restoring}
                    loading={purge.isPending}
                    onClick={onPurge}
                    size="compact-md"
                    variant="subtle"
                >
                    {t('page.trash.purge', { postProcess: 'sentenceCase' })}
                </Button>
            </Group>
        </Group>
    );
};

const TrashRoute = () => {
    const { t } = useTranslation();
    const trash = useTrash({ refetchOnMount: 'always' });
    const empty = useEmptyTrash();
    const batches = trash.data?.batches ?? [];

    const onEmpty = () =>
        confirm(
            t('page.trash.empty', { postProcess: 'sentenceCase' }),
            t('page.trash.confirmEmpty'),
            () =>
                empty.mutate(undefined, {
                    onError: () =>
                        toast.error({
                            message: t('page.trash.purgeFailed'),
                            title: t('error.genericError', { postProcess: 'sentenceCase' }),
                        }),
                }),
        );

    return (
        <AnimatedPage>
            <PageHeader>
                <Flex justify="space-between" w="100%">
                    <LibraryHeaderBar ignoreMaxWidth>
                        <LibraryHeaderBar.Title>
                            {t('page.trash.title', { postProcess: 'titleCase' })}
                        </LibraryHeaderBar.Title>
                    </LibraryHeaderBar>
                    <Group style={{ flexShrink: 0 }} wrap="nowrap">
                        <Button
                            disabled={batches.length === 0}
                            loading={empty.isPending}
                            onClick={onEmpty}
                            variant="default"
                        >
                            {t('page.trash.empty', { postProcess: 'titleCase' })}
                        </Button>
                    </Group>
                </Flex>
            </PageHeader>
            <ScrollArea>
                <Stack gap="sm" p="md">
                    <Text isMuted size="sm">
                        {trash.data?.trash_bytes
                            ? t('page.trash.explainerHeld', {
                                  size: formatSizeString(trash.data.trash_bytes),
                              })
                            : t('page.trash.explainer')}
                    </Text>
                    {trash.isPending && <Spinner container />}
                    {trash.isError && <Text isMuted>{t('page.trash.unavailable')}</Text>}
                    {trash.isSuccess && batches.length === 0 && (
                        <Text isMuted ta="center">
                            {t('page.trash.nothing')}
                        </Text>
                    )}
                    {batches.map((batch) => (
                        <TrashBatchRow batch={batch} key={batch.batch_id} />
                    ))}
                </Stack>
            </ScrollArea>
        </AnimatedPage>
    );
};

const TrashRouteWithBoundary = () => (
    <PageErrorBoundary>
        <TrashRoute />
    </PageErrorBoundary>
);

export default TrashRouteWithBoundary;
