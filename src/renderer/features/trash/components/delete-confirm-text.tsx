import { usePlaylistTree } from '/@/renderer/features/playlist-tree/hooks/use-playlist-tree';

// Subbox-only (subbox-app#150, design §11.4). A playlist delete that goes to pymix's
// trash ends in an Undo toast, so it asks nothing first (#182); anyone without a tree
// deletes from Navidrome for good, behind upstream's confirm. A folder delete keeps its
// confirm, naming what goes.

export const useDeletesToTrash = () => usePlaylistTree().state === 'tree';

export const deleteFolderConfirmText = (
    t: (key: string, options?: Record<string, unknown>) => string,
    name: string,
    playlists: number,
) =>
    playlists
        ? t('form.trash.confirmFolder', { count: playlists, name })
        : t('form.trash.confirmEmptyFolder', { name });
