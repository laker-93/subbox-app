import type { QueryClient } from '@tanstack/react-query';

import i18n from '/@/i18n/i18n';
import { PymixController } from '/@/renderer/api/pymix/pymix-controller';
import { urlConfig } from '/@/renderer/config/url-config';
import { refreshAfterTrashChange } from '/@/renderer/features/trash/api/trash-refresh';
import { PlaylistNodesDeleted, TrashRestored } from '/@/shared/api/pymix/pymix-types';
import { Button } from '/@/shared/components/button/button';
import { Group } from '/@/shared/components/group/group';
import { Stack } from '/@/shared/components/stack/stack';
import { toast } from '/@/shared/components/toast/toast';

// Subbox-only: the toasts for a playlist or folder delete and its Undo (subbox-app#150,
// design §11.4). The restore is synchronous, so "Restored" is said only once pymix has
// answered, with whatever it reports didn't come back as it went.

const UNDO_WINDOW_MS = 15_000;
// Long enough to read a note about a moved or shrunk playlist.
const NOTES_MS = 12_000;

const t = i18n.t.bind(i18n);

const deletedMessage = ({ deleted }: PlaylistNodesDeleted, name: null | string) => {
    const { folders, playlists } = deleted;
    if (name && folders === 0 && playlists === 1) {
        return t('form.trash.playlistDeleted', { name });
    }
    if (name && folders > 0) {
        // One folder and what was in it: `name` is only passed for a single node.
        return playlists
            ? t('form.trash.folderDeletedWith', { count: playlists, name })
            : t('form.trash.folderDeleted', { name });
    }
    return folders
        ? t('form.trash.nodesDeleted', { count: folders + playlists })
        : t('form.trash.playlistsDeleted', { count: playlists });
};

export const showNodesRestoredToast = (restored: TrashRestored) => {
    const notes = [
        ...(restored.moved ?? []),
        ...(restored.shrunk ?? []),
        ...(restored.lost ?? []),
    ].map((note) => note.message);
    const show = restored.lost?.length ? toast.warn : toast.success;
    show({
        autoClose: notes.length ? NOTES_MS : undefined,
        message: notes.length ? (
            <Stack gap={4}>
                <span>{t('form.trash.restored', { postProcess: 'sentenceCase' })}</span>
                {notes.map((note, index) => (
                    <span key={index}>{note}</span>
                ))}
            </Stack>
        ) : (
            t('form.trash.restored', { postProcess: 'sentenceCase' })
        ),
    });
};

interface NodesDeletedToastArgs {
    name: null | string;
    queryClient: QueryClient;
    result: PlaylistNodesDeleted;
    serverId: string;
}

export const showNodesDeletedToast = ({
    name,
    queryClient,
    result,
    serverId,
}: NodesDeletedToastArgs) => {
    const id = `trash-${result.trash_batch_id}`;

    const undo = async () => {
        toast.update({
            autoClose: false,
            id,
            loading: true,
            message: t('form.trash.restoring', { postProcess: 'sentenceCase' }),
            withCloseButton: false,
        });
        try {
            const restored = await PymixController.restoreTrashBatch({
                baseUrl: urlConfig.pymix,
                batchId: result.trash_batch_id,
            });
            await refreshAfterTrashChange(queryClient, serverId);
            toast.hide(id);
            showNodesRestoredToast(restored);
        } catch {
            toast.hide(id);
            toast.error({
                message: t('form.trash.restoreFailed', { postProcess: 'sentenceCase' }),
                title: t('error.genericError', { postProcess: 'sentenceCase' }),
            });
            await refreshAfterTrashChange(queryClient, serverId);
        }
    };

    toast.success({
        autoClose: UNDO_WINDOW_MS,
        id,
        message: (
            <Group gap="sm" justify="space-between" wrap="nowrap">
                <span>{deletedMessage(result, name)}</span>
                <Button onClick={undo} size="compact-sm" style={{ flexShrink: 0 }} variant="subtle">
                    {t('form.trash.undo', { postProcess: 'sentenceCase' })}
                </Button>
            </Group>
        ),
    });
};
