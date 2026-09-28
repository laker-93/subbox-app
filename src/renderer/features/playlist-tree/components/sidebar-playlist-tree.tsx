import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine';
import {
    draggable,
    dropTargetForElements,
} from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import {
    CSSProperties,
    KeyboardEvent,
    MouseEvent,
    ReactNode,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import styles from './sidebar-playlist-tree.module.css';

import { ContextMenuController } from '/@/renderer/features/context-menu/context-menu-controller';
import {
    openCreatePlaylistInFolderModal,
    openMoveToFolderModal,
} from '/@/renderer/features/playlist-tree/components/playlist-tree-modals';
import { useTreeExpanded } from '/@/renderer/features/playlist-tree/hooks/use-playlist-tree';
import {
    useCreatePlaylistFolder,
    useUpdatePlaylistNode,
} from '/@/renderer/features/playlist-tree/mutations/playlist-tree-mutations';
import {
    DropPlacement,
    isInSubtree,
    moveBySibling,
    moveForDrop,
    NodeMove,
} from '/@/renderer/features/playlist-tree/utils/tree-ops';
import { playlistsQueries } from '/@/renderer/features/playlists/api/playlists-api';
import { openCreatePlaylistModal } from '/@/renderer/features/playlists/components/create-playlist-form';
import { PlaylistRowButton } from '/@/renderer/features/sidebar/components/sidebar-playlist-list';
import rowStyles from '/@/renderer/features/sidebar/components/sidebar-playlist-list.module.css';
import { AppRoute } from '/@/renderer/router/routes';
import { useCurrentServer, useSidebarPlaylistListFilterRegex } from '/@/renderer/store';
import { PlaylistTree, PlaylistTreeNode } from '/@/shared/api/pymix/pymix-types';
import { Accordion } from '/@/shared/components/accordion/accordion';
import { ActionIcon } from '/@/shared/components/action-icon/action-icon';
import { ContextMenu } from '/@/shared/components/context-menu/context-menu';
import { DropdownMenu } from '/@/shared/components/dropdown-menu/dropdown-menu';
import { Group } from '/@/shared/components/group/group';
import { Icon } from '/@/shared/components/icon/icon';
import { TextInput } from '/@/shared/components/text-input/text-input';
import { Text } from '/@/shared/components/text/text';
import { LibraryItem, Playlist, PlaylistListSort, SortOrder } from '/@/shared/types/domain-types';
import { DragTarget } from '/@/shared/types/drag-and-drop';

// Subbox-only: the sidebar's playlists as pymix's tree (subbox-app#147, #148; design
// §11.1, §11.2). Drawn instead of upstream's SidebarPlaylistList when the user has a
// tree; order and structure are the server's, and only which folders are open is kept
// on the device.

// A folder row's drag. A playlist row's drag is upstream's (PlaylistRowButton), keyed
// by Navidrome id, and is mapped to its node on drop.
const TREE_NODE_DRAG = 'playlistTreeNode';

// A playlist dropped on a playlist is a tree reorder here (the wrapper row handles it),
// never upstream's local playlist_order.
const ignoreReorder = () => {};

interface TreeContext {
    nodeForDrag: (data: Record<string, unknown>) => null | string;
    nodes: PlaylistTreeNode[];
    onMove: (nodeId: string, move: NodeMove, openFolder?: string) => void;
}

interface TreeRow {
    depth: number;
    node: PlaylistTreeNode;
    playlist?: Playlist;
}

const DROP_CLASS: Record<DropPlacement, string> = {
    after: styles.dropAfter,
    before: styles.dropBefore,
    inside: styles.dropInside,
};

const focusNode = (nodeId: string) =>
    requestAnimationFrame(() => {
        const row = document.querySelector<HTMLElement>(`[data-node-id="${nodeId}"]`);
        (row?.tabIndex === 0 ? row : row?.querySelector<HTMLElement>('a'))?.focus();
    });

/**
 * A tree row as a drop target (and, for folders, a drag source). A folder takes a drop
 * before, inside or after it; a playlist only before or after, since dropping onto a
 * playlist never nests (§11.2). Dropping after an open folder puts the node first
 * inside it, which is where the line is drawn.
 */
const useTreeRowDnd = ({
    canDrag,
    context,
    isOpen,
    node,
}: {
    canDrag: boolean;
    context: TreeContext;
    isOpen: boolean;
    node: PlaylistTreeNode;
}) => {
    const ref = useRef<HTMLDivElement>(null);
    const [placement, setPlacement] = useState<DropPlacement | null>(null);
    const [isDragging, setIsDragging] = useState(false);

    useEffect(() => {
        const element = ref.current;
        if (!element) return undefined;

        const placementAt = (clientY: number): DropPlacement => {
            const rect = element.getBoundingClientRect();
            const y = (clientY - rect.top) / rect.height;
            if (node.kind !== 'folder') return y < 0.5 ? 'before' : 'after';
            if (y < 0.25) return 'before';
            return y > 0.75 ? 'after' : 'inside';
        };

        const moveFor = (sourceId: string, at: DropPlacement): NodeMove | null => {
            if (at === 'after' && node.kind === 'folder' && isOpen && node.child_count > 0) {
                const source = context.nodes.find((n) => n.node_id === sourceId);
                if (!source || isInSubtree(context.nodes, node.node_id, sourceId)) return null;
                return source.parent_id === node.node_id
                    ? { position: 0 }
                    : { parent_id: node.node_id, position: 0 };
            }
            return moveForDrop(context.nodes, sourceId, node, at);
        };

        const cleanups = [
            dropTargetForElements({
                canDrop: ({ source }) => {
                    const sourceId = context.nodeForDrag(source.data);
                    return sourceId !== null && !isInSubtree(context.nodes, node.node_id, sourceId);
                },
                element,
                onDrag: ({ location }) => setPlacement(placementAt(location.current.input.clientY)),
                onDragLeave: () => setPlacement(null),
                onDrop: ({ location, source }) => {
                    setPlacement(null);
                    const sourceId = context.nodeForDrag(source.data);
                    if (!sourceId) return;
                    const at = placementAt(location.current.input.clientY);
                    const move = moveFor(sourceId, at);
                    if (move) context.onMove(sourceId, move, move.parent_id ?? undefined);
                },
            }),
        ];
        if (canDrag && node.kind === 'folder') {
            cleanups.push(
                draggable({
                    element,
                    getInitialData: () => ({ id: [node.node_id], type: TREE_NODE_DRAG }),
                    onDragStart: () => setIsDragging(true),
                    onDrop: () => setIsDragging(false),
                }),
            );
        }
        return combine(...cleanups);
    }, [canDrag, context, isOpen, node]);

    const dropClass = placement && DROP_CLASS[placement];
    return { dropClass, isDragging, ref };
};

const Disclosure = ({
    isOpen,
    node,
    onToggle,
}: {
    isOpen: boolean;
    node: PlaylistTreeNode;
    onToggle: (nodeId: string) => void;
}) =>
    node.child_count > 0 ? (
        <ActionIcon
            aria-expanded={isOpen}
            aria-label={node.name ?? undefined}
            className={styles.disclosure}
            icon={isOpen ? 'arrowDownS' : 'arrowRightS'}
            onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onToggle(node.node_id);
            }}
            size="xs"
            variant="subtle"
        />
    ) : (
        <span className={styles.disclosure} />
    );

