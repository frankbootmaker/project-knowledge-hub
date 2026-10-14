import { describe, expect, it } from 'vitest';
import en from '../../messages/en.json';
import hu from '../../messages/hu.json';
import {
  DELIVERY_TREE_ORPHAN_STORIES,
  DELIVERY_TREE_UNGROUPED_TASKS,
  filterDeliveryTree,
  type DeliveryTreeFilterNode,
} from './delivery-tree-filter';
import {
  DELIVERY_TREE_ORPHAN_COLLAPSE_ID,
  DELIVERY_TREE_UNGROUPED_COLLAPSE_ID,
  collapseTreeAll,
  collapseTreeOneLevel,
  deliveryTreeCollapsibleNodes,
  deliveryTreeDepthActions,
  expandTreeAll,
  expandTreeOneLevel,
  type DeliveryTreeCollapseNode,
  type DeliveryTreeCollapseSource,
} from './delivery-tree-collapse';

const deepTree: DeliveryTreeCollapseNode[] = [
  { id: 'epic:a', parentId: null, depth: 0 },
  { id: 'story:a', parentId: 'epic:a', depth: 1 },
  { id: 'detail:a', parentId: 'story:a', depth: 2 },
  { id: 'epic:b', parentId: null, depth: 0 },
];

function ids(collapsed: Record<string, boolean>): string[] {
  return Object.keys(collapsed)
    .filter((id) => collapsed[id] === true)
    .sort();
}

function source(
  partial: Partial<DeliveryTreeCollapseSource> & Pick<DeliveryTreeCollapseSource, 'visible'>,
): DeliveryTreeCollapseSource {
  return {
    epics: [],
    stories: [],
    orphanStoryIds: [],
    ungroupedTaskIds: [],
    filtering: false,
    ...partial,
  };
}

describe('deliveryTreeCollapsibleNodes', () => {
  const visible = new Set([
    'epic:deep',
    'story:with-tasks',
    'task:one',
    'epic:leaf',
    'story:empty',
    DELIVERY_TREE_ORPHAN_STORIES,
    'story:orphan',
    'task:orphan',
    DELIVERY_TREE_UNGROUPED_TASKS,
    'task:loose',
  ]);

  const nodes = deliveryTreeCollapsibleNodes(
    source({
      visible,
      epics: [
        { id: 'deep', storyIds: ['with-tasks'] },
        { id: 'leaf', storyIds: [] },
        { id: 'hidden', storyIds: ['gone'] },
      ],
      stories: [
        { id: 'with-tasks', taskIds: ['one'] },
        { id: 'empty', taskIds: [] },
        { id: 'orphan', taskIds: ['orphan'] },
        { id: 'gone', taskIds: [] },
      ],
      orphanStoryIds: ['orphan'],
      ungroupedTaskIds: ['loose'],
    }),
  );

  it('keeps mixed-depth branches and skips rows outside the filter', () => {
    expect(nodes).toEqual([
      { id: 'epic:deep', parentId: null, depth: 0 },
      { id: 'story:with-tasks', parentId: 'epic:deep', depth: 1 },
      { id: 'epic:leaf', parentId: null, depth: 0 },
      { id: DELIVERY_TREE_ORPHAN_COLLAPSE_ID, parentId: null, depth: 0 },
      { id: 'story:orphan', parentId: DELIVERY_TREE_ORPHAN_COLLAPSE_ID, depth: 1 },
      { id: DELIVERY_TREE_UNGROUPED_COLLAPSE_ID, parentId: null, depth: 0 },
    ]);
  });

  it('drops a story toggle when a title filter hides its tasks', () => {
    const filtered = deliveryTreeCollapsibleNodes(
      source({
        filtering: true,
        visible: new Set(['epic:deep', 'story:with-tasks']),
        epics: [{ id: 'deep', storyIds: ['with-tasks'] }],
        stories: [{ id: 'with-tasks', taskIds: ['one'] }],
      }),
    );
    expect(filtered).toEqual([{ id: 'epic:deep', parentId: null, depth: 0 }]);
  });

  it('keeps an empty story when the tree is not filtered', () => {
    const open = deliveryTreeCollapsibleNodes(
      source({
        visible: new Set(['epic:leaf', 'story:empty']),
        epics: [{ id: 'leaf', storyIds: ['empty'] }],
        stories: [{ id: 'empty', taskIds: [] }],
      }),
    );
    expect(open.map((node) => node.id)).toEqual(['epic:leaf', 'story:empty']);
  });
});

