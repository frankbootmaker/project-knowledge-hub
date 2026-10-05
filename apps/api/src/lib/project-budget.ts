import { and, asc, eq, isNull, ne, or } from 'drizzle-orm';
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
  systems,
} from '@project-knowledge-hub/database';
import {
  AppError,
  aiCostModeSchema,
  projectCurrencySchema,
  systemItCostModeSchema,
  usageHasTokenBreakdown,
  type AiCostMode,
  type ProjectCurrency,
  type SystemItCostMode,
} from '@project-knowledge-hub/domain';
import { requireProjectContext } from './project-delivery.js';
import { AI_ASSISTANT_SYSTEM_TYPE } from './project-stakeholders.js';

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

export type AiBudgetBreakdown = {
  systemId: string;
  name: string;
  costMode: AiCostMode | null;
  flatAccruedCost: number;
  tokenCost: number;
  noteOnlyTokens: number;
  billableCost: number;
  budgetAllocation: number | null;
  overAllocation: boolean;
};

export type SystemItBudgetBreakdown = {
  systemId: string;
  name: string;
  costMode: SystemItCostMode | null;
  flatAccruedCost: number;
  oneTimeCost: number;
  billableCost: number;
  budgetAllocation: number | null;
  overAllocation: boolean;
};

export type ProjectBudgetSummary = {
  currency: ProjectCurrency;
  initialBudget: number | null;
  approvedBudget: number | null;
  bac: number | null;
  pv: number | null;
  ev: number;
  ac: number;
  /** Person hours × rate only (excludes AI / IT systems). */
  personAc: number;
  /** Billable AI flat + token costs. */
  aiAc: number;
  /** Billable AI flat fees (project-window accrual). */
  aiFlatAc: number;
  /** Billable AI token cost (blended and split rates). */
  aiTokenAc: number;
  /** Billable non-AI catalogue system OpEx. */
  systemAc: number;
  aiNoteOnlyTokens: number;
  aiSystems: AiBudgetBreakdown[];
  itSystems: SystemItBudgetBreakdown[];
  cpi: number | null;
  spi: number | null;
  financialRag: ProjectRagStatus;
  riskRag: ProjectRagStatus;
  startDate: string | null;
  endDate: string | null;
  burndown: CostSnapshotPoint[];
  epics: EpicBudgetRollup[];
};

