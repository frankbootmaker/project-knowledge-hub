'use client';

import { useCallback, useId, useMemo, useState, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Button, Switch } from './ui';
import { TableFilterControl, type TableFilterField } from './ui/TableFilterControl';
import { collectEnumOptions } from '../lib/data-table';
import { DELIVERY_STATUS_RANK, isTaskDeliveryStatus } from '../lib/delivery-status';
import {
  DELIVERY_TREE_ORPHAN_COLLAPSE_ID,
  DELIVERY_TREE_UNGROUPED_COLLAPSE_ID,
  collapseTreeAll,
  collapseTreeOneLevel,
  deliveryTreeCollapsibleNodes,
  deliveryTreeDepthActions,
  expandTreeAll,
  expandTreeOneLevel,
  isDeliveryTreeNodeOpen,
} from '../lib/delivery-tree-collapse';
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
import {
  deliveryCompletionIndex,
  deliveryLag,
  deliveryPaceClass,
  displayedParentCompletion,
  formatPercentLabel,
  formatStableNumber,
  plannedTargetPercent,
  taskDeliveryCompletion,
} from '../lib/delivery-completion';
import { formatLocaleDate } from '../lib/locale-date';
import { useLocalToday } from '../lib/use-local-today';
import {
  compareMilestonesByDueDate,
  type MilestoneMarker,
} from './MilestoneTimeMarkers';

const DELIVERY_TREE_MILESTONES = 'delivery-tree-milestones';

type TreeEpic = {
  id: string;
  title: string;
  status: string;
  sortOrder: number;
  startDate: string | null;
  endDate: string | null;
  humanKey?: string | null;
};

type TreeStory = {
  id: string;
  epicId: string;
  title: string;
  status: string;
  sortOrder: number;
  startDate: string | null;
  endDate: string | null;
  humanKey?: string | null;
};

