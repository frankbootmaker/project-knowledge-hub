'use client';

import { useCallback, useId, useMemo, useState, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Button, Switch } from './ui';
import { TableFilterControl, type TableFilterField } from './ui/TableFilterControl';
import { collectEnumOptions } from '../lib/data-table';
import { DELIVERY_STATUS_RANK, isTaskDeliveryStatus } from '../lib/delivery-status';
import {
  DELIVERY_TREE_ORPHAN_STORIES,
  DELIVERY_TREE_UNGROUPED_TASKS,
  deliveryTreeFiltersActive,
  filterDeliveryTree,
  type DeliveryTreeFilterNode,
  type DeliveryTreeFilterState,
} from '../lib/delivery-tree-filter';
import { useSyncEnumFilters, useTableState } from '../lib/use-table-state';
import { toHours } from '../lib/task-costing';

type TreeEpic = {
  id: string;
  title: string;
  status: string;
  sortOrder: number;
  humanKey?: string | null;
};

type TreeStory = {
  id: string;
  epicId: string;
  title: string;
  status: string;
  sortOrder: number;
  humanKey?: string | null;
};

type TreeTask = {
  id: string;
  title: string;
  status: string;
  dueDate: string | null;
  userStoryId: string | null;
  currentOwner: {
    displayName: string;
    avatarUrl?: string | null;
  } | null;
  humanKey?: string | null;
  forecastHours?: string | number | null;
  actualHours?: string | number | null;
  storyPoints?: number | null;
  sprintLabel?: string | null;
};

function TreeBranch({
  open,
  onToggle,
  label,
  sub,
  meta,
  children,
  depth,
  actions,
  dimmed,
  dimHint,
}: {
  open: boolean;
  onToggle?: () => void;
  label: ReactNode;
  sub?: ReactNode;
  meta?: ReactNode;
  children?: ReactNode;
  depth: number;
  actions?: ReactNode;
  dimmed?: boolean;
  dimHint?: string;
}) {
  const hasChildren = Boolean(children);
  return (
    <li className="list-none">
      <div
        className="kh-ops-delivery-tree-row"
        data-filter-dimmed={dimmed ? 'true' : undefined}
        title={dimmed ? dimHint : undefined}
      >
        <div className="kh-ops-tree-main" style={{ ['--level' as string]: depth }}>
          {hasChildren && onToggle ? (
            <button
              type="button"
              className="kh-ops-tree-toggle"
              aria-expanded={open}
              onClick={onToggle}
            >
              {open ? '⌄' : '›'}
            </button>
          ) : (
            <span className="kh-ops-tree-spacer" aria-hidden />
          )}
          <div className="kh-ops-tree-title">
            <strong>{label}</strong>
            {sub ? <small>{sub}</small> : null}
            {dimmed && dimHint ? <span className="sr-only">{dimHint}</span> : null}
          </div>
        </div>
        <div className="kh-ops-tree-meta">
          {meta}
          {actions}
        </div>
      </div>
      {hasChildren && open ? <ul className="m-0 grid list-none p-0">{children}</ul> : null}
    </li>
  );
}

function taskNode(task: TreeTask, parentId: string): DeliveryTreeFilterNode {
  return {
    id: `task:${task.id}`,
    kind: 'task',
    parentId,
    title: task.title,
    status: task.status,
    owner: task.currentOwner?.displayName ?? null,
    sprint: task.sprintLabel ?? null,
  };
}

function storyNode(story: TreeStory, parentId: string): DeliveryTreeFilterNode {
  return {
    id: `story:${story.id}`,
    kind: 'story',
    parentId,
    title: story.title,
    status: story.status,
    owner: null,
    sprint: null,
  };
}

