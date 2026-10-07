import type {
  DisplayPrefs,
  ReportDiagramPrefs,
} from '@project-knowledge-hub/domain';
import { DEFAULT_REPORT_DIAGRAM_PREFS } from '@project-knowledge-hub/domain';
import {
  deliveryScheduleTone,
  projectDeliveryRag,
  todayYmd,
  type ProjectRagStatus,
} from './delivery-schedule';
import { formatMoney } from './project-currency';
import { computeRiskRag } from './project-health';

export type ReportMilestone = {
  title: string;
  status: string;
  targetDate: string | null;
};

export type ReportTask = {
  title: string;
  status: string;
  dueDate: string | null;
  milestoneId: string | null;
  forecastHours: string | number | null;
  actualHours: string | number | null;
  humanKey?: string | null;
  currentOwner?: { displayName: string } | null;
  sprintId?: string | null;
  storyPoints?: number | null;
  /** Latest status_changed → done. Not updatedAt. */
  completedAt?: string | null;
};

export type ReportSprint = {
  id: string;
  name: string;
  status: string;
  startDate: string | null;
  endDate: string | null;
  committedPoints?: number;
  donePoints?: number;
};

export type ReportStakeholder = {
  kind: string;
  displayName: string;
  email: string | null;
  projectRole: string | null;
  jobTitle: string | null;
  reportsToUserId: string | null;
  hourlyRate: string | null;
  raciRoles: string[];
  notes: string | null;
  userId: string | null;
};

export type ReportRaidItem = {
  kind: string;
  title: string;
  status: string;
  severity: string;
};

export type ReportBudgetBurndownPoint = {
  capturedOn: string;
  bac: number;
  pv: number | null;
  ev: number;
  ac: number;
};

export type ReportBudgetSummary = {
  currency: string;
  initialBudget: number | null;
  approvedBudget: number | null;
  bac: number | null;
  pv: number | null;
  ev: number;
  ac: number;
  cpi: number | null;
  spi: number | null;
  financialRag: ProjectRagStatus;
  riskRag: ProjectRagStatus;
  burndown?: ReportBudgetBurndownPoint[];
};

export type ProjectReportData = {
  milestones: ReportMilestone[];
  tasks: ReportTask[];
  stakeholders: ReportStakeholder[];
  raidItems: ReportRaidItem[];
  budget: ReportBudgetSummary | null;
  sprints: ReportSprint[];
};

export type ReportDiagramLabels = {
  orgHierarchy: string;
  raidBreakdown: string;
  deliveryTimeline: string;
  budgetBurndown: string;
  milestonesSection: string;
  tasksSection: string;
};

function downloadMarkdown(filename: string, markdown: string) {
  const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64) || 'project';
}

function formatIndex(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return value.toFixed(2);
}

function formatHours(value: string | number | null | undefined): string | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return String(n);
}

export async function fetchProjectReportData(
  projectId: string,
): Promise<ProjectReportData> {
  const [milestonesRes, tasksRes, stakeholdersRes, raidRes, budgetRes, sprintsRes] =
    await Promise.all([
      fetch(`/api/v1/projects/${projectId}/milestones`),
      fetch(`/api/v1/projects/${projectId}/tasks`),
      fetch(`/api/v1/projects/${projectId}/stakeholders`),
      fetch(`/api/v1/projects/${projectId}/raid-items`),
      fetch(`/api/v1/projects/${projectId}/budget-summary`),
      fetch(`/api/v1/projects/${projectId}/sprints`),
    ]);

  const milestones = milestonesRes.ok
    ? ((await milestonesRes.json()) as { milestones: ReportMilestone[] })
        .milestones
    : [];
  const tasks = tasksRes.ok
    ? ((await tasksRes.json()) as { tasks: ReportTask[] }).tasks
    : [];
  const stakeholders = stakeholdersRes.ok
    ? ((await stakeholdersRes.json()) as {
        stakeholders: ReportStakeholder[];
      }).stakeholders
    : [];
  const raidItems = raidRes.ok
    ? ((await raidRes.json()) as { raidItems: ReportRaidItem[] }).raidItems
    : [];
  const budget = budgetRes.ok
    ? ((await budgetRes.json()) as { budget: ReportBudgetSummary }).budget
    : null;
  const sprints = sprintsRes.ok
    ? ((await sprintsRes.json()) as { sprints: ReportSprint[] }).sprints
    : [];

  return { milestones, tasks, stakeholders, raidItems, budget, sprints };
}

export async function fetchReportDiagramPrefs(): Promise<ReportDiagramPrefs> {
  try {
    const response = await fetch('/api/v1/me', { credentials: 'include' });
    if (!response.ok) return DEFAULT_REPORT_DIAGRAM_PREFS;
    const payload = (await response.json()) as {
      user?: { displayPrefs?: DisplayPrefs };
    };
    return {
      ...DEFAULT_REPORT_DIAGRAM_PREFS,
      ...(payload.user?.displayPrefs?.reportDiagrams ?? {}),
    };
  } catch {
    return DEFAULT_REPORT_DIAGRAM_PREFS;
  }
}

function nameByUserId(stakeholders: ReportStakeholder[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of stakeholders) {
    if (row.userId) map.set(row.userId, row.displayName);
  }
  return map;
}

/** Visible mermaid text cap. Longer labels keep an ellipsis so the line stays valid. */
export const MERMAID_TEXT_MAX = 80;

function mermaidId(value: string, prefix: string): string {
  const cleaned = value.replace(/[^a-zA-Z0-9]/g, '').slice(0, 24);
  return `${prefix}${cleaned || 'x'}`;
}