const FolderRow = ({
    context,
    depth,
    isOpen,
    isRenaming,
    node,
    onKeyboardMove,
    onNewFolder,
    onRename,
    onRenameEnd,
    onRenameStart,
    onToggle,
}: {
    context: TreeContext;
    depth: number;
    isOpen: boolean;
    isRenaming: boolean;
    node: PlaylistTreeNode;
    onKeyboardMove: (e: KeyboardEvent, node: PlaylistTreeNode) => boolean;
    onNewFolder: (parentId: null | string) => void;
    onRename: (nodeId: string, name: string) => void;
    onRenameEnd: () => void;
    onRenameStart: (nodeId: string) => void;
    onToggle: (nodeId: string) => void;
}) => {
    const { t } = useTranslation();
    const { dropClass, isDragging, ref } = useTreeRowDnd({
        canDrag: !isRenaming,
        context,
        isOpen,
        node,
    });

    const row = (
        <div
            aria-expanded={isOpen}
            className={clsx(styles.treeRow, styles.folderRow, dropClass, {
                [styles.dragging]: isDragging,
            })}
            data-node-id={node.node_id}
            onClick={() => !isRenaming && onToggle(node.node_id)}
            onKeyDown={(e) => {
                if (isRenaming || e.target !== e.currentTarget) return;
                if (onKeyboardMove(e, node)) return;
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onToggle(node.node_id);
                } else if (e.key === 'F2') {
                    e.preventDefault();
                    onRenameStart(node.node_id);
                }
            }}
            ref={ref}
            role="treeitem"
            style={{ '--tree-depth': depth } as CSSProperties}
            tabIndex={0}
        >
            <Disclosure isOpen={isOpen} node={node} onToggle={onToggle} />
            <div className={clsx(rowStyles.row, styles.folder)}>
                <div className={rowStyles.rowGroup}>
                    <div className={styles.folderIcon}>
                        <Icon color="muted" icon="folder" size="lg" />
                    </div>
                    <div className={rowStyles.metadata}>
                        {isRenaming ? (
                            <FolderNameInput
                                initial={node.name ?? ''}
                                onCancel={onRenameEnd}
                                onCommit={(name) => {
                                    onRenameEnd();
                                    if (name !== node.name) onRename(node.node_id, name);
                                }}
                            />
                        ) : (
                            <Text className={rowStyles.name} fw={500} size="md">
                                {node.name}
                            </Text>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );

    return (
        <ContextMenu>
            <ContextMenu.Target>{row}</ContextMenu.Target>
            <ContextMenu.Content>
                <ContextMenu.Item leftIcon="add" onSelect={() => onNewFolder(node.node_id)}>
                    {t('form.playlistTree.newFolderInside', { postProcess: 'sentenceCase' })}
                </ContextMenu.Item>
                <ContextMenu.Item
                    leftIcon="playlistAdd"
                    onSelect={() => openCreatePlaylistInFolderModal(node)}
                >
                    {t('form.playlistTree.newPlaylistInside', { postProcess: 'sentenceCase' })}
                </ContextMenu.Item>
                <ContextMenu.Divider />
                <ContextMenu.Item leftIcon="edit" onSelect={() => onRenameStart(node.node_id)}>
                    {t('form.playlistTree.rename', { postProcess: 'sentenceCase' })}
                </ContextMenu.Item>
                <ContextMenu.Item
                    leftIcon="folder"
                    onSelect={() => openMoveToFolderModal([node.node_id])}
                >
                    {t('form.playlistTree.moveTo', { postProcess: 'sentenceCase' })}
                </ContextMenu.Item>
            </ContextMenu.Content>
        </ContextMenu>
    );
};

const FolderNameInput = ({
    initial,
    onCancel,
    onCommit,
}: {
    initial: string;
    onCancel: () => void;
    onCommit: (name: string) => void;
}) => {
    const { t } = useTranslation();
    const [value, setValue] = useState(initial);
    const done = useRef(false);

    const finish = (commit: boolean) => {
        if (done.current) return;
        done.current = true;
        const name = value.trim();
        if (commit && name) onCommit(name);
        else onCancel();
    };

    return (
        <TextInput
            aria-label={t('form.playlistTree.folderNamePlaceholder', {
                postProcess: 'sentenceCase',
            })}
            autoFocus
            onBlur={() => finish(true)}
            onChange={(e) => setValue(e.currentTarget.value)}
            onClick={(e) => e.stopPropagation()}
            onFocus={(e) => e.currentTarget.select()}
            onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') finish(true);
                else if (e.key === 'Escape') finish(false);
            }}
            placeholder={t('form.playlistTree.folderNamePlaceholder', {
                postProcess: 'sentenceCase',
            })}
            size="xs"
            value={value}
        />
    );
};

