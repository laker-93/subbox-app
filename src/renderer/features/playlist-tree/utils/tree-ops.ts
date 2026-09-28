import { PlaylistTree, PlaylistTreeNode } from '/@/shared/api/pymix/pymix-types';

// Subbox-only: pure operations on the playlist tree (subbox-app#148). The server owns
// order and structure; these compute what to ask it for, and the optimistic copy of
// its answer that the sidebar shows until the next read.

/** Where a drop lands relative to the row it's on. `inside` is for folders only. */
export type DropPlacement = 'after' | 'before' | 'inside';

/** A PATCH's move: `parent_id` undefined keeps the parent; `position` undefined is the end. */
export interface NodeMove {
    parent_id?: null | string;
    position?: number;
}

export const childrenOf = (nodes: PlaylistTreeNode[], parentId: null | string) =>
    nodes.filter((node) => node.parent_id === parentId).sort((a, b) => a.position - b.position);

/** Whether `nodeId` is `ancestorId` or somewhere under it. */
export const isInSubtree = (nodes: PlaylistTreeNode[], nodeId: string, ancestorId: string) => {
    const parents = new Map(nodes.map((node) => [node.node_id, node.parent_id]));
    let current: null | string | undefined = nodeId;
    while (current) {
        if (current === ancestorId) return true;
        current = parents.get(current);
    }
    return false;
};

/**
 * The move that puts `source` at `placement` relative to `target`, or null when the
 * drop means nothing: onto itself, into its own subtree, or where it already is.
 * `position` counts the new siblings without the source, as the server does.
 */
export const moveForDrop = (
    nodes: PlaylistTreeNode[],
    sourceId: string,
    target: PlaylistTreeNode,
    placement: DropPlacement,
): NodeMove | null => {
    const source = nodes.find((node) => node.node_id === sourceId);
    if (!source || isInSubtree(nodes, target.node_id, sourceId)) return null;

    if (placement === 'inside') {
        if (target.kind !== 'folder') return null;
        if (source.parent_id === target.node_id) return null;
        return { parent_id: target.node_id };
    }

    const siblings = childrenOf(nodes, target.parent_id).filter(
        (node) => node.node_id !== sourceId,
    );
    const index = siblings.findIndex((node) => node.node_id === target.node_id);
    const position = placement === 'before' ? index : index + 1;
    return moveTo(nodes, source, target.parent_id, position);
};

/** One step up (-1) or down (+1) among its siblings, or null at either end. */
export const moveBySibling = (
    nodes: PlaylistTreeNode[],
    nodeId: string,
    step: -1 | 1,
): NodeMove | null => {
    const node = nodes.find((n) => n.node_id === nodeId);
    if (!node) return null;
    const siblings = childrenOf(nodes, node.parent_id);
    const index = siblings.findIndex((n) => n.node_id === nodeId);
    const position = index + step;
    if (position < 0 || position >= siblings.length) return null;
    return { position };
};

/** The move to `parentId` at `position`, trimmed to what changes, or null for none. */
const moveTo = (
    nodes: PlaylistTreeNode[],
    source: PlaylistTreeNode,
    parentId: null | string,
    position: number,
): NodeMove | null => {
    if (source.parent_id !== parentId) return { parent_id: parentId, position };
    const current = childrenOf(nodes, parentId).findIndex((n) => n.node_id === source.node_id);
    return current === position ? null : { position };
};

/**
 * The tree after `move`, as the server will answer it: siblings renumbered from 0,
 * child counts recomputed, and nodes back in tree order (depth-first, by position).
 */
export const applyMove = (tree: PlaylistTree, nodeId: string, move: NodeMove): PlaylistTree => {
    const source = tree.nodes.find((node) => node.node_id === nodeId);
    if (!source) return tree;
    const parentId = move.parent_id === undefined ? source.parent_id : move.parent_id;

    const byParent = new Map<null | string, PlaylistTreeNode[]>();
    for (const node of tree.nodes) {
        if (node.node_id === nodeId) continue;
        const list = byParent.get(node.parent_id) ?? [];
        list.push(node);
        byParent.set(node.parent_id, list);
    }
    for (const list of byParent.values()) list.sort((a, b) => a.position - b.position);

    const target = byParent.get(parentId) ?? [];
    const at = Math.min(move.position ?? target.length, target.length);
    target.splice(at, 0, { ...source, parent_id: parentId });
    byParent.set(parentId, target);

    const nodes: PlaylistTreeNode[] = [];
    const walk = (parent: null | string) => {
        (byParent.get(parent) ?? []).forEach((node, position) => {
            const children = byParent.get(node.node_id) ?? [];
            nodes.push({ ...node, child_count: children.length, position });
            walk(node.node_id);
        });
    };
    walk(null);
    return { ...tree, nodes };
};

export const applyRename = (tree: PlaylistTree, nodeId: string, name: string): PlaylistTree => ({
    ...tree,
    nodes: tree.nodes.map((node) => (node.node_id === nodeId ? { ...node, name } : node)),
});

/** A new node, added where the server put it (before the refetch confirms it). */
export const applyInsert = (
    tree: PlaylistTree,
    node: Omit<PlaylistTreeNode, 'child_count'>,
): PlaylistTree => {
    if (tree.nodes.some((n) => n.node_id === node.node_id)) return tree;
    const withNode = { ...tree, nodes: [...tree.nodes, { ...node, child_count: 0 }] };
    return applyMove(withNode, node.node_id, {
        parent_id: node.parent_id,
        position: node.position,
    });
};

/** Folders in tree order with their depth, for the Move to… picker. */
export const folderOutline = (nodes: PlaylistTreeNode[]) => {
    const depth = new Map<null | string, number>([[null, -1]]);
    const result: { depth: number; node: PlaylistTreeNode }[] = [];
    for (const node of nodes) {
        depth.set(node.node_id, (depth.get(node.parent_id) ?? -1) + 1);
        if (node.kind === 'folder') {
            result.push({ depth: depth.get(node.node_id) ?? 0, node });
        }
    }
    return result;
};
