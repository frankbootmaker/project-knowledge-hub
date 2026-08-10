import { and, asc, eq, isNull } from 'drizzle-orm';
import type { Database } from '@project-knowledge-hub/database';
import {
  projectCostSnapshots,
  projectEpics,
  projectRaidItems,
  projectStakeholders,
  projectTaskRaci,
  projectTasks,
  projectUserStories,
  projects,
} from '@project-knowledge-hub/database';
import {
  AppError,
  projectCurrencySchema,
  type ProjectCurrency,
} from '@project-knowledge-hub/domain';
import { requireProjectContext } from './project-delivery.js';

export type ProjectRagStatus = 'red' | 'amber' | 'green';

export type BudgetTaskCost = {
  taskId: string;
  epicId: string | null;
  userStoryId: string | null;
  status: string;
  forecastHours: number | null;
  actualHours: number | null;
  rateUserId: string | null;
  hourlyRate: number | null;
  forecastCost: number | null;
  actualCost: number | null;
};

export type EpicBudgetRollup = {
  epicId: string;
  title: string;
  forecastHours: number;
  actualHours: number;
  forecastCost: number | null;
  actualCost: number | null;
};

export type CostSnapshotPoint = {
  capturedOn: string;
  bac: number;
  pv: number | null;
  ev: number;
  ac: number;
};

export type ProjectBudgetSummary = {
  currency: ProjectCurrency;
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
  startDate: string | null;
  endDate: string | null;
  burndown: CostSnapshotPoint[];
  epics: EpicBudgetRollup[];
};

function parseNumeric(value: string | null | undefined): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function moneyString(value: number): string {
  return value.toFixed(2);
}

