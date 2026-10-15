/**
 * Read-only delivery Gantt math (PRO-T-62).
 *
 * Outline numbers follow the work-breakdown tree: milestones, then epics,
 * stories, and tasks or bugs. Parent start and end use the child rollup
 * from PRO-T-73. Duration and non-working days use the project calendar.
 * Predecessor text is a human key or a WBS number, never a UUID.
 */

import {
  addCalendarDays,
  derivedParentDates,
  diffCalendarDays,
  diffWorkingDays,
  isUuid,
  isWorkingDay,
  scheduledEffortHours,
  type ProjectWorkingCalendar,
} from '@project-knowledge-hub/domain';
import {
  DELIVERY_TREE_ORPHAN_COLLAPSE_ID,
  DELIVERY_TREE_UNGROUPED_COLLAPSE_ID,
  type DeliveryTreeCollapsed,
  type DeliveryTreeCollapseNode,
} from './delivery-tree-collapse';

export const GANTT_MILESTONES_ID = 'delivery-tree-milestones';

export const GANTT_PX_PER_DAY = {
  day: 32,
  week: 12,
  month: 4,
} as const;

export const GANTT_ROW_HEIGHT = 40;
export const GANTT_HEADER_HEIGHT = 44;

export const GANTT_ZOOM_LEVELS = ['day', 'week', 'month'] as const;
export type GanttZoom = (typeof GANTT_ZOOM_LEVELS)[number];

export const GANTT_COLUMN_VIEWS = ['default', 'compact', 'planning', 'execution'] as const;
export type GanttColumnView = (typeof GANTT_COLUMN_VIEWS)[number];

export const GANTT_COLUMN_IDS = [
  'wbs',
  'title',
  'status',
  'percent',
  'duration',
  'predecessors',
  'owner',
  'start',
  'due',
] as const;
export type GanttColumnId = (typeof GANTT_COLUMN_IDS)[number];

/** Title is the widest grid column. WBS stays a narrow frozen track. */
export const GANTT_COLUMN_WIDTH: Record<GanttColumnId, number> = {
  wbs: 64,
  title: 280,
  status: 120,
  percent: 128,
  duration: 108,
  predecessors: 160,
  owner: 132,
  start: 108,
  due: 108,
};

export const GANTT_COLUMNS: Record<GanttColumnView, readonly GanttColumnId[]> = {
  default: ['wbs', 'title', 'status', 'percent', 'duration', 'predecessors'],
  compact: ['wbs', 'title', 'percent'],
  planning: ['wbs', 'title', 'duration', 'predecessors', 'start', 'due'],
  execution: ['wbs', 'title', 'status', 'percent', 'owner', 'due'],
};

export const GANTT_LINK_TYPES = ['FS', 'SS', 'FF', 'SF'] as const;
export type GanttLinkType = (typeof GANTT_LINK_TYPES)[number];

export type GanttPredecessorMode = 'key' | 'wbs';

export type GanttItemKind = 'group' | 'milestone' | 'epic' | 'story' | 'task' | 'bug';

export type GanttLabelKey =
  | 'milestoneTimeOrder'
  | 'treeUngroupedStories'
  | 'treeUngroupedTasks';

export type GanttEpicInput = {
  id: string;
  title: string;
  status: string;
  sortOrder: number;
  startDate: string | null;
  endDate: string | null;
  humanKey?: string | null;
  percent?: number | null;
};

export type GanttStoryInput = {
  id: string;
  epicId: string;
  title: string;
  status: string;
  sortOrder: number;
  startDate: string | null;
  endDate: string | null;
  humanKey?: string | null;
  percent?: number | null;
};

export type GanttTaskInput = {
  id: string;
  title: string;
  status: string;
  startDate?: string | null;
  dueDate: string | null;
  userStoryId: string | null;
  humanKey?: string | null;
  itemType?: 'task' | 'bug';
  owner?: string | null;
  percent?: number | null;
};

export type GanttMilestoneInput = {
  id: string;
  title: string;
  status: string;
  startDate: string | null;
  targetDate: string | null;
  humanKey?: string | null;
  percent?: number | null;
};

export type GanttDependency = {
  predecessorType: string;
  predecessorId: string;
  predecessorKey: string | null;
  successorType: string;
  successorId: string;
  linkType: string;
  lagDays: number;
};

