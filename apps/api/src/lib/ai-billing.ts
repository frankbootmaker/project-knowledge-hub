import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import type { Database } from '@project-knowledge-hub/database';
import {
  aiBillingAllocationOverrides,
  aiBillingEntries,
  ensureExchangeRates,
  loadExchangeRateBook,
  projectTasks,
  projects,
  systems,
  workspaces,
} from '@project-knowledge-hub/database';
import {
  assertAiBillingPeriod,
  assertAllocationPercent,
  assertServiceDate,
  buildPlatformAiCost,
  convertMoney,
  isAiBillingActiveProject,
  paidConversionDate,
  parseUsageOccurredAt,
  projectCurrencySchema,
  theoreticalUsageDate,
  resolveAiBillingWindow,
  resolveBillingServiceWindow,
  roundAiMoney,
  settleProjectAiCost,
  splitBillingEntryByMonth,
  usageHasTokenBreakdown,
  type AiBillingAllocationMethod,
  type AiBillingEntryType,
  type AiBillingProjectShare,
  type AiCostUsageSlice,
  type AiFallbackSystem,
  type AiPaidPeriod,
  type FxConversion,
  type FxFetcher,
  type FxRate,
  type PlatformAiCostEntry,
  type PlatformAiWorkspaceMonth,
  type ProjectCurrency,
  AppError,
} from '@project-knowledge-hub/domain';

export type { AiPaidPeriod };
import { AI_ASSISTANT_SYSTEM_TYPE } from './ai-assistant-systems.js';
import { loadCompletedAtByTask } from './project-delivery.js';
import {
  addTheoreticalCost,
  foldBillingSlices,
  sumTheoreticalInCurrency,
  tokenRateCurrency,
  type CostSlice,
  type FoldedChartPoint,
  type SliceCandidate,
} from './ai-cost-fx.js';
import {
  tokenCostForUsages,
  usageTokenTotal,
  type AiTokenRates,
  type AiUsageForCost,
} from './project-budget.js';

const PROVIDER_MAX = 80;
const PLAN_MAX = 80;
const NOTE_MAX = 500;
const REF_MAX = 120;

export type PublicAiBillingEntry = {
  id: string;
  workspaceId: string;
  aiSystemId: string | null;
  period: string;
  servicePeriodStart: string | null;
  servicePeriodEnd: string | null;
  provider: string;
  plan: string | null;
  type: AiBillingEntryType;
  amount: number;
  currency: ProjectCurrency;
  paidAt: string | null;
  note: string | null;
  externalRef: string | null;
  createdAt: string;
  updatedAt: string;
  /** Amount in the workspace reporting currency. Same as amount when unconverted. */
  convertedAmount?: number;
  convertedCurrency?: string;
  fxRate?: number | null;
  fxRateDate?: string | null;
  fxSource?: string | null;
};

export type AiBillingEntryWrite = {
  aiSystemId?: string | null;
  /** YYYY-MM. Derived from servicePeriodStart when that date is set. */
  period?: string;
  servicePeriodStart?: string | null;
  servicePeriodEnd?: string | null;
  provider: string;
  plan?: string | null;
  type: AiBillingEntryType;
  amount: number | string;
  currency: string;
  paidAt?: string | null;
  note?: string | null;
  externalRef?: string | null;
};

export type AiSystemPaidInput = AiFallbackSystem & {
  rates: AiTokenRates;
};

export type ProjectPaidAi = {
  aiPaidAc: number;
  aiTheoreticalApiCost: number;
  periods: AiPaidPeriod[];
  systemPaid: Array<{ systemId: string; amount: number }>;
  entries: PublicAiBillingEntry[];
  /** Theoretical API cost by sprint. Paid fees stay on the calendar month. */
  sprints: Array<{
    sprintId: string;
    theoreticalApiCost: number;
    tokens: number;
  }>;
  /** Workspace reporting currency. Paid shares below are in the project currency. */
  reportingCurrency: ProjectCurrency;
  /** Allocated paid cost converted into the reporting currency. */
  aiPaidReporting: number;
  /** Theoretical API cost converted into the reporting currency. */
  aiTheoreticalReporting: number;
  /** One line per source-currency conversion that landed on this project. */
  aiCostFx: FxConversion[];
};

type EntryRow = typeof aiBillingEntries.$inferSelect;

function toPublicEntry(row: EntryRow): PublicAiBillingEntry {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    aiSystemId: row.aiSystemId,
    period: row.period,
    servicePeriodStart: row.servicePeriodStart,
    servicePeriodEnd: row.servicePeriodEnd,
    provider: row.provider,
    plan: row.plan,
    type: row.type as AiBillingEntryType,
    amount: Number(row.amount),
    currency: projectCurrencySchema.parse(row.currency),
    paidAt: row.paidAt?.toISOString() ?? null,
    note: row.note,
    externalRef: row.externalRef,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function parseLabel(
  value: string | null | undefined,
  field: string,
  max: number,
  required: boolean,
): string | null {
  if (value == null || value.trim() === '') {
    if (required) {
      throw new AppError({
        code: 'BILLING_FIELD_INVALID',
        message: `${field} is required`,
        statusCode: 400,
      });
    }
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length > max) {
    throw new AppError({
      code: 'BILLING_FIELD_INVALID',
      message: `${field} must be at most ${max} characters`,
      statusCode: 400,
    });
  }
  return trimmed;
}

export function parseBillingAmount(
  type: AiBillingEntryType,
  value: number | string | null | undefined,
): number {
  if (value == null || value === '') {
    throw new AppError({
      code: 'BILLING_AMOUNT_INVALID',
      message: 'amount is required',
      statusCode: 400,
    });
  }
  const amount = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(amount) || Math.abs(amount) > 1_000_000_000_000) {
    throw new AppError({
      code: 'BILLING_AMOUNT_INVALID',
      message: 'amount must be a finite number',
      statusCode: 400,
    });
  }
  const rounded = roundAiMoney(amount);
  if (type !== 'plan_change' && rounded < 0) {
    throw new AppError({
      code: 'BILLING_AMOUNT_INVALID',
      message: 'Only a plan_change entry may be negative',
      statusCode: 400,
    });
  }
  return rounded;
}

