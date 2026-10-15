'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  coerceProjectCalendar,
  type ProjectWorkingCalendar,
} from '@project-knowledge-hub/domain';
import { DeliveryItemIdButton } from './DeliveryItemIdButton';
import { Button, ErrorText, Input, Switch } from './ui';
import { TableFilterControl, type TableFilterField } from './ui/TableFilterControl';
import {
  deliveryCompletionIndex,
  displayedParentCompletion,
  formatPercentLabel,
  formatStableNumber,
  taskDeliveryCompletion,
} from '../lib/delivery-completion';
import {
  GANTT_COLUMNS,
  GANTT_COLUMN_VIEWS,
  GANTT_COLUMN_WIDTH,
  GANTT_HEADER_HEIGHT,
  GANTT_PX_PER_DAY,
  GANTT_ROW_HEIGHT,
  GANTT_ZOOM_LEVELS,
  buildGanttRows,
  ganttBarGeometry,
  ganttBarShape,
  ganttChartWidth,
  ganttCollapseNodes,
  ganttColumnOffsets,
  ganttDependencyArrows,
  ganttDurationDetail,
  ganttGridTemplate,
  ganttGridWidth,
  ganttNonWorkingBands,
  ganttScaleTicks,
  ganttTimelineRange,
  ganttTodayX,
  ganttWbsById,
  predecessorLabels,
  visibleGanttRows,
  type GanttColumnId,
  type GanttColumnView,
  type GanttDependency,
  type GanttPredecessorMode,
  type GanttRow,
  type GanttZoom,
} from '../lib/delivery-gantt';
import {
  collapseTreeAll,
  collapseTreeOneLevel,
  deliveryTreeDepthActions,
  expandTreeAll,
  expandTreeOneLevel,
  isDeliveryTreeNodeOpen,
  openCollapsedForDeliveryTreeSearch,
  type DeliveryTreeCollapsed,
} from '../lib/delivery-tree-collapse';
import {
  deliveryTreeFiltersActive,
  filterDeliveryTree,
  type DeliveryTreeFilterNode,
  type DeliveryTreeFilterState,
} from '../lib/delivery-tree-filter';
import { collectEnumOptions } from '../lib/data-table';
import { DELIVERY_STATUS_RANK, isTaskDeliveryStatus } from '../lib/delivery-status';
import { formatLocaleDate } from '../lib/locale-date';
import { useLocalToday } from '../lib/use-local-today';
import { useSyncEnumFilters, useTableState } from '../lib/use-table-state';

type GanttEpic = {
  id: string;
  title: string;
  status: string;
  sortOrder: number;
  startDate: string | null;
  endDate: string | null;
  humanKey?: string | null;
};

type GanttStory = {
  id: string;
  epicId: string;
  title: string;
  status: string;
  sortOrder: number;
  startDate: string | null;
  endDate: string | null;
  humanKey?: string | null;
};

type GanttTask = {
  id: string;
  title: string;
  status: string;
  dueDate: string | null;
  startDate?: string | null;
  userStoryId: string | null;
  epicId?: string | null;
  completionPercent?: number | null;
  currentOwner?: { displayName: string } | null;
  humanKey?: string | null;
  itemType?: 'task' | 'bug';
  sprintLabel?: string | null;
};

type GanttMilestone = {
  id: string;
  title: string;
  status: string;
  startDate: string | null;
  targetDate: string | null;
  humanKey?: string | null;
  completionPercent?: number | null;
};

type ApiDependency = {
  linkType: string;
  lagDays: number;
  predecessor: { entityType: string; id: string; humanKey: string | null };
  successor: { entityType: string; id: string; humanKey: string | null };
};

