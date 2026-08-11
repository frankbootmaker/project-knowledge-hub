import { and, eq, isNull } from 'drizzle-orm';
import type { Database } from '@project-knowledge-hub/database';
import {
  projectStakeholders,
  projectTaskRaci,
  projectTasks,
  users,
} from '@project-knowledge-hub/database';
import {
  resourceUtilizationStatusSchema,
  resourceUtilizationViewSchema,
  stakeholderEngagementTypeSchema,
  type ResourceUtilizationStatus,
  type ResourceUtilizationView,
  type StakeholderEngagementType,
} from '@project-knowledge-hub/domain';
import { requireProjectContext } from './project-delivery.js';
import type { ProjectRagStatus } from './project-budget.js';

export type ResourcePersonUtilization = {
  userId: string;
  displayName: string;
  engagementType: StakeholderEngagementType | null;
  capacityHours: number | null;
  plannedHours: number;
  burnHours: number;
  plannedPct: number | null;
  burnPct: number | null;
  combinedPct: number | null;
  status: ResourceUtilizationStatus;
  windowStart: string | null;
  windowEnd: string | null;
  allocatedDailyHours: number | null;
};

export type ProjectResourceUtilization = {
  view: ResourceUtilizationView;
  resourceRag: ProjectRagStatus;
  people: ResourcePersonUtilization[];
  totals: {
    capacityHours: number;
    plannedHours: number;
    burnHours: number;
  };
};

function parseNumeric(value: string | null | undefined): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseYmd(value: string): number {
  const parts = value.split('-').map(Number);
  const y = parts[0] ?? 1970;
  const m = parts[1] ?? 1;
  const d = parts[2] ?? 1;
  return Date.UTC(y, m - 1, d);
}

/** Count Mon–Fri days inclusive between two YMD dates. */
export function weekdaysInclusive(startDate: string, endDate: string): number {
  let cur = parseYmd(startDate);
  const end = parseYmd(endDate);
  if (end < cur) return 0;
  let count = 0;
  while (cur <= end) {
    const dow = new Date(cur).getUTCDay();
    if (dow !== 0 && dow !== 6) count += 1;
    cur += 86_400_000;
  }
  return count;
}

export function utilizationStatus(
  pct: number | null,
): ResourceUtilizationStatus {
  if (pct == null || !Number.isFinite(pct)) return 'unknown';
  if (pct < 70) return 'under';
  if (pct <= 110) return 'on_track';
  return 'over';
}

function resolveDemandUserId(
  currentOwnerUserId: string | null,
  raci: Array<{ userId: string; role: string }>,
): string | null {
  if (currentOwnerUserId) return currentOwnerUserId;
  const responsible = raci.find((entry) => entry.role === 'R');
  if (responsible) return responsible.userId;
  const accountable = raci.find((entry) => entry.role === 'A');
  if (accountable) return accountable.userId;
  return null;
}

function capacityWindow(row: {
  engagementType: string | null;
  assignmentStart: string | null;
  assignmentEnd: string | null;
  contractStart: string | null;
  contractEnd: string | null;
}): { start: string; end: string } | null {
  const engagement = row.engagementType
    ? stakeholderEngagementTypeSchema.safeParse(row.engagementType)
    : null;
  const type = engagement?.success ? engagement.data : null;

  if (type === 'contractor') {
    if (row.contractStart && row.contractEnd) {
      return { start: row.contractStart, end: row.contractEnd };
    }
    if (row.assignmentStart && row.assignmentEnd) {
      return { start: row.assignmentStart, end: row.assignmentEnd };
    }
    return null;
  }

  if (row.assignmentStart && row.assignmentEnd) {
    return { start: row.assignmentStart, end: row.assignmentEnd };
  }
  if (row.contractStart && row.contractEnd) {
    return { start: row.contractStart, end: row.contractEnd };
  }
  return null;
}

export function computeCapacityHours(
  allocatedDailyHours: number | null,
  window: { start: string; end: string } | null,
): number | null {
  if (allocatedDailyHours == null || allocatedDailyHours <= 0 || !window) {
    return null;
  }
  const days = weekdaysInclusive(window.start, window.end);
  return Math.round(days * allocatedDailyHours * 100) / 100;
}

function pctOf(demand: number, capacity: number | null): number | null {
  if (capacity == null || capacity <= 0) return null;
  return Math.round((demand / capacity) * 1000) / 10;
}

function resourceRagFromTotals(
  plannedHours: number,
  capacityHours: number,
): ProjectRagStatus {
  if (capacityHours <= 0) return 'green';
  if (plannedHours > capacityHours * 1.1) return 'red';
  if (plannedHours > capacityHours) return 'amber';
  return 'green';
}