async function assertAiSystemInWorkspace(
  database: Database,
  workspaceId: string,
  aiSystemId: string | null,
): Promise<void> {
  if (!aiSystemId) return;
  const [system] = await database.db
    .select({
      id: systems.id,
      systemType: systems.systemType,
      workspaceId: systems.workspaceId,
    })
    .from(systems)
    .where(and(eq(systems.id, aiSystemId), isNull(systems.archivedAt)))
    .limit(1);
  if (
    !system ||
    system.workspaceId !== workspaceId ||
    system.systemType !== AI_ASSISTANT_SYSTEM_TYPE
  ) {
    throw new AppError({
      code: 'SYSTEM_NOT_AI_ASSISTANT',
      message: 'aiSystemId must be an AI assistant in this workspace',
      statusCode: 400,
    });
  }
}

export async function listAiBillingEntries(
  database: Database,
  workspaceId: string,
  filter?: BillingListFilter,
): Promise<PublicAiBillingEntry[]> {
  assertBillingListFilter(filter);
  const rows = await database.db
    .select()
    .from(aiBillingEntries)
    .where(eq(aiBillingEntries.workspaceId, workspaceId))
    .orderBy(desc(aiBillingEntries.period), desc(aiBillingEntries.createdAt));
  const entries = rows
    .map(toPublicEntry)
    .filter((entry) => entryMatchesBillingListFilter(entry, filter));
  const fxBook = await loadWorkspaceFx(
    database,
    workspaceId,
    entries.map((entry) =>
      paidConversionDate({
        paidAt: entry.paidAt,
        servicePeriodStart: entry.servicePeriodStart,
        period: entry.period,
      }),
    ),
  );
  return entries.map((entry) =>
    decorateEntry(entry, fxBook.reportingCurrency, fxBook.rates),
  );
}

export async function createAiBillingEntry(
  database: Database,
  workspaceId: string,
  input: AiBillingEntryWrite,
  createdBy: string | null,
): Promise<PublicAiBillingEntry> {
  const window = resolveBillingServiceWindow({
    period: input.period,
    servicePeriodStart: input.servicePeriodStart,
    servicePeriodEnd: input.servicePeriodEnd,
  });
  const type = input.type;
  const amount = parseBillingAmount(type, input.amount);
  const currency = projectCurrencySchema.parse(input.currency);
  const aiSystemId = input.aiSystemId ?? null;
  await assertAiSystemInWorkspace(database, workspaceId, aiSystemId);
  const paidAt = parseUsageOccurredAt(input.paidAt);
  const [row] = await database.db
    .insert(aiBillingEntries)
    .values({
      workspaceId,
      aiSystemId,
      period: window.period,
      servicePeriodStart: window.servicePeriodStart,
      servicePeriodEnd: window.servicePeriodEnd,
      provider: parseLabel(input.provider, 'provider', PROVIDER_MAX, true) ?? '',
      plan: parseLabel(input.plan, 'plan', PLAN_MAX, false),
      type,
      amount,
      currency,
      paidAt: paidAt ?? null,
      note: parseLabel(input.note, 'note', NOTE_MAX, false),
      externalRef: parseLabel(input.externalRef, 'externalRef', REF_MAX, false),
      createdBy,
    })
    .returning();
  if (!row) {
    throw new AppError({
      code: 'BILLING_ENTRY_CREATE_FAILED',
      message: 'Failed to create billing entry',
      statusCode: 500,
    });
  }
  return toPublicEntry(row);
}

export async function updateAiBillingEntry(
  database: Database,
  entryId: string,
  input: Partial<AiBillingEntryWrite>,
): Promise<PublicAiBillingEntry> {
  const [existing] = await database.db
    .select()
    .from(aiBillingEntries)
    .where(eq(aiBillingEntries.id, entryId))
    .limit(1);
  if (!existing) {
    throw new AppError({
      code: 'BILLING_ENTRY_NOT_FOUND',
      message: 'Billing entry not found',
      statusCode: 404,
    });
  }
  const type = (input.type ?? existing.type) as AiBillingEntryType;
  const amount =
    input.amount === undefined
      ? Number(existing.amount)
      : parseBillingAmount(type, input.amount);
  if (input.amount === undefined && type !== 'plan_change' && amount < 0) {
    throw new AppError({
      code: 'BILLING_AMOUNT_INVALID',
      message: 'Only a plan_change entry may be negative',
      statusCode: 400,
    });
  }
  const aiSystemId =
    input.aiSystemId === undefined ? existing.aiSystemId : input.aiSystemId;
  await assertAiSystemInWorkspace(database, existing.workspaceId, aiSystemId ?? null);
  const paidAt =
    input.paidAt === undefined
      ? existing.paidAt
      : parseUsageOccurredAt(input.paidAt) ?? null;
  const window = resolveBillingServiceWindow({
    period: input.period === undefined ? existing.period : input.period,
    servicePeriodStart:
      input.servicePeriodStart === undefined
        ? existing.servicePeriodStart
        : input.servicePeriodStart,
    servicePeriodEnd:
      input.servicePeriodEnd === undefined
        ? existing.servicePeriodEnd
        : input.servicePeriodEnd,
  });
  const [row] = await database.db
    .update(aiBillingEntries)
    .set({
      aiSystemId,
      period: window.period,
      servicePeriodStart: window.servicePeriodStart,
      servicePeriodEnd: window.servicePeriodEnd,
      provider:
        input.provider === undefined
          ? existing.provider
          : parseLabel(input.provider, 'provider', PROVIDER_MAX, true) ?? existing.provider,
      plan:
        input.plan === undefined
          ? existing.plan
          : parseLabel(input.plan, 'plan', PLAN_MAX, false),
      type,
      amount,
      currency:
        input.currency === undefined
          ? existing.currency
          : projectCurrencySchema.parse(input.currency),
      paidAt,
      note:
        input.note === undefined
          ? existing.note
          : parseLabel(input.note, 'note', NOTE_MAX, false),
      externalRef:
        input.externalRef === undefined
          ? existing.externalRef
          : parseLabel(input.externalRef, 'externalRef', REF_MAX, false),
      updatedAt: new Date(),
    })
    .where(eq(aiBillingEntries.id, entryId))
    .returning();
  if (!row) {
    throw new AppError({
      code: 'BILLING_ENTRY_UPDATE_FAILED',
      message: 'Failed to update billing entry',
      statusCode: 500,
    });
  }
  return toPublicEntry(row);
}

export async function deleteAiBillingEntry(
  database: Database,
  entryId: string,
): Promise<{ workspaceId: string }> {
  const [row] = await database.db
    .delete(aiBillingEntries)
    .where(eq(aiBillingEntries.id, entryId))
    .returning({ workspaceId: aiBillingEntries.workspaceId });
  if (!row) {
    throw new AppError({
      code: 'BILLING_ENTRY_NOT_FOUND',
      message: 'Billing entry not found',
      statusCode: 404,
    });
  }
  return row;
}