function collapseMermaidWhitespace(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function truncateMermaid(value: string, max = MERMAID_TEXT_MAX): string {
  if (value.length <= max) return value;
  const ellipsis = '…';
  const cut = Math.max(1, max - ellipsis.length);
  return `${value.slice(0, cut).trimEnd()}${ellipsis}`;
}

/**
 * Gantt task and section text. The name ends at the first colon, `#` starts a
 * comment, and `;` can split the statement, so those characters are removed.
 */
export function mermaidGanttText(value: string): string {
  const cleaned = collapseMermaidWhitespace(value)
    .replace(/[:;#]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return truncateMermaid(cleaned) || '…';
}

/**
 * Text placed inside mermaid double quotes (pie, flowchart, xychart).
 * Escapes characters that terminate the quoted token. Truncates first so an
 * entity such as `#quot;` is never cut in half.
 */
export function mermaidQuotedLabel(value: string): string {
  const cleaned = truncateMermaid(collapseMermaidWhitespace(value)) || '…';
  let out = '';
  for (const ch of cleaned) {
    if (ch === '"') out += '#quot;';
    else if (ch === '#') out += '#35;';
    else if (ch === ';') out += '#59;';
    else if (ch === '&') out += '#amp;';
    else if (ch === '<') out += '#lt;';
    else if (ch === '>') out += '#gt;';
    else if (ch === '[') out += '#91;';
    else if (ch === ']') out += '#93;';
    else out += ch;
  }
  return out;
}

function fenceMermaid(source: string): string {
  return ['```mermaid', source.trim(), '```', ''].join('\n');
}

export function buildOrgHierarchyMermaid(
  stakeholders: ReportStakeholder[],
): string | null {
  const people = stakeholders.filter(
    (row) => row.kind === 'person' && row.userId,
  );
  const edges: Array<{ from: string; to: string }> = [];
  const ids = new Set<string>();

  for (const row of people) {
    if (!row.userId) continue;
    ids.add(row.userId);
    if (
      row.reportsToUserId &&
      row.reportsToUserId !== row.userId &&
      people.some((item) => item.userId === row.reportsToUserId)
    ) {
      edges.push({ from: row.reportsToUserId, to: row.userId });
    }
  }

  if (ids.size === 0 || edges.length === 0) return null;

  const lines = ['flowchart TB'];
  for (const row of people) {
    if (!row.userId || !ids.has(row.userId)) continue;
    lines.push(
      `  ${mermaidId(row.userId, 'u')}["${mermaidQuotedLabel(row.displayName)}"]`,
    );
  }
  for (const edge of edges) {
    lines.push(
      `  ${mermaidId(edge.from, 'u')} --> ${mermaidId(edge.to, 'u')}`,
    );
  }
  return fenceMermaid(lines.join('\n'));
}

export function buildRaidBreakdownMermaid(
  raidItems: ReportRaidItem[],
  kindLabel: (kind: string) => string,
): string | null {
  if (raidItems.length === 0) return null;
  const counts = new Map<string, number>();
  for (const row of raidItems) {
    counts.set(row.kind, (counts.get(row.kind) ?? 0) + 1);
  }
  const lines = ['pie showData'];
  for (const [kind, count] of counts) {
    lines.push(`  "${mermaidQuotedLabel(kindLabel(kind))}" : ${count}`);
  }
  return fenceMermaid(lines.join('\n'));
}

export function buildDeliveryTimelineMermaid(input: {
  milestones: ReportMilestone[];
  tasks: ReportTask[];
  milestonesSection: string;
  tasksSection: string;
}): string | null {
  const datedMilestones = input.milestones.filter((row) => row.targetDate);
  const datedTasks = input.tasks.filter((row) => row.dueDate).slice(0, 24);
  if (datedMilestones.length === 0 && datedTasks.length === 0) return null;

  const lines = ['gantt', '  dateFormat YYYY-MM-DD'];

  if (datedMilestones.length > 0) {
    lines.push(`  section ${mermaidGanttText(input.milestonesSection)}`);
    datedMilestones.forEach((row, index) => {
      lines.push(
        `  ${mermaidGanttText(row.title)} :milestone, m${index}, ${row.targetDate}, 0d`,
      );
    });
  }

  if (datedTasks.length > 0) {
    lines.push(`  section ${mermaidGanttText(input.tasksSection)}`);
    datedTasks.forEach((row, index) => {
      const done = row.status === 'done' ? 'done, ' : '';
      lines.push(
        `  ${mermaidGanttText(row.title)} :${done}t${index}, ${row.dueDate}, 1d`,
      );
    });
  }

  return fenceMermaid(lines.join('\n'));
}

export function buildBudgetBurndownMermaid(
  budget: ReportBudgetSummary | null,
): string | null {
  if (!budget) return null;
  const series = budget.burndown ?? [];
  if (series.length >= 2) {
    const labels = series.map((point) => point.capturedOn.slice(5));
    const remaining = series.map((point) =>
      Math.max(0, Math.round(point.bac - point.ac)),
    );
    const maxY = Math.max(...remaining, 1);
    return fenceMermaid(
      [
        'xychart-beta',
        `  title "${mermaidQuotedLabel('Remaining budget')}"`,
        `  x-axis [${labels.map((label) => `"${mermaidQuotedLabel(label)}"`).join(', ')}]`,
        `  y-axis "Amount" 0 --> ${maxY}`,
        `  line [${remaining.join(', ')}]`,
      ].join('\n'),
    );
  }

  const values = (
    [
      ['BAC', budget.bac],
      ['PV', budget.pv],
      ['EV', budget.ev],
      ['AC', budget.ac],
    ] as Array<[string, number | null]>
  ).filter((entry): entry is [string, number] => entry[1] != null && entry[1] > 0);

  if (values.length < 2) return null;
  const maxY = Math.max(...values.map((entry) => entry[1]), 1);
  return fenceMermaid(
    [
      'xychart-beta',
      `  title "${mermaidQuotedLabel('EVM snapshot')}"`,
      `  x-axis [${values.map((entry) => `"${mermaidQuotedLabel(entry[0])}"`).join(', ')}]`,
      `  y-axis "Amount" 0 --> ${Math.ceil(maxY)}`,
      `  bar [${values.map((entry) => Math.round(entry[1])).join(', ')}]`,
    ].join('\n'),
  );
}

function diagramSection(
  title: string,
  mermaid: string | null,
  emptyLabel: string,
): string {
  if (!mermaid) {
    return [`### ${title}`, '', emptyLabel, ''].join('\n');
  }
  return [`### ${title}`, '', mermaid].join('\n');
}

export function computeReportRags(input: {
  milestones: ReportMilestone[];
  tasks: ReportTask[];
  raidItems: ReportRaidItem[];
  budget: ReportBudgetSummary | null;
  today?: string;
}): {
  timelineRag: ProjectRagStatus;
  riskRag: ProjectRagStatus;
  financialRag: ProjectRagStatus;
} {
  const today = input.today ?? todayYmd();
  return {
    timelineRag: projectDeliveryRag(
      [
        ...input.milestones.map((row) => ({
          status: row.status,
          date: row.targetDate,
        })),
        ...input.tasks.map((row) => ({ status: row.status, date: row.dueDate })),
      ],
      today,
    ),
    riskRag: input.budget?.riskRag ?? computeRiskRag(input.raidItems),
    financialRag: input.budget?.financialRag ?? 'green',
  };
}

export const REPORT_TASK_GROUPS = [
  'blocked',
  'in_progress',
  'todo',
  'done',
  'cancelled',
] as const;

export type ReportTaskGroup = (typeof REPORT_TASK_GROUPS)[number];

/** Done and cancelled lists stay short; the rest of the group is "+N more". */
export const REPORT_CLOSED_GROUP_LIMIT = 8;

const OPEN_TASK_STATUSES = new Set<string>(['todo', 'in_progress', 'blocked']);

export type ReportOverviewCopy = {
  atAGlance: string;
  keyNumbers: (input: {
    total: number;
    todo: number;
    inProgress: number;
    blocked: number;
    done: number;
    cancelled: number;
    completedRecent: number;
    dueSoon: number;
    overdue: number;
  }) => string;
  completedLast24h: string;
  plannedNext24h: string;
  whereWeStand: string;
  groupBlocked: string;
  groupInProgress: string;
  groupTodo: string;
  groupDone: string;
  groupCancelled: string;
  more: (count: number) => string;
  none: string;
  overdueLine: (count: number, titles: string) => string;
  blockedRisksLine: (input: {
    blockedCount: number;
    blockedTitles: string;
    riskCount: number;
    riskTitles: string;
  }) => string;
  activeSprintLine: (input: {
    name: string;
    done: number;
    committed: number;
    pct: number;
  }) => string;
  noActiveSprint: string;
  nextMilestoneLine: (input: { title: string; days: number; date: string }) => string;
  noNextMilestone: string;
  cpiSpiLine: (input: { cpi: string; spi: string }) => string;
  ownerWorkloadLine: (owners: string) => string;
  due: (date: string) => string;
  points: (count: number) => string;
  target: (date: string) => string;
  sprintStarts: (date: string) => string;
  sprintEnds: (date: string) => string;
  sprintWindow: (start: string, end: string) => string;
  taskKind: string;
  milestoneKind: string;
  sprintKind: string;
};

/**
 * Clock time for report headers. Uses the UI locale and the viewer's zone,
 * with a short zone name. Date-only fields (due dates, milestone targets)
 * stay `YYYY-MM-DD` and do not go through this.
 */
export function formatReportTimestamp(
  value: Date | string,
  locale: string,
  timeZone: string,
): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return typeof value === 'string' ? value : '';
  }
  const intlLocale = locale === 'en' ? 'en-GB' : locale;
  const dateStyle = intlLocale === 'hu' ? 'short' : 'medium';
  const zone = timeZone || 'UTC';
  try {
    const when = new Intl.DateTimeFormat(intlLocale, {
      dateStyle,
      timeStyle: 'short',
      hourCycle: 'h23',
      timeZone: zone,
    }).format(date);
    const zoneName =
      new Intl.DateTimeFormat(intlLocale, {
        timeZone: zone,
        timeZoneName: 'short',
      })
        .formatToParts(date)
        .find((part) => part.type === 'timeZoneName')?.value ?? zone;
    return `${when} (${zoneName})`;
  } catch {
    return `${date.toISOString().slice(0, 16).replace('T', ' ')} (UTC)`;
  }
}

/** Calendar date in the viewer's zone. Date-only fields are not shifted through UTC. */
export function calendarYmd(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const year = parts.find((part) => part.type === 'year')?.value ?? '0000';
  const month = parts.find((part) => part.type === 'month')?.value ?? '01';
  const day = parts.find((part) => part.type === 'day')?.value ?? '01';
  return `${year}-${month}-${day}`;
}

export function shiftYmd(ymd: string, days: number): string {
  const ms = Date.parse(`${ymd}T00:00:00Z`) + days * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

export function isWithinLast24Hours(
  completedAt: string | null | undefined,
  now: Date,
): boolean {
  if (!completedAt) return false;
  const at = Date.parse(completedAt);
  if (!Number.isFinite(at)) return false;
  const start = now.getTime() - 24 * 60 * 60 * 1000;
  return at >= start && at <= now.getTime();
}

/** Inclusive of today and tomorrow as calendar dates in the viewer zone. */
export function isTodayOrTomorrow(
  dateYmd: string | null | undefined,
  today: string,
): boolean {
  if (!dateYmd || !/^\d{4}-\d{2}-\d{2}$/.test(dateYmd)) return false;
  return dateYmd === today || dateYmd === shiftYmd(today, 1);
}

export function compareReportTasks(a: ReportTask, b: ReportTask): number {
  if (a.dueDate && b.dueDate) {
    const due = a.dueDate.localeCompare(b.dueDate);
    if (due !== 0) return due;
  } else if (a.dueDate) {
    return -1;
  } else if (b.dueDate) {
    return 1;
  }
  return a.title.localeCompare(b.title);
}

export function selectCompletedLast24h(tasks: ReportTask[], now: Date): ReportTask[] {
  return tasks
    .filter((task) => isWithinLast24Hours(task.completedAt, now))
    .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''));
}