export function ProjectDeliveryTree({
  epics,
  stories,
  tasks,
  sprintsLoaded = true,
  onManageTask,
  onManageEpic,
  onManageStory,
}: {
  epics: TreeEpic[];
  stories: TreeStory[];
  tasks: TreeTask[];
  /** False while sprint titles are still loading, so a sprint URL filter is kept. */
  sprintsLoaded?: boolean;
  onManageTask?: (taskId: string) => void;
  onManageEpic?: (epicId: string) => void;
  onManageStory?: (storyId: string) => void;
}) {
  const t = useTranslations('delivery');
  const tTable = useTranslations('table');
  const locale = useLocale();
  const onlyOpenId = useId();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const table = useTableState({
    namespace: 'dt',
    defaultSortKey: null,
  });

  function isOpen(id: string) {
    return collapsed[id] !== true;
  }

  function toggle(id: string) {
    setCollapsed((current) => ({ ...current, [id]: !current[id] }));
  }

  const clearTreeFilters = useCallback(() => {
    table.clearFilters();
    table.setExtra('open', '');
  }, [table]);

  const statusOptions = useMemo(
    () =>
      Object.keys(DELIVERY_STATUS_RANK).map((value) => ({
        value,
        label: isTaskDeliveryStatus(value)
          ? t(`taskStatus.${value}`)
          : t(`milestoneStatus.${value}`),
      })),
    [t],
  );
  const ownerOptions = useMemo(
    () =>
      collectEnumOptions(
        tasks,
        (task) => task.currentOwner?.displayName ?? '',
        (value) => value,
        locale,
      ),
    [locale, tasks],
  );
  const sprintOptions = useMemo(
    () =>
      sprintsLoaded
        ? collectEnumOptions(
            tasks,
            (task) => task.sprintLabel ?? '',
            (value) => value,
            locale,
          )
        : [],
    [locale, sprintsLoaded, tasks],
  );
  const syncColumns = useMemo(
    () => [
      {
        id: 'status',
        filter: {
          type: 'enum' as const,
          getValue: () => '',
          options: statusOptions,
        },
      },
      {
        id: 'owner',
        filter: {
          type: 'enum' as const,
          getValue: () => '',
          options: ownerOptions,
        },
      },
      {
        id: 'sprint',
        filter: {
          type: 'enum' as const,
          getValue: () => '',
          options: sprintOptions,
        },
      },
    ],
    [ownerOptions, sprintOptions, statusOptions],
  );
  useSyncEnumFilters(table.filters, syncColumns, table.setEnumFilter);

  const filterFields = useMemo<TableFilterField[]>(() => {
    const fields: TableFilterField[] = [
      { id: 'status', header: t('colStatus'), type: 'enum', options: statusOptions },
    ];
    if (ownerOptions.length > 0) {
      fields.push({
        id: 'owner',
        header: t('colOwner'),
        type: 'enum',
        options: ownerOptions,
      });
    }
    const sprintSelected = table.filters.sprint ?? [];
    if (sprintOptions.length > 0 || sprintSelected.length > 0) {
      fields.push({
        id: 'sprint',
        header: t('colSprint'),
        type: 'enum',
        options: sprintOptions,
      });
    }
    fields.push({ id: 'title', header: t('colTitle'), type: 'text' });
    return fields;
  }, [ownerOptions, sprintOptions, statusOptions, t, table.filters.sprint]);

  const onlyOpen = table.extras.open === '1';
  const filterState = useMemo<DeliveryTreeFilterState>(
    () => ({
      statuses: table.filters.status ?? [],
      owners: table.filters.owner ?? [],
      sprints: sprintsLoaded ? (table.filters.sprint ?? []) : [],
      title: table.textFilters.title ?? '',
      onlyOpen,
    }),
    [
      onlyOpen,
      sprintsLoaded,
      table.filters.owner,
      table.filters.sprint,
      table.filters.status,
      table.textFilters.title,
    ],
  );
  const filtersActive = table.filtersActive || onlyOpen;

  const tree = useMemo(() => {
    const storiesByEpic = new Map<string, TreeStory[]>();
    const orphanStories: TreeStory[] = [];
    const epicIds = new Set(epics.map((epic) => epic.id));
    const nodes: DeliveryTreeFilterNode[] = [];

    for (const story of [...stories].sort(
      (a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title),
    )) {
      if (!epicIds.has(story.epicId)) {
        orphanStories.push(story);
        continue;
      }
      const list = storiesByEpic.get(story.epicId) ?? [];
      list.push(story);
      storiesByEpic.set(story.epicId, list);
    }

    const tasksByStory = new Map<string, TreeTask[]>();
    const ungroupedTasks: TreeTask[] = [];
    for (const task of [...tasks].sort((a, b) => a.title.localeCompare(b.title))) {
      if (!task.userStoryId) {
        ungroupedTasks.push(task);
        continue;
      }
      const list = tasksByStory.get(task.userStoryId) ?? [];
      list.push(task);
      tasksByStory.set(task.userStoryId, list);
    }

    const sortedEpics = [...epics].sort(
      (a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title),
    );

    for (const epic of sortedEpics) {
      nodes.push({
        id: `epic:${epic.id}`,
        kind: 'epic',
        parentId: null,
        title: epic.title,
        status: epic.status,
        owner: null,
        sprint: null,
      });
      for (const story of storiesByEpic.get(epic.id) ?? []) {
        nodes.push(storyNode(story, `epic:${epic.id}`));
        for (const task of tasksByStory.get(story.id) ?? []) {
          nodes.push(taskNode(task, `story:${story.id}`));
        }
      }
    }

    if (orphanStories.length > 0) {
      nodes.push({
        id: DELIVERY_TREE_ORPHAN_STORIES,
        kind: 'group',
        parentId: null,
        title: '',
        status: null,
        owner: null,
        sprint: null,
      });
      for (const story of orphanStories) {
        nodes.push(storyNode(story, DELIVERY_TREE_ORPHAN_STORIES));
        for (const task of tasksByStory.get(story.id) ?? []) {
          nodes.push(taskNode(task, `story:${story.id}`));
        }
      }
    }

    if (ungroupedTasks.length > 0) {
      nodes.push({
        id: DELIVERY_TREE_UNGROUPED_TASKS,
        kind: 'group',
        parentId: null,
        title: '',
        status: null,
        owner: null,
        sprint: null,
      });
      for (const task of ungroupedTasks) {
        nodes.push(taskNode(task, DELIVERY_TREE_UNGROUPED_TASKS));
      }
    }

    return {
      storiesByEpic,
      orphanStories,
      tasksByStory,
      ungroupedTasks,
      sortedEpics,
      nodes,
    };
  }, [epics, stories, tasks]);

  const visibility = useMemo(
    () => filterDeliveryTree(tree.nodes, filterState),
    [filterState, tree.nodes],
  );
  const filtering = deliveryTreeFiltersActive(filterState);

  function metaBits(input: {
    statusLabel: string;
    owner?: string | null;
    sprint?: string | null;
    hours?: number | null;
    points?: number | null;
  }) {
    return (
      <>
        <span>{input.statusLabel}</span>
        <span>{input.owner ?? '—'}</span>
        <span>{input.sprint ?? '—'}</span>
        <span>{input.hours == null ? '—' : `${input.hours}h`}</span>
        <span>{input.points == null ? '—' : `${input.points}pt`}</span>
      </>
    );
  }

  function rowDim(id: string) {
    const dimmed = visibility.dimmed.has(id);
    return {
      dimmed,
      dimHint: dimmed ? t('treeFilterDimmed') : undefined,
    };
  }

  function renderTask(task: TreeTask, depth: number) {
    const id = `task:${task.id}`;
    if (!visibility.visible.has(id)) return null;
    return (
      <TreeBranch
        key={task.id}
        open
        depth={depth}
        label={task.title}
        sub={task.humanKey ?? t('kindTask')}
        {...rowDim(id)}
        meta={metaBits({
          statusLabel: t(`taskStatus.${task.status}`),
          owner: task.currentOwner?.displayName ?? null,
          sprint: task.sprintLabel ?? null,
          hours: toHours(task.forecastHours),
          points: task.storyPoints ?? null,
        })}
        actions={
          onManageTask ? (
            <Button
              type="button"
              variant="secondary"
              className="h-8 min-h-8 px-2 text-xs"
              onClick={() => onManageTask(task.id)}
            >
              {t('manage')}
            </Button>
          ) : null
        }
      />
    );
  }

  function renderStory(story: TreeStory, depth: number) {
    const id = `story:${story.id}`;
    if (!visibility.visible.has(id)) return null;
    const storyTasks = tree.tasksByStory.get(story.id) ?? [];
    const visibleTasks = storyTasks.filter((task) => visibility.visible.has(`task:${task.id}`));
    const nodeId = `story:${story.id}`;
    return (
      <TreeBranch
        key={story.id}
        open={isOpen(nodeId)}
        onToggle={() => toggle(nodeId)}
        depth={depth}
        label={story.title}
        sub={story.humanKey ?? t('kindStory')}
        {...rowDim(id)}
        meta={metaBits({
          statusLabel: t(`milestoneStatus.${story.status}`),
        })}
        actions={
          onManageStory ? (
            <Button
              type="button"
              variant="secondary"
              className="h-8 min-h-8 px-2 text-xs"
              onClick={() => onManageStory(story.id)}
            >
              {t('manage')}
            </Button>
          ) : null
        }
      >
        {visibleTasks.length > 0 ? (
          visibleTasks.map((task) => renderTask(task, depth + 1))
        ) : !filtering && storyTasks.length === 0 ? (
          <li className="kh-ops-delivery-tree-row list-none text-sm text-ink-muted">
            {t('treeNoTasks')}
          </li>
        ) : null}
      </TreeBranch>
    );
  }

  const hasAny =
    tree.sortedEpics.length > 0 || tree.orphanStories.length > 0 || tree.ungroupedTasks.length > 0;

  if (!hasAny) {
    return (
      <section className="kh-ops-panel">
        <div className="kh-ops-empty-state">
          <div className="kh-ops-empty-mark">00</div>
          <h3>{t('emptyTitle')}</h3>
          <p>{t('treeEmpty')}</p>
        </div>
      </section>
    );
  }

  const filteredEmpty = filtering && visibility.visible.size === 0;

  return (
    <section className="kh-ops-panel overflow-x-auto">
      <div className="kh-ops-delivery-tree">
        <div className="kh-ops-delivery-tree-head">
          <span>{t('treeBreakdown')}</span>
          <div className="kh-ops-delivery-tree-head-meta">
            <span>{t('treeMetaHead')}</span>
            <TableFilterControl
              fields={filterFields}
              enumFilters={table.filters}
              textFilters={table.textFilters}
              onEnumFilter={table.setEnumFilter}
              onTextFilter={table.setTextFilter}
              onClearFilters={clearTreeFilters}
              filtersActive={filtersActive}
              insertAfter={{
                id: 'status',
                content: (
                  <div className="kh-ops-table-filter-group">
                    <Switch
                      id={onlyOpenId}
                      checked={onlyOpen}
                      label={t('treeOnlyOpen')}
                      onCheckedChange={(checked) => table.setExtra('open', checked ? '1' : '')}
                    />
                  </div>
                ),
              }}
            />
            {filtersActive ? (
              <Button
                type="button"
                variant="secondary"
                className="kh-ops-tree-filter-clear h-8 min-h-8 px-2 text-xs"
                onClick={clearTreeFilters}
              >
                {tTable('clearFilters')}
              </Button>
            ) : null}
          </div>
        </div>
        {filteredEmpty ? (
          <div className="kh-ops-empty-state">
            <div className="kh-ops-empty-mark">00</div>
            <h3>{t('emptyTitle')}</h3>
            <p>{tTable('emptyFiltered')}</p>
            <Button type="button" variant="secondary" onClick={clearTreeFilters}>
              {tTable('clearFilters')}
            </Button>
          </div>
        ) : (
          <ul className="m-0 grid list-none p-0">
            {tree.sortedEpics.map((epic) => {
              const id = `epic:${epic.id}`;
              if (!visibility.visible.has(id)) return null;
              const epicStories = tree.storiesByEpic.get(epic.id) ?? [];
              const visibleStories = epicStories.filter((story) =>
                visibility.visible.has(`story:${story.id}`),
              );
              const nodeId = `epic:${epic.id}`;
              return (
                <TreeBranch
                  key={epic.id}
                  open={isOpen(nodeId)}
                  onToggle={() => toggle(nodeId)}
                  depth={0}
                  label={epic.title}
                  sub={epic.humanKey ?? t('kindEpic')}
                  {...rowDim(id)}
                  meta={metaBits({
                    statusLabel: t(`milestoneStatus.${epic.status}`),
                  })}
                  actions={
                    onManageEpic ? (
                      <Button
                        type="button"
                        variant="secondary"
                        className="h-8 min-h-8 px-2 text-xs"
                        onClick={() => onManageEpic(epic.id)}
                      >
                        {t('manage')}
                      </Button>
                    ) : null
                  }
                >
                  {visibleStories.length > 0 ? (
                    visibleStories.map((story) => renderStory(story, 1))
                  ) : !filtering && epicStories.length === 0 ? (
                    <li className="kh-ops-delivery-tree-row list-none text-sm text-ink-muted">
                      {t('treeNoStories')}
                    </li>
                  ) : null}
                </TreeBranch>
              );
            })}

            {visibility.visible.has(DELIVERY_TREE_ORPHAN_STORIES) ? (
              <TreeBranch
                open={isOpen('orphan-stories')}
                onToggle={() => toggle('orphan-stories')}
                depth={0}
                label={t('treeUngroupedStories')}
                sub={t('kindStory')}
                {...rowDim(DELIVERY_TREE_ORPHAN_STORIES)}
              >
                {tree.orphanStories.map((story) => renderStory(story, 1))}
              </TreeBranch>
            ) : null}

            {visibility.visible.has(DELIVERY_TREE_UNGROUPED_TASKS) ? (
              <TreeBranch
                open={isOpen('ungrouped-tasks')}
                onToggle={() => toggle('ungrouped-tasks')}
                depth={0}
                label={t('treeUngroupedTasks')}
                sub={t('kindTask')}
                {...rowDim(DELIVERY_TREE_UNGROUPED_TASKS)}
              >
                {tree.ungroupedTasks.map((task) => renderTask(task, 1))}
              </TreeBranch>
            ) : null}
          </ul>
        )}
      </div>
    </section>
  );
}