export async function getAiBillingEntry(
  database: Database,
  entryId: string,
): Promise<PublicAiBillingEntry | null> {
  const [row] = await database.db
    .select()
    .from(aiBillingEntries)
    .where(eq(aiBillingEntries.id, entryId))
    .limit(1);
  return row ? toPublicEntry(row) : null;
}

/**
 * Set or clear one project's percent of a pool. Passing null deletes it.
 * Overrides in the pool must still sum to at most 100.
 */
export async function setAiBillingAllocation(database: Database, input: {
  workspaceId: string;
  projectId: string;
  period: string;
  aiSystemId: string | null;
  percent: number | null;
}): Promise<void> {
  const period = assertAiBillingPeriod(input.period);
  const [project] = await database.db
    .select({ id: projects.id })
    .from(projects)
    .where(
      and(
        eq(projects.id, input.projectId),
        eq(projects.workspaceId, input.workspaceId),
      ),
    )
    .limit(1);
  if (!project) {
    throw new AppError({
      code: 'PROJECT_NOT_FOUND',
      message: 'Project was not found in this workspace',
      statusCode: 404,
    });
  }
  await assertAiSystemInWorkspace(
    database,
    input.workspaceId,
    input.aiSystemId,
  );
  const existing = await database.db
    .select()
    .from(aiBillingAllocationOverrides)
    .where(eq(aiBillingAllocationOverrides.workspaceId, input.workspaceId));
  const samePool = existing.filter(
    (row) =>
      row.period === period &&
      (row.aiSystemId ?? null) === input.aiSystemId &&
      row.projectId !== input.projectId,
  );
  if (input.percent == null) {
    await database.db
      .delete(aiBillingAllocationOverrides)
      .where(
        and(
          eq(aiBillingAllocationOverrides.workspaceId, input.workspaceId),
          eq(aiBillingAllocationOverrides.projectId, input.projectId),
          eq(aiBillingAllocationOverrides.period, period),
          input.aiSystemId
            ? eq(aiBillingAllocationOverrides.aiSystemId, input.aiSystemId)
            : isNull(aiBillingAllocationOverrides.aiSystemId),
        ),
      );
    return;
  }
  const percent = assertAllocationPercent(input.percent);
  const sum =
    samePool.reduce((total, row) => total + Number(row.percent), 0) + percent;
  if (sum > 100 + 1e-9) {
    throw new AppError({
      code: 'BILLING_ALLOCATION_INVALID',
      message: 'Allocation overrides for a period must sum to at most 100',
      statusCode: 400,
    });
  }
  const current = existing.find(
    (row) =>
      row.projectId === input.projectId &&
      row.period === period &&
      (row.aiSystemId ?? null) === input.aiSystemId,
  );
  if (current) {
    await database.db
      .update(aiBillingAllocationOverrides)
      .set({ percent, updatedAt: new Date() })
      .where(eq(aiBillingAllocationOverrides.id, current.id));
    return;
  }
  await database.db.insert(aiBillingAllocationOverrides).values({
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    period,
    aiSystemId: input.aiSystemId,
    percent,
  });
}

function usagePeriod(
  billingPeriod: string | null,
  usageOccurredAt: Date | null,
): string | null {
  if (billingPeriod && /^\d{4}-(0[1-9]|1[0-2])$/.test(billingPeriod)) {
    return billingPeriod;
  }
  if (!usageOccurredAt) return null;
  const month = String(usageOccurredAt.getUTCMonth() + 1).padStart(2, '0');
  return `${usageOccurredAt.getUTCFullYear()}-${month}`;
}

type TaskUsageRow = {
  projectId: string;
  aiSystemId: string | null;
  sprintId: string | null;
  period: string | null;
  usageOccurredAt: Date | null;
  onDate: string;
  usage: AiUsageForCost;
  tokens: number;
};

async function taskUsageRows(
  database: Database,
  taskRows: ReadonlyArray<{
    id: string;
    projectId: string;
    aiSystemId: string | null;
    sprintId?: string | null;
    status: string;
    tokensUsed: number | null;
    tokensInput: number | null;
    tokensOutput: number | null;
    tokensCache: number | null;
    tokensCacheWrite: number | null;
    billingPeriod: string | null;
    usageOccurredAt: Date | null;
    updatedAt: Date;
  }>,
  today: string,
): Promise<TaskUsageRow[]> {
  const completedAt = await loadCompletedAtByTask(
    database,
    taskRows.map((row) => row.id),
  );
  const usages: TaskUsageRow[] = [];
  for (const task of taskRows) {
    if (task.status === 'cancelled') continue;
    const usage: AiUsageForCost = {
      tokensUsed: task.tokensUsed,
      tokensInput: task.tokensInput,
      tokensOutput: task.tokensOutput,
      tokensCache: task.tokensCache,
      tokensCacheWrite: task.tokensCacheWrite,
    };
    const tokens = usageTokenTotal(usage);
    if (tokens <= 0 && !usageHasTokenBreakdown(usage)) continue;
    const period = usagePeriod(task.billingPeriod, task.usageOccurredAt);
    usages.push({
      projectId: task.projectId,
      aiSystemId: task.aiSystemId,
      sprintId: task.sprintId ?? null,
      period,
      usageOccurredAt: task.usageOccurredAt,
      onDate: theoreticalUsageDate({
        usageOccurredAt: task.usageOccurredAt,
        completedAt: completedAt.get(task.id) ?? null,
        updatedAt: task.updatedAt,
        period,
        fallback: today,
      }),
      usage,
      tokens,
    });
  }
  return usages;
}

function poolId(period: string, aiSystemId: string | null, currency: string): string {
  return `${period}|${aiSystemId ?? ''}|${currency}`;
}

export type BillingMonthPool = {
  period: string;
  aiSystemId: string | null;
  currency: string;
  subscription: number;
  planChange: number;
  onDemand: number;
  paidTotal: number;
};

/**
 * Paid amount of each entry, split by `splitBillingEntryByMonth`, summed
 * into month + system + currency pools.
 */