export function ProjectDeliveryGantt({
  projectId,
  epics,
  stories,
  tasks,
  milestones,
  workingCalendar,
  sprintsLoaded = true,
  onManageTask,
  onManageEpic,
  onManageStory,
  onManageMilestone,
}: {
  projectId: string;
  epics: GanttEpic[];
  stories: GanttStory[];
  tasks: GanttTask[];
  milestones: GanttMilestone[];
  workingCalendar?: {
    hoursPerWorkday?: number | string | null;
    workdaysPerWeek?: number | null;
    nonWorkingDays?: readonly string[] | null;
  };
  /** False while sprint titles are still loading, so a sprint URL filter is kept. */
  sprintsLoaded?: boolean;
  onManageTask?: (taskId: string) => void;
  onManageEpic?: (epicId: string) => void;
  onManageStory?: (storyId: string) => void;
  onManageMilestone?: (milestoneId: string) => void;
}) {
  const t = useTranslations('delivery');
  const locale = useLocale();
  const today = useLocalToday();
  const markerId = `gantt-arrow-${useId().replace(/:/g, '')}`;
  const [columnView, setColumnView] = useState<GanttColumnView>('default');
  const [freezeTable, setFreezeTable] = useState(false);
  const [predMode, setPredMode] = useState<GanttPredecessorMode>('key');
  const [zoom, setZoom] = useState<GanttZoom>('week');
  const [collapsed, setCollapsed] = useState<DeliveryTreeCollapsed>({});
  const collapsedBeforeSearchRef = useRef<DeliveryTreeCollapsed | null>(null);
  const onlyOpenId = useId();
  const tTable = useTranslations('table');
  const table = useTableState({
    namespace: 'gantt',
    defaultSortKey: null,
  });
  const clearGanttFilters = useCallback(() => {
    table.clearFilters();
    table.setExtra('open', '');
  }, [table]);
  const [links, setLinks] = useState<GanttDependency[]>([]);
  const [linkError, setLinkError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLinkError(null);
    void (async () => {
      try {
        const response = await fetch(
          `/api/v1/projects/${projectId}/delivery-dependencies`,
        );
        if (!response.ok) throw new Error(t('ganttDependenciesFailed'));
        const payload = (await response.json()) as { dependencies?: ApiDependency[] };
        if (cancelled) return;
        setLinks((payload.dependencies ?? []).map((link) => ({
          predecessorType: link.predecessor.entityType,
          predecessorId: link.predecessor.id,
          predecessorKey: link.predecessor.humanKey,
          successorType: link.successor.entityType,
          successorId: link.successor.id,
          linkType: link.linkType,
          lagDays: link.lagDays,
        })));
      } catch (err) {
        if (!cancelled) {
          setLinkError(err instanceof Error ? err.message : t('ganttDependenciesFailed'));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, t]);

  const calendar = useMemo(
    () => coerceProjectCalendar(workingCalendar ?? {}),
    [workingCalendar],
  );
  const completion = useMemo(
    () => deliveryCompletionIndex(tasks.map((task) => ({
      status: task.status,
      completionPercent: task.completionPercent,
      userStoryId: task.userStoryId,
      epicId: task.epicId ?? null,
    }))),
    [tasks],
  );
  const rowsWithEpicPercent = useMemo(() => buildGanttRows({
    epics: epics.map((epic) => ({
      id: epic.id,
      title: epic.title,
      status: epic.status,
      sortOrder: epic.sortOrder,
      startDate: epic.startDate,
      endDate: epic.endDate,
      humanKey: epic.humanKey,
      percent: displayedParentCompletion(
        epic.status,
        completion.byEpicId.get(epic.id) ?? null,
      )?.percent ?? null,
    })),
    stories: stories.map((story) => ({
      id: story.id,
      epicId: story.epicId,
      title: story.title,
      status: story.status,
      sortOrder: story.sortOrder,
      startDate: story.startDate,
      endDate: story.endDate,
      humanKey: story.humanKey,
      percent: displayedParentCompletion(
        story.status,
        completion.byStoryId.get(story.id) ?? null,
      )?.percent ?? null,
    })),
    tasks: tasks.map((task) => ({
      id: task.id,
      title: task.title,
      status: task.status,
      startDate: task.startDate ?? null,
      dueDate: task.dueDate,
      userStoryId: task.userStoryId,
      humanKey: task.humanKey,
      itemType: task.itemType,
      owner: task.currentOwner?.displayName ?? null,
      percent: taskDeliveryCompletion(task.status, task.completionPercent).percent,
    })),
    milestones: milestones.map((milestone) => ({
      id: milestone.id,
      title: milestone.title,
      status: milestone.status,
      startDate: milestone.startDate,
      targetDate: milestone.targetDate,
      humanKey: milestone.humanKey,
      percent: milestone.completionPercent ?? null,
    })),
  }), [completion, epics, milestones, stories, tasks]);

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
  const sprintByTaskId = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const task of tasks) map.set(task.id, task.sprintLabel ?? null);
    return map;
  }, [tasks]);
  const filterNodes = useMemo(
    () => rowsWithEpicPercent.map((row) => ganttFilterNode(row, sprintByTaskId)),
    [rowsWithEpicPercent, sprintByTaskId],
  );
  const filterState = useMemo<DeliveryTreeFilterState>(() => ({
    statuses: table.filters.status ?? [],
    owners: table.filters.owner ?? [],
    sprints: sprintsLoaded ? (table.filters.sprint ?? []) : [],
    itemTypes: table.filters.itemType ?? [],
    title: table.textFilters.title ?? '',
    search: table.query,
    onlyOpen: table.extras.open === '1',
  }), [
    sprintsLoaded,
    table.extras.open,
    table.filters.itemType,
    table.filters.owner,
    table.filters.sprint,
    table.filters.status,
    table.query,
    table.textFilters.title,
  ]);
  const visibility = useMemo(
    () => filterDeliveryTree(filterNodes, filterState),
    [filterNodes, filterState],
  );
  const filtering = deliveryTreeFiltersActive(filterState);
  const searching = table.query.trim().length > 0;
  const filteredRows = useMemo(
    () => (
      filtering
        ? rowsWithEpicPercent.filter((row) => visibility.visible.has(row.id))
        : rowsWithEpicPercent
    ),
    [filtering, rowsWithEpicPercent, visibility.visible],
  );

  useEffect(() => {
    if (!searching) {
      if (collapsedBeforeSearchRef.current !== null) {
        setCollapsed(collapsedBeforeSearchRef.current);
        collapsedBeforeSearchRef.current = null;
      }
      return;
    }
    const forceOpen = ganttSearchOpenIds(rowsWithEpicPercent, visibility.visible);
    setCollapsed((current) => {
      if (collapsedBeforeSearchRef.current === null) {
        collapsedBeforeSearchRef.current = { ...current };
      }
      return openCollapsedForDeliveryTreeSearch(current, forceOpen);
    });
  }, [rowsWithEpicPercent, searching, visibility.visible]);

  const visible = useMemo(
    () => visibleGanttRows(filteredRows, collapsed),
    [collapsed, filteredRows],
  );
  const collapseNodes = useMemo(
    () => ganttCollapseNodes(filteredRows),
    [filteredRows],
  );
  const depthActions = useMemo(
    () => deliveryTreeDepthActions(collapsed, collapseNodes),
    [collapseNodes, collapsed],
  );
  const wbsById = useMemo(() => ganttWbsById(rowsWithEpicPercent), [rowsWithEpicPercent]);
  const keyById = useMemo(
    () => new Map(rowsWithEpicPercent.map((row) => [row.id, row.humanKey])),
    [rowsWithEpicPercent],
  );
  const pxPerDay = GANTT_PX_PER_DAY[zoom];
  const range = useMemo(() => ganttTimelineRange(
    filteredRows.flatMap((row) => [row.start, row.end]),
    today,
    zoom,
  ), [filteredRows, today, zoom]);
  const chartWidth = ganttChartWidth(range, pxPerDay);
  const columns = GANTT_COLUMNS[columnView];
  const columnLeft = useMemo(
    () => (freezeTable ? ganttColumnOffsets(columnView) : null),
    [columnView, freezeTable],
  );
  const gridWidth = ganttGridWidth(columnView);
  const ticks = useMemo(
    () => ganttScaleTicks(range, zoom, pxPerDay, calendar),
    [calendar, pxPerDay, range, zoom],
  );
  const bands = useMemo(
    () => ganttNonWorkingBands(range, calendar, pxPerDay),
    [calendar, pxPerDay, range],
  );
  const todayX = ganttTodayX(today, range, pxPerDay);
  const arrows = useMemo(() => ganttDependencyArrows({
    rows: visible,
    links,
    rangeStart: range.start,
    pxPerDay,
    rowHeight: GANTT_ROW_HEIGHT,
  }), [links, pxPerDay, range.start, visible]);
  const bodyHeight = visible.length * GANTT_ROW_HEIGHT;

  function openRow(row: GanttRow) {
    if (!row.entityId) return;
    if (row.kind === 'task' || row.kind === 'bug') onManageTask?.(row.entityId);
    else if (row.kind === 'epic') onManageEpic?.(row.entityId);
    else if (row.kind === 'story') onManageStory?.(row.entityId);
    else if (row.kind === 'milestone') onManageMilestone?.(row.entityId);
  }

  function statusLabel(row: GanttRow): string {
    if (!row.status) return '—';
    if (row.kind === 'task' || row.kind === 'bug') return t(`taskStatus.${row.status}`);
    return t(`milestoneStatus.${row.status}`);
  }

  function tickText(date: string): string {
    const parsed = new Date(`${date}T00:00:00Z`);
    if (zoom === 'month') {
      return new Intl.DateTimeFormat(locale, {
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(parsed);
    }
    if (zoom === 'week') return formatLocaleDate(date, locale);
    if (parsed.getUTCDate() === 1) {
      return new Intl.DateTimeFormat(locale, {
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
      }).format(parsed);
    }
    return String(parsed.getUTCDate());
  }

  if (rowsWithEpicPercent.length === 0) {
    return (
      <section className="kh-ops-panel" data-delivery-gantt="empty">
        <div className="kh-ops-empty-state">
          <div className="kh-ops-empty-mark">00</div>
          <h3>{t('emptyTitle')}</h3>
          <p>{t('ganttEmpty')}</p>
        </div>
      </section>
    );
  }

  const filteredEmpty = filtering && visibility.visible.size === 0;

  const sheetStyle = {
    ['--gantt-cols' as string]: ganttGridTemplate(columnView, chartWidth),
    ['--gantt-grid' as string]: `${gridWidth}px`,
    ['--gantt-wbs' as string]: `${GANTT_COLUMN_WIDTH.wbs}px`,
    ['--gantt-head' as string]: `${GANTT_HEADER_HEIGHT}px`,
    ['--gantt-row' as string]: `${GANTT_ROW_HEIGHT}px`,
  };

  return (
    <section
      className="kh-ops-gantt"
      data-delivery-gantt={columnView}
      data-freeze={freezeTable ? 'table' : undefined}
    >
      <div className="kh-ops-toolbar mb-0 border-0 border-b border-line">
        <label className="flex min-w-[220px] flex-1 items-center gap-2">
          <span className="sr-only">{t('searchPlaceholder')}</span>
          <Input
            type="search"
            value={table.query}
            onChange={(event) => table.setQuery(event.target.value)}
            placeholder={t('searchPlaceholder')}
            className="h-10 min-h-10 py-1.5 text-xs"
          />
        </label>
        <TableFilterControl
          fields={filterFields}
          enumFilters={table.filters}
          textFilters={table.textFilters}
          onEnumFilter={table.setEnumFilter}
          onTextFilter={table.setTextFilter}
          onClearFilters={clearGanttFilters}
          filtersActive={filtering}
          insertAfter={{
            id: 'status',
            content: (
              <div className="kh-ops-table-filter-group">
                <Switch
                  id={onlyOpenId}
                  checked={table.extras.open === '1'}
                  label={t('treeOnlyOpen')}
                  onCheckedChange={(checked) => table.setExtra('open', checked ? '1' : '')}
                />
              </div>
            ),
          }}
        />
        {filtering ? (
          <Button
            type="button"
            variant="secondary"
            className="kh-ops-tree-filter-clear h-8 min-h-8 px-2 text-xs"
            onClick={clearGanttFilters}
          >
            {tTable('clearFilters')}
          </Button>
        ) : null}
      </div>
      <div className="kh-ops-gantt-tools">
        <div role="group" aria-label={t('ganttColumns')}>
          {GANTT_COLUMN_VIEWS.map((view) => (
            <Button
              key={view}
              type="button"
              variant="secondary"
              className="kh-ops-gantt-choice"
              aria-pressed={columnView === view}
              onClick={() => setColumnView(view)}
            >
              {t(`ganttView.${view}`)}
            </Button>
          ))}
        </div>
        <div role="group" aria-label={t('ganttPredMode')}>
          <Button
            type="button"
            variant="secondary"
            className="kh-ops-gantt-choice"
            aria-pressed={predMode === 'key'}
            onClick={() => setPredMode('key')}
          >
            {t('ganttPredKeys')}
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="kh-ops-gantt-choice"
            aria-pressed={predMode === 'wbs'}
            onClick={() => setPredMode('wbs')}
          >
            {t('ganttPredWbs')}
          </Button>
        </div>
        <div role="group" aria-label={t('ganttZoom')}>
          {GANTT_ZOOM_LEVELS.map((level) => (
            <Button
              key={level}
              type="button"
              variant="secondary"
              className="kh-ops-gantt-choice"
              aria-pressed={zoom === level}
              onClick={() => setZoom(level)}
            >
              {level === 'day'
                ? t('ganttZoomDay')
                : level === 'week'
                  ? t('ganttZoomWeek')
                  : t('ganttZoomMonth')}
            </Button>
          ))}
        </div>
        <label className="inline-flex items-center gap-2">
          <input
            type="checkbox"
            checked={freezeTable}
            onChange={(event) => setFreezeTable(event.target.checked)}
          />
          <span>{t('ganttFreezeTable')}</span>
        </label>
        <div className="kh-ops-tree-depth" role="group" aria-label={t('treeDepthControls')}>
          <DepthButton
            label={t('treeExpandLevel')}
            disabled={!depthActions.canExpandLevel}
            onClick={() => setCollapsed((current) => expandTreeOneLevel(current, collapseNodes))}
          >
            <ExpandLevelIcon />
          </DepthButton>
          <DepthButton
            label={t('treeCollapseLevel')}
            disabled={!depthActions.canCollapseLevel}
            onClick={() => setCollapsed((current) => collapseTreeOneLevel(current, collapseNodes))}
          >
            <CollapseLevelIcon />
          </DepthButton>
          <DepthButton
            label={t('treeExpandAll')}
            disabled={!depthActions.canExpandAll}
            onClick={() => setCollapsed((current) => expandTreeAll(current, collapseNodes))}
          >
            <ExpandAllIcon />
          </DepthButton>
          <DepthButton
            label={t('treeCollapseAll')}
            disabled={!depthActions.canCollapseAll}
            onClick={() => setCollapsed((current) => collapseTreeAll(current, collapseNodes))}
          >
            <CollapseAllIcon />
          </DepthButton>
        </div>
      </div>
      {linkError ? (
        <div className="mb-2">
          <ErrorText>{linkError}</ErrorText>
        </div>
      ) : null}
      {filteredEmpty ? (
        <div className="kh-ops-empty-state">
          <div className="kh-ops-empty-mark">00</div>
          <h3>{t('emptyTitle')}</h3>
          <p>
            {searching || table.textFilters.title?.trim()
              ? t('emptyFiltered')
              : tTable('emptyFiltered')}
          </p>
          <Button type="button" variant="secondary" onClick={clearGanttFilters}>
            {tTable('clearFilters')}
          </Button>
        </div>
      ) : (
      <div className="kh-ops-gantt-scroll">
        <div
          className="kh-ops-gantt-sheet"
          role="table"
          aria-label={t('viewMode.gantt')}
          aria-readonly="true"
          style={sheetStyle}
        >
          <div className="kh-ops-gantt-head" role="row">
            {columns.map((column) => {
              const frozen = frozenCell(column, columns, columnLeft);
              return (
                <div
                  key={column}
                  role="columnheader"
                  className={frozen.className}
                  style={frozen.style}
                  title={headerTitle(column, t)}
                >
                  {headerLabel(column, t)}
                </div>
              );
            })}
            <div role="columnheader" className="kh-ops-gantt-scale" aria-label={t('ganttScale')}>
              {ticks.map((tick) => (
                <div
                  key={tick.date}
                  className="kh-ops-gantt-tick"
                  data-off={tick.nonWorking ? 'true' : undefined}
                  style={{ left: tick.x, width: tick.width }}
                  title={formatLocaleDate(tick.date, locale)}
                >
                  {tickText(tick.date)}
                </div>
              ))}
              {todayX != null ? (
                <span
                  className="kh-ops-gantt-today-tick"
                  style={{ left: todayX }}
                  title={t('ganttToday')}
                />
              ) : null}
            </div>
          </div>
          <div className="kh-ops-gantt-body">
            <svg
              className="kh-ops-gantt-shade"
              width={chartWidth}
              height={bodyHeight}
              aria-hidden="true"
            >
              {bands.map((band) => (
                <rect key={band.x} x={band.x} y={0} width={band.width} height={bodyHeight} />
              ))}
            </svg>
            {visible.map((row) => (
              <GanttGridRow
                key={row.id}
                row={row}
                columns={columns}
                open={isDeliveryTreeNodeOpen(collapsed, row.id)}
                onToggle={() => setCollapsed((current) => ({
                  ...current,
                  [row.id]: !current[row.id],
                }))}
                label={row.labelKey ? t(row.labelKey) : row.title}
                statusLabel={statusLabel(row)}
                predecessors={predecessorLabels({
                  successorId: row.id,
                  links,
                  mode: predMode,
                  wbsById,
                  keyById,
                })}
                calendar={calendar}
                locale={locale}
                rangeStart={range.start}
                pxPerDay={pxPerDay}
                onOpen={() => openRow(row)}
                canOpen={canOpen(row, {
                  onManageTask,
                  onManageEpic,
                  onManageStory,
                  onManageMilestone,
                })}
                columnLeft={columnLeft}
                dimmed={filtering && visibility.dimmed.has(row.id)}
                dimHint={t('treeFilterDimmed')}
                t={t}
              />
            ))}
            <svg
              className="kh-ops-gantt-arrows"
              width={chartWidth}
              height={bodyHeight}
              aria-hidden="true"
            >
              <defs>
                <marker
                  id={markerId}
                  markerWidth="8"
                  markerHeight="8"
                  refX="7"
                  refY="4"
                  orient="auto"
                >
                  <path d="M0 0 L8 4 L0 8 Z" />
                </marker>
              </defs>
              {todayX != null ? (
                <line
                  className="kh-ops-gantt-today"
                  x1={todayX}
                  x2={todayX}
                  y1={0}
                  y2={bodyHeight}
                />
              ) : null}
              {arrows.map((arrow) => (
                <path key={arrow.key} d={arrow.path} markerEnd={`url(#${markerId})`} />
              ))}
            </svg>
          </div>
        </div>
      </div>
      )}
    </section>
  );
}

function ganttFilterKind(kind: GanttRow['kind']): DeliveryTreeFilterNode['kind'] {
  if (kind === 'bug') return 'task';
  return kind;
}

function ganttFilterNode(
  row: GanttRow,
  sprintByTaskId: ReadonlyMap<string, string | null>,
): DeliveryTreeFilterNode {
  const task = row.kind === 'task' || row.kind === 'bug';
  return {
    id: row.id,
    kind: ganttFilterKind(row.kind),
    parentId: row.parentId,
    title: row.title,
    humanKey: row.humanKey,
    status: row.status,
    owner: task ? row.owner : null,
    sprint: task && row.entityId ? (sprintByTaskId.get(row.entityId) ?? null) : null,
    itemType: row.kind === 'bug' ? 'bug' : row.kind === 'task' ? 'task' : undefined,
  };
}

/** Parent row ids that must stay open so a search match remains on screen. */
function ganttSearchOpenIds(
  rows: readonly GanttRow[],
  visible: ReadonlySet<string>,
): string[] {
  const parentById = new Map(rows.map((row) => [row.id, row.parentId]));
  const open = new Set<string>();
  for (const id of visible) {
    let parentId = parentById.get(id) ?? null;
    const seen = new Set<string>();
    while (parentId && !seen.has(parentId)) {
      seen.add(parentId);
      open.add(parentId);
      parentId = parentById.get(parentId) ?? null;
    }
  }
  return [...open];
}

function headerLabel(
  column: GanttColumnId,
  t: ReturnType<typeof useTranslations<'delivery'>>,
): string {
  if (column === 'wbs') return t('ganttColWbs');
  if (column === 'title') return t('ganttColTitle');
  if (column === 'status') return t('colStatus');
  if (column === 'percent') return t('ganttColPercent');
  if (column === 'duration') return t('ganttColDuration');
  if (column === 'predecessors') return t('ganttColPredecessors');
  if (column === 'owner') return t('colOwner');
  if (column === 'start') return t('ganttColStart');
  return t('ganttColDue');
}

function headerTitle(
  column: GanttColumnId,
  t: ReturnType<typeof useTranslations<'delivery'>>,
): string | undefined {
  if (column === 'percent') return t('colCompleteLabel');
  return undefined;
}

function cellClass(column: GanttColumnId): string {
  if (column === 'wbs') return 'kh-ops-gantt-cell kh-ops-gantt-wbs';
  if (column === 'title') return 'kh-ops-gantt-cell kh-ops-gantt-title';
  return 'kh-ops-gantt-cell';
}

function frozenCell(
  column: GanttColumnId,
  columns: readonly GanttColumnId[],
  columnLeft: ReadonlyMap<GanttColumnId, number> | null,
): { className: string; style?: { left: number } } {
  if (!columnLeft) return { className: cellClass(column) };
  const edge = column === columns[columns.length - 1];
  return {
    className: `${cellClass(column)}${edge ? ' kh-ops-gantt-freeze-edge' : ''}`,
    style: { left: columnLeft.get(column) ?? 0 },
  };
}

function canOpen(
  row: GanttRow,
  handlers: {
    onManageTask?: (taskId: string) => void;
    onManageEpic?: (epicId: string) => void;
    onManageStory?: (storyId: string) => void;
    onManageMilestone?: (milestoneId: string) => void;
  },
): boolean {
  if (!row.entityId) return false;
  if (row.kind === 'task' || row.kind === 'bug') return Boolean(handlers.onManageTask);
  if (row.kind === 'epic') return Boolean(handlers.onManageEpic);
  if (row.kind === 'story') return Boolean(handlers.onManageStory);
  if (row.kind === 'milestone') return Boolean(handlers.onManageMilestone);
  return false;
}

function GanttGridRow({
  row,
  columns,
  open,
  onToggle,
  label,
  statusLabel,
  predecessors,
  calendar,
  locale,
  rangeStart,
  pxPerDay,
  onOpen,
  canOpen: allowOpen,
  columnLeft = null,
  dimmed = false,
  dimHint,
  t,
}: {
  row: GanttRow;
  columns: readonly GanttColumnId[];
  open: boolean;
  onToggle: () => void;
  label: string;
  statusLabel: string;
  predecessors: string;
  calendar: ProjectWorkingCalendar;
  locale: string;
  rangeStart: string;
  pxPerDay: number;
  onOpen: () => void;
  canOpen: boolean;
  columnLeft?: ReadonlyMap<GanttColumnId, number> | null;
  dimmed?: boolean;
  dimHint?: string;
  t: ReturnType<typeof useTranslations<'delivery'>>;
}) {
  const shape = ganttBarShape(row.kind);
  const layout = shape
    ? ganttBarGeometry({
      shape,
      start: row.start,
      end: row.end,
      percent: row.percent,
      rangeStart,
      pxPerDay,
    })
    : null;
  const duration = ganttDurationDetail(row.start, row.end, calendar);
  const barTitle = layout?.kind === 'milestone'
    ? t('ganttMilestoneLabel', { title: label, date: formatLocaleDate(layout.date, locale) })
    : layout?.kind === 'bar'
      ? t('ganttBarLabel', {
        title: label,
        start: formatLocaleDate(layout.start, locale),
        end: formatLocaleDate(layout.end, locale),
      })
      : undefined;

  function cell(column: GanttColumnId): ReactNode {
    if (column === 'wbs') return row.wbs;
    if (column === 'title') {
      return (
        <div className="kh-ops-gantt-title-inner" style={{ ['--level' as string]: row.depth }}>
          {row.hasChildren ? (
            <button
              type="button"
              className="kh-ops-tree-toggle"
              aria-expanded={open}
              aria-label={label}
              onClick={onToggle}
            >
              {open ? '⌄' : '›'}
            </button>
          ) : (
            <span className="kh-ops-tree-spacer" aria-hidden />
          )}
          {allowOpen ? (
            <button type="button" className="kh-ops-gantt-title-btn" onClick={onOpen}>
              {label}
            </button>
          ) : (
            <span className="kh-ops-gantt-title-text">{label}</span>
          )}
          {row.humanKey && allowOpen ? (
            <DeliveryItemIdButton variant="key" onClick={onOpen}>
              {row.humanKey}
            </DeliveryItemIdButton>
          ) : null}
        </div>
      );
    }
    if (row.kind === 'group') return '—';
    if (column === 'status') return statusLabel;
    if (column === 'percent') {
      if (row.percent == null) return '—';
      const width = `${Math.min(100, Math.max(0, row.percent))}%`;
      return (
        <span className="kh-ops-gantt-pct">
          <span>{formatPercentLabel(row.percent, locale)}</span>
          <span className="kh-ops-gantt-pct-track" aria-hidden="true">
            <span style={{ width }} />
          </span>
        </span>
      );
    }
    if (column === 'duration') {
      if (!duration) return '—';
      return (
        <span
          title={t('ganttEffortTitle', {
            days: formatStableNumber(duration.workingDays, locale),
            hours: formatStableNumber(duration.effortHours, locale),
          })}
        >
          {t('ganttDurationValue', {
            days: formatStableNumber(duration.workingDays, locale),
          })}
        </span>
      );
    }
    if (column === 'predecessors') return predecessors || '—';
    if (column === 'owner') return row.owner || '—';
    if (column === 'start') return row.start ? formatLocaleDate(row.start, locale) : '—';
    return row.end ? formatLocaleDate(row.end, locale) : '—';
  }

  return (
    <div
      className="kh-ops-gantt-row"
      role="row"
      data-kind={row.kind}
      data-filter-dimmed={dimmed ? 'true' : undefined}
      title={dimmed ? dimHint : undefined}
    >
      {columns.map((column) => {
        const frozen = frozenCell(column, columns, columnLeft);
        return (
          <div
            key={column}
            role="gridcell"
            className={frozen.className}
            style={frozen.style}
            title={column === 'predecessors' && predecessors ? predecessors : undefined}
          >
            {cell(column)}
          </div>
        );
      })}
      <div role="gridcell" className="kh-ops-gantt-track">
        {layout?.kind === 'bar' ? (
          <span className="kh-ops-gantt-bar" data-kind={row.kind} style={{ left: layout.leftPx, width: layout.widthPx }} title={barTitle}>
            <span className="kh-ops-gantt-bar-done" style={{ width: layout.completePx }} />
          </span>
        ) : null}
        {layout?.kind === 'milestone' ? (
          <span className="kh-ops-gantt-diamond" style={{ left: layout.centerPx }} title={barTitle} />
        ) : null}
        {!layout && row.kind !== 'group' ? (
          <span className="sr-only">{t('ganttUndated')}</span>
        ) : null}
      </div>
    </div>
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
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CollapseLevelIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="size-4 shrink-0" fill="none">
      <path d="M6 15l6-6 6 6" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ExpandAllIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="size-4 shrink-0" fill="none">
      <path d="M6 7l6 5 6-5M6 13l6 5 6-5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CollapseAllIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="size-4 shrink-0" fill="none">
      <path d="M6 11l6-5 6 5M6 17l6-5 6 5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