export async function getProjectResourceUtilization(
  database: Database,
  projectId: string,
  viewInput: string = 'planned',
): Promise<ProjectResourceUtilization> {
  await requireProjectContext(database, projectId);
  const viewParsed = resourceUtilizationViewSchema.safeParse(viewInput);
  const view: ResourceUtilizationView = viewParsed.success
    ? viewParsed.data
    : 'planned';

  const rosterRows = await database.db
    .select({
      userId: projectStakeholders.userId,
      engagementType: projectStakeholders.engagementType,
      assignmentStart: projectStakeholders.assignmentStart,
      assignmentEnd: projectStakeholders.assignmentEnd,
      allocatedDailyHours: projectStakeholders.allocatedDailyHours,
      contractStart: projectStakeholders.contractStart,
      contractEnd: projectStakeholders.contractEnd,
      displayName: users.displayName,
      fullName: users.fullName,
      email: users.email,
    })
    .from(projectStakeholders)
    .innerJoin(users, eq(projectStakeholders.userId, users.id))
    .where(eq(projectStakeholders.projectId, projectId));

  const tasks = await database.db
    .select({
      id: projectTasks.id,
      status: projectTasks.status,
      currentOwnerUserId: projectTasks.currentOwnerUserId,
      forecastHours: projectTasks.forecastHours,
      actualHours: projectTasks.actualHours,
    })
    .from(projectTasks)
    .where(
      and(eq(projectTasks.projectId, projectId), isNull(projectTasks.archivedAt)),
    );

  const raciRows =
    tasks.length === 0
      ? []
      : await database.db
          .select({
            taskId: projectTaskRaci.taskId,
            userId: projectTaskRaci.userId,
            role: projectTaskRaci.role,
          })
          .from(projectTaskRaci)
          .innerJoin(projectTasks, eq(projectTaskRaci.taskId, projectTasks.id))
          .where(eq(projectTasks.projectId, projectId));

  const raciByTask = new Map<string, Array<{ userId: string; role: string }>>();
  for (const row of raciRows) {
    const list = raciByTask.get(row.taskId) ?? [];
    list.push({ userId: row.userId, role: row.role });
    raciByTask.set(row.taskId, list);
  }

  const plannedByUser = new Map<string, number>();
  const burnByUser = new Map<string, number>();
  for (const task of tasks) {
    if (task.status === 'cancelled') continue;
    const userId = resolveDemandUserId(
      task.currentOwnerUserId,
      raciByTask.get(task.id) ?? [],
    );
    if (!userId) continue;
    const forecast = parseNumeric(task.forecastHours) ?? 0;
    const actual = parseNumeric(task.actualHours) ?? 0;
    const open = task.status !== 'done';
    if (open && forecast > 0) {
      plannedByUser.set(userId, (plannedByUser.get(userId) ?? 0) + forecast);
    }
    if (actual > 0) {
      burnByUser.set(userId, (burnByUser.get(userId) ?? 0) + actual);
    }
  }

  const people: ResourcePersonUtilization[] = rosterRows
    .filter((row): row is typeof row & { userId: string } => row.userId != null)
    .map((row) => {
    const engagement = row.engagementType
      ? stakeholderEngagementTypeSchema.safeParse(row.engagementType)
      : null;
    const engagementType = engagement?.success ? engagement.data : null;
    const window = capacityWindow(row);
    const daily = parseNumeric(row.allocatedDailyHours);
    const capacityHours = computeCapacityHours(daily, window);
    const plannedHours =
      Math.round((plannedByUser.get(row.userId) ?? 0) * 100) / 100;
    const burnHours =
      Math.round((burnByUser.get(row.userId) ?? 0) * 100) / 100;
    const plannedPct = pctOf(plannedHours, capacityHours);
    const burnPct = pctOf(burnHours, capacityHours);
    const combinedPct =
      plannedPct == null && burnPct == null
        ? null
        : Math.max(plannedPct ?? 0, burnPct ?? 0);

    let statusMetric: number | null = null;
    if (view === 'planned') statusMetric = plannedPct;
    else if (view === 'burn') statusMetric = burnPct;
    else statusMetric = combinedPct;

    const status = resourceUtilizationStatusSchema.parse(
      utilizationStatus(statusMetric),
    );

    return {
      userId: row.userId,
      displayName: row.fullName || row.displayName || row.email || row.userId,
      engagementType,
      capacityHours,
      plannedHours,
      burnHours,
      plannedPct,
      burnPct,
      combinedPct,
      status,
      windowStart: window?.start ?? null,
      windowEnd: window?.end ?? null,
      allocatedDailyHours: daily,
    };
  });

  people.sort((a, b) => a.displayName.localeCompare(b.displayName));

  const totals = {
    capacityHours:
      Math.round(
        people.reduce((sum, p) => sum + (p.capacityHours ?? 0), 0) * 100,
      ) / 100,
    plannedHours:
      Math.round(people.reduce((sum, p) => sum + p.plannedHours, 0) * 100) /
      100,
    burnHours:
      Math.round(people.reduce((sum, p) => sum + p.burnHours, 0) * 100) / 100,
  };

  return {
    view,
    resourceRag: resourceRagFromTotals(
      totals.plannedHours,
      totals.capacityHours,
    ),
    people,
    totals,
  };
}