function parseNumeric(value: number | null | undefined): number | null {
  if (value == null) return null;
  return Number.isFinite(value) ? value : null;
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

const AVG_DAYS_PER_MONTH = 30.437;

function dayIndex(ymd: string): number {
  return Math.floor(parseYmd(ymd) / 86_400_000);
}

/** Inclusive Mon–Sun calendar day count between two YMD dates. */
export function calendarDaysInclusive(
  startDate: string,
  endDate: string,
): number {
  const start = dayIndex(startDate);
  const end = dayIndex(endDate);
  if (end < start) return 0;
  return end - start + 1;
}

/**
 * Accrue a monthly flat fee over the project window as a calendar-day fraction.
 * Without a window, one month is treated as accrued.
 */
export function accrueFlatMonthlyFee(
  monthlyFee: number,
  startDate: string | null,
  endDate: string | null,
  today = todayYmd(),
): number {
  if (monthlyFee <= 0) return 0;
  if (!startDate || !endDate) {
    return Math.round(monthlyFee * 100) / 100;
  }
  const totalDays = Math.max(1, calendarDaysInclusive(startDate, endDate));
  const cappedToday = today < startDate ? startDate : today > endDate ? endDate : today;
  const elapsedDays =
    today < startDate ? 0 : calendarDaysInclusive(startDate, cappedToday);
  const projectMonths = totalDays / AVG_DAYS_PER_MONTH;
  const accrued = monthlyFee * projectMonths * (elapsedDays / totalDays);
  return Math.round(accrued * 100) / 100;
}

export function tokenCostFromUsage(
  tokensUsed: number,
  ratePer1k: number,
): number {
  if (tokensUsed <= 0 || ratePer1k <= 0) return 0;
  return Math.round((tokensUsed / 1000) * ratePer1k * 100) / 100;
}

export type AiTokenRates = {
  blendedPer1k: number | null;
  inputPer1k: number | null;
  outputPer1k: number | null;
  cachePer1k: number | null;
};

export type AiUsageForCost = {
  tokensUsed: number | null;
  tokensInput: number | null;
  tokensOutput: number | null;
  tokensCache: number | null;
};

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Null split rate uses the blended rate. An explicit 0 does not. */
function componentRate(
  specific: number | null,
  blended: number | null,
): number {
  if (specific != null) return specific;
  return blended ?? 0;
}

function tokenCostForBreakdown(
  usage: AiUsageForCost,
  rates: AiTokenRates,
): number {
  const input = tokenCostFromUsage(
    usage.tokensInput ?? 0,
    componentRate(rates.inputPer1k, rates.blendedPer1k),
  );
  const output = tokenCostFromUsage(
    usage.tokensOutput ?? 0,
    componentRate(rates.outputPer1k, rates.blendedPer1k),
  );
  const cache = tokenCostFromUsage(
    usage.tokensCache ?? 0,
    componentRate(rates.cachePer1k, rates.blendedPer1k),
  );
  return roundMoney(input + output + cache);
}

/**
 * Token cost for a set of task usages.
 * Tasks with only `tokensUsed` are summed first, then priced once, so rounding
 * matches the pre-breakdown bill. Breakdown rows are priced with split rates.
 */
export function tokenCostForUsages(
  usages: readonly AiUsageForCost[],
  rates: AiTokenRates,
): number {
  let blendedTokens = 0;
  let splitCost = 0;
  for (const usage of usages) {
    if (usageHasTokenBreakdown(usage)) {
      splitCost += tokenCostForBreakdown(usage, rates);
    } else {
      blendedTokens += usage.tokensUsed ?? 0;
    }
  }
  return roundMoney(
    tokenCostFromUsage(blendedTokens, rates.blendedPer1k ?? 0) + splitCost,
  );
}

export function usageTokenTotal(usage: AiUsageForCost): number {
  if (usageHasTokenBreakdown(usage)) {
    if (usage.tokensUsed != null) return usage.tokensUsed;
    return (
      (usage.tokensInput ?? 0) +
      (usage.tokensOutput ?? 0) +
      (usage.tokensCache ?? 0)
    );
  }
  return usage.tokensUsed ?? 0;
}

/**
 * One AI assistant's contribution to AC.
 * Mixed = flat fee accrued over the project window + token cost.
 * API = token cost only. Flat = accrued fee only. note_only / unset = $0.
 */
export function billAiAssistantUsage(input: {
  costMode: AiCostMode | null;
  flatMonthlyFee: number;
  rates: AiTokenRates;
  usages: readonly AiUsageForCost[];
  startDate: string | null;
  endDate: string | null;
  today?: string;
}): {
  flatAccruedCost: number;
  tokenCost: number;
  noteOnlyTokens: number;
  billableCost: number;
} {
  const tokens = input.usages.reduce(
    (sum, usage) => sum + usageTokenTotal(usage),
    0,
  );
  let flatAccruedCost = 0;
  let tokenCost = 0;
  let noteOnlyTokens = 0;

  if (input.costMode === 'flat' || input.costMode === 'mixed') {
    flatAccruedCost = accrueFlatMonthlyFee(
      input.flatMonthlyFee,
      input.startDate,
      input.endDate,
      input.today,
    );
  }
  if (input.costMode === 'api' || input.costMode === 'mixed') {
    tokenCost = tokenCostForUsages(input.usages, input.rates);
  }
  if (input.costMode === 'note_only') {
    noteOnlyTokens = tokens;
  }

  const billableCost =
    input.costMode === 'note_only' || input.costMode == null
      ? 0
      : roundMoney(flatAccruedCost + tokenCost);

  return { flatAccruedCost, tokenCost, noteOnlyTokens, billableCost };
}

export async function computeAiBudgetCosts(
  database: Database,
  projectId: string,
  project: {
    startDate: string | null;
    endDate: string | null;
  },
  today = todayYmd(),
): Promise<{
  aiBillableCost: number;
  aiNoteOnlyTokens: number;
  aiFlatAc: number;
  aiTokenAc: number;
  aiSystems: AiBudgetBreakdown[];
}> {
  const assistantRows = await database.db
    .select({
      id: systems.id,
      name: systems.name,
      aiCostMode: systems.aiCostMode,
      aiFlatMonthlyFee: systems.aiFlatMonthlyFee,
      aiTokenRatePer1k: systems.aiTokenRatePer1k,
      aiTokenRateInputPer1k: systems.aiTokenRateInputPer1k,
      aiTokenRateOutputPer1k: systems.aiTokenRateOutputPer1k,
      aiTokenRateCachePer1k: systems.aiTokenRateCachePer1k,
      aiBudgetAllocation: systems.aiBudgetAllocation,
    })
    .from(systems)
    .where(
      and(
        eq(systems.projectId, projectId),
        eq(systems.systemType, AI_ASSISTANT_SYSTEM_TYPE),
        isNull(systems.archivedAt),
      ),
    );

  const taskRows = await database.db
    .select({
      tokensUsed: projectTasks.tokensUsed,
      tokensInput: projectTasks.tokensInput,
      tokensOutput: projectTasks.tokensOutput,
      tokensCache: projectTasks.tokensCache,
      aiSystemId: projectTasks.aiSystemId,
      status: projectTasks.status,
    })
    .from(projectTasks)
    .where(
      and(eq(projectTasks.projectId, projectId), isNull(projectTasks.archivedAt)),
    );

  const usagesBySystem = new Map<string, AiUsageForCost[]>();
  let orphanTokens = 0;
  for (const task of taskRows) {
    if (task.status === 'cancelled') continue;
    const usage: AiUsageForCost = {
      tokensUsed: task.tokensUsed,
      tokensInput: task.tokensInput,
      tokensOutput: task.tokensOutput,
      tokensCache: task.tokensCache,
    };
    const tokens = usageTokenTotal(usage);
    if (tokens <= 0 && !usageHasTokenBreakdown(usage)) continue;
    if (task.aiSystemId) {
      const list = usagesBySystem.get(task.aiSystemId) ?? [];
      list.push(usage);
      usagesBySystem.set(task.aiSystemId, list);
    } else if (tokens > 0) {
      orphanTokens += tokens;
    }
  }

  const aiSystems: AiBudgetBreakdown[] = [];
  let aiBillableCost = 0;
  let aiFlatAc = 0;
  let aiTokenAc = 0;
  let aiNoteOnlyTokens = orphanTokens;

  for (const row of assistantRows) {
    const modeParsed = row.aiCostMode
      ? aiCostModeSchema.safeParse(row.aiCostMode)
      : null;
    const costMode = modeParsed?.success ? modeParsed.data : null;
    const allocation = parseNumeric(row.aiBudgetAllocation);
    const billed = billAiAssistantUsage({
      costMode,
      flatMonthlyFee: parseNumeric(row.aiFlatMonthlyFee) ?? 0,
      rates: {
        blendedPer1k: parseNumeric(row.aiTokenRatePer1k),
        inputPer1k: parseNumeric(row.aiTokenRateInputPer1k),
        outputPer1k: parseNumeric(row.aiTokenRateOutputPer1k),
        cachePer1k: parseNumeric(row.aiTokenRateCachePer1k),
      },
      usages: usagesBySystem.get(row.id) ?? [],
      startDate: project.startDate,
      endDate: project.endDate,
      today,
    });

    aiBillableCost += billed.billableCost;
    aiFlatAc += billed.flatAccruedCost;
    aiTokenAc += billed.tokenCost;
    aiNoteOnlyTokens += billed.noteOnlyTokens;

    aiSystems.push({
      systemId: row.id,
      name: row.name,
      costMode,
      flatAccruedCost: billed.flatAccruedCost,
      tokenCost: billed.tokenCost,
      noteOnlyTokens: billed.noteOnlyTokens,
      billableCost: billed.billableCost,
      budgetAllocation: allocation,
      overAllocation:
        allocation != null && billed.billableCost > allocation,
    });
  }

  return {
    aiBillableCost: roundMoney(aiBillableCost),
    aiFlatAc: roundMoney(aiFlatAc),
    aiTokenAc: roundMoney(aiTokenAc),
    aiNoteOnlyTokens,
    aiSystems,
  };
}

/**
 * OpEx for non-AI catalogue systems linked to the project.
 * AI assistants are handled by {@link computeAiBudgetCosts}.
 */
export async function computeSystemItBudgetCosts(
  database: Database,
  projectId: string,
  project: {
    startDate: string | null;
    endDate: string | null;
  },
  today = todayYmd(),
): Promise<{
  systemBillableCost: number;
  itSystems: SystemItBudgetBreakdown[];
}> {
  const rows = await database.db
    .select({
      id: systems.id,
      name: systems.name,
      itCostMode: systems.itCostMode,
      itFlatMonthlyFee: systems.itFlatMonthlyFee,
      itOneTimeCost: systems.itOneTimeCost,
      itBudgetAllocation: systems.itBudgetAllocation,
    })
    .from(systems)
    .where(
      and(
        eq(systems.projectId, projectId),
        isNull(systems.archivedAt),
        or(
          isNull(systems.systemType),
          ne(systems.systemType, AI_ASSISTANT_SYSTEM_TYPE),
        ),
      ),
    );

  const itSystems: SystemItBudgetBreakdown[] = [];
  let systemBillableCost = 0;

  for (const row of rows) {
    const modeParsed = row.itCostMode
      ? systemItCostModeSchema.safeParse(row.itCostMode)
      : null;
    const costMode = modeParsed?.success ? modeParsed.data : null;
    const flatFee = parseNumeric(row.itFlatMonthlyFee) ?? 0;
    const oneTime = parseNumeric(row.itOneTimeCost) ?? 0;
    const allocation = parseNumeric(row.itBudgetAllocation);

    let flatAccruedCost = 0;
    let oneTimeCost = 0;

    if (costMode === 'flat') {
      flatAccruedCost = accrueFlatMonthlyFee(
        flatFee,
        project.startDate,
        project.endDate,
        today,
      );
    }
    if (costMode === 'one_time') {
      oneTimeCost = oneTime > 0 ? Math.round(oneTime * 100) / 100 : 0;
    }

    const billableCost =
      costMode === 'note_only' || costMode == null
        ? 0
        : Math.round((flatAccruedCost + oneTimeCost) * 100) / 100;

    systemBillableCost += billableCost;
    itSystems.push({
      systemId: row.id,
      name: row.name,
      costMode,
      flatAccruedCost,
      oneTimeCost,
      billableCost,
      budgetAllocation: allocation,
      overAllocation: allocation != null && billableCost > allocation,
    });
  }

  return {
    systemBillableCost: Math.round(systemBillableCost * 100) / 100,
    itSystems,
  };
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
    if (!row.userId) continue;
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
    initialBudget: number | null;
    approvedBudget: number | null;
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

function withNonPersonAc(
  evm: ReturnType<typeof computeEvmFromCosts>,
  aiBillableCost: number,
  systemBillableCost: number,
): ReturnType<typeof computeEvmFromCosts> & {
  personAc: number;
  aiAc: number;
  systemAc: number;
} {
  const personAc = evm.ac;
  const ac =
    Math.round((personAc + aiBillableCost + systemBillableCost) * 100) / 100;
  const cpi = ac > 0 ? Math.round((evm.ev / ac) * 1000) / 1000 : null;
  return {
    ...evm,
    ac,
    cpi,
    personAc,
    aiAc: aiBillableCost,
    systemAc: systemBillableCost,
    financialRag: computeFinancialRag({ bac: evm.bac, ac, cpi }),
  };
}

export async function upsertProjectCostSnapshot(
  database: Database,
  projectId: string,
): Promise<void> {
  const { project } = await requireProjectContext(database, projectId);
  const costs = await listTaskBudgetCosts(database, projectId);
  const evm = computeEvmFromCosts(project, costs);
  const ai = await computeAiBudgetCosts(database, projectId, project);
  const it = await computeSystemItBudgetCosts(database, projectId, project);
  const merged = withNonPersonAc(evm, ai.aiBillableCost, it.systemBillableCost);
  if (merged.bac == null) return;

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
        bac: merged.bac,
        pv: merged.pv,
        ev: merged.ev,
        ac: merged.ac,
        updatedAt: new Date(),
      })
      .where(eq(projectCostSnapshots.id, existing.id));
    return;
  }

  await database.db.insert(projectCostSnapshots).values({
    projectId,
    capturedOn,
    bac: merged.bac,
    pv: merged.pv,
    ev: merged.ev,
    ac: merged.ac,
  });
}