export type PlannedWindowItem = {
  kind: 'task' | 'milestone' | 'sprint';
  title: string;
  date: string | null;
  endDate: string | null;
  sprintEdge: 'start' | 'end' | 'both' | null;
};

export function selectPlannedNext24h(input: {
  tasks: ReportTask[];
  milestones: ReportMilestone[];
  sprints: ReportSprint[];
  today: string;
}): PlannedWindowItem[] {
  const items: PlannedWindowItem[] = [];
  const tasks = input.tasks
    .filter(
      (task) =>
        OPEN_TASK_STATUSES.has(task.status) &&
        isTodayOrTomorrow(task.dueDate, input.today),
    )
    .sort(compareReportTasks);
  for (const task of tasks) {
    items.push({
      kind: 'task',
      title: task.humanKey ? `${task.humanKey} ${task.title}` : task.title,
      date: task.dueDate,
      endDate: null,
      sprintEdge: null,
    });
  }

  const milestones = input.milestones
    .filter(
      (row) =>
        row.status !== 'done' &&
        row.status !== 'cancelled' &&
        isTodayOrTomorrow(row.targetDate, input.today),
    )
    .sort(
      (a, b) =>
        (a.targetDate ?? '').localeCompare(b.targetDate ?? '') ||
        a.title.localeCompare(b.title),
    );
  for (const row of milestones) {
    items.push({
      kind: 'milestone',
      title: row.title,
      date: row.targetDate,
      endDate: null,
      sprintEdge: null,
    });
  }

  for (const sprint of input.sprints) {
    if (sprint.status === 'cancelled') continue;
    const start = isTodayOrTomorrow(sprint.startDate, input.today);
    const end = isTodayOrTomorrow(sprint.endDate, input.today);
    if (!start && !end) continue;
    items.push({
      kind: 'sprint',
      title: sprint.name,
      date: sprint.startDate,
      endDate: sprint.endDate,
      sprintEdge: start && end ? 'both' : start ? 'start' : 'end',
    });
  }
  return items;
}