export function monthPoolsFromBillingEntries(
  entries: readonly {
    period: string;
    aiSystemId: string | null;
    currency: string;
    type: string;
    amount: number | string;
    servicePeriodStart?: string | null;
    servicePeriodEnd?: string | null;
  }[],
): Map<string, BillingMonthPool> {
  const pools = new Map<string, BillingMonthPool>();
  for (const entry of entries) {
    const slices = splitBillingEntryByMonth({
      amount: Number(entry.amount),
      period: entry.period,
      servicePeriodStart: entry.servicePeriodStart ?? null,
      servicePeriodEnd: entry.servicePeriodEnd ?? null,
    });
    for (const slice of slices) {
      const key = poolId(slice.period, entry.aiSystemId, entry.currency);
      const pool = pools.get(key) ?? {
        period: slice.period,
        aiSystemId: entry.aiSystemId,
        currency: entry.currency,
        subscription: 0,
        planChange: 0,
        onDemand: 0,
        paidTotal: 0,
      };
      pool.paidTotal += slice.amount;
      if (entry.type === 'subscription') pool.subscription += slice.amount;
      else if (entry.type === 'plan_change') pool.planChange += slice.amount;
      else pool.onDemand += slice.amount;
      pools.set(key, pool);
    }
  }
  return pools;
}

export type BillingListFilter = {
  period?: string;
  aiSystemId?: string;
  servicePeriodStart?: string;
  servicePeriodEnd?: string;
};

/** Service window [start, end). `end` is the exclusive renewal date. */
function serviceBounds(entry: {
  period: string;
  servicePeriodStart: string | null;
  servicePeriodEnd: string | null;
}): { start: string; end: string } | null {
  if (entry.servicePeriodStart && entry.servicePeriodEnd) {
    return { start: entry.servicePeriodStart, end: entry.servicePeriodEnd };
  }
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(entry.period);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  return {
    start: `${entry.period}-01`,
    end: `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`,
  };
}

function assertBillingListFilter(filter: BillingListFilter | undefined): void {
  if (!filter) return;
  const start = filter.servicePeriodStart
    ? assertServiceDate(filter.servicePeriodStart, 'servicePeriodStart')
    : null;
  const end = filter.servicePeriodEnd
    ? assertServiceDate(filter.servicePeriodEnd, 'servicePeriodEnd')
    : null;
  if (start && end && end < start) {
    throw new AppError({
      code: 'INVALID_DATE_RANGE',
      message: `servicePeriodEnd (${end}) must be on or after servicePeriodStart (${start})`,
      statusCode: 400,
    });
  }
}

/** Period matches any month the entry contributes to, not only its start month. */
export function entryMatchesBillingListFilter(
  entry: {
    period: string;
    aiSystemId: string | null;
    amount: number;
    servicePeriodStart: string | null;
    servicePeriodEnd: string | null;
  },
  filter?: BillingListFilter,
): boolean {
  if (!filter) return true;
  if (filter.aiSystemId && entry.aiSystemId !== filter.aiSystemId) return false;
  if (filter.period) {
    const hit = splitBillingEntryByMonth({
      amount: entry.amount,
      period: entry.period,
      servicePeriodStart: entry.servicePeriodStart,
      servicePeriodEnd: entry.servicePeriodEnd,
    }).some((slice) => slice.period === filter.period);
    if (!hit) return false;
  }
  if (filter.servicePeriodStart || filter.servicePeriodEnd) {
    const bounds = serviceBounds(entry);
    if (!bounds) return false;
    if (filter.servicePeriodStart && bounds.end <= filter.servicePeriodStart) {
      return false;
    }
    if (filter.servicePeriodEnd && bounds.start > filter.servicePeriodEnd) {
      return false;
    }
  }
  return true;
}

/**
 * Allocate the workspace ledger onto one project and compare it with the
 * theoretical API cost. With no applicable ledger entries, paid AC is the
 * legacy bill exactly.
 */