function todayYmd(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseYmd(value: string): number {
  const parts = value.split('-').map(Number);
  const y = parts[0] ?? 1970;
  const m = parts[1] ?? 1;
  const d = parts[2] ?? 1;
  return Date.UTC(y, m - 1, d);
}

export function computeLinearPv(
  bac: number | null,
  startDate: string | null,
  endDate: string | null,
  today = todayYmd(),
): number | null {
  if (bac == null || !startDate || !endDate) return null;
  const start = parseYmd(startDate);
  const end = parseYmd(endDate);
  const now = parseYmd(today);
  if (end <= start) return bac;
  if (now <= start) return 0;
  if (now >= end) return bac;
  const ratio = (now - start) / (end - start);
  return Math.round(bac * ratio * 100) / 100;
}

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

async function loadRateMap(
  database: Database,
  projectId: string,
): Promise<Map<string, number>> {
  const rows = await database.db
    .select({
      userId: projectStakeholders.userId,
      hourlyRate: projectStakeholders.hourlyRate,
    })
    .from(projectStakeholders)
    .where(eq(projectStakeholders.projectId, projectId));
  const map = new Map<string, number>();
  for (const row of rows) {
    const rate = parseNumeric(row.hourlyRate);
    if (rate != null) map.set(row.userId, rate);
  }
  return map;
}

function resolveRateUserId(
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

export async function listTaskBudgetCosts(
  database: Database,
  projectId: string,
): Promise<BudgetTaskCost[]> {
  const tasks = await database.db
    .select({
      id: projectTasks.id,
      status: projectTasks.status,
      userStoryId: projectTasks.userStoryId,
      currentOwnerUserId: projectTasks.currentOwnerUserId,
      forecastHours: projectTasks.forecastHours,
      actualHours: projectTasks.actualHours,
    })
    .from(projectTasks)
    .where(
      and(eq(projectTasks.projectId, projectId), isNull(projectTasks.archivedAt)),
    );

  if (tasks.length === 0) return [];

  const raciRows = await database.db
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

  const storyRows = await database.db
    .select({
      id: projectUserStories.id,
      epicId: projectUserStories.epicId,
    })
    .from(projectUserStories)
    .where(eq(projectUserStories.projectId, projectId));
  const epicByStory = new Map(storyRows.map((row) => [row.id, row.epicId]));
  const rates = await loadRateMap(database, projectId);

  return tasks.map((task) => {
    const raci = raciByTask.get(task.id) ?? [];
    const rateUserId = resolveRateUserId(task.currentOwnerUserId, raci);
    const hourlyRate = rateUserId ? rates.get(rateUserId) ?? null : null;
    const forecastHours = parseNumeric(task.forecastHours);
    const actualHours = parseNumeric(task.actualHours);
    const forecastCost =
      forecastHours != null && hourlyRate != null
        ? Math.round(forecastHours * hourlyRate * 100) / 100
        : null;
    const actualCost =
      actualHours != null && hourlyRate != null
        ? Math.round(actualHours * hourlyRate * 100) / 100
        : null;
    return {
      taskId: task.id,
      epicId: task.userStoryId
        ? epicByStory.get(task.userStoryId) ?? null
        : null,
      userStoryId: task.userStoryId,
      status: task.status,
      forecastHours,
      actualHours,
      rateUserId,
      hourlyRate,
      forecastCost,
      actualCost,
    };
  });
}

function rollupEpics(
  costs: BudgetTaskCost[],
  epics: Array<{ id: string; title: string }>,
): EpicBudgetRollup[] {
  return epics.map((epic) => {
    const rows = costs.filter(
      (row) => row.epicId === epic.id && row.status !== 'cancelled',
    );
    let forecastHours = 0;
    let actualHours = 0;
    let forecastCostSum = 0;
    let actualCostSum = 0;
    let hasForecastCost = false;
    let hasActualCost = false;
    for (const row of rows) {
      if (row.forecastHours != null) forecastHours += row.forecastHours;
      if (row.actualHours != null) actualHours += row.actualHours;
      if (row.forecastCost != null) {
        forecastCostSum += row.forecastCost;
        hasForecastCost = true;
      }
      if (row.actualCost != null) {
        actualCostSum += row.actualCost;
        hasActualCost = true;
      }
    }
    return {
      epicId: epic.id,
      title: epic.title,
      forecastHours: Math.round(forecastHours * 100) / 100,
      actualHours: Math.round(actualHours * 100) / 100,
      forecastCost: hasForecastCost
        ? Math.round(forecastCostSum * 100) / 100
        : null,
      actualCost: hasActualCost ? Math.round(actualCostSum * 100) / 100 : null,
    };
  });
}

export function computeEvmFromCosts(
  project: {
    currency: string;
    initialBudget: string | null;
    approvedBudget: string | null;
    startDate: string | null;
    endDate: string | null;
  },
  costs: BudgetTaskCost[],
  today = todayYmd(),
): {
  currency: ProjectCurrency;
  initialBudget: number | null;
  approvedBudget: number | null;
  bac: number | null;
  pv: number | null;
  ev: number;
  ac: number;
  cpi: number | null;
  spi: number | null;
  financialRag: ProjectRagStatus;
} {
  const currency = projectCurrencySchema.parse(project.currency);
  const initialBudget = parseNumeric(project.initialBudget);
  const approvedBudget = parseNumeric(project.approvedBudget);
  const bac = approvedBudget ?? initialBudget;
  let ev = 0;
  let ac = 0;
  for (const row of costs) {
    if (row.status === 'cancelled') continue;
    if (row.actualCost != null) ac += row.actualCost;
    if (row.status === 'done' && row.forecastCost != null) ev += row.forecastCost;
  }
  ev = Math.round(ev * 100) / 100;
  ac = Math.round(ac * 100) / 100;
  const pv = computeLinearPv(bac, project.startDate, project.endDate, today);
  const cpi = ac > 0 ? Math.round((ev / ac) * 1000) / 1000 : null;
  const spi = pv != null && pv > 0 ? Math.round((ev / pv) * 1000) / 1000 : null;
  return {
    currency,
    initialBudget,
    approvedBudget,
    bac,
    pv,
    ev,
    ac,
    cpi,
    spi,
    financialRag: computeFinancialRag({ bac, ac, cpi }),
  };
}

export async function upsertProjectCostSnapshot(
  database: Database,
  projectId: string,
): Promise<void> {
  const { project } = await requireProjectContext(database, projectId);
  const costs = await listTaskBudgetCosts(database, projectId);
  const evm = computeEvmFromCosts(project, costs);
  if (evm.bac == null) return;

  const capturedOn = todayYmd();
  const [existing] = await database.db
    .select({ id: projectCostSnapshots.id })
    .from(projectCostSnapshots)
    .where(
      and(
        eq(projectCostSnapshots.projectId, projectId),
        eq(projectCostSnapshots.capturedOn, capturedOn),
      ),
    )
    .limit(1);

  if (existing) {
    await database.db
      .update(projectCostSnapshots)
      .set({
        bac: moneyString(evm.bac),
        pv: evm.pv == null ? null : moneyString(evm.pv),
        ev: moneyString(evm.ev),
        ac: moneyString(evm.ac),
        updatedAt: new Date(),
      })
      .where(eq(projectCostSnapshots.id, existing.id));
    return;
  }

  await database.db.insert(projectCostSnapshots).values({
    projectId,
    capturedOn,
    bac: moneyString(evm.bac),
    pv: evm.pv == null ? null : moneyString(evm.pv),
    ev: moneyString(evm.ev),
    ac: moneyString(evm.ac),
  });
}

export async function getProjectBudgetSummary(
  database: Database,
  projectId: string,
): Promise<ProjectBudgetSummary> {
  const { project } = await requireProjectContext(database, projectId);
  const costs = await listTaskBudgetCosts(database, projectId);
  const evm = computeEvmFromCosts(project, costs);

  const raidRows = await database.db
    .select({
      kind: projectRaidItems.kind,
      status: projectRaidItems.status,
      severity: projectRaidItems.severity,
    })
    .from(projectRaidItems)
    .where(
      and(
        eq(projectRaidItems.projectId, projectId),
        isNull(projectRaidItems.archivedAt),
      ),
    );

  const epicRows = await database.db
    .select({
      id: projectEpics.id,
      title: projectEpics.title,
    })
    .from(projectEpics)
    .where(
      and(eq(projectEpics.projectId, projectId), isNull(projectEpics.archivedAt)),
    )
    .orderBy(asc(projectEpics.sortOrder), asc(projectEpics.title));

  const snapshotRows = await database.db
    .select()
    .from(projectCostSnapshots)
    .where(eq(projectCostSnapshots.projectId, projectId))
    .orderBy(asc(projectCostSnapshots.capturedOn));

  return {
    ...evm,
    riskRag: computeRiskRag(raidRows),
    startDate: project.startDate,
    endDate: project.endDate,
    burndown: snapshotRows.map((row) => ({
      capturedOn: row.capturedOn,
      bac: parseNumeric(row.bac) ?? 0,
      pv: parseNumeric(row.pv),
      ev: parseNumeric(row.ev) ?? 0,
      ac: parseNumeric(row.ac) ?? 0,
    })),
    epics: rollupEpics(costs, epicRows),
  };
}

/** Returns `undefined` when input is omitted (leave column unchanged). */
export function parseBudgetAmount(
  value: number | string | null | undefined,
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) {
    throw new AppError({
      code: 'BUDGET_AMOUNT_INVALID',
      message: 'Budget amount must be a non-negative number',
      statusCode: 400,
    });
  }
  return moneyString(n);
}

/** Returns `undefined` when input is omitted (leave column unchanged). */
export function parseHours(
  value: number | string | null | undefined,
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) {
    throw new AppError({
      code: 'HOURS_INVALID',
      message: 'Hours must be a non-negative number',
      statusCode: 400,
    });
  }
  return moneyString(n);
}

export async function assertProjectCurrency(
  currency: string,
): Promise<ProjectCurrency> {
  return projectCurrencySchema.parse(currency);
}

/** Convenience for routes that only need project row currency/budget fields. */
export async function getProjectBudgetFields(
  database: Database,
  projectId: string,
) {
  const [row] = await database.db
    .select({
      currency: projects.currency,
      initialBudget: projects.initialBudget,
      approvedBudget: projects.approvedBudget,
    })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!row) {
    throw new AppError({
      code: 'PROJECT_NOT_FOUND',
      message: 'Project not found',
      statusCode: 404,
    });
  }
  return {
    currency: projectCurrencySchema.parse(row.currency),
    initialBudget: parseNumeric(row.initialBudget),
    approvedBudget: parseNumeric(row.approvedBudget),
  };
}
