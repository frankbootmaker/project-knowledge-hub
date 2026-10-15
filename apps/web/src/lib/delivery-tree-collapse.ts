import {
  DELIVERY_TREE_ORPHAN_STORIES,
  DELIVERY_TREE_UNGROUPED_TASKS,
  type DeliveryTreeFilterNode,
} from './delivery-tree-filter';

/**
 * Expand and collapse for the delivery work-breakdown tree.
 *
 * The map stores explicit collapses. A missing id is open. One-level actions
 * move only the visible frontier: the shallowest collapsed rows, or the
 * deepest open rows. Expand all and collapse all include rows that are hidden
 * under a collapsed parent, but only rows that remain in the active filter.
 */

export type DeliveryTreeCollapsed = Record<string, boolean>;

export type DeliveryTreeCollapseNode = {
  id: string;
  parentId: string | null;
  depth: number;
};

/** Collapse-map ids for the two synthetic grouping rows. */
export const DELIVERY_TREE_ORPHAN_COLLAPSE_ID = 'orphan-stories';
export const DELIVERY_TREE_UNGROUPED_COLLAPSE_ID = 'ungrouped-tasks';

export type DeliveryTreeCollapseSource = {
  epics: readonly { id: string; storyIds: readonly string[] }[];
  stories: readonly { id: string; taskIds: readonly string[] }[];
  orphanStoryIds: readonly string[];
  ungroupedTaskIds: readonly string[];
  visible: ReadonlySet<string>;
  filtering: boolean;
};

export function isDeliveryTreeNodeOpen(collapsed: DeliveryTreeCollapsed, id: string): boolean {
  return collapsed[id] !== true;
}

export function deliveryTreeCollapsibleNodes(
  source: DeliveryTreeCollapseSource,
): DeliveryTreeCollapseNode[] {
  const taskIds = new Map(source.stories.map((story) => [story.id, story.taskIds]));
  const nodes: DeliveryTreeCollapseNode[] = [];

  function storyCollapsible(storyId: string): boolean {
    if (!source.visible.has(`story:${storyId}`)) return false;
    const tasks = taskIds.get(storyId) ?? [];
    const visibleTasks = tasks.filter((taskId) => source.visible.has(`task:${taskId}`));
    if (visibleTasks.length > 0) return true;
    return !source.filtering && tasks.length === 0;
  }

  for (const epic of source.epics) {
    if (!source.visible.has(`epic:${epic.id}`)) continue;
    const visibleStories = epic.storyIds.filter((storyId) =>
      source.visible.has(`story:${storyId}`),
    );
    const showsEmptyNote = !source.filtering && epic.storyIds.length === 0;
    if (visibleStories.length === 0 && !showsEmptyNote) continue;
    nodes.push({ id: `epic:${epic.id}`, parentId: null, depth: 0 });
    for (const storyId of epic.storyIds) {
      if (!storyCollapsible(storyId)) continue;
      nodes.push({
        id: `story:${storyId}`,
        parentId: `epic:${epic.id}`,
        depth: 1,
      });
    }
  }

  const visibleOrphans = source.orphanStoryIds.filter((storyId) =>
    source.visible.has(`story:${storyId}`),
  );
  if (source.visible.has(DELIVERY_TREE_ORPHAN_STORIES) && visibleOrphans.length > 0) {
    nodes.push({
      id: DELIVERY_TREE_ORPHAN_COLLAPSE_ID,
      parentId: null,
      depth: 0,
    });
    for (const storyId of visibleOrphans) {
      if (!storyCollapsible(storyId)) continue;
      nodes.push({
        id: `story:${storyId}`,
        parentId: DELIVERY_TREE_ORPHAN_COLLAPSE_ID,
        depth: 1,
      });
    }
  }

  const visibleUngrouped = source.ungroupedTaskIds.filter((taskId) =>
    source.visible.has(`task:${taskId}`),
  );
  if (source.visible.has(DELIVERY_TREE_UNGROUPED_TASKS) && visibleUngrouped.length > 0) {
    nodes.push({
      id: DELIVERY_TREE_UNGROUPED_COLLAPSE_ID,
      parentId: null,
      depth: 0,
    });
  }

  return nodes;
}

type DepthAction = {
  canExpandLevel: boolean;
  canCollapseLevel: boolean;
  canExpandAll: boolean;
  canCollapseAll: boolean;
};

function nodeIndex(nodes: readonly DeliveryTreeCollapseNode[]) {
  return new Map(nodes.map((node) => [node.id, node]));
}

function hiddenByAncestor(
  node: DeliveryTreeCollapseNode,
  byId: ReadonlyMap<string, DeliveryTreeCollapseNode>,
  collapsed: DeliveryTreeCollapsed,
): boolean {
  let parentId = node.parentId;
  const seen = new Set<string>();
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId);
    if (collapsed[parentId] === true) return true;
    parentId = byId.get(parentId)?.parentId ?? null;
  }
  return false;
}