type TreeTask = {
  id: string;
  title: string;
  status: string;
  dueDate: string | null;
  userStoryId: string | null;
  epicId: string | null;
  completionPercent?: number | null;
  currentOwner: {
    displayName: string;
    avatarUrl?: string | null;
  } | null;
  humanKey?: string | null;
  itemType?: 'task' | 'bug';
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
  subIsKey = false,
  note,
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
  /** Item keys stay on the mono badge. Kind words use the menu type chip. */
  subIsKey?: boolean;
  note?: ReactNode;
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
            <strong className="kh-ops-primary-cell">{label}</strong>
            {sub ? (
              <span className={subIsKey ? 'kh-ops-key-badge' : 'kh-ops-type-chip'}>{sub}</span>
            ) : null}
            {note ? <span className="kh-ops-menu-type">{note}</span> : null}
            {dimmed && dimHint ? <span className="sr-only">{dimHint}</span> : null}
          </div>
        </div>
        {meta ? (
          <div className="kh-ops-tree-meta">
            {meta}
            <span className="kh-ops-tree-actions">{actions}</span>
          </div>
        ) : null}
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
    itemType: task.itemType === 'bug' ? 'bug' : 'task',
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
  milestones = [],
  sprintsLoaded = true,
  onManageTask,
  onManageEpic,
  onManageStory,
  onManageMilestone,
}: {
  epics: TreeEpic[];
  stories: TreeStory[];
  tasks: TreeTask[];
  milestones?: MilestoneMarker[];
  /** False while sprint titles are still loading, so a sprint URL filter is kept. */
  sprintsLoaded?: boolean;
  onManageTask?: (taskId: string) => void;
  onManageEpic?: (epicId: string) => void;
  onManageStory?: (storyId: string) => void;
  onManageMilestone?: (milestoneId: string) => void;
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
    return isDeliveryTreeNodeOpen(collapsed, id);
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
        id: 'itemType',
        filter: {
          type: 'enum' as const,
          getValue: () => '',
          options: [
            { value: 'task', label: t('kindTask') },
            { value: 'bug', label: t('kindBug') },
          ],
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
    [ownerOptions, sprintOptions, statusOptions, t],
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
    fields.push({
      id: 'itemType',
      header: t('colType'),
      type: 'enum',
      options: [
        { value: 'task', label: t('kindTask') },
        { value: 'bug', label: t('kindBug') },
      ],
    });
    fields.push({ id: 'title', header: t('colTitle'), type: 'text' });
    return fields;
  }, [ownerOptions, sprintOptions, statusOptions, t, table.filters.sprint]);

  const today = useLocalToday();
  const completion = useMemo(
    () =>
      deliveryCompletionIndex(
        tasks.map((task) => ({
          status: task.status,
          completionPercent: task.completionPercent,
          userStoryId: task.userStoryId,
          epicId: task.epicId,
        })),
      ),
    [tasks],
  );

  function paceCells(input: {
    actual: number | null;
    target: number | null;
    status: string;
    comparable: boolean;
    earned?: { done: number; total: number } | null;
  }) {
    const lag = input.comparable
      ? deliveryLag({
          actual: input.actual,
          target: input.target,
          status: input.status,
        })
      : null;
    const earnedTitle = input.earned
      ? t('completeOf', {
          done: formatStableNumber(input.earned.done, locale),
          total: input.earned.total,
        })
      : null;
    const lagTitle = lag
      ? t(lag === 'overdue' ? 'completeOverdue' : 'completeBehind', {
          gap: (input.target ?? 0) - (input.actual ?? 0),
        })
      : null;
    const title = [earnedTitle, lagTitle].filter(Boolean).join(' · ') || undefined;
    const label = input.actual == null ? '—' : formatPercentLabel(input.actual, locale);
    return {
      percent: (
        <span className={deliveryPaceClass(lag)} title={title}>
          {label}
        </span>
      ),
      target: input.target == null ? '—' : formatPercentLabel(input.target, locale),
    };
  }

  function parentPace(
    status: string,
    rollup: { percent: number; done: number; total: number } | null,
  ) {
    const shown = displayedParentCompletion(status, rollup);
    const forced = status === 'done' || status === 'cancelled';
    return {
      actual: shown?.percent ?? null,
      status,
      comparable: true,
      earned: forced ? null : shown,
    };
  }

  const onlyOpen = table.extras.open === '1';
  const filterState = useMemo<DeliveryTreeFilterState>(
    () => ({
      statuses: table.filters.status ?? [],
      owners: table.filters.owner ?? [],
      sprints: sprintsLoaded ? (table.filters.sprint ?? []) : [],
      itemTypes: table.filters.itemType ?? [],
      title: table.textFilters.title ?? '',
      onlyOpen,
    }),
    [
      onlyOpen,
      sprintsLoaded,
      table.filters.owner,
      table.filters.sprint,
      table.filters.itemType,
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
  const collapseNodes = useMemo(
    () =>
      deliveryTreeCollapsibleNodes({
        epics: tree.sortedEpics.map((epic) => ({
          id: epic.id,
          storyIds: (tree.storiesByEpic.get(epic.id) ?? []).map((story) => story.id),
        })),
        stories: [...tree.storiesByEpic.values(), tree.orphanStories].flat(2).map((story) => ({
          id: story.id,
          taskIds: (tree.tasksByStory.get(story.id) ?? []).map((task) => task.id),
        })),
        orphanStoryIds: tree.orphanStories.map((story) => story.id),
        ungroupedTaskIds: tree.ungroupedTasks.map((task) => task.id),
        visible: visibility.visible,
        filtering,
      }),
    [filtering, tree, visibility.visible],
  );
  const depthActions = useMemo(
    () => deliveryTreeDepthActions(collapsed, collapseNodes),
    [collapseNodes, collapsed],
  );

  const expandLevel = useCallback(() => {
    setCollapsed((current) => expandTreeOneLevel(current, collapseNodes));
  }, [collapseNodes]);
  const collapseLevel = useCallback(() => {
    setCollapsed((current) => collapseTreeOneLevel(current, collapseNodes));
  }, [collapseNodes]);
  const expandAll = useCallback(() => {
    setCollapsed((current) => expandTreeAll(current, collapseNodes));
  }, [collapseNodes]);
  const collapseAll = useCallback(() => {
    setCollapsed((current) => collapseTreeAll(current, collapseNodes));
  }, [collapseNodes]);

  function metaBits(input: {
    statusLabel: string;
    percent: ReactNode;
    target: ReactNode;
    owner?: string | null;
    sprint?: string | null;
    hours?: number | null;
    points?: number | null;
  }) {
    return (
      <>
        <span className="kh-ops-tree-cell kh-ops-tree-status" title={input.statusLabel}>
          {input.statusLabel}
        </span>
        <span className="kh-ops-tree-cell kh-ops-num kh-ops-tree-pct">{input.percent}</span>
        <span className="kh-ops-tree-cell kh-ops-num kh-ops-tree-pct">{input.target}</span>
        <span className="kh-ops-tree-cell kh-ops-tree-owner" title={input.owner ?? undefined}>
          {input.owner ?? '—'}
        </span>
        <span className="kh-ops-tree-cell kh-ops-tree-sprint" title={input.sprint ?? undefined}>
          {input.sprint ?? '—'}
        </span>
        <span className="kh-ops-tree-cell kh-ops-num kh-ops-tree-hours">
          {input.hours == null ? '—' : `${input.hours}h`}
        </span>
        <span className="kh-ops-tree-cell kh-ops-num kh-ops-tree-points">
          {input.points == null ? '—' : `${input.points}pt`}
        </span>
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
        sub={
          task.itemType === 'bug'
            ? (task.humanKey ?? t('kindBug'))
            : (task.humanKey ?? t('kindTask'))
        }
        subIsKey={Boolean(task.humanKey)}
        {...rowDim(id)}
        meta={metaBits({
          statusLabel: t(`taskStatus.${task.status}`),
          ...paceCells({
            actual: taskDeliveryCompletion(task.status, task.completionPercent)?.percent ?? null,
            target: null,
            status: task.status,
            comparable: false,
          }),
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
        subIsKey={Boolean(story.humanKey)}
        {...rowDim(id)}
        meta={metaBits({
          statusLabel: t(`milestoneStatus.${story.status}`),
          ...paceCells({
            ...parentPace(story.status, completion.byStoryId.get(story.id) ?? null),
            target: plannedTargetPercent(story.startDate, story.endDate, today),
          }),
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
          <li
            className="kh-ops-delivery-tree-row kh-ops-tree-note list-none"
            style={{ ['--level' as string]: depth + 1 }}
          >
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

  const orderedMilestones = useMemo(
    () => [...milestones].sort(compareMilestonesByDueDate),
    [milestones],
  );
  const filteredEmpty = filtering && visibility.visible.size === 0;

  return (
    <section className="kh-ops-panel overflow-x-auto">
      <div className="kh-ops-delivery-tree">
        <div className="kh-ops-delivery-tree-head">
          <div className="kh-ops-delivery-tree-label">
            <span>{t('treeBreakdown')}</span>
            <div className="kh-ops-tree-depth" role="group" aria-label={t('treeDepthControls')}>
              <DepthButton
                label={t('treeExpandLevel')}
                disabled={!depthActions.canExpandLevel}
                onClick={expandLevel}
              >
                <ExpandLevelIcon />
              </DepthButton>
              <DepthButton
                label={t('treeCollapseLevel')}
                disabled={!depthActions.canCollapseLevel}
                onClick={collapseLevel}
              >
                <CollapseLevelIcon />
              </DepthButton>
              <DepthButton
                label={t('treeExpandAll')}
                disabled={!depthActions.canExpandAll}
                onClick={expandAll}
              >
                <ExpandAllIcon />
              </DepthButton>
              <DepthButton
                label={t('treeCollapseAll')}
                disabled={!depthActions.canCollapseAll}
                onClick={collapseAll}
              >
                <CollapseAllIcon />
              </DepthButton>
            </div>
          </div>
          <div className="kh-ops-tree-meta" aria-label={t('treeMetaHead')}>
            <span title={t('colStatus')}>{t('colStatus')}</span>
            <span title={t('colCompleteLabel')}>{t('colComplete')}</span>
            <span title={t('colTargetLabel')}>{t('colTarget')}</span>
            <span title={t('colOwner')}>{t('colOwner')}</span>
            <span title={t('colSprint')}>{t('colSprint')}</span>
            <span title={t('colForecast')}>{t('colForecast')}</span>
            <span title={t('colPoints')}>{t('colPoints')}</span>
            <span className="kh-ops-tree-actions">
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
            </span>
          </div>
        </div>
        {filteredEmpty && orderedMilestones.length === 0 ? (
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
            {orderedMilestones.length > 0 ? (
              <TreeBranch
                open={isOpen(DELIVERY_TREE_MILESTONES)}
                onToggle={() => toggle(DELIVERY_TREE_MILESTONES)}
                depth={0}
                label={t('milestoneTimeOrder')}
                sub={t('kindMilestone')}
              >
                {orderedMilestones.map((milestone) => (
                  <TreeBranch
                    key={milestone.id}
                    open={false}
                    depth={1}
                    label={milestone.title}
                    sub={milestone.humanKey ?? undefined}
                    subIsKey={Boolean(milestone.humanKey)}
                    note={
                      milestone.targetDate
                        ? formatLocaleDate(milestone.targetDate, locale)
                        : milestone.humanKey
                          ? undefined
                          : t('milestoneNoDue')
                    }
                    meta={metaBits({
                      statusLabel: t(`milestoneStatus.${milestone.status}`),
                      percent:
                        milestone.completionPercent == null
                          ? '—'
                          : formatPercentLabel(milestone.completionPercent, locale),
                      target: '—',
                      owner: null,
                    })}
                    actions={
                      onManageMilestone ? (
                        <Button
                          type="button"
                          variant="secondary"
                          className="h-8 min-h-8 px-2 text-xs"
                          onClick={() => onManageMilestone(milestone.id)}
                        >
                          {t('manage')}
                        </Button>
                      ) : null
                    }
                  />
                ))}
              </TreeBranch>
            ) : null}
            {filteredEmpty ? null : tree.sortedEpics.map((epic) => {
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
                  subIsKey={Boolean(epic.humanKey)}
                  {...rowDim(id)}
                  meta={metaBits({
                    statusLabel: t(`milestoneStatus.${epic.status}`),
                    ...paceCells({
                      ...parentPace(epic.status, completion.byEpicId.get(epic.id) ?? null),
                      target: plannedTargetPercent(epic.startDate, epic.endDate, today),
                    }),
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
                    <li
                      className="kh-ops-delivery-tree-row kh-ops-tree-note list-none"
                      style={{ ['--level' as string]: 1 }}
                    >
                      {t('treeNoStories')}
                    </li>
                  ) : null}
                </TreeBranch>
              );
            })}

            {visibility.visible.has(DELIVERY_TREE_ORPHAN_STORIES) ? (
              <TreeBranch
                open={isOpen(DELIVERY_TREE_ORPHAN_COLLAPSE_ID)}
                onToggle={() => toggle(DELIVERY_TREE_ORPHAN_COLLAPSE_ID)}
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
                open={isOpen(DELIVERY_TREE_UNGROUPED_COLLAPSE_ID)}
                onToggle={() => toggle(DELIVERY_TREE_UNGROUPED_COLLAPSE_ID)}
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

function DepthButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <span className="kh-ops-tree-tip">
      <Button
        type="button"
        variant="secondary"
        className="kh-ops-tree-depth-btn"
        disabled={disabled}
        aria-label={label}
        onClick={onClick}
      >
        {children}
      </Button>
      <span className="kh-ops-tree-tip-label" role="tooltip" aria-hidden="true">
        {label}
      </span>
    </span>
  );
}

function ExpandLevelIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="size-4 shrink-0" fill="none">
      <path
        d="M6 9l6 6 6-6"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CollapseLevelIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="size-4 shrink-0" fill="none">
      <path
        d="M6 15l6-6 6 6"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ExpandAllIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="size-4 shrink-0" fill="none">
      <path
        d="M6 7l6 5 6-5M6 13l6 5 6-5"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CollapseAllIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="size-4 shrink-0" fill="none">
      <path
        d="M6 11l6-5 6 5M6 17l6-5 6 5"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