describe('delivery tree depth actions', () => {
  it('starts fully open, so only collapse actions are available', () => {
    const open = {};
    expect(deliveryTreeDepthActions(open, deepTree)).toEqual({
      canExpandLevel: false,
      canCollapseLevel: true,
      canExpandAll: false,
      canCollapseAll: true,
    });
    expect(expandTreeOneLevel(open, deepTree)).toBe(open);
    expect(expandTreeAll(open, deepTree)).toBe(open);
  });

  it('collapses one level from the deepest open row', () => {
    const once = collapseTreeOneLevel({}, deepTree);
    expect(ids(once)).toEqual(['detail:a']);
    const twice = collapseTreeOneLevel(once, deepTree);
    expect(ids(twice)).toEqual(['detail:a', 'story:a']);
    const thrice = collapseTreeOneLevel(twice, deepTree);
    expect(ids(thrice)).toEqual(['detail:a', 'epic:a', 'epic:b', 'story:a']);
    expect(deliveryTreeDepthActions(thrice, deepTree)).toMatchObject({
      canCollapseLevel: false,
      canCollapseAll: false,
      canExpandLevel: true,
      canExpandAll: true,
    });
    expect(collapseTreeOneLevel(thrice, deepTree)).toBe(thrice);
    expect(collapseTreeAll(thrice, deepTree)).toBe(thrice);
  });

  it('expands one level from the shallowest visible collapsed row', () => {
    const closed = collapseTreeAll({}, deepTree);
    const roots = expandTreeOneLevel(closed, deepTree);
    expect(ids(roots)).toEqual(['detail:a', 'story:a']);
    const middles = expandTreeOneLevel(roots, deepTree);
    expect(ids(middles)).toEqual(['detail:a']);
    expect(ids(expandTreeOneLevel(middles, deepTree))).toEqual([]);
  });

  it('keeps a deeper collapse when a shallower branch is the frontier', () => {
    const mixed = { 'epic:b': true, 'detail:a': true };
    expect(ids(expandTreeOneLevel(mixed, deepTree))).toEqual(['detail:a']);
    expect(ids(collapseTreeOneLevel(mixed, deepTree))).toEqual(['detail:a', 'epic:b', 'story:a']);
  });

  it('collapses hidden open descendants with collapse all, not collapse one', () => {
    const rootsClosed = { 'epic:a': true, 'epic:b': true };
    expect(deliveryTreeDepthActions(rootsClosed, deepTree)).toMatchObject({
      canCollapseLevel: false,
      canCollapseAll: true,
      canExpandLevel: true,
    });
    expect(collapseTreeOneLevel(rootsClosed, deepTree)).toBe(rootsClosed);
    expect(ids(collapseTreeAll(rootsClosed, deepTree))).toEqual([
      'detail:a',
      'epic:a',
      'epic:b',
      'story:a',
    ]);
    expect(ids(expandTreeAll(rootsClosed, deepTree))).toEqual([]);
  });

  it('leaves rows outside the active filter untouched', () => {
    const visibleBranch = deepTree.filter((node) => node.id !== 'epic:b');
    const collapsed = { 'epic:b': true, 'story:a': true, 'detail:a': true };
    const expanded = expandTreeAll(collapsed, visibleBranch);
    expect(expanded['epic:b']).toBe(true);
    expect(expanded['story:a']).toBeUndefined();
    const collapsedAgain = collapseTreeAll({}, visibleBranch);
    expect(collapsedAgain['epic:b']).toBeUndefined();
    expect(ids(collapsedAgain)).toEqual(['detail:a', 'epic:a', 'story:a']);
  });

  it('disables every control when the filter has nothing to open', () => {
    expect(deliveryTreeDepthActions({ 'epic:a': true }, [])).toEqual({
      canExpandLevel: false,
      canCollapseLevel: false,
      canExpandAll: false,
      canCollapseAll: false,
    });
  });
});

