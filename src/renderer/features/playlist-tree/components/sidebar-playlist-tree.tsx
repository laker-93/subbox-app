import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { CSSProperties, MouseEvent, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import styles from './sidebar-playlist-tree.module.css';

import { ContextMenuController } from '/@/renderer/features/context-menu/context-menu-controller';
import { playlistsQueries } from '/@/renderer/features/playlists/api/playlists-api';
import { openCreatePlaylistModal } from '/@/renderer/features/playlists/components/create-playlist-form';
import { PlaylistRowButton } from '/@/renderer/features/sidebar/components/sidebar-playlist-list';
import rowStyles from '/@/renderer/features/sidebar/components/sidebar-playlist-list.module.css';
import { AppRoute } from '/@/renderer/router/routes';
import { useCurrentServer, useSidebarPlaylistListFilterRegex } from '/@/renderer/store';
import { PlaylistTree, PlaylistTreeNode } from '/@/shared/api/pymix/pymix-types';
import { Accordion } from '/@/shared/components/accordion/accordion';
import { ActionIcon } from '/@/shared/components/action-icon/action-icon';
import { Group } from '/@/shared/components/group/group';
import { Icon } from '/@/shared/components/icon/icon';
import { Text } from '/@/shared/components/text/text';
import { useLocalStorage } from '/@/shared/hooks/use-local-storage';
import { LibraryItem, Playlist, PlaylistListSort, SortOrder } from '/@/shared/types/domain-types';

// Subbox-only: the sidebar's playlists as pymix's tree (subbox-app#147, design §11.1).
// Drawn instead of upstream's SidebarPlaylistList when the user has a tree; order and
// structure are the server's, and only which folders are open is kept on the device.

const expandedKey = (serverId: string | undefined) =>
    `playlist_tree_expanded:${serverId || 'local'}`;

// A drop that reorders playlists does nothing here yet: in a tree, a reorder is a
// pymix write (#148), not the local playlist_order upstream keeps.
const ignoreReorder = () => {};

interface TreeRow {
    depth: number;
    node: PlaylistTreeNode;
    playlist?: Playlist;
}

export const SidebarPlaylistTree = ({ tree }: { tree: PlaylistTree }) => {
    const { t } = useTranslation();
    const server = useCurrentServer();
    const filterRegex = useSidebarPlaylistListFilterRegex();

    // The same query upstream's list makes, so the two share one cache entry: a
    // playlist's art, counts and duration come from here, joined by Navidrome id.
    const playlistsQuery = useQuery(
        playlistsQueries.list({
            query: {
                sortBy: PlaylistListSort.NAME,
                sortOrder: SortOrder.ASC,
                startIndex: 0,
            },
            serverId: server?.id,
        }),
    );

    const [expanded, setExpanded] = useLocalStorage<string[]>({
        defaultValue: [],
        key: expandedKey(server?.id),
    });

    const toggle = useCallback(
        (nodeId: string) =>
            setExpanded((current) =>
                current.includes(nodeId)
                    ? current.filter((id) => id !== nodeId)
                    : [...current, nodeId],
            ),
        [setExpanded],
    );

    const rows = useMemo(() => {
        const playlists = new Map(
            (playlistsQuery.data?.items ?? []).map((playlist) => [playlist.id, playlist]),
        );
        let regex: null | RegExp = null;
        if (filterRegex) {
            try {
                regex = new RegExp(filterRegex, 'i');
            } catch {
                // An invalid filter filters nothing, as upstream's list does.
            }
        }

        // Nodes come in tree order, so a parent is always seen before its children.
        const open = new Set(expanded);
        const depth = new Map<null | string, number>([[null, -1]]);
        const visible = new Set<null | string>([null]);
        const result: TreeRow[] = [];

        for (const node of tree.nodes) {
            depth.set(node.node_id, (depth.get(node.parent_id) ?? -1) + 1);
            const parentShown =
                visible.has(node.parent_id) &&
                (node.parent_id === null || open.has(node.parent_id));
            if (!parentShown) continue;

            if (node.kind === 'folder') {
                visible.add(node.node_id);
                result.push({ depth: depth.get(node.node_id) ?? 0, node });
                continue;
            }

            const playlist = node.navidrome_playlist_id
                ? playlists.get(node.navidrome_playlist_id)
                : undefined;
            // Not in the list yet (it refetches after any playlist change), or gone
            // from Navidrome: nothing to draw a row from.
            if (!playlist) continue;
            if (regex && regex.test(playlist.name)) continue;
            visible.add(node.node_id);
            result.push({ depth: depth.get(node.node_id) ?? 0, node, playlist });
        }
        return result;
    }, [expanded, filterRegex, playlistsQuery.data?.items, tree.nodes]);

    const handleContextMenu = useCallback(
        (e: MouseEvent<HTMLAnchorElement>, playlist: Playlist) => {
            e.preventDefault();
            e.stopPropagation();
            ContextMenuController.call({
                cmd: { items: [playlist], type: LibraryItem.PLAYLIST },
                event: e,
            });
        },
        [],
    );

    const handleCreatePlaylistModal = (e: MouseEvent<HTMLButtonElement>) => {
        openCreatePlaylistModal(server, e);
    };

    const openSet = new Set(expanded);

    return (
        <Accordion.Item value="playlists">
            <Accordion.Control component="div" role="button" style={{ userSelect: 'none' }}>
                <Group justify="space-between" pr="var(--theme-spacing-md)">
                    <Text fw={500}>
                        {t('page.sidebar.playlists', {
                            postProcess: 'titleCase',
                        })}
                    </Text>
                    <Group gap="xs">
                        <ActionIcon
                            icon="add"
                            iconProps={{
                                size: 'lg',
                            }}
                            onClick={handleCreatePlaylistModal}
                            size="xs"
                            tooltip={{
                                label: t('action.createPlaylist', {
                                    postProcess: 'sentenceCase',
                                }),
                            }}
                            variant="subtle"
                        />
                        <ActionIcon
                            component={Link}
                            icon="list"
                            iconProps={{
                                size: 'lg',
                            }}
                            onClick={(e) => e.stopPropagation()}
                            size="xs"
                            to={AppRoute.PLAYLISTS}
                            tooltip={{
                                label: t('action.viewPlaylists', {
                                    postProcess: 'sentenceCase',
                                }),
                            }}
                            variant="subtle"
                        />
                    </Group>
                </Group>
            </Accordion.Control>
            <Accordion.Panel>
                <div role="tree">
                    {rows.map(({ depth, node, playlist }) => {
                        const hasChildren = node.child_count > 0;
                        const isOpen = openSet.has(node.node_id);
                        const indent = { '--tree-depth': depth } as CSSProperties;
                        const disclosure = hasChildren ? (
                            <ActionIcon
                                aria-expanded={isOpen}
                                aria-label={node.name ?? undefined}
                                className={styles.disclosure}
                                icon={isOpen ? 'arrowDownS' : 'arrowRightS'}
                                onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    toggle(node.node_id);
                                }}
                                size="xs"
                                variant="subtle"
                            />
                        ) : (
                            <span className={styles.disclosure} />
                        );

                        if (node.kind === 'folder') {
                            return (
                                <div
                                    aria-expanded={isOpen}
                                    className={clsx(styles.treeRow, styles.folderRow)}
                                    data-node-id={node.node_id}
                                    key={node.node_id}
                                    onClick={() => toggle(node.node_id)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' || e.key === ' ') {
                                            e.preventDefault();
                                            toggle(node.node_id);
                                        }
                                    }}
                                    role="treeitem"
                                    style={indent}
                                    tabIndex={0}
                                >
                                    {disclosure}
                                    <div className={clsx(rowStyles.row, styles.folder)}>
                                        <div className={rowStyles.rowGroup}>
                                            <div className={styles.folderIcon}>
                                                <Icon color="muted" icon="folder" size="lg" />
                                            </div>
                                            <div className={rowStyles.metadata}>
                                                <Text className={rowStyles.name} fw={500} size="md">
                                                    {node.name}
                                                </Text>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            );
                        }

                        if (!playlist) return null;

                        return (
                            <div
                                aria-expanded={hasChildren ? isOpen : undefined}
                                className={styles.treeRow}
                                data-node-id={node.node_id}
                                key={node.node_id}
                                role="treeitem"
                                style={indent}
                            >
                                {disclosure}
                                <PlaylistRowButton
                                    item={playlist}
                                    name={playlist.name}
                                    onContextMenu={handleContextMenu}
                                    onReorder={ignoreReorder}
                                    to={playlist.id}
                                />
                            </div>
                        );
                    })}
                </div>
            </Accordion.Panel>
        </Accordion.Item>
    );
};
