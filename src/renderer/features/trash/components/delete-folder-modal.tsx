import { useTranslation } from 'react-i18next';

import i18n from '/@/i18n/i18n';
import { deleteFolderConfirmText } from '/@/renderer/features/trash/components/delete-confirm-text';
import { useDeleteFolder } from '/@/renderer/features/trash/hooks/use-trash';
import { PlaylistTreeNode } from '/@/shared/api/pymix/pymix-types';
import { closeAllModals, ConfirmModal, openModal } from '/@/shared/components/modal/modal';
import { Text } from '/@/shared/components/text/text';

// Subbox-only: "Delete folder" (subbox-app#150, design §11.4). The folder and everything
// in it go into one trash batch, so one Undo brings all of it back.

/** How many playlists sit anywhere under the folder. */
const playlistsUnder = (nodes: PlaylistTreeNode[], folderId: string) => {
    const under = new Set([folderId]);
    let count = 0;
    // Tree order puts every node after its parent.
    for (const node of nodes) {
        if (!node.parent_id || !under.has(node.parent_id)) continue;
        under.add(node.node_id);
        if (node.kind === 'playlist') count += 1;
    }
    return count;
};

const DeleteFolderConfirm = ({
    folder,
    playlists,
}: {
    folder: PlaylistTreeNode;
    playlists: number;
}) => {
    const { t } = useTranslation();
    const deleteFolder = useDeleteFolder();
    const name = folder.name ?? '';
    return (
        <ConfirmModal
            loading={deleteFolder.isPending}
            onConfirm={async () => {
                await deleteFolder.mutateAsync({ name, nodeId: folder.node_id }).catch(() => {});
                closeAllModals();
            }}
        >
            <Text>{deleteFolderConfirmText(t, name, playlists)}</Text>
        </ConfirmModal>
    );
};

export const openDeleteFolderModal = (folder: PlaylistTreeNode, nodes: PlaylistTreeNode[]) => {
    openModal({
        children: (
            <DeleteFolderConfirm
                folder={folder}
                playlists={playlistsUnder(nodes, folder.node_id)}
            />
        ),
        title: i18n.t('form.trash.deleteFolder', { postProcess: 'sentenceCase' }),
    });
};