export async function loadProjectPaidAi(
  database: Database,
  project: {
    id: string;
    workspaceId: string;
    currency: string;
    startDate: string | null;
    endDate: string | null;
  },
  systemInputs: readonly AiSystemPaidInput[],
  today: string,
): Promise<ProjectPaidAi> {
  const currency = projectCurrencySchema.parse(project.currency);
  const [entryRows, overrideRows, projectRows, assistantRows, taskRows] =
    await Promise.all([
      database.db
        .select()
        .from(aiBillingEntries)
        .where(eq(aiBillingEntries.workspaceId, project.workspaceId))
        .orderBy(asc(aiBillingEntries.period)),
      database.db
        .select()
        .from(aiBillingAllocationOverrides)
        .where(eq(aiBillingAllocationOverrides.workspaceId, project.workspaceId)),
      database.db
        .select({
          id: projects.id,
          status: projects.status,
          currency: projects.currency,
          archivedAt: projects.archivedAt,
        })
        .from(projects)
        .where(eq(projects.workspaceId, project.workspaceId)),
      database.db
        .select({
          id: systems.id,
          projectId: systems.projectId,
        })
        .from(systems)
        .where(
          and(
            eq(systems.workspaceId, project.workspaceId),
            eq(systems.systemType, AI_ASSISTANT_SYSTEM_TYPE),
            isNull(systems.archivedAt),
          ),
        ),
      database.db
        .select({
          id: projectTasks.id,
          projectId: projectTasks.projectId,
          aiSystemId: projectTasks.aiSystemId,
          sprintId: projectTasks.sprintId,
          status: projectTasks.status,
          tokensUsed: projectTasks.tokensUsed,
          tokensInput: projectTasks.tokensInput,
          tokensOutput: projectTasks.tokensOutput,
          tokensCache: projectTasks.tokensCache,
          tokensCacheWrite: projectTasks.tokensCacheWrite,
          billingPeriod: projectTasks.billingPeriod,
          usageOccurredAt: projectTasks.usageOccurredAt,
          updatedAt: projectTasks.updatedAt,
        })
        .from(projectTasks)
        .innerJoin(projects, eq(projectTasks.projectId, projects.id))
        .where(
          and(
            eq(projects.workspaceId, project.workspaceId),
            isNull(projectTasks.archivedAt),
            isNull(projects.archivedAt),
          ),
        ),
    ]);

  const usages = await taskUsageRows(database, taskRows, today);

  const ratesBySystem = new Map(
    systemInputs.map((system) => [system.systemId, system.rates]),
  );
  const modeBySystem = new Map(
    systemInputs.map((system) => [system.systemId, system.costMode]),
  );

  const tokensOf = (
    projectId: string,
    period: string,
    aiSystemId: string | null,
  ) =>
    usages
      .filter(
        (row) =>
          row.projectId === projectId &&
          row.period === period &&
          (aiSystemId == null || row.aiSystemId === aiSystemId),
      )
      .reduce((sum, row) => sum + row.tokens, 0);

  const openProjects = projectRows.filter(
    (row) => !row.archivedAt && row.status !== 'archived',
  );
  const systemProjectId = new Map(
    assistantRows.map((row) => [row.id, row.projectId]),
  );

  const paidSlices = slicesFromEntries(entryRows);
  const fxDates = [
    ...paidSlices.map((slice) => slice.onDate),
    ...usages.map((row) => row.onDate),
  ];
  const fxBook = await loadWorkspaceFx(database, project.workspaceId, fxDates);
  const folded = foldBillingSlices({
    slices: paidSlices,
    reportingCurrency: fxBook.reportingCurrency,
    rates: fxBook.rates,
    candidates: (slice) =>
      allocationCandidates({
        slice,
        openProjects,
        systemProjectId,
        overrideRows,
        tokensOf,
      }),
  });
  const shares: AiBillingProjectShare[] = folded.sharesByProject.get(project.id) ?? [];

  const sliceGroups = new Map<
    string,
    { period: string | null; systemId: string | null; rows: TaskUsageRow[]; tokens: number }
  >();
  for (const row of usages) {
    if (row.projectId !== project.id) continue;
    const key = `${row.period ?? ''}|${row.aiSystemId ?? ''}`;
    const group = sliceGroups.get(key) ?? {
      period: row.period,
      systemId: row.aiSystemId,
      rows: [],
      tokens: 0,
    };
    group.rows.push(row);
    group.tokens += row.tokens;
    sliceGroups.set(key, group);
  }
  const usageSlices: AiCostUsageSlice[] = [...sliceGroups.values()].map((group) => {
    const rates = group.systemId ? ratesBySystem.get(group.systemId) : undefined;
    const raw = rates ? tokenCostForUsages(group.rows.map((row) => row.usage), rates) : 0;
    const mode = group.systemId ? modeBySystem.get(group.systemId) : null;
    const legacyToken = rates && (mode === 'api' || mode === 'mixed') ? raw : 0;
    const theoretical = rates
      ? sumTheoreticalInCurrency({
          parts: group.rows.map((row) => ({
            amount: tokenCostForUsages([row.usage], rates),
            onDate: row.onDate,
          })),
          from: tokenRateCurrency(rates.currency, currency),
          to: currency,
          rates: fxBook.rates,
        })
      : 0;
    return {
      period: group.period,
      systemId: group.systemId,
      theoretical,
      legacyToken,
      tokens: group.tokens,
    };
  });

  const sprintGroups = new Map<
    string,
    { sprintId: string; rows: TaskUsageRow[]; tokens: number; systemId: string | null }
  >();
  for (const row of usages) {
    if (row.projectId !== project.id || !row.sprintId) continue;
    const key = `${row.sprintId}|${row.aiSystemId ?? ''}`;
    const group = sprintGroups.get(key) ?? {
      sprintId: row.sprintId,
      rows: [],
      tokens: 0,
      systemId: row.aiSystemId,
    };
    group.rows.push(row);
    group.tokens += row.tokens;
    sprintGroups.set(key, group);
  }
  const sprintTotals = new Map<string, { theoreticalApiCost: number; tokens: number }>();
  for (const group of sprintGroups.values()) {
    const rates = group.systemId ? ratesBySystem.get(group.systemId) : undefined;
    const theoretical = rates
      ? sumTheoreticalInCurrency({
          parts: group.rows.map((row) => ({
            amount: tokenCostForUsages([row.usage], rates),
            onDate: row.onDate,
          })),
          from: tokenRateCurrency(rates.currency, currency),
          to: currency,
          rates: fxBook.rates,
        })
      : 0;
    const current = sprintTotals.get(group.sprintId) ?? {
      theoreticalApiCost: 0,
      tokens: 0,
    };
    current.theoreticalApiCost += theoretical;
    current.tokens += group.tokens;
    sprintTotals.set(group.sprintId, current);
  }

  const settled = settleProjectAiCost({
    today,
    startDate: project.startDate,
    endDate: project.endDate,
    systems: systemInputs,
    legacyBillableCost: roundAiMoney(
      systemInputs.reduce((sum, system) => sum + system.legacyBillable, 0),
    ),
    ledgerEmpty: shares.length === 0,
    shares,
    usage: usageSlices,
  });

  let theoreticalReporting = 0;
  for (const row of usages) {
    if (row.projectId !== project.id || !row.aiSystemId) continue;
    const rates = ratesBySystem.get(row.aiSystemId);
    if (!rates) continue;
    const amount = tokenCostForUsages([row.usage], rates);
    theoreticalReporting += sumTheoreticalInCurrency({
      parts: [{ amount, onDate: row.onDate }],
      from: tokenRateCurrency(rates.currency, currency),
      to: fxBook.reportingCurrency,
      rates: fxBook.rates,
    });
  }
  theoreticalReporting = roundAiMoney(theoreticalReporting);
  const projectShares = folded.sharesByProject.get(project.id) ?? [];
  const aiCostFx = projectShares.flatMap((share) =>
    share.conversions.filter(
      (conversion) =>
        conversion.originalCurrency !== conversion.currency || conversion.source !== 'identity',
    ),
  );

  return {
    ...settled,
    entries: entryRows.map((row) =>
      decorateEntry(toPublicEntry(row), fxBook.reportingCurrency, fxBook.rates),
    ),
    sprints: [...sprintTotals.entries()]
      .map(([sprintId, value]) => ({
        sprintId,
        theoreticalApiCost: roundAiMoney(value.theoreticalApiCost),
        tokens: value.tokens,
      }))
      .sort((a, b) => a.sprintId.localeCompare(b.sprintId)),
    reportingCurrency: fxBook.reportingCurrency,
    aiPaidReporting: roundAiMoney(
      projectShares.reduce((sum, share) => sum + share.reportingAmount, 0),
    ),
    aiTheoreticalReporting: roundAiMoney(theoreticalReporting),
    aiCostFx,
  };
}

export type WorkspaceAiAllocationProject = {
  projectId: string;
  name: string;
  slug: string;
  tokens: number;
  overridePercent: number | null;
  /** Display amount: reporting currency, or the original amount when unconverted. */
  amount: number;
  method: AiBillingAllocationMethod;
  originalAmount: number;
  projectAmount: number;
  projectCurrency: string;
  reportingAmount: number;
  fxRate: number | null;
  fxRateDate: string | null;
  fxSource: string | null;
};

