/** Red / amber / green project health. */
export type ProjectRagStatus = 'red' | 'amber' | 'green';

/**
 * Project health shared by the catalogue, project header, dashboard, and MCP.
 * `financial` is null when the budget summary could not be loaded.
 */
/**
 * Why an open or mitigating RAID item moves the risk RAG.
 *
 * `due_soon` is due today through today + TIMELINE_AT_RISK_DAYS.
 * `dueInDays` is set only for that cause (0 means due today).
 */
export type RiskRagCause = 'issue' | 'overdue' | 'due_soon' | 'severity';

export type RiskRagReason = {
  count: number;
  severity: string;
  kind: string;
  cause: RiskRagCause;
  dueInDays?: number;
};

export type ProjectHealth = {
  overall: ProjectRagStatus;
  timeline: ProjectRagStatus;
  risk: ProjectRagStatus;
  financial: ProjectRagStatus | null;
  /**
   * Why `risk` is amber or red. Empty when risk is green.
   * Same payload for the project header, catalogue, dashboard, and MCP.
   */
  riskReasons: RiskRagReason[];
};

/** RAID row the risk rule reads. Archived rows are ignored even if still open. */
export type RiskRagItem = {
  kind: string;
  status: string;
  severity: string;
  dueDate?: string | null;
  archivedAt?: string | Date | null;
};

/**
 * Open tasks and milestones due within this many calendar days, inclusive,
 * are timeline-amber. Overdue open items are red.
 *
 * PRO-B-18: this is the only project-health timeline window. The project
 * header, catalogue cards, dashboard counts, and MCP `health` all use it.
 * Delivery board, calendar, and export item colours keep a separate 3-day
 * tone and are not this signal.
 */
export const TIMELINE_AT_RISK_DAYS = 7;

const RAG_RANK: Record<ProjectRagStatus, number> = {
  green: 0,
  amber: 1,
  red: 2,
};