export type ReportTaskGroupView = {
  status: ReportTaskGroup;
  tasks: ReportTask[];
  hiddenCount: number;
};

export function groupReportTasks(tasks: ReportTask[]): ReportTaskGroupView[] {
  const groups: ReportTaskGroupView[] = [];
  for (const status of REPORT_TASK_GROUPS) {
    const matching = tasks
      .filter((task) => task.status === status)
      .sort(compareReportTasks);
    if (matching.length === 0) continue;
    const limit =
      status === 'done' || status === 'cancelled'
        ? REPORT_CLOSED_GROUP_LIMIT
        : matching.length;
    groups.push({
      status,
      tasks: matching.slice(0, limit),
      hiddenCount: Math.max(0, matching.length - limit),
    });
  }
  return groups;
}

function daysUntilYmd(dateYmd: string, today: string): number {
  const due = Date.parse(`${dateYmd}T00:00:00Z`);
  const base = Date.parse(`${today}T00:00:00Z`);
  return Math.round((due - base) / 86_400_000);
}

function titledList(
  titles: string[],
  none: string,
  more: (count: number) => string,
): string {
  if (titles.length === 0) return none;
  const shown = titles.slice(0, 5);
  const hidden = titles.length - shown.length;
  return hidden > 0 ? `${shown.join('; ')} ${more(hidden)}` : shown.join('; ');
}

function attentionRisks(items: ReportRaidItem[]): ReportRaidItem[] {
  return items.filter(
    (item) =>
      item.kind === 'risk' &&
      (item.status === 'open' || item.status === 'mitigating') &&
      (item.severity === 'high' || item.severity === 'critical'),
  );
}

function sprintPoints(
  sprint: ReportSprint,
  tasks: ReportTask[],
): { done: number; committed: number; pct: number } {
  const inSprint = tasks.filter(
    (task) => task.sprintId === sprint.id && task.status !== 'cancelled',
  );
  const committedFromTasks = inSprint.reduce(
    (sum, task) =>
      sum + (typeof task.storyPoints === 'number' ? task.storyPoints : 0),
    0,
  );
  const doneFromTasks = inSprint
    .filter((task) => task.status === 'done')
    .reduce(
      (sum, task) =>
        sum + (typeof task.storyPoints === 'number' ? task.storyPoints : 0),
      0,
    );
  const committed = sprint.committedPoints ?? committedFromTasks;
  const done = sprint.donePoints ?? doneFromTasks;
  const pct = committed > 0 ? Math.round((done / committed) * 100) : 0;
  return { done, committed, pct };
}

const GROUP_LABEL: Record<
  ReportTaskGroup,
  keyof Pick<
    ReportOverviewCopy,
    | 'groupBlocked'
    | 'groupInProgress'
    | 'groupTodo'
    | 'groupDone'
    | 'groupCancelled'
  >
> = {
  blocked: 'groupBlocked',
  in_progress: 'groupInProgress',
  todo: 'groupTodo',
  done: 'groupDone',
  cancelled: 'groupCancelled',
};