export type WorkspaceAiCostPool = {
  period: string;
  currency: ProjectCurrency;
  originalCurrency: string;
  aiSystemId: string | null;
  aiSystemName: string | null;
  paidTotal: number;
  originalPaidTotal: number;
  fxRate: number | null;
  fxRateDate: string | null;
  fxSource: string | null;
  projects: WorkspaceAiAllocationProject[];
};

export type WorkspaceAiCostChartPoint = {
  period: string;
  currency: ProjectCurrency;
  paidCost: number;
  subscription: number;
  planChange: number;
  onDemand: number;
  theoreticalApiCost: number;
  fxRate: number | null;
  fxRateDate: string | null;
  fxSource: string | null;
};

export type WorkspaceAiCostOverview = {
  reportingCurrency: ProjectCurrency;
  entries: PublicAiBillingEntry[];
  chart: WorkspaceAiCostChartPoint[];
  originalChart: WorkspaceAiCostChartPoint[];
  pools: WorkspaceAiCostPool[];
};

/**
 * Workspace view of the ledger: paid totals by month, the theoretical API
 * line, and how each pool is split across projects.
 */
export async function loadWorkspaceAiCostOverview(
  database: Database,
  workspaceId: string,
  options?: { reportingCurrency?: ProjectCurrency },
): Promise<WorkspaceAiCostOverview> {
  const [entryRows, overrideRows, projectRows, assistantRows, taskRows] =
    await Promise.all([
      database.db
        .select()
        .from(aiBillingEntries)
        .where(eq(aiBillingEntries.workspaceId, workspaceId))
        .orderBy(desc(aiBillingEntries.period), desc(aiBillingEntries.createdAt)),
      database.db
        .select()
        .from(aiBillingAllocationOverrides)
        .where(eq(aiBillingAllocationOverrides.workspaceId, workspaceId)),
      database.db
        .select({
          id: projects.id,
          name: projects.name,
          slug: projects.slug,
          status: projects.status,
          currency: projects.currency,
          archivedAt: projects.archivedAt,
        })
        .from(projects)
        .where(eq(projects.workspaceId, workspaceId)),
      database.db
        .select({
          id: systems.id,
          name: systems.name,
          projectId: systems.projectId,
          aiTokenRatePer1k: systems.aiTokenRatePer1k,
          aiTokenRateInputPer1k: systems.aiTokenRateInputPer1k,
          aiTokenRateOutputPer1k: systems.aiTokenRateOutputPer1k,
          aiTokenRateCachePer1k: systems.aiTokenRateCachePer1k,
          aiTokenRateCacheWritePer1k: systems.aiTokenRateCacheWritePer1k,
          aiTokenRateCurrency: systems.aiTokenRateCurrency,
        })
        .from(systems)
        .where(
          and(
            eq(systems.workspaceId, workspaceId),
            eq(systems.systemType, AI_ASSISTANT_SYSTEM_TYPE),
            isNull(systems.archivedAt),
          ),
        ),
      database.db
        .select({
          id: projectTasks.id,
          projectId: projectTasks.projectId,
          aiSystemId: projectTasks.aiSystemId,
          status: projectTasks.status,
          tokensUsed: projectTasks.tokensUsed,
          tokensInput: projectTasks.tokensInput,
          tokensOutput: projectTasks.tokensOutput,
          tokensCache: projectTasks.tokensCache,
          tokensCacheWrite: projectTasks.tokensCacheWrite,
          billingPeriod: projectTasks.billingPeriod,
          usageOccurredAt: projectTasks.usageOccurredAt,
          updatedAt: projectTasks.updatedAt,
        })
        .from(projectTasks)
        .innerJoin(projects, eq(projectTasks.projectId, projects.id))
        .where(
          and(
            eq(projects.workspaceId, workspaceId),
            isNull(projectTasks.archivedAt),
            isNull(projects.archivedAt),
          ),
        ),
    ]);

  const today = new Date().toISOString().slice(0, 10);
  const usages = await taskUsageRows(database, taskRows, today);

  const ratesBySystem = new Map(
    assistantRows.map((row) => [
      row.id,
      {
        blendedPer1k: row.aiTokenRatePer1k,
        inputPer1k: row.aiTokenRateInputPer1k,
        outputPer1k: row.aiTokenRateOutputPer1k,
        cachePer1k: row.aiTokenRateCachePer1k,
        cacheWritePer1k: row.aiTokenRateCacheWritePer1k,
        currency: row.aiTokenRateCurrency,
      },
    ]),
  );
  const projectById = new Map(projectRows.map((row) => [row.id, row]));
  const systemName = new Map(assistantRows.map((row) => [row.id, row.name]));
  const systemProjectId = new Map(
    assistantRows.map((row) => [row.id, row.projectId]),
  );
  const openProjects = projectRows.filter(
    (row) => !row.archivedAt && row.status !== 'archived',
  );

  const tokensOf = (
    projectId: string,
    period: string,
    aiSystemId: string | null,
  ) =>
    usages
      .filter(
        (row) =>
          row.projectId === projectId &&
          row.period === period &&
          (aiSystemId == null || row.aiSystemId === aiSystemId),
      )
      .reduce((sum, row) => sum + row.tokens, 0);

  const paidSlices = slicesFromEntries(entryRows);
  const fxDates = [
    ...paidSlices.map((slice) => slice.onDate),
    ...usages.map((row) => row.onDate),
  ];
  const fxBook = await loadWorkspaceFx(
    database,
    workspaceId,
    fxDates,
    options?.reportingCurrency,
  );
  const folded = foldBillingSlices({
    slices: paidSlices,
    reportingCurrency: fxBook.reportingCurrency,
    rates: fxBook.rates,
    candidates: (slice) =>
      allocationCandidates({
        slice,
        openProjects,
        systemProjectId,
        overrideRows,
        tokensOf,
      }),
  });

  let reportingChart = folded.reportingChart;
  let originalChart = folded.originalChart;
  for (const row of usages) {
    if (!row.period || !row.aiSystemId) continue;
    const project = projectById.get(row.projectId);
    const parsed = project ? projectCurrencySchema.safeParse(project.currency) : null;
    if (!parsed?.success) continue;
    const tokenRates = ratesBySystem.get(row.aiSystemId);
    if (!tokenRates) continue;
    const amount = tokenCostForUsages([row.usage], tokenRates);
    if (amount === 0) continue;
    const rateCurrency = tokenRateCurrency(tokenRates.currency, parsed.data);
    reportingChart = addTheoreticalCost(reportingChart, {
      period: row.period,
      amount,
      currency: rateCurrency,
      reportingCurrency: fxBook.reportingCurrency,
      onDate: row.onDate,
      rates: fxBook.rates,
    }).chart;
    originalChart = addTheoreticalCost(originalChart, {
      period: row.period,
      amount,
      currency: rateCurrency,
      reportingCurrency: rateCurrency,
      onDate: row.onDate,
      rates: [],
    }).chart;
  }

  const pools = folded.pools.flatMap((pool) => {
    const displayCurrency = projectCurrencySchema.safeParse(
      pool.converted ? pool.reportingCurrency : pool.originalCurrency,
    );
    const originalCurrency = projectCurrencySchema.safeParse(pool.originalCurrency);
    if (!displayCurrency.success || !originalCurrency.success) return [];
    const showReporting = pool.converted;
    return [
      {
        period: pool.period,
        currency: displayCurrency.data,
        originalCurrency: originalCurrency.data,
        aiSystemId: pool.aiSystemId,
        aiSystemName: pool.aiSystemId ? (systemName.get(pool.aiSystemId) ?? null) : null,
        paidTotal: showReporting ? pool.reportingPaidTotal : pool.originalPaidTotal,
        originalPaidTotal: pool.originalPaidTotal,
        fxRate: pool.fxRate,
        fxRateDate: pool.fxRateDate,
        fxSource: pool.fxSource,
        projects: pool.projects.map((project) => ({
          projectId: project.projectId,
          name: project.name,
          slug: project.slug,
          tokens: project.tokens,
          overridePercent: project.overridePercent,
          amount: showReporting ? project.reportingAmount : project.originalAmount,
          method: project.method,
          originalAmount: project.originalAmount,
          projectAmount: project.projectAmount,
          projectCurrency: project.projectCurrency,
          reportingAmount: project.reportingAmount,
          fxRate: project.fxRate,
          fxRateDate: project.fxRateDate,
          fxSource: project.fxSource,
        })),
      },
    ];
  });

  return {
    reportingCurrency: fxBook.reportingCurrency,
    entries: entryRows.map((row) =>
      decorateEntry(toPublicEntry(row), fxBook.reportingCurrency, fxBook.rates),
    ),
    chart: reportingChart.flatMap((row) => {
      const point = toChartPoint(row);
      return point ? [point] : [];
    }),
    originalChart: originalChart.flatMap((row) => {
      const point = toChartPoint(row);
      return point ? [point] : [];
    }),
    pools: pools.sort(
      (left, right) =>
        right.period.localeCompare(left.period) ||
        left.originalCurrency.localeCompare(right.originalCurrency) ||
        (left.aiSystemName ?? '').localeCompare(right.aiSystemName ?? ''),
    ),
  };
}

