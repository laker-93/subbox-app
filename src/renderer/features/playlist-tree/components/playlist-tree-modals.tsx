import { t } from 'i18next';
import { CSSProperties, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import styles from './playlist-tree-modals.module.css';

import {
    usePlaylistTree,
    useTreeExpanded,
} from '/@/renderer/features/playlist-tree/hooks/use-playlist-tree';
import {
    useCreatePlaylistInFolder,
    useUpdatePlaylistNode,
} from '/@/renderer/features/playlist-tree/mutations/playlist-tree-mutations';
import { folderOutline, isInSubtree } from '/@/renderer/features/playlist-tree/utils/tree-ops';
import { Group } from '/@/shared/components/group/group';
import { Icon } from '/@/shared/components/icon/icon';
import { closeAllModals, openModal } from '/@/shared/components/modal/modal';
import { ModalButton } from '/@/shared/components/modal/model-shared';
import { Stack } from '/@/shared/components/stack/stack';
import { TextInput } from '/@/shared/components/text-input/text-input';
import { Text } from '/@/shared/components/text/text';
import { toast } from '/@/shared/components/toast/toast';

// Subbox-only: the playlist tree's two dialogs (subbox-app#148, design §11.2).

const CreatePlaylistInFolderForm = ({ parentId }: { parentId: string }) => {
    const { t } = useTranslation();
    const [name, setName] = useState('');
    const mutation = useCreatePlaylistInFolder();
    const { expand } = useTreeExpanded();

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!name.trim()) return;
        mutation.mutate(
            { name: name.trim(), parent_id: parentId },
            {
                onError: (err) => {
                    toast.error({
                        message: err.message,
                        title: t('form.playlistTree.createFailed', { postProcess: 'sentenceCase' }),
                    });
                },
                onSuccess: () => {
                    toast.success({
                        message: t('form.createPlaylist.success', { postProcess: 'sentenceCase' }),
                    });
                    expand(parentId);
                    closeAllModals();
                },
            },
        );
    };

    return (
        <form onSubmit={handleSubmit}>
            <Stack>
                <TextInput
                    data-autofocus
                    label={t('form.createPlaylist.input', {
                        context: 'name',
                        postProcess: 'titleCase',
                    })}
                    onChange={(e) => setName(e.currentTarget.value)}
                    required
                    value={name}
                />
                <Group justify="flex-end">
                    <ModalButton
                        onClick={() => closeAllModals()}
                        px="2xl"
                        uppercase
                        variant="subtle"
                    >
                        {t('common.cancel')}
                    </ModalButton>
                    <ModalButton
                        disabled={!name.trim() || mutation.isPending}
                        loading={mutation.isPending}
                        type="submit"
                        variant="filled"
                    >
                        {t('common.create')}
                    </ModalButton>
                </Group>
            </Stack>
        </form>
    );
};

export const openCreatePlaylistInFolderModal = (folder: {
    name: null | string;
    node_id: string;
}) => {
    openModal({
        children: <CreatePlaylistInFolderForm parentId={folder.node_id} />,
        size: 'sm',
        // Written in sentence case, not post-processed: that would lowercase the
        // folder's own name (#181).
        title: t('form.playlistTree.newPlaylistTitle', { folder: folder.name ?? '' }),
    });
};

/**
 * Pick a folder (or the top level) to move nodes into, at the end. For keyboard and
 * touch users, and for playlists outside the sidebar; drag-and-drop does the same.
 */
const MoveToFolderPicker = ({ nodeIds }: { nodeIds: string[] }) => {
    const { t } = useTranslation();
    const { tree } = usePlaylistTree();
    const mutation = useUpdatePlaylistNode();
    const { expand } = useTreeExpanded();

    const nodes = useMemo(() => tree?.nodes ?? [], [tree]);
    const moving = nodes.filter((node) => nodeIds.includes(node.node_id));
    // A folder can't go inside itself; one parent in common is where they already are.
    const destinations = folderOutline(nodes).filter(
        ({ node }) => !moving.some((m) => isInSubtree(nodes, node.node_id, m.node_id)),
    );
    const parents = new Set(moving.map((node) => node.parent_id));
    const currentParent = parents.size === 1 ? [...parents][0] : undefined;

    const moveTo = async (parentId: null | string) => {
        for (const node of moving) {
            if (node.parent_id === parentId) continue;
            await mutation
                .mutateAsync({ nodeId: node.node_id, update: { move: { parent_id: parentId } } })
                .catch(() => {});
        }
        expand(parentId);
        closeAllModals();
    };

    const option = (parentId: null | string, label: string, depth: number) => {
        const isCurrent = currentParent === parentId;
        return (
            <button
                className={styles.option}
                data-folder-id={parentId ?? 'root'}
                disabled={isCurrent || mutation.isPending}
                key={parentId ?? 'root'}
                onClick={() => moveTo(parentId)}
                style={{ '--tree-depth': depth } as CSSProperties}
                type="button"
            >
                <Icon color="muted" icon={parentId ? 'folder' : 'library'} />
                <Text size="md">{label}</Text>
                {isCurrent && (
                    <Text isMuted size="sm">
                        {t('form.playlistTree.currentFolder', { postProcess: 'sentenceCase' })}
                    </Text>
                )}
            </button>
        );
    };

    return (
        <Stack gap={0}>
            {option(null, t('form.playlistTree.topLevel', { postProcess: 'sentenceCase' }), 0)}
            {destinations.map(({ depth, node }) =>
                option(node.node_id, node.name ?? '', depth + 1),
            )}
        </Stack>
    );
};

export const openMoveToFolderModal = (nodeIds: string[]) => {
    openModal({
        children: <MoveToFolderPicker nodeIds={nodeIds} />,
        size: 'sm',
        title: t('form.playlistTree.moveToTitle', { postProcess: 'sentenceCase' }),
    });
};