export type GanttRow = {
  id: string;
  parentId: string | null;
  depth: number;
  kind: GanttItemKind;
  entityId: string | null;
  title: string;
  labelKey: GanttLabelKey | null;
  humanKey: string | null;
  status: string | null;
  owner: string | null;
  start: string | null;
  end: string | null;
  percent: number | null;
  wbs: string;
  hasChildren: boolean;
};

type Draft = {
  id: string;
  kind: GanttItemKind;
  entityId: string | null;
  title: string;
  labelKey: GanttLabelKey | null;
  humanKey: string | null;
  status: string | null;
  owner: string | null;
  start: string | null;
  end: string | null;
  percent: number | null;
  children: Draft[];
};

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export function ganttRowId(entityType: string, id: string): string {
  if (entityType === 'user_story') return `story:${id}`;
  if (entityType === 'epic') return `epic:${id}`;
  if (entityType === 'milestone') return `milestone:${id}`;
  if (entityType === 'task') return `task:${id}`;
  if (entityType === 'sprint') return `sprint:${id}`;
  return `${entityType}:${id}`;
}

export function ganttRollupDates(
  manual: { start: string | null; end: string | null },
  children: readonly { status: string; start: string | null; end: string | null }[],
): { start: string | null; end: string | null } {
  return derivedParentDates(manual, children);
}

function bySortThenTitle<T extends { sortOrder: number; title: string }>(a: T, b: T): number {
  return a.sortOrder - b.sortOrder || a.title.localeCompare(b.title);
}

function compareMilestones(a: GanttMilestoneInput, b: GanttMilestoneInput): number {
  if (a.targetDate && b.targetDate && a.targetDate !== b.targetDate) {
    return a.targetDate < b.targetDate ? -1 : 1;
  }
  if (a.targetDate && !b.targetDate) return -1;
  if (!a.targetDate && b.targetDate) return 1;
  return a.title.localeCompare(b.title);
}

function leafDraft(
  id: string,
  kind: GanttItemKind,
  entityId: string,
  title: string,
  humanKey: string | null | undefined,
  status: string,
  owner: string | null,
  start: string | null,
  end: string | null,
  percent: number | null | undefined,
): Draft {
  return {
    id,
    kind,
    entityId,
    title,
    labelKey: null,
    humanKey: humanKey ?? null,
    status,
    owner,
    start,
    end,
    percent: percent ?? null,
    children: [],
  };
}

function groupDraft(id: string, labelKey: GanttLabelKey, children: Draft[]): Draft {
  return {
    id,
    kind: 'group',
    entityId: null,
    title: '',
    labelKey,
    humanKey: null,
    status: null,
    owner: null,
    start: null,
    end: null,
    percent: null,
    children,
  };
}

function flatten(nodes: Draft[], parentId: string | null, depth: number, prefix: string): GanttRow[] {
  const rows: GanttRow[] = [];
  nodes.forEach((node, index) => {
    const wbs = prefix ? `${prefix}.${index + 1}` : String(index + 1);
    rows.push({
      id: node.id,
      parentId,
      depth,
      kind: node.kind,
      entityId: node.entityId,
      title: node.title,
      labelKey: node.labelKey,
      humanKey: node.humanKey,
      status: node.status,
      owner: node.owner,
      start: node.start,
      end: node.end,
      percent: node.percent,
      wbs,
      hasChildren: node.children.length > 0,
    });
    rows.push(...flatten(node.children, node.id, depth + 1, wbs));
  });
  return rows;
}

/**
 * Tree order: milestone group, epics (stories, then tasks and bugs),
 * stories with no epic, then tasks with no story. WBS is assigned on the
 * full outline, including rows a collapsed parent hides.
 */
