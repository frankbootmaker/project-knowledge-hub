import { describe, expect, it } from 'vitest';
import { EMPTY_FILTER_VALUE } from './data-table';
import {
  DELIVERY_TREE_ORPHAN_STORIES,
  DELIVERY_TREE_UNGROUPED_TASKS,
  deliveryTreeFiltersActive,
  filterDeliveryTree,
  type DeliveryTreeFilterNode,
  type DeliveryTreeFilterState,
} from './delivery-tree-filter';

function node(
  partial: Pick<DeliveryTreeFilterNode, 'id' | 'kind' | 'parentId' | 'title'> &
    Partial<DeliveryTreeFilterNode>,
): DeliveryTreeFilterNode {
  return {
    status: null,
    owner: null,
    sprint: null,
    ...partial,
  };
}

const epicDone = node({
  id: 'epic:done',
  kind: 'epic',
  parentId: null,
  title: 'Archive the lab',
  status: 'done',
});
const storyDone = node({
  id: 'story:done',
  kind: 'story',
  parentId: epicDone.id,
  title: 'Close the runbook',
  status: 'done',
});
const taskOpen = node({
  id: 'task:open',
  kind: 'task',
  parentId: storyDone.id,
  title: 'Redraw the Form',
  status: 'todo',
  owner: 'Ada',
  sprint: 'Sprint 2',
});
const taskDone = node({
  id: 'task:done',
  kind: 'task',
  parentId: storyDone.id,
  title: 'File the copy',
  status: 'done',
  owner: null,
  sprint: null,
});
const storyActive = node({
  id: 'story:active',
  kind: 'story',
  parentId: epicDone.id,
  title: 'Billing',
  status: 'active',
});
const taskBlocked = node({
  id: 'task:blocked',
  kind: 'task',
  parentId: storyActive.id,
  title: 'Invoice export',
  status: 'blocked',
  owner: 'Bea',
  sprint: 'Sprint 1',
});
const epicActive = node({
  id: 'epic:active',
  kind: 'epic',
  parentId: null,
  title: 'Mobile',
  status: 'active',
});
const storyPlanned = node({
  id: 'story:planned',
  kind: 'story',
  parentId: epicActive.id,
  title: 'Empty shell',
  status: 'planned',
});
const orphanGroup = node({
  id: DELIVERY_TREE_ORPHAN_STORIES,
  kind: 'group',
  parentId: null,
  title: 'Stories without an epic',
});
const orphanStory = node({
  id: 'story:orphan',
  kind: 'story',
  parentId: orphanGroup.id,
  title: 'Loose story',
  status: 'active',
});
const orphanTask = node({
  id: 'task:orphan',
  kind: 'task',
  parentId: orphanStory.id,
  title: 'Loose wiring',
  status: 'in_progress',
  owner: 'Ada',
  sprint: null,
});
const taskGroup = node({
  id: DELIVERY_TREE_UNGROUPED_TASKS,
  kind: 'group',
  parentId: null,
  title: 'Tasks without a story',
});
const looseCancelled = node({
  id: 'task:loose',
  kind: 'task',
  parentId: taskGroup.id,
  title: 'Drop the volume',
  status: 'cancelled',
  owner: null,
  sprint: 'Sprint 2',
});
const epicCancelled = node({
  id: 'epic:cancelled',
  kind: 'epic',
  parentId: null,
  title: 'Parked',
  status: 'cancelled',
});
const parkedTask = node({
  id: 'task:parked',
  kind: 'task',
  parentId: epicCancelled.id,
  title: 'Still open under cancelled',
  status: 'todo',
  owner: 'Bea',
  sprint: 'Sprint 1',
});

const nodes = [
  epicDone,
  storyDone,
  taskOpen,
  taskDone,
  storyActive,
  taskBlocked,
  epicActive,
  storyPlanned,
  orphanGroup,
  orphanStory,
  orphanTask,
  taskGroup,
  looseCancelled,
  epicCancelled,
  parkedTask,
];

const idle: DeliveryTreeFilterState = {
  statuses: [],
  owners: [],
  sprints: [],
  title: '',
  onlyOpen: false,
};

function ids(set: ReadonlySet<string>): string[] {
  return [...set].sort();
}