describe('filtered delivery tree', () => {
  function node(
    partial: Pick<DeliveryTreeFilterNode, 'id' | 'kind' | 'parentId' | 'title'> &
      Partial<DeliveryTreeFilterNode>,
  ): DeliveryTreeFilterNode {
    return { status: 'todo', owner: null, sprint: null, ...partial };
  }

  const filterNodes: DeliveryTreeFilterNode[] = [
    node({ id: 'epic:a', kind: 'epic', parentId: null, title: 'Platform' }),
    node({ id: 'story:a', kind: 'story', parentId: 'epic:a', title: 'Routes' }),
    node({
      id: 'task:a',
      kind: 'task',
      parentId: 'story:a',
      title: 'Invoice export',
      owner: 'Ada',
    }),
    node({ id: 'epic:leaf', kind: 'epic', parentId: null, title: 'Empty epic' }),
    node({
      id: DELIVERY_TREE_ORPHAN_STORIES,
      kind: 'group',
      parentId: null,
      title: '',
      status: null,
    }),
    node({
      id: 'story:orphan',
      kind: 'story',
      parentId: DELIVERY_TREE_ORPHAN_STORIES,
      title: 'Loose story',
    }),
    node({
      id: 'task:orphan',
      kind: 'task',
      parentId: 'story:orphan',
      title: 'Orphan task',
    }),
    node({
      id: DELIVERY_TREE_UNGROUPED_TASKS,
      kind: 'group',
      parentId: null,
      title: '',
      status: null,
    }),
    node({
      id: 'task:loose',
      kind: 'task',
      parentId: DELIVERY_TREE_UNGROUPED_TASKS,
      title: 'Ungrouped',
    }),
  ];

  const treeSource: DeliveryTreeCollapseSource = {
    epics: [
      { id: 'a', storyIds: ['a'] },
      { id: 'leaf', storyIds: [] },
    ],
    stories: [
      { id: 'a', taskIds: ['a'] },
      { id: 'orphan', taskIds: ['orphan'] },
    ],
    orphanStoryIds: ['orphan'],
    ungroupedTaskIds: ['loose'],
    visible: new Set(),
    filtering: true,
  };

  it('limits one-level collapse to the filtered branch', () => {
    const visibility = filterDeliveryTree(filterNodes, {
      statuses: [],
      owners: [],
      sprints: [],
      itemTypes: [],
      title: 'invoice',
      onlyOpen: false,
    });
    const nodes = deliveryTreeCollapsibleNodes({
      ...treeSource,
      visible: visibility.visible,
    });
    expect(nodes.map((entry) => entry.id)).toEqual(['epic:a', 'story:a']);
    expect(ids(collapseTreeOneLevel({}, nodes))).toEqual(['story:a']);
    expect(ids(collapseTreeAll({}, nodes))).toEqual(['epic:a', 'story:a']);
    const reopened = expandTreeOneLevel(
      { 'epic:a': true, 'story:a': true, 'epic:leaf': true },
      nodes,
    );
    expect(ids(reopened)).toEqual(['epic:leaf', 'story:a']);
  });
});

describe('delivery tree depth tooltips', () => {
  it('has English and Hungarian labels', () => {
    expect(en.delivery.treeExpandLevel).toBe('Expand one level');
    expect(en.delivery.treeCollapseLevel).toBe('Collapse one level');
    expect(en.delivery.treeExpandAll).toBe('Expand all');
    expect(en.delivery.treeCollapseAll).toBe('Collapse all');
    expect(hu.delivery.treeExpandLevel).toBe('Egy szint kibontása');
    expect(hu.delivery.treeCollapseLevel).toBe('Egy szint összecsukása');
    expect(hu.delivery.treeExpandAll).toBe('Összes kibontása');
    expect(hu.delivery.treeCollapseAll).toBe('Összes összecsukása');
    expect(en.delivery.treeDepthControls).not.toBe(hu.delivery.treeDepthControls);
  });
});