function frontier(
  nodes: readonly DeliveryTreeCollapseNode[],
  collapsed: DeliveryTreeCollapsed,
  open: boolean,
): DeliveryTreeCollapseNode[] {
  const byId = nodeIndex(nodes);
  return nodes.filter((node) => {
    const isOpen = collapsed[node.id] !== true;
    if (isOpen !== open) return false;
    return !hiddenByAncestor(node, byId, collapsed);
  });
}

export function deliveryTreeDepthActions(
  collapsed: DeliveryTreeCollapsed,
  nodes: readonly DeliveryTreeCollapseNode[],
): DepthAction {
  const collapsedNodes = nodes.filter((node) => collapsed[node.id] === true);
  const openNodes = nodes.filter((node) => collapsed[node.id] !== true);
  return {
    canExpandLevel: frontier(nodes, collapsed, false).length > 0,
    canCollapseLevel: frontier(nodes, collapsed, true).length > 0,
    canExpandAll: collapsedNodes.length > 0,
    canCollapseAll: openNodes.length > 0,
  };
}

function shallowestCollapsed(
  collapsed: DeliveryTreeCollapsed,
  nodes: readonly DeliveryTreeCollapseNode[],
): DeliveryTreeCollapseNode[] {
  const visible = frontier(nodes, collapsed, false);
  if (visible.length === 0) return [];
  const depth = Math.min(...visible.map((node) => node.depth));
  return visible.filter((node) => node.depth === depth);
}

function deepestOpen(
  collapsed: DeliveryTreeCollapsed,
  nodes: readonly DeliveryTreeCollapseNode[],
): DeliveryTreeCollapseNode[] {
  const visible = frontier(nodes, collapsed, true);
  if (visible.length === 0) return [];
  const depth = Math.max(...visible.map((node) => node.depth));
  return visible.filter((node) => node.depth === depth);
}

export function expandTreeOneLevel(
  collapsed: DeliveryTreeCollapsed,
  nodes: readonly DeliveryTreeCollapseNode[],
): DeliveryTreeCollapsed {
  const targets = shallowestCollapsed(collapsed, nodes);
  if (targets.length === 0) return collapsed;
  const next = { ...collapsed };
  for (const node of targets) delete next[node.id];
  return next;
}

export function collapseTreeOneLevel(
  collapsed: DeliveryTreeCollapsed,
  nodes: readonly DeliveryTreeCollapseNode[],
): DeliveryTreeCollapsed {
  const targets = deepestOpen(collapsed, nodes);
  if (targets.length === 0) return collapsed;
  const next = { ...collapsed };
  for (const node of targets) next[node.id] = true;
  return next;
}

export function expandTreeAll(
  collapsed: DeliveryTreeCollapsed,
  nodes: readonly DeliveryTreeCollapseNode[],
): DeliveryTreeCollapsed {
  const targets = nodes.filter((node) => collapsed[node.id] === true);
  if (targets.length === 0) return collapsed;
  const next = { ...collapsed };
  for (const node of targets) delete next[node.id];
  return next;
}

export function collapseTreeAll(
  collapsed: DeliveryTreeCollapsed,
  nodes: readonly DeliveryTreeCollapseNode[],
): DeliveryTreeCollapsed {
  const targets = nodes.filter((node) => collapsed[node.id] !== true);
  if (targets.length === 0) return collapsed;
  const next = { ...collapsed };
  for (const node of targets) next[node.id] = true;
  return next;
}

function collapseIdForTreeNode(id: string): string | null {
  if (id === DELIVERY_TREE_ORPHAN_STORIES) return DELIVERY_TREE_ORPHAN_COLLAPSE_ID;
  if (id === DELIVERY_TREE_UNGROUPED_TASKS) return DELIVERY_TREE_UNGROUPED_COLLAPSE_ID;
  if (id.startsWith('epic:') || id.startsWith('story:')) return id;
  return null;
}

/** Collapse-map ids that must stay open so every visible filtered row stays reachable. */
export function deliveryTreeCollapseIdsForVisibleNodes(
  nodes: readonly DeliveryTreeFilterNode[],
  visible: ReadonlySet<string>,
): string[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const open = new Set<string>();
  for (const id of visible) {
    let current: string | null = id;
    const seen = new Set<string>();
    while (current && !seen.has(current)) {
      seen.add(current);
      const collapseId = collapseIdForTreeNode(current);
      if (collapseId) open.add(collapseId);
      current = byId.get(current)?.parentId ?? null;
    }
  }
  return [...open];
}

export function openCollapsedForDeliveryTreeSearch(
  collapsed: DeliveryTreeCollapsed,
  forceOpenIds: readonly string[],
): DeliveryTreeCollapsed {
  if (forceOpenIds.length === 0) return collapsed;
  const next = { ...collapsed };
  for (const id of forceOpenIds) {
    delete next[id];
  }
  return next;
}
