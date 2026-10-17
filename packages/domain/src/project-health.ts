/** Red / amber / green project health. */
export type ProjectRagStatus = 'red' | 'amber' | 'green';

/**
 * Project health shared by the catalogue, project header, dashboard, and MCP.
 * `financial` is null when the budget summary could not be loaded.
 */
export type ProjectHealth = {
  overall: ProjectRagStatus;
  timeline: ProjectRagStatus;
  risk: ProjectRagStatus;
  financial: ProjectRagStatus | null;
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

/**
 * Risk RAG from RAID rows.
 *
 * Open or mitigating critical → red, high → amber, otherwise green.
 * This is the only risk rule. PRO-T-98 will replace it with a due-date-aware
 * version; callers must use this function instead of copying the rule.
 */
export function computeRiskRag(
  items: Array<{ kind: string; status: string; severity: string }>,
): ProjectRagStatus {
  const open = items.filter(
    (item) => item.status === 'open' || item.status === 'mitigating',
  );
  if (open.some((item) => item.severity === 'critical')) return 'red';
  if (open.some((item) => item.severity === 'high')) return 'amber';
  return 'green';
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
  budget: { risk: ProjectRagStatus; financial: ProjectRagStatus } | null;
}): ProjectHealth {
  if (!input.budget) {
    return {
      overall: input.timeline,
      timeline: input.timeline,
      risk: 'green',
      financial: null,
    };
  }
  return {
    overall: worstProjectRag([
      input.timeline,
      input.budget.risk,
      input.budget.financial,
    ]),
    timeline: input.timeline,
    risk: input.budget.risk,
    financial: input.budget.financial,
  };
}

/** Used when a project id is missing from a health batch. */
export function emptyProjectHealth(): ProjectHealth {
  return {
    overall: 'green',
    timeline: 'green',
    risk: 'green',
    financial: null,
  };
}