function appendReadability(
  lines: string[],
  input: {
    tasks: ReportTask[];
    milestones: ReportMilestone[];
    sprints: ReportSprint[];
    raidItems: ReportRaidItem[];
    budget: ReportBudgetSummary | null;
    overview: ReportOverviewCopy;
    now: Date;
    today: string;
  },
) {
  const copy = input.overview;
  const completed = selectCompletedLast24h(input.tasks, input.now);
  const planned = selectPlannedNext24h({
    tasks: input.tasks,
    milestones: input.milestones,
    sprints: input.sprints,
    today: input.today,
  });
  const overdue = input.tasks
    .filter(
      (task) =>
        OPEN_TASK_STATUSES.has(task.status) &&
        task.dueDate != null &&
        task.dueDate < input.today,
    )
    .sort(compareReportTasks);
  const blocked = input.tasks
    .filter((task) => task.status === 'blocked')
    .sort(compareReportTasks);
  const risks = attentionRisks(input.raidItems);
  const counts = {
    total: input.tasks.length,
    todo: input.tasks.filter((task) => task.status === 'todo').length,
    inProgress: input.tasks.filter((task) => task.status === 'in_progress').length,
    blocked: blocked.length,
    done: input.tasks.filter((task) => task.status === 'done').length,
    cancelled: input.tasks.filter((task) => task.status === 'cancelled').length,
    completedRecent: completed.length,
    dueSoon: planned.filter((item) => item.kind === 'task').length,
    overdue: overdue.length,
  };

  lines.push(`## ${copy.atAGlance}`, '', copy.keyNumbers(counts), '');
  lines.push(`## ${copy.completedLast24h}`, '');
  if (completed.length === 0) {
    lines.push(copy.none, '');
  } else {
    for (const task of completed) {
      const key = task.humanKey ? `**${task.humanKey}** ` : '';
      lines.push(`- ${key}**${task.title}**`);
    }
    lines.push('');
  }

  if (planned.length > 0) {
    lines.push(`## ${copy.plannedNext24h}`, '');
    for (const item of planned) {
      const kind =
        item.kind === 'task'
          ? copy.taskKind
          : item.kind === 'milestone'
            ? copy.milestoneKind
            : copy.sprintKind;
      let when = '';
      if (item.kind === 'task' && item.date) when = copy.due(item.date);
      if (item.kind === 'milestone' && item.date) when = copy.target(item.date);
      if (item.kind === 'sprint') {
        if (item.sprintEdge === 'both' && item.date && item.endDate) {
          when = copy.sprintWindow(item.date, item.endDate);
        } else if (item.sprintEdge === 'start' && item.date) {
          when = copy.sprintStarts(item.date);
        } else if (item.sprintEdge === 'end' && item.endDate) {
          when = copy.sprintEnds(item.endDate);
        }
      }
      lines.push(`- **${kind}** ${item.title}${when ? ` — ${when}` : ''}`);
    }
    lines.push('');
  }

  lines.push(`## ${copy.whereWeStand}`, '');
  lines.push(
    `- ${copy.overdueLine(
      overdue.length,
      titledList(
        overdue.map((task) => task.title),
        copy.none,
        copy.more,
      ),
    )}`,
  );
  lines.push(
    `- ${copy.blockedRisksLine({
      blockedCount: blocked.length,
      blockedTitles: titledList(
        blocked.map((task) => task.title),
        copy.none,
        copy.more,
      ),
      riskCount: risks.length,
      riskTitles: titledList(
        risks.map((item) => item.title),
        copy.none,
        copy.more,
      ),
    })}`,
  );
  const active = input.sprints.filter((sprint) => sprint.status === 'active');
  if (active.length === 0) {
    lines.push(`- ${copy.noActiveSprint}`);
  } else {
    for (const sprint of active) {
      lines.push(`- ${copy.activeSprintLine({ name: sprint.name, ...sprintPoints(sprint, input.tasks) })}`);
    }
  }
  const upcoming = input.milestones
    .filter(
      (row) =>
        row.targetDate != null &&
        row.targetDate >= input.today &&
        row.status !== 'done' &&
        row.status !== 'cancelled',
    )
    .sort(
      (a, b) =>
        (a.targetDate ?? '').localeCompare(b.targetDate ?? '') ||
        a.title.localeCompare(b.title),
    );
  const next = upcoming[0];
  if (!next?.targetDate) {
    lines.push(`- ${copy.noNextMilestone}`);
  } else {
    lines.push(
      `- ${copy.nextMilestoneLine({
        title: next.title,
        days: daysUntilYmd(next.targetDate, input.today),
        date: next.targetDate,
      })}`,
    );
  }
  if (input.budget && (input.budget.cpi != null || input.budget.spi != null)) {
    lines.push(
      `- ${copy.cpiSpiLine({
        cpi: formatIndex(input.budget.cpi),
        spi: formatIndex(input.budget.spi),
      })}`,
    );
  }
  const owners = workloadTop(input.tasks);
  if (owners.length > 0) {
    lines.push(
      `- ${copy.ownerWorkloadLine(
        owners.map((row) => `${row.name} (${row.count})`).join(', '),
      )}`,
    );
  }
  lines.push('');
}

function workloadTop(tasks: ReportTask[]): Array<{ name: string; count: number }> {
  const counts = new Map<string, number>();
  for (const task of tasks) {
    if (!OPEN_TASK_STATUSES.has(task.status)) continue;
    const name = task.currentOwner?.displayName?.trim();
    if (!name) continue;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, 5);
}

