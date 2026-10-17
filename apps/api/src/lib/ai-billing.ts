import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import type { Database } from '@project-knowledge-hub/database';
import {
  aiBillingAllocationOverrides,
  aiBillingEntries,
  projectTasks,
  projects,
  systems,
  workspaces,
} from '@project-knowledge-hub/database';
import {
  allocateAiBillingPool,
  assertAiBillingPeriod,
  assertAllocationPercent,
  assertServiceDate,
  buildPlatformAiCost,
  isAiBillingActiveProject,
  type AiBillingAllocationMethod,
  parseUsageOccurredAt,
  projectCurrencySchema,
  resolveAiBillingWindow,
  resolveBillingServiceWindow,
  roundAiMoney,
  scaleAiBillingTypes,
  settleProjectAiCost,
  splitBillingEntryByMonth,
  usageHasTokenBreakdown,
  type AiBillingEntryType,
  type AiBillingProjectShare,
  type AiCostUsageSlice,
  type AiFallbackSystem,
  type AiPaidPeriod,
  type PlatformAiCostEntry,
  type PlatformAiWorkspaceMonth,
  type ProjectCurrency,
  AppError,
} from '@project-knowledge-hub/domain';

export type { AiPaidPeriod };
import { AI_ASSISTANT_SYSTEM_TYPE } from './ai-assistant-systems.js';
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
  return rows
    .map(toPublicEntry)
    .filter((entry) => entryMatchesBillingListFilter(entry, filter));
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
  usage: AiUsageForCost;
  tokens: number;
};

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
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    start: `${entry.period}-01`,
    end: `${entry.period}-${String(last).padStart(2, '0')}`,
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
    if (filter.servicePeriodStart && bounds.end < filter.servicePeriodStart) {
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
    usages.push({
      projectId: task.projectId,
      aiSystemId: task.aiSystemId,
      sprintId: task.sprintId,
      period: usagePeriod(task.billingPeriod, task.usageOccurredAt),
      usage,
      tokens,
    });
  }

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

  const pools = monthPoolsFromBillingEntries(entryRows);

  const shares: AiBillingProjectShare[] = [];
  for (const pool of pools.values()) {
    if (pool.currency !== currency) continue;
    const candidates = openProjects.filter((row) => {
      if (row.currency !== currency) return false;
      if (pool.aiSystemId == null) return true;
      const linked = systemProjectId.get(pool.aiSystemId) === row.id;
      const used = tokensOf(row.id, pool.period, pool.aiSystemId) > 0;
      const override = overrideRows.some(
        (item) =>
          item.projectId === row.id &&
          item.period === pool.period &&
          (item.aiSystemId ?? null) === pool.aiSystemId,
      );
      return linked || used || override;
    });
    const allocationProjects = candidates.map((row) => {
      const override = overrideRows.find(
        (item) =>
          item.projectId === row.id &&
          item.period === pool.period &&
          (item.aiSystemId ?? null) === pool.aiSystemId,
      );
      return {
        projectId: row.id,
        tokens: tokensOf(row.id, pool.period, pool.aiSystemId),
        active: isAiBillingActiveProject(row.status, row.archivedAt),
        overridePercent: override ? Number(override.percent) : null,
      };
    });
    const allocated = allocateAiBillingPool({
      paidTotal: roundAiMoney(pool.paidTotal),
      projects: allocationProjects,
    });
    const mine = allocated.find((share) => share.projectId === project.id);
    const covered = allocationProjects.some((row) => row.projectId === project.id);
    if (!covered) continue;
    const scaled = scaleAiBillingTypes(mine?.amount ?? 0, {
      subscription: pool.subscription,
      planChange: pool.planChange,
      onDemand: pool.onDemand,
    });
    shares.push({
      period: pool.period,
      aiSystemId: pool.aiSystemId,
      amount: mine?.amount ?? 0,
      subscription: scaled.subscription,
      planChange: scaled.planChange,
      onDemand: scaled.onDemand,
      covered: true,
    });
  }

  const sliceGroups = new Map<
    string,
    { period: string | null; systemId: string | null; usages: AiUsageForCost[]; tokens: number }
  >();
  for (const row of usages) {
    if (row.projectId !== project.id) continue;
    const key = `${row.period ?? ''}|${row.aiSystemId ?? ''}`;
    const group = sliceGroups.get(key) ?? {
      period: row.period,
      systemId: row.aiSystemId,
      usages: [],
      tokens: 0,
    };
    group.usages.push(row.usage);
    group.tokens += row.tokens;
    sliceGroups.set(key, group);
  }
  const usageSlices: AiCostUsageSlice[] = [...sliceGroups.values()].map((group) => {
    const rates = group.systemId ? ratesBySystem.get(group.systemId) : undefined;
    const theoretical = rates ? tokenCostForUsages(group.usages, rates) : 0;
    const mode = group.systemId ? modeBySystem.get(group.systemId) : null;
    const legacyToken =
      rates && (mode === 'api' || mode === 'mixed') ? theoretical : 0;
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
    { sprintId: string; usages: AiUsageForCost[]; tokens: number; systemId: string | null }
  >();
  for (const row of usages) {
    if (row.projectId !== project.id || !row.sprintId) continue;
    const key = `${row.sprintId}|${row.aiSystemId ?? ''}`;
    const group = sprintGroups.get(key) ?? {
      sprintId: row.sprintId,
      usages: [],
      tokens: 0,
      systemId: row.aiSystemId,
    };
    group.usages.push(row.usage);
    group.tokens += row.tokens;
    sprintGroups.set(key, group);
  }
  const sprintTotals = new Map<string, { theoreticalApiCost: number; tokens: number }>();
  for (const group of sprintGroups.values()) {
    const rates = group.systemId ? ratesBySystem.get(group.systemId) : undefined;
    const theoretical = rates ? tokenCostForUsages(group.usages, rates) : 0;
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

  return {
    ...settled,
    entries: entryRows
      .filter((row) => row.currency === currency)
      .map(toPublicEntry),
    sprints: [...sprintTotals.entries()]
      .map(([sprintId, value]) => ({
        sprintId,
        theoreticalApiCost: roundAiMoney(value.theoreticalApiCost),
        tokens: value.tokens,
      }))
      .sort((a, b) => a.sprintId.localeCompare(b.sprintId)),
  };
}

export type WorkspaceAiAllocationProject = {
  projectId: string;
  name: string;
  slug: string;
  tokens: number;
  overridePercent: number | null;
  amount: number;
  method: AiBillingAllocationMethod;
};

export type WorkspaceAiCostPool = {
  period: string;
  currency: ProjectCurrency;
  aiSystemId: string | null;
  aiSystemName: string | null;
  paidTotal: number;
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
};

export type WorkspaceAiCostOverview = {
  entries: PublicAiBillingEntry[];
  chart: WorkspaceAiCostChartPoint[];
  pools: WorkspaceAiCostPool[];
};

/**
 * Workspace view of the ledger: paid totals by month, the theoretical API
 * line, and how each pool is split across projects.
 */
export async function loadWorkspaceAiCostOverview(
  database: Database,
  workspaceId: string,
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
    usages.push({
      projectId: task.projectId,
      aiSystemId: task.aiSystemId,
      sprintId: null,
      period: usagePeriod(task.billingPeriod, task.usageOccurredAt),
      usage,
      tokens,
    });
  }

  const ratesBySystem = new Map(
    assistantRows.map((row) => [
      row.id,
      {
        blendedPer1k: row.aiTokenRatePer1k,
        inputPer1k: row.aiTokenRateInputPer1k,
        outputPer1k: row.aiTokenRateOutputPer1k,
        cachePer1k: row.aiTokenRateCachePer1k,
        cacheWritePer1k: row.aiTokenRateCacheWritePer1k,
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

  const pools = monthPoolsFromBillingEntries(entryRows);

  const chart = new Map<
    string,
    {
      period: string;
      currency: ProjectCurrency;
      subscription: number;
      planChange: number;
      onDemand: number;
      theoretical: number;
    }
  >();
  const chartKey = (period: string, currency: string) => `${period}|${currency}`;
  const ensureChart = (period: string, currency: ProjectCurrency) => {
    const key = chartKey(period, currency);
    const row = chart.get(key) ?? {
      period,
      currency,
      subscription: 0,
      planChange: 0,
      onDemand: 0,
      theoretical: 0,
    };
    chart.set(key, row);
    return row;
  };

  const allocationPools: WorkspaceAiCostPool[] = [];
  for (const pool of pools.values()) {
    const currency = projectCurrencySchema.safeParse(pool.currency);
    if (!currency.success) continue;
    const bucket = ensureChart(pool.period, currency.data);
    bucket.subscription += pool.subscription;
    bucket.planChange += pool.planChange;
    bucket.onDemand += pool.onDemand;
    const candidates = openProjects.filter((row) => {
      if (row.currency !== currency.data) return false;
      if (pool.aiSystemId == null) return true;
      const linked = systemProjectId.get(pool.aiSystemId) === row.id;
      const used = tokensOf(row.id, pool.period, pool.aiSystemId) > 0;
      const override = overrideRows.some(
        (item) =>
          item.projectId === row.id &&
          item.period === pool.period &&
          (item.aiSystemId ?? null) === pool.aiSystemId,
      );
      return linked || used || override;
    });
    const allocationProjects = candidates.map((row) => {
      const override = overrideRows.find(
        (item) =>
          item.projectId === row.id &&
          item.period === pool.period &&
          (item.aiSystemId ?? null) === pool.aiSystemId,
      );
      return {
        projectId: row.id,
        tokens: tokensOf(row.id, pool.period, pool.aiSystemId),
        active: isAiBillingActiveProject(row.status, row.archivedAt),
        overridePercent: override ? Number(override.percent) : null,
      };
    });
    const allocated = allocateAiBillingPool({
      paidTotal: roundAiMoney(pool.paidTotal),
      projects: allocationProjects,
    });
    allocationPools.push({
      period: pool.period,
      currency: currency.data,
      aiSystemId: pool.aiSystemId,
      aiSystemName: pool.aiSystemId
        ? (systemName.get(pool.aiSystemId) ?? null)
        : null,
      paidTotal: roundAiMoney(pool.paidTotal),
      projects: allocated.map((share) => {
        const project = projectById.get(share.projectId);
        const source = allocationProjects.find(
          (row) => row.projectId === share.projectId,
        );
        return {
          projectId: share.projectId,
          name: project?.name ?? share.projectId,
          slug: project?.slug ?? '',
          tokens: source?.tokens ?? 0,
          overridePercent: source?.overridePercent ?? null,
          amount: share.amount,
          method: share.method,
        };
      }),
    });
  }

  const theoreticalGroups = new Map<
    string,
    { period: string; currency: ProjectCurrency; systemId: string; usages: AiUsageForCost[] }
  >();
  for (const row of usages) {
    if (!row.period || !row.aiSystemId) continue;
    const project = projectById.get(row.projectId);
    const currency = project
      ? projectCurrencySchema.safeParse(project.currency)
      : null;
    if (!currency?.success) continue;
    const key = `${chartKey(row.period, currency.data)}|${row.aiSystemId}`;
    const group = theoreticalGroups.get(key) ?? {
      period: row.period,
      currency: currency.data,
      systemId: row.aiSystemId,
      usages: [],
    };
    group.usages.push(row.usage);
    theoreticalGroups.set(key, group);
  }
  for (const group of theoreticalGroups.values()) {
    const rates = ratesBySystem.get(group.systemId);
    if (!rates) continue;
    ensureChart(group.period, group.currency).theoretical += tokenCostForUsages(
      group.usages,
      rates,
    );
  }

  return {
    entries: entryRows.map(toPublicEntry),
    chart: [...chart.values()]
      .map((row) => ({
        period: row.period,
        currency: row.currency,
        subscription: roundAiMoney(row.subscription),
        planChange: roundAiMoney(row.planChange),
        onDemand: roundAiMoney(row.onDemand),
        paidCost: roundAiMoney(row.subscription + row.planChange + row.onDemand),
        theoreticalApiCost: roundAiMoney(row.theoretical),
      }))
      .sort((a, b) => a.period.localeCompare(b.period) || a.currency.localeCompare(b.currency)),
    pools: allocationPools.sort(
      (a, b) =>
        b.period.localeCompare(a.period) ||
        a.currency.localeCompare(b.currency) ||
        (a.aiSystemName ?? '').localeCompare(b.aiSystemName ?? ''),
    ),
  };
}

export type PlatformAiCostReport = {
  from: string;
  to: string;
  periods: string[];
  workspaces: Array<{ id: string; name: string; slug: string }>;
  providers: string[];
  months: PlatformAiWorkspaceMonth[];
  totals: Array<{
    period: string;
    currency: string;
    subscription: number;
    planChange: number;
    onDemand: number;
    paidCost: number;
    theoreticalApiCost: number;
    difference: number;
    ratio: number | null;
  }>;
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
  },
  now = new Date(),
): Promise<PlatformAiCostReport> {
  const window = resolveAiBillingWindow({ from: query.from, to: query.to }, now);
  if (query.period) assertAiBillingPeriod(query.period);
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
      overview: await loadWorkspaceAiCostOverview(database, workspace.id),
    })),
  );
  const report = buildPlatformAiCost({
    from: window.from,
    to: window.to,
    workspaces: overviews.map(({ workspace, overview }) => ({
      workspaceId: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
      chart: overview.chart,
      entries: overview.entries,
    })),
    entryFilter: {
      ...(query.workspaceId ? { workspaceId: query.workspaceId } : {}),
      ...(query.provider ? { provider: query.provider } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.period ? { period: query.period } : {}),
    },
  });
  return {
    ...report,
    workspaces: workspaceRows,
  };
}