export type PlatformAiMonthFx = PlatformAiWorkspaceMonth & {
  fxRate: number | null;
  fxRateDate: string | null;
  fxSource: string | null;
};

export type PlatformAiTotalFx = {
  period: string;
  currency: string;
  subscription: number;
  planChange: number;
  onDemand: number;
  paidCost: number;
  theoreticalApiCost: number;
  difference: number;
  ratio: number | null;
  fxRate: number | null;
  fxRateDate: string | null;
  fxSource: string | null;
};

export type PlatformAiCostReport = {
  from: string;
  to: string;
  periods: string[];
  reportingCurrency: ProjectCurrency;
  workspaces: Array<{ id: string; name: string; slug: string }>;
  providers: string[];
  months: PlatformAiMonthFx[];
  totals: PlatformAiTotalFx[];
  originalMonths: PlatformAiMonthFx[];
  originalTotals: PlatformAiTotalFx[];
  entries: PlatformAiCostEntry[];
};

/**
 * Every workspace's AI Cost chart, summed per currency. The per-workspace
 * months are that workspace's own chart points, not a second calculation.
 */
export async function loadPlatformAiCost(
  database: Database,
  query: {
    from?: string;
    to?: string;
    workspaceId?: string;
    provider?: string;
    type?: AiBillingEntryType;
    period?: string;
    reportingCurrency?: string;
  },
  now = new Date(),
): Promise<PlatformAiCostReport> {
  const window = resolveAiBillingWindow({ from: query.from, to: query.to }, now);
  if (query.period) assertAiBillingPeriod(query.period);
  const reportingCurrency = projectCurrencySchema.safeParse(query.reportingCurrency ?? 'EUR');
  const rollup = reportingCurrency.success ? reportingCurrency.data : 'EUR';
  const workspaceRows = await database.db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      slug: workspaces.slug,
    })
    .from(workspaces)
    .orderBy(asc(workspaces.name), asc(workspaces.slug));
  const overviews = await Promise.all(
    workspaceRows.map(async (workspace) => ({
      workspace,
      overview: await loadWorkspaceAiCostOverview(database, workspace.id, {
        reportingCurrency: rollup,
      }),
    })),
  );
  const entryFilter = {
    ...(query.workspaceId ? { workspaceId: query.workspaceId } : {}),
    ...(query.provider ? { provider: query.provider } : {}),
    ...(query.type ? { type: query.type } : {}),
    ...(query.period ? { period: query.period } : {}),
  };
  const workspacesFor = (
    chart: 'chart' | 'originalChart',
  ) =>
    overviews.map(({ workspace, overview }) => ({
      workspaceId: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
      chart: overview[chart],
      entries: overview.entries,
    }));
  const report = buildPlatformAiCost({
    from: window.from,
    to: window.to,
    workspaces: workspacesFor('chart'),
    entryFilter,
  });
  const original = buildPlatformAiCost({
    from: window.from,
    to: window.to,
    workspaces: workspacesFor('originalChart'),
    entryFilter,
  });
  const fxFor = (
    months: PlatformAiWorkspaceMonth[],
    chart: 'chart' | 'originalChart',
  ): PlatformAiMonthFx[] =>
    months.map((month) => {
      const overview = overviews.find((row) => row.workspace.id === month.workspaceId);
      const point = overview?.overview[chart].find(
        (row) => row.period === month.period && row.currency === month.currency,
      );
      return {
        ...month,
        fxRate: point?.fxRate ?? null,
        fxRateDate: point?.fxRateDate ?? null,
        fxSource: point?.fxSource ?? null,
      };
    });
  const totalsWithFx = (
    totals: ReadonlyArray<{
      period: string;
      currency: string;
      subscription: number;
      planChange: number;
      onDemand: number;
      paidCost: number;
      theoreticalApiCost: number;
      difference: number;
      ratio: number | null;
    }>,
    months: PlatformAiMonthFx[],
  ): PlatformAiTotalFx[] =>
    totals.map((total) => {
      const rows = months.filter(
        (month) => month.period === total.period && month.currency === total.currency,
      );
      const source = rows[0]?.fxSource ?? null;
      const same = rows.every(
        (month) => month.fxSource === source && month.fxRateDate === rows[0]?.fxRateDate,
      );
      return {
        ...total,
        fxRate: same ? (rows[0]?.fxRate ?? null) : null,
        fxRateDate: same ? (rows[0]?.fxRateDate ?? null) : null,
        fxSource: same ? source : rows.length > 0 ? 'mixed' : null,
      };
    });
  const months = fxFor(report.months, 'chart');
  const originalMonths = fxFor(original.months, 'originalChart');
  return {
    ...report,
    reportingCurrency: rollup,
    workspaces: workspaceRows,
    months,
    totals: totalsWithFx(report.totals, months),
    originalMonths,
    originalTotals: totalsWithFx(original.totals, originalMonths),
  };
}

