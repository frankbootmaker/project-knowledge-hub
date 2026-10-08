import { EMPTY_FILTER_VALUE } from './data-table';
import { isClosedDeliveryStatus } from './delivery-status';

/**
 * Visibility for the delivery tree filter.
 *
 * Hours and story points are intentionally not inputs. Filtering only decides
 * which rows stay on screen. It does not roll task hours or points up to
 * stories or epics, and it does not change the numbers rendered on a task.
 */

export type DeliveryTreeNodeKind = 'epic' | 'story' | 'task' | 'group';

export type DeliveryTreeFilterNode = {
  id: string;
  kind: DeliveryTreeNodeKind;
  parentId: string | null;
  title: string;
  /** Null on grouping rows (stories without an epic, tasks without a story). */
  status: string | null;
  /** Tasks only. Null or blank is unassigned. */
  owner: string | null;
  /** Tasks only. Null or blank is no sprint. */
  sprint: string | null;
};

export type DeliveryTreeFilterState = {
  statuses: readonly string[];
  owners: readonly string[];
  sprints: readonly string[];
  title: string;
  onlyOpen: boolean;
};

export type DeliveryTreeVisibility = {
  /** Matching rows plus every ancestor that keeps the branch on screen. */
  visible: ReadonlySet<string>;
  /** Visible rows that do not themselves match. They stay clickable. */
  dimmed: ReadonlySet<string>;
};

export const DELIVERY_TREE_ORPHAN_STORIES = 'group:orphan-stories';
export const DELIVERY_TREE_UNGROUPED_TASKS = 'group:ungrouped-tasks';

const EMPTY_FILTERS: DeliveryTreeFilterState = {
  statuses: [],
  owners: [],
  sprints: [],
  title: '',
  onlyOpen: false,
};

export function deliveryTreeFiltersActive(
  filters: DeliveryTreeFilterState = EMPTY_FILTERS,
): boolean {
  return (
    filters.statuses.length > 0 ||
    filters.owners.length > 0 ||
    filters.sprints.length > 0 ||
    filters.title.trim() !== '' ||
    filters.onlyOpen
  );
}

function enumToken(value: string | null | undefined): string {
  if (value == null || value === '') return EMPTY_FILTER_VALUE;
  return value;
}

function itemMatches(node: DeliveryTreeFilterNode, filters: DeliveryTreeFilterState): boolean {
  if (node.kind === 'group') return false;

  if (filters.onlyOpen && isClosedDeliveryStatus(node.status)) return false;

  if (filters.statuses.length > 0) {
    if (!node.status || !filters.statuses.includes(node.status)) return false;
  }

  const ownerActive = filters.owners.length > 0;
  const sprintActive = filters.sprints.length > 0;
  if ((ownerActive || sprintActive) && node.kind !== 'task') return false;

  if (ownerActive && !filters.owners.includes(enumToken(node.owner))) {
    return false;
  }
  if (sprintActive && !filters.sprints.includes(enumToken(node.sprint))) {
    return false;
  }

  const title = filters.title.trim().toLowerCase();
  if (title && !node.title.toLowerCase().includes(title)) return false;

  return true;
}

export function filterDeliveryTree(
  nodes: readonly DeliveryTreeFilterNode[],
  filters: DeliveryTreeFilterState,
): DeliveryTreeVisibility {
  const ids = nodes.map((node) => node.id);
  if (!deliveryTreeFiltersActive(filters)) {
    return { visible: new Set(ids), dimmed: new Set() };
  }

  const byId = new Map(nodes.map((node) => [node.id, node]));
  const matching = new Set<string>();
  for (const node of nodes) {
    if (itemMatches(node, filters)) matching.add(node.id);
  }

  const visible = new Set<string>();
  for (const id of matching) {
    let current: string | null = id;
    const seen = new Set<string>();
    while (current && !seen.has(current)) {
      seen.add(current);
      visible.add(current);
      current = byId.get(current)?.parentId ?? null;
    }
  }

  const dimmed = new Set<string>();
  for (const id of visible) {
    if (!matching.has(id)) dimmed.add(id);
  }
  return { visible, dimmed };
}