export function buildDeliveryStatusReport(input: {
  projectName: string;
  projectSlug: string;
  projectStatus: string;
  milestones: ReportMilestone[];
  tasks: ReportTask[];
  sprints?: ReportSprint[];
  raidItems?: ReportRaidItem[];
  budget?: ReportBudgetSummary | null;
  now?: Date;
  timeZone?: string;
  locale?: string;
  overview?: ReportOverviewCopy;
  diagrams?: Partial<ReportDiagramPrefs>;
  diagramLabels?: Pick<
    ReportDiagramLabels,
    'deliveryTimeline' | 'milestonesSection' | 'tasksSection'
  >;
  labels: {
    title: string;
    generated: string;
    timelineRag: string;
    timelineRagValue: string;
    milestones: string;
    tasks: string;
    none: string;
    forecastHours: string;
    actualHours: string;
    diagramEmpty: string;
  };
}): string {
  const now = input.now ?? new Date();
  const timeZone =
    input.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC';
  const locale = input.locale ?? 'en';
  const today = calendarYmd(now, timeZone);
  const diagrams = {
    ...DEFAULT_REPORT_DIAGRAM_PREFS,
    ...(input.diagrams ?? {}),
  };

  const lines = [
    `# ${input.labels.title}: ${input.projectName}`,
    '',
    `- Slug: \`${input.projectSlug}\``,
    `- Status: ${input.projectStatus}`,
    `- ${input.labels.timelineRag}: **${input.labels.timelineRagValue}**`,
    `- ${input.labels.generated}: ${formatReportTimestamp(now, locale, timeZone)}`,
    '',
  ];

  if (input.overview) {
    appendReadability(lines, {
      tasks: input.tasks,
      milestones: input.milestones,
      sprints: input.sprints ?? [],
      raidItems: input.raidItems ?? [],
      budget: input.budget ?? null,
      overview: input.overview,
      now,
      today,
    });
  }

  lines.push(`## ${input.labels.tasks}`, '');
  const groups = groupReportTasks(input.tasks);
  if (groups.length === 0) {
    lines.push(input.labels.none, '');
  } else {
    for (const group of groups) {
      const label = input.overview
        ? input.overview[GROUP_LABEL[group.status]]
        : group.status;
      const total = group.tasks.length + group.hiddenCount;
      lines.push(`### ${label} (${total})`, '');
      for (const row of group.tasks) {
        lines.push(formatGroupedTask(row, input, today));
      }
      if (group.hiddenCount > 0) {
        const more = input.overview
          ? input.overview.more(group.hiddenCount)
          : `+${group.hiddenCount} more`;
        lines.push(`- ${more}`);
      }
      lines.push('');
    }
  }

  if (diagrams.deliveryTimeline && input.diagramLabels) {
    lines.push(
      diagramSection(
        input.diagramLabels.deliveryTimeline,
        buildDeliveryTimelineMermaid({
          milestones: input.milestones,
          tasks: input.tasks,
          milestonesSection: input.diagramLabels.milestonesSection,
          tasksSection: input.diagramLabels.tasksSection,
        }),
        input.labels.diagramEmpty,
      ),
    );
  }

  lines.push(`## ${input.labels.milestones}`, '');

  if (input.milestones.length === 0) {
    lines.push(input.labels.none, '');
  } else {
    for (const row of input.milestones) {
      const tone = deliveryScheduleTone({
        status: row.status,
        date: row.targetDate,
        today,
      });
      lines.push(
        `- **${row.title}** — ${row.status}` +
          (row.targetDate ? `, target ${row.targetDate}` : '') +
          ` (${tone})`,
      );
    }
    lines.push('');
  }

  return `${lines.join('\n').trim()}\n`;
}

function formatGroupedTask(
  row: ReportTask,
  input: {
    overview?: ReportOverviewCopy;
    labels: { forecastHours: string; actualHours: string };
  },
  today: string,
): string {
  const tone = deliveryScheduleTone({
    status: row.status,
    date: row.dueDate,
    today,
  });
  const forecast = formatHours(row.forecastHours);
  const actual = formatHours(row.actualHours);
  const bits = [
    row.dueDate
      ? input.overview
        ? input.overview.due(row.dueDate)
        : `due ${row.dueDate}`
      : null,
    row.currentOwner?.displayName ?? null,
    typeof row.storyPoints === 'number' && row.storyPoints > 0
      ? input.overview
        ? input.overview.points(row.storyPoints)
        : `${row.storyPoints} pt`
      : null,
    forecast != null ? `${input.labels.forecastHours}: ${forecast}` : null,
    actual != null ? `${input.labels.actualHours}: ${actual}` : null,
  ].filter((bit): bit is string => Boolean(bit));
  const key = row.humanKey ? `**${row.humanKey}** ` : '';
  const detail = bits.length > 0 ? ` — ${bits.join(' · ')}` : '';
  return `- ${key}**${row.title}**${detail} (${tone})`;
}