function slicesFromEntries(
  entries: ReadonlyArray<{
    period: string;
    aiSystemId: string | null;
    currency: string;
    type: string;
    amount: number | string;
    paidAt: Date | null;
    servicePeriodStart: string | null;
    servicePeriodEnd: string | null;
  }>,
): CostSlice[] {
  const slices: CostSlice[] = [];
  for (const entry of entries) {
    const type = entry.type;
    if (type !== 'subscription' && type !== 'plan_change' && type !== 'on_demand') {
      continue;
    }
    const onDate = paidConversionDate({
      paidAt: entry.paidAt,
      servicePeriodStart: entry.servicePeriodStart,
      period: entry.period,
    });
    for (const slice of splitBillingEntryByMonth({
      amount: Number(entry.amount),
      period: entry.period,
      servicePeriodStart: entry.servicePeriodStart,
      servicePeriodEnd: entry.servicePeriodEnd,
    })) {
      slices.push({
        period: slice.period,
        aiSystemId: entry.aiSystemId,
        currency: entry.currency,
        type,
        amount: slice.amount,
        onDate,
      });
    }
  }
  return slices;
}

function allocationCandidates(input: {
  slice: CostSlice;
  openProjects: ReadonlyArray<{
    id: string;
    name?: string;
    slug?: string;
    status: string;
    currency: string;
    archivedAt: Date | null;
  }>;
  systemProjectId: ReadonlyMap<string, string | null>;
  overrideRows: ReadonlyArray<{
    projectId: string;
    period: string;
    aiSystemId: string | null;
    percent: number | string;
  }>;
  tokensOf: (projectId: string, period: string, aiSystemId: string | null) => number;
}): SliceCandidate[] {
  const candidates: SliceCandidate[] = [];
  for (const row of input.openProjects) {
    const currency = projectCurrencySchema.safeParse(row.currency);
    if (!currency.success) continue;
    if (input.slice.aiSystemId != null) {
      const linked = input.systemProjectId.get(input.slice.aiSystemId) === row.id;
      const used = input.tokensOf(row.id, input.slice.period, input.slice.aiSystemId) > 0;
      const override = input.overrideRows.some(
        (item) =>
          item.projectId === row.id &&
          item.period === input.slice.period &&
          (item.aiSystemId ?? null) === input.slice.aiSystemId,
      );
      if (!linked && !used && !override) continue;
    }
    const override = input.overrideRows.find(
      (item) =>
        item.projectId === row.id &&
        item.period === input.slice.period &&
        (item.aiSystemId ?? null) === input.slice.aiSystemId,
    );
    candidates.push({
      projectId: row.id,
      name: row.name ?? row.id,
      slug: row.slug ?? '',
      currency: currency.data,
      active: isAiBillingActiveProject(row.status, row.archivedAt),
      tokens: input.tokensOf(row.id, input.slice.period, input.slice.aiSystemId),
      overridePercent: override ? Number(override.percent) : null,
    });
  }
  return candidates;
}

async function workspaceReportingCurrency(
  database: Database,
  workspaceId: string,
): Promise<ProjectCurrency> {
  const [row] = await database.db
    .select({ reportingCurrency: workspaces.reportingCurrency })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  const parsed = projectCurrencySchema.safeParse(row?.reportingCurrency);
  return parsed.success ? parsed.data : 'EUR';
}

async function loadWorkspaceFx(
  database: Database,
  workspaceId: string,
  dates: readonly string[],
  override?: ProjectCurrency,
): Promise<{ reportingCurrency: ProjectCurrency; rates: FxRate[] }> {
  const reportingCurrency = override ?? (await workspaceReportingCurrency(database, workspaceId));
  const fetchImpl: FxFetcher | undefined =
    process.env.NODE_ENV === 'test' ? undefined : globalThis.fetch;
  await ensureExchangeRates(database, dates, fetchImpl);
  const rates = await loadExchangeRateBook(database, dates);
  return { reportingCurrency, rates };
}

function decorateEntry(
  entry: PublicAiBillingEntry,
  reportingCurrency: string,
  rates: readonly FxRate[],
): PublicAiBillingEntry {
  const converted = convertMoney(
    entry.amount,
    entry.currency,
    reportingCurrency,
    paidConversionDate({
      paidAt: entry.paidAt,
      servicePeriodStart: entry.servicePeriodStart,
      period: entry.period,
    }),
    rates,
  );
  return {
    ...entry,
    convertedAmount: converted.amount,
    convertedCurrency: converted.currency,
    fxRate: converted.rate,
    fxRateDate: converted.rateDate,
    fxSource: converted.source,
  };
}

function toChartPoint(row: FoldedChartPoint): WorkspaceAiCostChartPoint | null {
  const currency = projectCurrencySchema.safeParse(row.currency);
  if (!currency.success) return null;
  return {
    period: row.period,
    currency: currency.data,
    subscription: row.subscription,
    planChange: row.planChange,
    onDemand: row.onDemand,
    paidCost: roundAiMoney(row.subscription + row.planChange + row.onDemand),
    theoreticalApiCost: row.theoretical,
    fxRate: row.fxRate,
    fxRateDate: row.fxRateDate,
    fxSource: row.fxSource,
  };
}