export async function getProjectBudgetSummary(
  database: Database,
  projectId: string,
): Promise<ProjectBudgetSummary> {
  const { project } = await requireProjectContext(database, projectId);
  const costs = await listTaskBudgetCosts(database, projectId);
  const evm = computeEvmFromCosts(project, costs);
  const ai = await computeAiBudgetCosts(database, projectId, project);
  const it = await computeSystemItBudgetCosts(database, projectId, project);
  const merged = withNonPersonAc(evm, ai.aiBillableCost, it.systemBillableCost);

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
    ...merged,
    aiFlatAc: ai.aiFlatAc,
    aiTokenAc: ai.aiTokenAc,
    aiNoteOnlyTokens: ai.aiNoteOnlyTokens,
    aiSystems: ai.aiSystems,
    itSystems: it.itSystems,
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
): number | null | undefined {
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
  return n;
}

/** Returns `undefined` when input is omitted (leave column unchanged). */
export function parseHours(
  value: number | string | null | undefined,
): number | null | undefined {
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
  return n;
}

export function parseTokenRate(
  value: number | string | null | undefined,
): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) {
    throw new AppError({
      code: 'TOKEN_RATE_INVALID',
      message: 'Token rate must be a non-negative number',
      statusCode: 400,
    });
  }
  return n;
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