export function buildGanttRows(input: {
  epics: readonly GanttEpicInput[];
  stories: readonly GanttStoryInput[];
  tasks: readonly GanttTaskInput[];
  milestones: readonly GanttMilestoneInput[];
}): GanttRow[] {
  const epicIds = new Set(input.epics.map((epic) => epic.id));
  const storyIds = new Set(input.stories.map((story) => story.id));
  const storiesByEpic = new Map<string, GanttStoryInput[]>();
  const orphanStories: GanttStoryInput[] = [];
  for (const story of [...input.stories].sort(bySortThenTitle)) {
    if (!epicIds.has(story.epicId)) {
      orphanStories.push(story);
      continue;
    }
    const list = storiesByEpic.get(story.epicId) ?? [];
    list.push(story);
    storiesByEpic.set(story.epicId, list);
  }

  const tasksByStory = new Map<string, GanttTaskInput[]>();
  const ungroupedTasks: GanttTaskInput[] = [];
  for (const task of [...input.tasks].sort((a, b) => a.title.localeCompare(b.title))) {
    if (!task.userStoryId || !storyIds.has(task.userStoryId)) {
      if (!task.userStoryId) ungroupedTasks.push(task);
      continue;
    }
    const list = tasksByStory.get(task.userStoryId) ?? [];
    list.push(task);
    tasksByStory.set(task.userStoryId, list);
  }

  function storyDraft(story: GanttStoryInput): Draft {
    const children = tasksByStory.get(story.id) ?? [];
    const dates = ganttRollupDates(
      { start: story.startDate, end: story.endDate },
      children.map((task) => ({
        status: task.status,
        start: task.startDate ?? null,
        end: task.dueDate,
      })),
    );
    const draft = leafDraft(
      `story:${story.id}`,
      'story',
      story.id,
      story.title,
      story.humanKey,
      story.status,
      null,
      dates.start,
      dates.end,
      story.percent,
    );
    draft.children = children.map((task) => leafDraft(
      `task:${task.id}`,
      task.itemType === 'bug' ? 'bug' : 'task',
      task.id,
      task.title,
      task.humanKey,
      task.status,
      task.owner ?? null,
      task.startDate ?? null,
      task.dueDate,
      task.percent,
    ));
    return draft;
  }

  const roots: Draft[] = [];
  const milestones = [...input.milestones].sort(compareMilestones);
  if (milestones.length > 0) {
    roots.push(groupDraft(
      GANTT_MILESTONES_ID,
      'milestoneTimeOrder',
      milestones.map((milestone) => leafDraft(
        `milestone:${milestone.id}`,
        'milestone',
        milestone.id,
        milestone.title,
        milestone.humanKey,
        milestone.status,
        null,
        milestone.startDate,
        milestone.targetDate,
        milestone.percent,
      )),
    ));
  }

  for (const epic of [...input.epics].sort(bySortThenTitle)) {
    const stories = (storiesByEpic.get(epic.id) ?? []).map(storyDraft);
    const dates = ganttRollupDates(
      { start: epic.startDate, end: epic.endDate },
      stories.map((story) => ({
        status: story.status ?? 'planned',
        start: story.start,
        end: story.end,
      })),
    );
    const draft = leafDraft(
      `epic:${epic.id}`,
      'epic',
      epic.id,
      epic.title,
      epic.humanKey,
      epic.status,
      null,
      dates.start,
      dates.end,
      epic.percent,
    );
    draft.children = stories;
    roots.push(draft);
  }

  if (orphanStories.length > 0) {
    roots.push(groupDraft(
      DELIVERY_TREE_ORPHAN_COLLAPSE_ID,
      'treeUngroupedStories',
      orphanStories.map(storyDraft),
    ));
  }
  if (ungroupedTasks.length > 0) {
    roots.push(groupDraft(
      DELIVERY_TREE_UNGROUPED_COLLAPSE_ID,
      'treeUngroupedTasks',
      ungroupedTasks.map((task) => leafDraft(
        `task:${task.id}`,
        task.itemType === 'bug' ? 'bug' : 'task',
        task.id,
        task.title,
        task.humanKey,
        task.status,
        task.owner ?? null,
        task.startDate ?? null,
        task.dueDate,
        task.percent,
      )),
    ));
  }

  return flatten(roots, null, 0, '');
}

export function ganttWbsById(rows: readonly GanttRow[]): Map<string, string> {
  return new Map(rows.map((row) => [row.id, row.wbs]));
}

export function visibleGanttRows(
  rows: readonly GanttRow[],
  collapsed: DeliveryTreeCollapsed,
): GanttRow[] {
  const parentById = new Map(rows.map((row) => [row.id, row.parentId]));
  return rows.filter((row) => {
    let parentId = row.parentId;
    const seen = new Set<string>();
    while (parentId && !seen.has(parentId)) {
      seen.add(parentId);
      if (collapsed[parentId] === true) return false;
      parentId = parentById.get(parentId) ?? null;
    }
    return true;
  });
}

