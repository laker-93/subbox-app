import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useRestoreTrashBatch, useTrash } from '/@/renderer/features/trash/hooks/use-trash';
import { TrashRestored } from '/@/shared/api/pymix/pymix-types';
import { Button } from '/@/shared/components/button/button';
import { Group } from '/@/shared/components/group/group';
import { closeAllModals, ConfirmModal, openModal } from '/@/shared/components/modal/modal';
import { Stack } from '/@/shared/components/stack/stack';
import { Text } from '/@/shared/components/text/text';

// Subbox-only: Undo for the playlists a Rekordbox or Serato re-import replaced
// (subbox-app#151, design §5.3, §8.3, §9). pymix keeps what each replace wrote over in
// a trash batch and names it on the job. The restore is synchronous, and it throws
// away anything changed in those playlists since the import, which the confirm says.

type Done = { error: true } | { error?: false; result: TrashRestored };

/** What the restore did, in lines: what came back, and anything that didn't. */
const restoredLines = (
    t: (key: string, o?: Record<string, unknown>) => string,
    result: TrashRestored,
) => {
    const restored = (result.restored ?? []).filter((r) => 'name' in r);
    const lines = [t('form.reimportUndo.restored', { count: restored.length })];
    for (const failed of result.failed ?? []) {
        lines.push(t('form.reimportUndo.failed', { name: failed.name, reason: failed.reason }));
    }
    const missing = new Map<string, number>();
    for (const entry of result.not_restored ?? []) {
        missing.set(entry.playlist, (missing.get(entry.playlist) ?? 0) + 1);
    }
    for (const [name, count] of missing) {
        lines.push(t('form.reimportUndo.notRestored', { count, name }));
    }
    return lines;
};

export const ReimportUndo = ({
    batchId,
    source,
}: {
    batchId: null | string | undefined;
    source: 'Rekordbox' | 'Serato';
}) => {
    const { t } = useTranslation();
    // demo has no trash (403): the batch never shows up, so neither does the Undo.
    // Asked afresh: a trash list cached from before the job finished won't have it.
    const trash = useTrash({ enabled: Boolean(batchId), refetchOnMount: 'always' });
    const restore = useRestoreTrashBatch();
    const [done, setDone] = useState<Done | null>(null);

    if (done) {
        const lines = done.error
            ? [t('form.reimportUndo.restoreFailed')]
            : restoredLines(t, done.result);
        return (
            <Stack align="center" gap={2}>
                {lines.map((line, index) => (
                    <Text c={index === 0 ? undefined : 'dimmed'} key={index} size="sm" ta="center">
                        {line}
                    </Text>
                ))}
            </Stack>
        );
    }

    const batch = trash.data?.batches.find((b) => b.batch_id === batchId);
    if (!batchId || !batch) return null;
    const names = (batch.items ?? [])
        .map((item) => item.playlist_name)
        .filter((name): name is string => Boolean(name));
    const count = names.length || batch.items?.length || 1;

    const undo = async () => {
        closeAllModals();
        try {
            setDone({ result: await restore.mutateAsync(batchId) });
        } catch {
            setDone({ error: true });
        }
    };

    const confirm = () =>
        openModal({
            children: (
                <ConfirmModal onConfirm={undo}>
                    <Text>
                        {t('form.reimportUndo.confirm', {
                            count,
                            names: names.join(', '),
                            source,
                        })}
                    </Text>
                </ConfirmModal>
            ),
            // Not sentence-cased: that would lower-case the product name.
            title: t('form.reimportUndo.title', { source }),
        });

    return (
        <Group gap="xs" justify="center">
            <Text size="sm">{t('form.reimportUndo.updated', { count, source })}</Text>
            <Button
                loading={restore.isPending}
                onClick={confirm}
                size="compact-sm"
                variant="subtle"
            >
                {t('form.reimportUndo.undo', { postProcess: 'sentenceCase' })}
            </Button>
        </Group>
    );
};