export function buildStakeholdersReport(input: {
  projectName: string;
  projectSlug: string;
  stakeholders: ReportStakeholder[];
  currency?: string;
  locale?: string;
  now?: Date;
  timeZone?: string;
  diagrams?: Partial<ReportDiagramPrefs>;
  diagramLabels?: Pick<ReportDiagramLabels, 'orgHierarchy'>;
  labels: {
    title: string;
    generated: string;
    people: string;
    aiAssistants: string;
    none: string;
    reportsTo: string;
    hourlyRate: string;
    diagramEmpty: string;
  };
}): string {
  const names = nameByUserId(input.stakeholders);
  const people = input.stakeholders.filter((row) => row.kind === 'person');
  const assistants = input.stakeholders.filter(
    (row) => row.kind === 'ai_assistant',
  );
  const currency = input.currency ?? 'EUR';
  const locale = input.locale ?? 'en';
  const now = input.now ?? new Date();
  const timeZone =
    input.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC';
  const diagrams = {
    ...DEFAULT_REPORT_DIAGRAM_PREFS,
    ...(input.diagrams ?? {}),
  };

  const lines = [
    `# ${input.labels.title}: ${input.projectName}`,
    '',
    `- Slug: \`${input.projectSlug}\``,
    `- ${input.labels.generated}: ${formatReportTimestamp(now, locale, timeZone)}`,
    '',
  ];

  if (diagrams.orgHierarchy && input.diagramLabels) {
    lines.push(
      diagramSection(
        input.diagramLabels.orgHierarchy,
        buildOrgHierarchyMermaid(input.stakeholders),
        input.labels.diagramEmpty,
      ),
    );
  }

  lines.push(`## ${input.labels.people}`, '');

  if (people.length === 0) {
    lines.push(input.labels.none, '');
  } else {
    for (const row of people) {
      const reportsTo = row.reportsToUserId
        ? names.get(row.reportsToUserId)
        : null;
      const rate =
        row.hourlyRate != null && row.hourlyRate !== ''
          ? Number(row.hourlyRate)
          : null;
      const bits = [
        row.projectRole,
        row.jobTitle,
        row.email,
        row.raciRoles.length > 0 ? `RACI ${row.raciRoles.join('/')}` : null,
        reportsTo ? `${input.labels.reportsTo}: ${reportsTo}` : null,
        rate != null && Number.isFinite(rate)
          ? `${input.labels.hourlyRate}: ${formatMoney(rate, currency, locale)}`
          : null,
      ].filter(Boolean);
      lines.push(
        `- **${row.displayName}**${bits.length ? ` — ${bits.join(' · ')}` : ''}`,
      );
      if (row.notes) lines.push(`  - ${row.notes}`);
    }
    lines.push('');
  }

  lines.push(`## ${input.labels.aiAssistants}`, '');
  if (assistants.length === 0) {
    lines.push(input.labels.none, '');
  } else {
    for (const row of assistants) {
      const owner = row.reportsToUserId
        ? names.get(row.reportsToUserId)
        : null;
      lines.push(
        `- **${row.displayName}**` +
          (owner ? ` — ${input.labels.reportsTo}: ${owner}` : '') +
          (row.notes ? ` — ${row.notes}` : ''),
      );
    }
    lines.push('');
  }

  return `${lines.join('\n').trim()}\n`;
}

export function buildBudgetReportSection(input: {
  budget: ReportBudgetSummary | null;
  locale?: string;
  diagrams?: Partial<ReportDiagramPrefs>;
  diagramLabels?: Pick<ReportDiagramLabels, 'budgetBurndown'>;
  labels: {
    title: string;
    currency: string;
    initialBudget: string;
    approvedBudget: string;
    bac: string;
    ev: string;
    ac: string;
    pv: string;
    cpi: string;
    spi: string;
    financialRag: string;
    financialRagValue: string;
    none: string;
    diagramEmpty: string;
  };
}): string {
  const locale = input.locale ?? 'en';
  const diagrams = {
    ...DEFAULT_REPORT_DIAGRAM_PREFS,
    ...(input.diagrams ?? {}),
  };
  const lines = [`## ${input.labels.title}`, ''];

  if (!input.budget) {
    lines.push(input.labels.none, '');
    return lines.join('\n');
  }

  if (diagrams.budgetBurndown && input.diagramLabels) {
    lines.push(
      diagramSection(
        input.diagramLabels.budgetBurndown,
        buildBudgetBurndownMermaid(input.budget),
        input.labels.diagramEmpty,
      ),
    );
  }

  const b = input.budget;
  const currency = b.currency;
  lines.push(
    `- ${input.labels.currency}: ${currency}`,
    `- ${input.labels.initialBudget}: ${formatMoney(b.initialBudget, currency, locale)}`,
    `- ${input.labels.approvedBudget}: ${formatMoney(b.approvedBudget, currency, locale)}`,
    `- ${input.labels.bac}: ${formatMoney(b.bac, currency, locale)}`,
    `- ${input.labels.ev}: ${formatMoney(b.ev, currency, locale)}`,
    `- ${input.labels.ac}: ${formatMoney(b.ac, currency, locale)}`,
    `- ${input.labels.pv}: ${formatMoney(b.pv, currency, locale)}`,
    `- ${input.labels.cpi}: ${formatIndex(b.cpi)}`,
    `- ${input.labels.spi}: ${formatIndex(b.spi)}`,
    `- ${input.labels.financialRag}: **${input.labels.financialRagValue}**`,
    '',
  );
  return lines.join('\n');
}

export function buildRaidReportSection(input: {
  raidItems: ReportRaidItem[];
  riskRagValue: string;
  diagrams?: Partial<ReportDiagramPrefs>;
  diagramLabels?: Pick<ReportDiagramLabels, 'raidBreakdown'>;
  labels: {
    title: string;
    riskRag: string;
    none: string;
    diagramEmpty: string;
  };
  kindLabel: (kind: string) => string;
  statusLabel: (status: string) => string;
  severityLabel: (severity: string) => string;
}): string {
  const diagrams = {
    ...DEFAULT_REPORT_DIAGRAM_PREFS,
    ...(input.diagrams ?? {}),
  };
  const lines = [
    `## ${input.labels.title}`,
    '',
    `- ${input.labels.riskRag}: **${input.riskRagValue}**`,
    '',
  ];

  if (diagrams.raidBreakdown && input.diagramLabels) {
    lines.push(
      diagramSection(
        input.diagramLabels.raidBreakdown,
        buildRaidBreakdownMermaid(input.raidItems, input.kindLabel),
        input.labels.diagramEmpty,
      ),
    );
  }

  if (input.raidItems.length === 0) {
    lines.push(input.labels.none, '');
    return lines.join('\n');
  }

  for (const row of input.raidItems) {
    lines.push(
      `- **${row.title}** — ${input.kindLabel(row.kind)} · ${input.statusLabel(row.status)} · ${input.severityLabel(row.severity)}`,
    );
  }
  lines.push('');
  return lines.join('\n');
}