export function todayYmd(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Add calendar days to a YYYY-MM-DD date. Noon avoids DST jumps. */
export function addDaysYmd(ymd: string, days: number): string {
  const date = new Date(`${ymd}T12:00:00`);
  date.setDate(date.getDate() + days);
  return todayYmd(date);
}

/** Worst (most severe) status. Null and undefined entries are ignored. */
export function worstProjectRag(
  statuses: Array<ProjectRagStatus | null | undefined>,
): ProjectRagStatus {
  let worst: ProjectRagStatus = 'green';
  for (const status of statuses) {
    if (status == null) continue;
    if (RAG_RANK[status] > RAG_RANK[worst]) worst = status;
  }
  return worst;
}

/**
 * Timeline RAG for open delivery dates.
 * Done, cancelled, and undated items do not move the result.
 * At-risk means due on or before today + TIMELINE_AT_RISK_DAYS.
 */
export function timelineRag(
  items: Array<{ status: string; date: string | null | undefined }>,
  today = todayYmd(),
): ProjectRagStatus {
  const atRiskUntil = addDaysYmd(today, TIMELINE_AT_RISK_DAYS);
  let worst: ProjectRagStatus = 'green';
  for (const item of items) {
    if (item.status === 'done' || item.status === 'cancelled' || !item.date) {
      continue;
    }
    if (item.date < today) return 'red';
    if (item.date <= atRiskUntil) worst = 'amber';
  }
  return worst;
}

const OPEN_RAID_STATUSES = new Set(['open', 'mitigating']);

const SEVERITY_RANK: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const CAUSE_RANK: Record<RiskRagCause, number> = {
  issue: 0,
  overdue: 1,
  due_soon: 2,
  severity: 3,
};

const KIND_RANK: Record<string, number> = {
  issue: 0,
  risk: 1,
  assumption: 2,
  dependency: 3,
};

function isYmd(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/** Calendar days from `fromYmd` to `toYmd`. Noon matches {@link addDaysYmd}. */
function daysBetweenYmd(fromYmd: string, toYmd: string): number {
  const from = new Date(`${fromYmd}T12:00:00`);
  const to = new Date(`${toYmd}T12:00:00`);
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}

type ItemSignal = {
  level: ProjectRagStatus;
  reason: Omit<RiskRagReason, 'count'> | null;
};

/**
 * One open/mitigating item. Closed, accepted, cancelled, and archived stay out.
 *
 * Red: critical and (overdue, due within TIMELINE_AT_RISK_DAYS, or kind issue);
 * or high and overdue.
 * Amber: any other critical (far due date or none); any other high; any overdue
 * item. A critical issue is red even with no due date.
 */
function signalForRaidItem(item: RiskRagItem, today: string, atRiskUntil: string): ItemSignal {
  if (item.archivedAt) return { level: 'green', reason: null };
  if (!OPEN_RAID_STATUSES.has(item.status)) return { level: 'green', reason: null };

  const due = item.dueDate && isYmd(item.dueDate) ? item.dueDate : null;
  const overdue = due != null && due < today;
  const dueSoon = due != null && due >= today && due <= atRiskUntil;
  const critical = item.severity === 'critical';
  const high = item.severity === 'high';
  const base = { severity: item.severity, kind: item.kind };

  if (critical && item.kind === 'issue') {
    return { level: 'red', reason: { ...base, cause: 'issue' } };
  }
  if (critical && overdue) {
    return { level: 'red', reason: { ...base, cause: 'overdue' } };
  }
  if (critical && dueSoon && due != null) {
    return {
      level: 'red',
      reason: {
        ...base,
        cause: 'due_soon',
        dueInDays: daysBetweenYmd(today, due),
      },
    };
  }
  if (high && overdue) {
    return { level: 'red', reason: { ...base, cause: 'overdue' } };
  }
  if (critical || high) {
    return { level: 'amber', reason: { ...base, cause: 'severity' } };
  }
  if (overdue) {
    return { level: 'amber', reason: { ...base, cause: 'overdue' } };
  }
  return { level: 'green', reason: null };
}

function groupRiskReasons(reasons: Array<Omit<RiskRagReason, 'count'>>): RiskRagReason[] {
  const groups = new Map<string, RiskRagReason>();
  for (const reason of reasons) {
    const key = [reason.severity, reason.kind, reason.cause, reason.dueInDays ?? ''].join('\0');
    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
      continue;
    }
    const next: RiskRagReason = {
      count: 1,
      severity: reason.severity,
      kind: reason.kind,
      cause: reason.cause,
    };
    if (reason.dueInDays != null) next.dueInDays = reason.dueInDays;
    groups.set(key, next);
  }
  return [...groups.values()].sort((left, right) => {
    const severity = (SEVERITY_RANK[left.severity] ?? 9) - (SEVERITY_RANK[right.severity] ?? 9);
    if (severity !== 0) return severity;
    const cause = CAUSE_RANK[left.cause] - CAUSE_RANK[right.cause];
    if (cause !== 0) return cause;
    const days = (left.dueInDays ?? 0) - (right.dueInDays ?? 0);
    if (days !== 0) return days;
    return (KIND_RANK[left.kind] ?? 9) - (KIND_RANK[right.kind] ?? 9);
  });
}

export type RiskRagAssessment = {
  status: ProjectRagStatus;
  reasons: RiskRagReason[];
};

/**
 * Due-date-aware RAID risk RAG (PRO-T-98).
 *
 * Open or mitigating items only. Closed, accepted, cancelled, and archived
 * items do not move the result. The at-risk window is TIMELINE_AT_RISK_DAYS
 * (the same 7 calendar days as the timeline RAG), inclusive of today.
 *
 * Red when any critical item is overdue, due inside that window, or kind
 * `issue` (materialised, whatever the due date), or any high item is overdue.
 * Amber when any other critical item remains (due later, or no due date), any
 * other high item remains, or any item of any severity is overdue.
 * Green otherwise.
 *
 * `reasons` explains the resulting colour only. A red result does not also
 * list amber items. This is the only risk rule.
 */
export function assessRiskRag(
  items: readonly RiskRagItem[],
  today = todayYmd(),
): RiskRagAssessment {
  const atRiskUntil = addDaysYmd(today, TIMELINE_AT_RISK_DAYS);
  const signals = items.map((item) => signalForRaidItem(item, today, atRiskUntil));
  const status = worstProjectRag(signals.map((signal) => signal.level));
  if (status === 'green') return { status, reasons: [] };
  const reasons = groupRiskReasons(
    signals.flatMap((signal) => (signal.level === status && signal.reason ? [signal.reason] : [])),
  );
  return { status, reasons };
}

/** Status only. Callers that need the tooltip text use {@link assessRiskRag}. */
export function computeRiskRag(
  items: readonly RiskRagItem[],
  today = todayYmd(),
): ProjectRagStatus {
  return assessRiskRag(items, today).status;
}

/**
 * RAID list due-date tone. Overdue is red; a date on or before today +
 * TIMELINE_AT_RISK_DAYS is amber. Undated and later dates are uncoloured.
 */
export function raidDueDateTone(
  dueDate: string | null | undefined,
  today = todayYmd(),
): 'overdue' | 'soon' | null {
  if (!dueDate || !isYmd(dueDate)) return null;
  if (dueDate < today) return 'overdue';
  if (dueDate <= addDaysYmd(today, TIMELINE_AT_RISK_DAYS)) return 'soon';
  return null;
}

/** Financial RAG. Thresholds match the budget summary. */
export function computeFinancialRag(input: {
  bac: number | null;
  ac: number;
  cpi: number | null;
}): ProjectRagStatus {
  if (input.bac == null) return 'green';
  if (input.ac > input.bac || (input.cpi != null && input.cpi < 0.9)) {
    return 'red';
  }
  if (input.ac > input.bac * 0.85 || (input.cpi != null && input.cpi < 1)) {
    return 'amber';
  }
  return 'green';
}

/**
 * Overall health is the worst of timeline, risk, and financial.
 *
 * When `budget` is null the budget summary failed. Overall is the timeline
 * RAG only — the catalogue fallback — and `financial` is null. Risk is
 * reported as green because that signal is loaded with the summary.
 */
export function projectHealthFromBudget(input: {
  timeline: ProjectRagStatus;
  budget: {
    risk: ProjectRagStatus;
    financial: ProjectRagStatus;
    riskReasons?: RiskRagReason[];
  } | null;
}): ProjectHealth {
  if (!input.budget) {
    return {
      overall: input.timeline,
      timeline: input.timeline,
      risk: 'green',
      financial: null,
      riskReasons: [],
    };
  }
  return {
    overall: worstProjectRag([input.timeline, input.budget.risk, input.budget.financial]),
    timeline: input.timeline,
    risk: input.budget.risk,
    financial: input.budget.financial,
    riskReasons: input.budget.riskReasons ?? [],
  };
}

/** Used when a project id is missing from a health batch. */
export function emptyProjectHealth(): ProjectHealth {
  return {
    overall: 'green',
    timeline: 'green',
    risk: 'green',
    financial: null,
    riskReasons: [],
  };
}