export function ganttCollapseNodes(rows: readonly GanttRow[]): DeliveryTreeCollapseNode[] {
  return rows
    .filter((row) => row.hasChildren)
    .map((row) => ({ id: row.id, parentId: row.parentId, depth: row.depth }));
}

function isLinkType(value: string): value is GanttLinkType {
  return (GANTT_LINK_TYPES as readonly string[]).includes(value);
}

function safeKey(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || isUuid(trimmed)) return null;
  return trimmed;
}

function formatPredecessor(token: string, linkType: GanttLinkType, lagDays: number): string {
  if (!Number.isFinite(lagDays) || lagDays === 0) return `${token} ${linkType}`;
  const lag = lagDays > 0 ? `+${lagDays}` : String(lagDays);
  return `${token} ${linkType}${lag}`;
}

/**
 * Labels for one successor. Key mode prefers the human key and falls back
 * to WBS. WBS mode does the reverse. A UUID is never emitted.
 */
export function predecessorLabels(input: {
  successorId: string;
  links: readonly GanttDependency[];
  mode: GanttPredecessorMode;
  wbsById: ReadonlyMap<string, string>;
  keyById?: ReadonlyMap<string, string | null>;
}): string {
  const parts: { token: string; text: string }[] = [];
  for (const link of input.links) {
    if (ganttRowId(link.successorType, link.successorId) !== input.successorId) continue;
    if (!isLinkType(link.linkType)) continue;
    const rowId = ganttRowId(link.predecessorType, link.predecessorId);
    const key = safeKey(link.predecessorKey) ?? safeKey(input.keyById?.get(rowId));
    const wbs = input.wbsById.get(rowId) ?? null;
    const token = input.mode === 'key' ? (key ?? wbs) : (wbs ?? key);
    if (!token || isUuid(token)) continue;
    parts.push({
      token,
      text: formatPredecessor(token, link.linkType, link.lagDays),
    });
  }
  parts.sort((a, b) => a.token.localeCompare(b.token) || a.text.localeCompare(b.text));
  return parts.map((part) => part.text).join(', ');
}

export function ganttDurationWorkingDays(
  start: string | null,
  end: string | null,
  calendar: ProjectWorkingCalendar,
): number | null {
  if (!start && !end) return null;
  if (!start || !end || !YMD.test(start) || !YMD.test(end)) return 0;
  if (end < start) return null;
  return diffWorkingDays(start, end, calendar);
}

export function ganttDurationDetail(
  start: string | null,
  end: string | null,
  calendar: ProjectWorkingCalendar,
): { workingDays: number; effortHours: number } | null {
  const workingDays = ganttDurationWorkingDays(start, end, calendar);
  if (workingDays == null) return null;
  return {
    workingDays,
    effortHours: scheduledEffortHours(workingDays, calendar),
  };
}

export type GanttBarLayout =
  | {
    kind: 'bar';
    start: string;
    end: string;
    leftPx: number;
    widthPx: number;
    completePx: number;
  }
  | {
    kind: 'milestone';
    date: string;
    centerPx: number;
  };