export function buildProjectStatusReport(input: {
  projectName: string;
  projectSlug: string;
  projectStatus: string;
  summary: string | null;
  milestones: ReportMilestone[];
  tasks: ReportTask[];
  stakeholders: ReportStakeholder[];
  raidItems: ReportRaidItem[];
  budget: ReportBudgetSummary | null;
  sprints?: ReportSprint[];
  now?: Date;
  timeZone?: string;
  overview?: ReportOverviewCopy;
  locale?: string;
  diagrams?: Partial<ReportDiagramPrefs>;
  diagramLabels?: ReportDiagramLabels;
  labels: {
    statusTitle: string;
    deliveryTitle: string;
    stakeholdersTitle: string;
    budgetTitle: string;
    raidTitle: string;
    generated: string;
    timelineRag: string;
    timelineRagValue: string;
    riskRag: string;
    riskRagValue: string;
    financialRag: string;
    financialRagValue: string;
    milestones: string;
    tasks: string;
    people: string;
    aiAssistants: string;
    none: string;
    reportsTo: string;
    hourlyRate: string;
    summary: string;
    forecastHours: string;
    actualHours: string;
    currency: string;
    initialBudget: string;
    approvedBudget: string;
    bac: string;
    ev: string;
    ac: string;
    pv: string;
    cpi: string;
    spi: string;
    diagramEmpty: string;
  };
  kindLabel: (kind: string) => string;
  statusLabel: (status: string) => string;
  severityLabel: (severity: string) => string;
}): string {
  const locale = input.locale ?? 'en';
  const now = input.now ?? new Date();
  const timeZone =
    input.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC';
  const currency = input.budget?.currency ?? 'EUR';
  const diagrams = {
    ...DEFAULT_REPORT_DIAGRAM_PREFS,
    ...(input.diagrams ?? {}),
  };

  const delivery = buildDeliveryStatusReport({
    projectName: input.projectName,
    projectSlug: input.projectSlug,
    projectStatus: input.projectStatus,
    milestones: input.milestones,
    tasks: input.tasks,
    sprints: input.sprints,
    raidItems: input.raidItems,
    budget: input.budget,
    now,
    timeZone,
    locale,
    overview: input.overview,
    diagrams,
    diagramLabels: input.diagramLabels,
    labels: {
      title: input.labels.deliveryTitle,
      generated: input.labels.generated,
      timelineRag: input.labels.timelineRag,
      timelineRagValue: input.labels.timelineRagValue,
      milestones: input.labels.milestones,
      tasks: input.labels.tasks,
      none: input.labels.none,
      forecastHours: input.labels.forecastHours,
      actualHours: input.labels.actualHours,
      diagramEmpty: input.labels.diagramEmpty,
    },
  });

  const stakeholders = buildStakeholdersReport({
    projectName: input.projectName,
    projectSlug: input.projectSlug,
    stakeholders: input.stakeholders,
    currency,
    locale,
    now,
    timeZone,
    diagrams,
    diagramLabels: input.diagramLabels,
    labels: {
      title: input.labels.stakeholdersTitle,
      generated: input.labels.generated,
      people: input.labels.people,
      aiAssistants: input.labels.aiAssistants,
      none: input.labels.none,
      reportsTo: input.labels.reportsTo,
      hourlyRate: input.labels.hourlyRate,
      diagramEmpty: input.labels.diagramEmpty,
    },
  });

  const budgetSection = buildBudgetReportSection({
    budget: input.budget,
    locale,
    diagrams,
    diagramLabels: input.diagramLabels,
    labels: {
      title: input.labels.budgetTitle,
      currency: input.labels.currency,
      initialBudget: input.labels.initialBudget,
      approvedBudget: input.labels.approvedBudget,
      bac: input.labels.bac,
      ev: input.labels.ev,
      ac: input.labels.ac,
      pv: input.labels.pv,
      cpi: input.labels.cpi,
      spi: input.labels.spi,
      financialRag: input.labels.financialRag,
      financialRagValue: input.labels.financialRagValue,
      none: input.labels.none,
      diagramEmpty: input.labels.diagramEmpty,
    },
  });

  const raidSection = buildRaidReportSection({
    raidItems: input.raidItems,
    riskRagValue: input.labels.riskRagValue,
    diagrams,
    diagramLabels: input.diagramLabels,
    labels: {
      title: input.labels.raidTitle,
      riskRag: input.labels.riskRag,
      none: input.labels.none,
      diagramEmpty: input.labels.diagramEmpty,
    },
    kindLabel: input.kindLabel,
    statusLabel: input.statusLabel,
    severityLabel: input.severityLabel,
  });

  const header = [
    `# ${input.labels.statusTitle}: ${input.projectName}`,
    '',
    `- Slug: \`${input.projectSlug}\``,
    `- Status: ${input.projectStatus}`,
    `- ${input.labels.timelineRag}: **${input.labels.timelineRagValue}**`,
    `- ${input.labels.riskRag}: **${input.labels.riskRagValue}**`,
    `- ${input.labels.financialRag}: **${input.labels.financialRagValue}**`,
    `- ${input.labels.generated}: ${formatReportTimestamp(now, locale, timeZone)}`,
    '',
  ];

  if (input.summary) {
    header.push(`## ${input.labels.summary}`, '', input.summary, '');
  }

  const deliveryBody = delivery.replace(/^# .*\n+/, '');
  const stakeholdersBody = stakeholders.replace(/^# .*\n+/, '');

  return (
    `${header.join('\n')}${deliveryBody}\n${budgetSection}\n${raidSection}\n${stakeholdersBody}`.trim() +
    '\n'
  );
}

export function downloadProjectReport(
  projectName: string,
  kind: 'delivery' | 'stakeholders' | 'status',
  markdown: string,
) {
  const stamp = todayYmd();
  downloadMarkdown(`${slugify(projectName)}-${kind}-${stamp}.md`, markdown);
}