describe('deliveryTreeFiltersActive', () => {
  it('is inactive until a status, owner, sprint, title, or only-open filter is set', () => {
    expect(deliveryTreeFiltersActive(idle)).toBe(false);
    expect(deliveryTreeFiltersActive({ ...idle, title: '   ' })).toBe(false);
    expect(deliveryTreeFiltersActive({ ...idle, onlyOpen: true })).toBe(true);
    expect(deliveryTreeFiltersActive({ ...idle, statuses: ['todo'] })).toBe(true);
    expect(deliveryTreeFiltersActive({ ...idle, title: 'form' })).toBe(true);
  });
});

describe('filterDeliveryTree', () => {
  it('shows every row and dims none when no filter is active', () => {
    const result = filterDeliveryTree(nodes, idle);
    expect(ids(result.visible)).toEqual(ids(new Set(nodes.map((item) => item.id))));
    expect(result.dimmed.size).toBe(0);
  });

  it('hides done and cancelled rows but keeps open descendants and dims their ancestors', () => {
    const result = filterDeliveryTree(nodes, { ...idle, onlyOpen: true });

    expect(result.visible.has(taskOpen.id)).toBe(true);
    expect(result.dimmed.has(taskOpen.id)).toBe(false);
    expect(result.visible.has(storyDone.id)).toBe(true);
    expect(result.dimmed.has(storyDone.id)).toBe(true);
    expect(result.visible.has(epicDone.id)).toBe(true);
    expect(result.dimmed.has(epicDone.id)).toBe(true);
    expect(result.visible.has(taskDone.id)).toBe(false);
    expect(result.visible.has(looseCancelled.id)).toBe(false);
    expect(result.visible.has(taskGroup.id)).toBe(false);

    expect(result.visible.has(storyActive.id)).toBe(true);
    expect(result.dimmed.has(storyActive.id)).toBe(false);
    expect(result.visible.has(taskBlocked.id)).toBe(true);
    expect(result.visible.has(epicActive.id)).toBe(true);
    expect(result.dimmed.has(epicActive.id)).toBe(false);
    expect(result.visible.has(storyPlanned.id)).toBe(true);

    expect(result.visible.has(orphanTask.id)).toBe(true);
    expect(result.dimmed.has(orphanStory.id)).toBe(false);
    expect(result.dimmed.has(orphanGroup.id)).toBe(true);

    expect(result.visible.has(parkedTask.id)).toBe(true);
    expect(result.dimmed.has(epicCancelled.id)).toBe(true);
    expect(result.visible.has(epicCancelled.id)).toBe(true);
  });

  it('keeps a matching ancestor undimmed and hides children that miss the status', () => {
    const result = filterDeliveryTree(nodes, {
      ...idle,
      statuses: ['done'],
    });

    expect(result.visible.has(epicDone.id)).toBe(true);
    expect(result.dimmed.has(epicDone.id)).toBe(false);
    expect(result.visible.has(storyDone.id)).toBe(true);
    expect(result.dimmed.has(storyDone.id)).toBe(false);
    expect(result.visible.has(taskDone.id)).toBe(true);
    expect(result.dimmed.has(taskDone.id)).toBe(false);
    expect(result.visible.has(taskOpen.id)).toBe(false);
    expect(result.visible.has(storyActive.id)).toBe(false);
    expect(result.visible.has(epicActive.id)).toBe(false);
    expect(result.visible.has(orphanGroup.id)).toBe(false);
    expect(result.visible.has(taskGroup.id)).toBe(false);
  });

  it('dims ancestors when only a nested status matches', () => {
    const result = filterDeliveryTree(nodes, {
      ...idle,
      statuses: ['planned'],
    });
    expect(ids(result.visible)).toEqual([epicActive.id, storyPlanned.id].sort());
    expect(ids(result.dimmed)).toEqual([epicActive.id]);
  });

  it('treats owner and sprint as task-only, including the empty sentinel', () => {
    const byAda = filterDeliveryTree(nodes, { ...idle, owners: ['Ada'] });
    expect(byAda.visible.has(taskOpen.id)).toBe(true);
    expect(byAda.visible.has(orphanTask.id)).toBe(true);
    expect(byAda.dimmed.has(epicDone.id)).toBe(true);
    expect(byAda.dimmed.has(storyDone.id)).toBe(true);
    expect(byAda.dimmed.has(orphanGroup.id)).toBe(true);
    expect(byAda.dimmed.has(orphanStory.id)).toBe(true);
    expect(byAda.visible.has(storyActive.id)).toBe(false);
    expect(byAda.visible.has(epicActive.id)).toBe(false);
    expect(byAda.visible.has(taskBlocked.id)).toBe(false);
    expect(byAda.visible.has(epicDone.id)).toBe(true);

    const unassigned = filterDeliveryTree(nodes, {
      ...idle,
      owners: [EMPTY_FILTER_VALUE],
    });
    expect(unassigned.visible.has(taskDone.id)).toBe(true);
    expect(unassigned.visible.has(looseCancelled.id)).toBe(true);
    expect(unassigned.dimmed.has(storyDone.id)).toBe(true);
    expect(unassigned.dimmed.has(taskGroup.id)).toBe(true);
    expect(unassigned.visible.has(taskOpen.id)).toBe(false);

    const sprintTwo = filterDeliveryTree(nodes, {
      ...idle,
      sprints: ['Sprint 2'],
    });
    expect(sprintTwo.visible.has(taskOpen.id)).toBe(true);
    expect(sprintTwo.visible.has(looseCancelled.id)).toBe(true);
    expect(sprintTwo.dimmed.has(epicDone.id)).toBe(true);
    expect(sprintTwo.dimmed.has(taskGroup.id)).toBe(true);
    expect(sprintTwo.visible.has(storyActive.id)).toBe(false);
    expect(sprintTwo.visible.has(orphanStory.id)).toBe(false);

    const noSprint = filterDeliveryTree(nodes, {
      ...idle,
      sprints: [EMPTY_FILTER_VALUE],
    });
    expect(noSprint.visible.has(taskDone.id)).toBe(true);
    expect(noSprint.visible.has(orphanTask.id)).toBe(true);
    expect(noSprint.visible.has(taskOpen.id)).toBe(false);
    expect(noSprint.visible.has(looseCancelled.id)).toBe(false);
  });

  it('matches titles case-insensitively and still keeps ancestors', () => {
    const result = filterDeliveryTree(nodes, { ...idle, title: '  fOrM ' });
    expect(ids(result.visible)).toEqual([epicDone.id, storyDone.id, taskOpen.id].sort());
    expect(ids(result.dimmed)).toEqual([epicDone.id, storyDone.id].sort());
  });

  it('does not let a grouping row match on its own title', () => {
    const result = filterDeliveryTree(nodes, {
      ...idle,
      title: 'without a story',
    });
    expect(result.visible.size).toBe(0);
  });

  it('requires every active filter to pass', () => {
    const combined = filterDeliveryTree(nodes, {
      statuses: ['todo'],
      owners: ['Ada'],
      sprints: ['Sprint 2'],
      title: 'form',
      onlyOpen: true,
    });
    expect(ids(combined.visible)).toEqual([epicDone.id, storyDone.id, taskOpen.id].sort());
    expect(combined.dimmed.has(taskOpen.id)).toBe(false);

    const contradiction = filterDeliveryTree(nodes, {
      ...idle,
      statuses: ['done'],
      onlyOpen: true,
    });
    expect(contradiction.visible.size).toBe(0);

    const ownerAndStatus = filterDeliveryTree(nodes, {
      ...idle,
      statuses: ['active'],
      owners: ['Ada'],
    });
    expect(ownerAndStatus.visible.has(storyActive.id)).toBe(false);
    expect(ownerAndStatus.visible.has(epicActive.id)).toBe(false);
    expect(ownerAndStatus.visible.has(orphanTask.id)).toBe(false);
  });

  it('hides a branch that has no matching row', () => {
    const result = filterDeliveryTree(nodes, {
      ...idle,
      statuses: ['in_progress'],
    });
    expect(ids(result.visible)).toEqual([orphanGroup.id, orphanStory.id, orphanTask.id].sort());
    expect(result.visible.has(epicDone.id)).toBe(false);
    expect(result.visible.has(epicActive.id)).toBe(false);
    expect(result.visible.has(taskGroup.id)).toBe(false);
  });

  it('does not mutate nodes or invent rolled-up values', () => {
    const snapshot = nodes.map((item) => ({ ...item }));
    filterDeliveryTree(nodes, { ...idle, onlyOpen: true, owners: ['Ada'] });
    expect(nodes).toEqual(snapshot);
    for (const item of nodes) {
      expect(item).not.toHaveProperty('hours');
      expect(item).not.toHaveProperty('points');
    }
  });
});
