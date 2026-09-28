import { SidebarPlaylistTree } from '/@/renderer/features/playlist-tree/components/sidebar-playlist-tree';
import {
    useFollowPlaylistListInvalidations,
    usePlaylistTree,
} from '/@/renderer/features/playlist-tree/hooks/use-playlist-tree';
import { SidebarPlaylistList } from '/@/renderer/features/sidebar/components/sidebar-playlist-list';

// Subbox-only: the one switch between pymix's tree and upstream's flat list (#147). The
// tree when there is one (even a stale one while a refetch fails); upstream's list,
// untouched, for everyone else: demo, an older pymix, a user not migrated, or a tree
// query that hasn't answered or can't be answered, so the sidebar is never empty.
export const SidebarPlaylists = () => {
    const { tree } = usePlaylistTree();
    useFollowPlaylistListInvalidations();

    return tree ? <SidebarPlaylistTree tree={tree} /> : <SidebarPlaylistList />;
};