function clampPercent(value: number | null): number {
  if (value == null || !Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

function validYmd(value: string | null): value is string {
  return Boolean(value && YMD.test(value));
}

/** Inclusive start..due bar, or a milestone diamond. No dates means no mark. */
export function ganttBarGeometry(input: {
  shape: 'bar' | 'milestone';
  start: string | null;
  end: string | null;
  percent: number | null;
  rangeStart: string;
  pxPerDay: number;
}): GanttBarLayout | null {
  if (input.shape === 'milestone') {
    const date = validYmd(input.end) ? input.end : validYmd(input.start) ? input.start : null;
    if (!date) return null;
    const index = diffCalendarDays(input.rangeStart, date);
    return {
      kind: 'milestone',
      date,
      centerPx: (index + 0.5) * input.pxPerDay,
    };
  }
  const start = validYmd(input.start) ? input.start : null;
  const end = validYmd(input.end) ? input.end : null;
  if (!start && !end) return null;
  const from = start && end ? (start <= end ? start : end) : (start ?? end!);
  const to = start && end ? (start <= end ? end : start) : from;
  const leftPx = diffCalendarDays(input.rangeStart, from) * input.pxPerDay;
  const widthPx = (diffCalendarDays(from, to) + 1) * input.pxPerDay;
  return {
    kind: 'bar',
    start: from,
    end: to,
    leftPx,
    widthPx,
    completePx: (clampPercent(input.percent) / 100) * widthPx,
  };
}

function alignMonday(ymd: string): string {
  const utc = new Date(`${ymd}T00:00:00Z`);
  const day = utc.getUTCDay();
  const offset = day === 0 ? -6 : 1 - day;
  return addCalendarDays(ymd, offset);
}

function alignSunday(ymd: string): string {
  const utc = new Date(`${ymd}T00:00:00Z`);
  const day = utc.getUTCDay();
  return day === 0 ? ymd : addCalendarDays(ymd, 7 - day);
}

function lastDayOfMonth(ymd: string): string {
  const year = Number(ymd.slice(0, 4));
  const month = Number(ymd.slice(5, 7));
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

export function ganttTimelineRange(
  dates: readonly (string | null | undefined)[],
  today: string,
  zoom: GanttZoom,
): { start: string; end: string } {
  const valid = dates.filter((date): date is string => Boolean(date && YMD.test(date)));
  const anchors = valid.length > 0 ? valid : [today];
  let min = anchors.reduce((left, date) => (date < left ? date : left));
  let max = anchors.reduce((right, date) => (date > right ? date : right));
  if (YMD.test(today)) {
    if (today < min) min = today;
    if (today > max) max = today;
  }
  const pad = zoom === 'month' ? 3 : zoom === 'week' ? 2 : 1;
  let start = addCalendarDays(min, -pad);
  let end = addCalendarDays(max, pad);
  if (zoom === 'week') {
    start = alignMonday(start);
    end = alignSunday(end);
  } else if (zoom === 'month') {
    start = `${start.slice(0, 7)}-01`;
    end = lastDayOfMonth(end);
  }
  return { start, end };
}

export function ganttChartWidth(
  range: { start: string; end: string },
  pxPerDay: number,
): number {
  return (diffCalendarDays(range.start, range.end) + 1) * pxPerDay;
}

export type GanttTick = {
  date: string;
  x: number;
  width: number;
  spanDays: number;
  nonWorking: boolean;
};

export function ganttScaleTicks(
  range: { start: string; end: string },
  zoom: GanttZoom,
  pxPerDay: number,
  calendar: ProjectWorkingCalendar,
): GanttTick[] {
  const total = diffCalendarDays(range.start, range.end);
  const ticks: GanttTick[] = [];
  if (zoom === 'day') {
    let cursor = range.start;
    for (let index = 0; index <= total; index += 1) {
      ticks.push({
        date: cursor,
        x: index * pxPerDay,
        width: pxPerDay,
        spanDays: 1,
        nonWorking: !isWorkingDay(cursor, calendar),
      });
      cursor = addCalendarDays(cursor, 1);
    }
    return ticks;
  }
  if (zoom === 'week') {
    let index = 0;
    while (index <= total) {
      const span = Math.min(7, total - index + 1);
      ticks.push({
        date: addCalendarDays(range.start, index),
        x: index * pxPerDay,
        width: span * pxPerDay,
        spanDays: span,
        nonWorking: false,
      });
      index += 7;
    }
    return ticks;
  }
  let index = 0;
  while (index <= total) {
    const date = addCalendarDays(range.start, index);
    const span = Math.min(
      diffCalendarDays(date, lastDayOfMonth(date)) + 1,
      total - index + 1,
    );
    ticks.push({
      date,
      x: index * pxPerDay,
      width: span * pxPerDay,
      spanDays: span,
      nonWorking: false,
    });
    index += span;
  }
  return ticks;
}

export function ganttNonWorkingBands(
  range: { start: string; end: string },
  calendar: ProjectWorkingCalendar,
  pxPerDay: number,
): { x: number; width: number }[] {
  const total = diffCalendarDays(range.start, range.end);
  const bands: { x: number; width: number }[] = [];
  let cursor = range.start;
  for (let index = 0; index <= total; index += 1) {
    if (!isWorkingDay(cursor, calendar)) {
      bands.push({ x: index * pxPerDay, width: pxPerDay });
    }
    cursor = addCalendarDays(cursor, 1);
  }
  return bands;
}

export function ganttTodayX(
  today: string,
  range: { start: string; end: string },
  pxPerDay: number,
): number | null {
  if (!YMD.test(today) || today < range.start || today > range.end) return null;
  return (diffCalendarDays(range.start, today) + 0.5) * pxPerDay;
}

export function dependencyEndpoints(
  linkType: GanttLinkType,
): { from: 'start' | 'finish'; to: 'start' | 'finish' } {
  if (linkType === 'SS') return { from: 'start', to: 'start' };
  if (linkType === 'FF') return { from: 'finish', to: 'finish' };
  if (linkType === 'SF') return { from: 'start', to: 'finish' };
  return { from: 'finish', to: 'start' };
}

export function ganttArrowPath(fromX: number, fromY: number, toX: number, toY: number): string {
  const stub = 12;
  if (toX >= fromX + stub) {
    const mid = Math.round((fromX + toX) / 2);
    return `M ${fromX} ${fromY} H ${mid} V ${toY} H ${toX}`;
  }
  const lane = fromY <= toY ? Math.max(fromY, toY) + 10 : Math.min(fromY, toY) - 10;
  const right = Math.max(fromX, toX) + stub;
  const left = Math.min(fromX, toX) - stub;
  return `M ${fromX} ${fromY} H ${right} V ${lane} H ${left} V ${toY} H ${toX}`;
}

function endpointX(
  layout: GanttBarLayout | null,
  side: 'start' | 'finish',
): number | null {
  if (!layout) return null;
  if (layout.kind === 'milestone') return layout.centerPx;
  return side === 'start' ? layout.leftPx : layout.leftPx + layout.widthPx;
}

export type GanttArrow = {
  key: string;
  linkType: GanttLinkType;
  path: string;
};

export function ganttDependencyArrows(input: {
  rows: readonly GanttRow[];
  links: readonly GanttDependency[];
  rangeStart: string;
  pxPerDay: number;
  rowHeight: number;
}): GanttArrow[] {
  const indexById = new Map(input.rows.map((row, index) => [row.id, index]));
  const arrows: GanttArrow[] = [];
  for (const link of input.links) {
    if (!isLinkType(link.linkType)) continue;
    const fromId = ganttRowId(link.predecessorType, link.predecessorId);
    const toId = ganttRowId(link.successorType, link.successorId);
    const fromIndex = indexById.get(fromId);
    const toIndex = indexById.get(toId);
    if (fromIndex == null || toIndex == null) continue;
    const fromRow = input.rows[fromIndex];
    const toRow = input.rows[toIndex];
    if (!fromRow || !toRow) continue;
    const ends = dependencyEndpoints(link.linkType);
    const fromLayout = ganttBarGeometry({
      shape: fromRow.kind === 'milestone' ? 'milestone' : 'bar',
      start: fromRow.start,
      end: fromRow.end,
      percent: fromRow.percent,
      rangeStart: input.rangeStart,
      pxPerDay: input.pxPerDay,
    });
    const toLayout = ganttBarGeometry({
      shape: toRow.kind === 'milestone' ? 'milestone' : 'bar',
      start: toRow.start,
      end: toRow.end,
      percent: toRow.percent,
      rangeStart: input.rangeStart,
      pxPerDay: input.pxPerDay,
    });
    if (fromRow.kind === 'group' || toRow.kind === 'group') continue;
    const fromX = endpointX(fromLayout, ends.from);
    const toX = endpointX(toLayout, ends.to);
    if (fromX == null || toX == null) continue;
    const fromY = (fromIndex + 0.5) * input.rowHeight;
    const toY = (toIndex + 0.5) * input.rowHeight;
    arrows.push({
      key: `${fromId}->${toId}:${link.linkType}`,
      linkType: link.linkType,
      path: ganttArrowPath(fromX, fromY, toX, toY),
    });
  }
  return arrows;
}

export function ganttGridWidth(view: GanttColumnView): number {
  return GANTT_COLUMNS[view].reduce((sum, column) => sum + GANTT_COLUMN_WIDTH[column], 0);
}

export function ganttGridTemplate(view: GanttColumnView, chartWidth: number): string {
  const tracks = GANTT_COLUMNS[view].map((column) => `${GANTT_COLUMN_WIDTH[column]}px`);
  tracks.push(`${chartWidth}px`);
  return tracks.join(' ');
}

export function ganttBarShape(kind: GanttItemKind): 'bar' | 'milestone' | null {
  if (kind === 'group') return null;
  if (kind === 'milestone') return 'milestone';
  return 'bar';
}
