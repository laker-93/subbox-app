import type { QueryClient } from '@tanstack/react-query';

import i18n from '/@/i18n/i18n';
import { ndApiClient } from '/@/renderer/api/navidrome/navidrome-api';
import { PymixController } from '/@/renderer/api/pymix/pymix-controller';
import { queryKeys } from '/@/renderer/api/query-keys';
import { infiniteLoaderDataQueryKey } from '/@/renderer/components/item-list/helpers/item-list-infinite-loader';
import { urlConfig } from '/@/renderer/config/url-config';
import { getServerById } from '/@/renderer/store';
import { TrashRestoreProgress } from '/@/shared/api/pymix/pymix-types';
import { Button } from '/@/shared/components/button/button';
import { Group } from '/@/shared/components/group/group';
import { Stack } from '/@/shared/components/stack/stack';
import { toast } from '/@/shared/components/toast/toast';
import { LibraryItem } from '/@/shared/types/domain-types';

// Subbox-only: deleted tracks and their Undo (subbox-app#152, design §8.1, §11.4). A
// delete moves the files to pymix's trash; a restore is a job, because it waits on a
// library scan, so the toast follows it and says "Restored" only once it has.

const UNDO_WINDOW_MS = 15_000;
const POLL_MS = 1500;
// How long a delete waits for the library to drop its rows. Navidrome notices a
// deleted file on its next scan or watcher event; past this the lists refresh anyway.
const GONE_TIMEOUT_MS = 60_000;

const t = i18n.t.bind(i18n);

/** Every list a track shows up in. */
export const invalidateTrackLists = (queryClient: QueryClient, serverId: string) => {
    for (const queryKey of [
        queryKeys.songs.root(serverId),
        infiniteLoaderDataQueryKey(serverId, LibraryItem.SONG),
        queryKeys.albums.root(serverId),
        queryKeys.albumArtists.root(serverId),
        queryKeys.search.root(serverId),
        // Song counts and playlist track lists.
        queryKeys.playlists.root(serverId),
    ]) {
        queryClient.invalidateQueries({ exact: false, queryKey });
    }
};

/**
 * Wait until Navidrome no longer lists the songs: each is missing (a trashed file's
 * row stays, marked missing, until the trash is purged) or gone. The lists leave
 * missing songs out, so refetching before this shows the deleted rows again
 * (design §11.4: poll until the library reflects the change, never remove rows
 * optimistically). Resolves false if it gave up waiting.
 */
export const waitUntilGone = async (serverId: string, songIds: string[]) => {
    const server = getServerById(serverId);
    if (!server || songIds.length === 0) return true;
    let waiting = [...songIds];
    const until = Date.now() + GONE_TIMEOUT_MS;
    while (Date.now() < until) {
        const still = await Promise.all(
            waiting.map(async (id) => {
                const res = await ndApiClient({ server })
                    .getSongDetail({ params: { id } })
                    .catch(() => null);
                const song = res?.status === 200 ? (res.body.data as { missing?: boolean }) : null;
                return song && !song.missing ? id : null;
            }),
        );
        waiting = still.filter((id): id is string => id !== null);
        if (waiting.length === 0) return true;
        await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    return false;
};

const PHASE_LABELS: Record<string, string> = {
    checking: 'form.trash.tracks.phaseChecking',
    restoring_files: 'form.trash.tracks.phaseRestoring',
};

const progressMessage = (progress: null | TrashRestoreProgress, count: number) => {
    const key = progress?.phase ? PHASE_LABELS[progress.phase] : undefined;
    if (!key) return t('form.trash.tracks.restoring', { count });
    const total = progress?.phase_n_total ?? 0;
    return t(key, { n: progress?.phase_n_processed ?? 0, total });
};

/** The restore job's verdict, as a toast. Only called once the job has finished. */
const finishedToast = (progress: TrashRestoreProgress, count: number) => {
    if (!progress.result) {
        toast.error({
            message: progress.reason || t('form.trash.tracks.restoreFailed', { count }),
            title: t('error.genericError', { postProcess: 'sentenceCase' }),
        });
        return;
    }
    const files = progress.phases?.find((phase) => phase.phase === 'restoring_files');
    const restored = files ? files.ok : count;
    const headline =
        restored < count
            ? t('form.trash.tracks.restoredSome', { count, n: restored })
            : t('form.trash.tracks.restored', { count });
    // A track back under a new Navidrome id lost its star, rating, play count or
    // playlist places, and pymix names it here (design §13).
    if (!progress.warnings) {
        toast.success({ message: headline });
        return;
    }
    toast.warn({
        autoClose: false,
        message: (
            <Stack gap={4}>
                <span>{headline}</span>
                <span>{progress.warnings}</span>
            </Stack>
        ),
    });
};

/**
 * Restore a track batch and follow its job to the end. `toastId` is the toast to turn
 * into its progress, if there is one.
 */
export const restoreTrackBatch = async ({
    batchId,
    count,
    queryClient,
    serverId,
    toastId = `trash-restore-${batchId}`,
}: {
    batchId: string;
    count: number;
    queryClient: QueryClient;
    serverId: string;
    toastId?: string;
}) => {
    const loading = (message: string) =>
        toast.update({
            autoClose: false,
            id: toastId,
            loading: true,
            message,
            title: t('form.trash.tracks.restoringTitle', { postProcess: 'sentenceCase' }),
            withCloseButton: false,
        });
    toast.info({
        autoClose: false,
        id: toastId,
        loading: true,
        message: progressMessage(null, count),
    });

    try {
        const started = await PymixController.restoreTrashBatch({
            baseUrl: urlConfig.pymix,
            batchId,
        });
        if (!started.job_id) throw new Error('no restore job');
        let progress: TrashRestoreProgress;
        for (;;) {
            await new Promise((resolve) => setTimeout(resolve, POLL_MS));
            progress = await PymixController.trashRestoreProgress({
                baseUrl: urlConfig.pymix,
                jobId: started.job_id,
            });
            if (!progress.in_progress) break;
            loading(progressMessage(progress, count));
        }
        toast.hide(toastId);
        finishedToast(progress, count);
        return progress;
    } catch {
        toast.hide(toastId);
        toast.error({
            message: t('form.trash.tracks.restoreFailed', { count }),
            title: t('error.genericError', { postProcess: 'sentenceCase' }),
        });
        return null;
    } finally {
        // The job scanned before it finished, so the tracks are listed again now.
        invalidateTrackLists(queryClient, serverId);
        queryClient.invalidateQueries({ queryKey: queryKeys.trash.root(serverId) });
    }
};

export const showTracksDeletedToast = ({
    batchId,
    count,
    queryClient,
    serverId,
}: {
    batchId: string;
    count: number;
    queryClient: QueryClient;
    serverId: string;
}) => {
    const id = `trash-${batchId}`;
    toast.success({
        autoClose: UNDO_WINDOW_MS,
        id,
        message: (
            <Group gap="sm" justify="space-between" wrap="nowrap">
                <span>{t('form.trash.tracks.deleted', { count })}</span>
                <Button
                    onClick={() => {
                        toast.hide(id);
                        restoreTrackBatch({ batchId, count, queryClient, serverId });
                    }}
                    size="compact-sm"
                    style={{ flexShrink: 0 }}
                    variant="subtle"
                >
                    {t('form.trash.undo', { postProcess: 'sentenceCase' })}
                </Button>
            </Group>
        ),
    });
};
