import { useTranslation } from 'react-i18next';

import { openMoveToFolderModal } from '/@/renderer/features/playlist-tree/components/playlist-tree-modals';
import { usePlaylistTree } from '/@/renderer/features/playlist-tree/hooks/use-playlist-tree';
import { ContextMenu } from '/@/shared/components/context-menu/context-menu';
import { Playlist } from '/@/shared/types/domain-types';

// Subbox-only: "Move to…" on a playlist's context menu (subbox-app#148), wherever the
// menu opens: the sidebar tree, the Playlists page, a playlist's header. Absent when
// the user has no tree, or when a playlist isn't in it (someone else's shared one).
export const MoveToFolderAction = ({ items }: { items: Playlist[] }) => {
    const { t } = useTranslation();
    const { tree } = usePlaylistTree();

    if (!tree || items.length === 0) return null;
    const nodeIds = items.map(
        (item) => tree.nodes.find((node) => node.navidrome_playlist_id === item.id)?.node_id,
    );
    if (nodeIds.some((id) => !id)) return null;

    return (
        <ContextMenu.Item
            leftIcon="folder"
            onSelect={() => openMoveToFolderModal(nodeIds as string[])}
        >
            {t('form.playlistTree.moveTo', { postProcess: 'sentenceCase' })}
        </ContextMenu.Item>
    );
};