const PlaylistRow = ({
    context,
    depth,
    isOpen,
    node,
    onContextMenu,
    onKeyboardMove,
    onToggle,
    playlist,
}: {
    context: TreeContext;
    depth: number;
    isOpen: boolean;
    node: PlaylistTreeNode;
    onContextMenu: (e: MouseEvent<HTMLAnchorElement>, playlist: Playlist) => void;
    onKeyboardMove: (e: KeyboardEvent, node: PlaylistTreeNode) => boolean;
    onToggle: (nodeId: string) => void;
    playlist: Playlist;
}) => {
    const { dropClass, ref } = useTreeRowDnd({ canDrag: false, context, isOpen, node });

    return (
        <div
            aria-expanded={node.child_count > 0 ? isOpen : undefined}
            className={clsx(styles.treeRow, dropClass)}
            data-node-id={node.node_id}
            onKeyDown={(e) => onKeyboardMove(e, node)}
            ref={ref}
            role="treeitem"
            style={{ '--tree-depth': depth } as CSSProperties}
        >
            <Disclosure isOpen={isOpen} node={node} onToggle={onToggle} />
            <PlaylistRowButton
                item={playlist}
                name={playlist.name}
                onContextMenu={onContextMenu}
                onReorder={ignoreReorder}
                to={playlist.id}
            />
        </div>
    );
};

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

    const { expand, expanded, toggle } = useTreeExpanded();
    const [renamingId, setRenamingId] = useState<null | string>(null);
    const updateNode = useUpdatePlaylistNode();
    const createFolder = useCreatePlaylistFolder();

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

    const { mutate: mutateNode } = updateNode;
    const context = useMemo<TreeContext>(() => {
        const byPlaylistId = new Map(
            tree.nodes
                .filter((node) => node.navidrome_playlist_id)
                .map((node) => [node.navidrome_playlist_id, node.node_id]),
        );
        return {
            nodeForDrag: (data) => {
                const id = Array.isArray(data.id) ? (data.id[0] as string) : undefined;
                if (!id) return null;
                if (data.type === TREE_NODE_DRAG) return id;
                // A playlist dragged from the sidebar (or anywhere else that drags one).
                if (data.type === DragTarget.PLAYLIST && data.itemType === LibraryItem.PLAYLIST) {
                    return byPlaylistId.get(id) ?? null;
                }
                return null;
            },
            nodes: tree.nodes,
            onMove: (nodeId, move, openFolder) => {
                if (openFolder) expand(openFolder);
                mutateNode({ nodeId, update: { move } });
            },
        };
    }, [expand, mutateNode, tree.nodes]);

    // Alt+↑ / Alt+↓ reorder a row among its siblings, for keyboard users; "Move to…"
    // moves it between folders.
    const handleKeyboardMove = useCallback(
        (e: KeyboardEvent, node: PlaylistTreeNode) => {
            if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return false;
            e.preventDefault();
            e.stopPropagation();
            const move = moveBySibling(tree.nodes, node.node_id, e.key === 'ArrowUp' ? -1 : 1);
            if (move) {
                mutateNode({ nodeId: node.node_id, update: { move } });
                focusNode(node.node_id);
            }
            return true;
        },
        [mutateNode, tree.nodes],
    );

    const handleRename = useCallback(
        (nodeId: string, name: string) => mutateNode({ nodeId, update: { name } }),
        [mutateNode],
    );

    const handleRenameEnd = useCallback(() => {
        if (renamingId) focusNode(renamingId);
        setRenamingId(null);
    }, [renamingId]);

    const { mutate: mutateCreateFolder } = createFolder;
    const handleNewFolder = useCallback(
        (parentId: null | string) =>
            mutateCreateFolder(
                {
                    name: t('form.playlistTree.newFolderDefaultName', {
                        postProcess: 'titleCase',
                    }),
                    parent_id: parentId,
                },
                {
                    onSuccess: (node) => {
                        expand(parentId);
                        setRenamingId(node.node_id);
                    },
                },
            ),
        [expand, mutateCreateFolder, t],
    );

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
                        <DropdownMenu position="bottom-end" trigger="click">
                            <DropdownMenu.Target>
                                <ActionIcon
                                    aria-label={t('action.createPlaylist', {
                                        postProcess: 'sentenceCase',
                                    })}
                                    icon="add"
                                    iconProps={{
                                        size: 'lg',
                                    }}
                                    onClick={(e) => e.stopPropagation()}
                                    size="xs"
                                    variant="subtle"
                                />
                            </DropdownMenu.Target>
                            <DropdownMenu.Dropdown>
                                <DropdownMenu.Item
                                    leftSection={<Icon icon="playlistAdd" />}
                                    onClick={(e: MouseEvent<HTMLButtonElement>) =>
                                        openCreatePlaylistModal(server, e)
                                    }
                                >
                                    {t('form.playlistTree.newPlaylist', {
                                        postProcess: 'sentenceCase',
                                    })}
                                </DropdownMenu.Item>
                                <DropdownMenu.Item
                                    leftSection={<Icon icon="folder" />}
                                    onClick={(e: MouseEvent<HTMLButtonElement>) => {
                                        e.stopPropagation();
                                        handleNewFolder(null);
                                    }}
                                >
                                    {t('form.playlistTree.newFolder', {
                                        postProcess: 'sentenceCase',
                                    })}
                                </DropdownMenu.Item>
                            </DropdownMenu.Dropdown>
                        </DropdownMenu>
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
                    {rows.map(({ depth, node, playlist }): ReactNode => {
                        const isOpen = openSet.has(node.node_id);

                        if (node.kind === 'folder') {
                            return (
                                <FolderRow
                                    context={context}
                                    depth={depth}
                                    isOpen={isOpen}
                                    isRenaming={renamingId === node.node_id}
                                    key={node.node_id}
                                    node={node}
                                    onKeyboardMove={handleKeyboardMove}
                                    onNewFolder={handleNewFolder}
                                    onRename={handleRename}
                                    onRenameEnd={handleRenameEnd}
                                    onRenameStart={setRenamingId}
                                    onToggle={toggle}
                                />
                            );
                        }

                        if (!playlist) return null;

                        return (
                            <PlaylistRow
                                context={context}
                                depth={depth}
                                isOpen={isOpen}
                                key={node.node_id}
                                node={node}
                                onContextMenu={handleContextMenu}
                                onKeyboardMove={handleKeyboardMove}
                                onToggle={toggle}
                                playlist={playlist}
                            />
                        );
                    })}
                </div>
            </Accordion.Panel>
        </Accordion.Item>
    );
};
