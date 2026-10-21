import { and, desc, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import type { Database } from '@project-knowledge-hub/database';
import {
  aiUsageEvents,
  aiUsageImports,
  projectTasks,
  projects,
  users,
  workspaces,
} from '@project-knowledge-hub/database';
import {
  AppError,
  USAGE_IMPORT_ERROR_LIMIT,
  aggregateLinkedUsage,
  dedupeUsageRows,
  linkUsageRows,
  parseUsageSource,
  previewUsageImport,
  priceImportedUsage,
  roundAiMoney,
  type AiUsageImportSource,
  type AiUsageImportSummary,
  type AiUsageRowError,
  type NormalizedAiUsageRow,
  type UsageImportStats,
} from '@project-knowledge-hub/domain';
import { decodeListCursor, encodeListCursor } from './task-list-page.js';
import { listAiModelPrices, loadImportedTheoretical } from './ai-usage-pricing.js';

export type PublicUsageActor = {
  id: string;
  displayName: string;
  email: string;
};

export type PublicAiUsageImport = {
  id: string;
  workspaceId: string;
  source: AiUsageImportSource;
  fileName: string | null;
  createdBy: PublicUsageActor | null;
  createdAt: string;
  rowCountTotal: number;
  rowCountInserted: number;
  rowCountDuplicate: number;
  rowCountLinked: number;
  rowCountErrors: number;
  rowCountNoTokens: number;
  errors: AiUsageRowError[];
  summary: AiUsageImportSummary | null;
};

export type PublicUsagePreview = UsageImportStats & {
  source: 'csv';
  fileName: string | null;
  theoretical: Array<{
    currency: string;
    linked: number;
    unassigned: number;
    total: number;
    paid: number;
  }>;
  unpricedModels: Array<{ model: string; rowCount: number; tokensTotal: number }>;
};

export type UnassignedUsageGroup = {
  cloudAgentId: string | null;
  rowCount: number;
  tokensTotal: number;
  latestAt: string;
  models: string[];
};

export type UnassignedUsageRow = {
  id: string;
  importId: string | null;
  occurredAt: string;
  cloudAgentId: string | null;
  model: string;
  tokensInput: number;
  tokensCacheWrite: number;
  tokensCache: number;
  tokensOutput: number;
  tokensTotal: number;
};

export type UsageImportSummaryPage = {
  summaries: PublicAiUsageImport[];
  summaryTotal: number;
  summaryLimit: number;
  summaryNextCursor: string | null;
  summaryHasMore: boolean;
  unassigned: UnassignedUsageRow[];
  unassignedTotal: number;
  unassignedLimit: number;
  unassignedNextCursor: string | null;
  unassignedHasMore: boolean;
};

const INSERT_CHUNK = 200;
const HASH_CHUNK = 500;

export async function previewAiUsageCsv(
  database: Database,
  workspaceId: string,
  input: { csv: string; fileName?: string | null },
): Promise<PublicUsagePreview> {
  await requireWorkspace(database, workspaceId);
  const parsed = parseUsageSource('csv', input.csv);
  const prepared = await prepareRows(database, workspaceId, parsed.rows);
  const stats = previewUsageImport({
    rows: parsed.rows,
    errors: parsed.errors,
    rowCountNoTokens: parsed.rowCountNoTokens,
    existingHashes: prepared.existingHashes,
    taskIdByCloudAgentId: prepared.taskIdByCloudAgentId,
  });
  const prices = await listAiModelPrices(database, workspaceId);
  const priced = priceImportedUsage(
    parsed.rows.map((row) => ({
      occurredOn: row.occurredAt.toISOString().slice(0, 10),
      model: row.model,
      tokensInput: row.tokensInput,
      tokensCacheWrite: row.tokensCacheWrite,
      tokensCache: row.tokensCache,
      tokensOutput: row.tokensOutput,
      cost: row.cost,
      linked: row.cloudAgentId
        ? prepared.taskIdByCloudAgentId.has(row.cloudAgentId)
        : false,
      cloudAgentId: row.cloudAgentId,
    })),
    prices,
  );
  const theoretical = new Map<
    string,
    { currency: string; linked: number; unassigned: number; total: number; paid: number }
  >();
  for (const row of priced.rows) {
    const current = theoretical.get(row.currency) ?? {
      currency: row.currency,
      linked: 0,
      unassigned: 0,
      total: 0,
      paid: 0,
    };
    if (row.linked) current.linked += row.theoretical;
    else current.unassigned += row.theoretical;
    current.total += row.theoretical;
    if (row.paid != null) current.paid += row.paid;
    theoretical.set(row.currency, current);
  }
  return {
    source: 'csv' as const,
    fileName: sanitizeUsageFileName(input.fileName),
    ...stats,
    theoretical: [...theoretical.values()].map((row) => ({
      ...row,
      linked: roundAiMoney(row.linked),
      unassigned: roundAiMoney(row.unassigned),
      total: roundAiMoney(row.total),
      paid: roundAiMoney(row.paid),
    })),
    unpricedModels: priced.unpricedModels,
  };
}

export async function importAiUsageCsv(
  database: Database,
  workspaceId: string,
  input: { csv: string; fileName?: string | null; actorUserId: string | null },
): Promise<{ usageImport: PublicAiUsageImport; affectedProjectIds: string[] }> {
  await requireWorkspace(database, workspaceId);
  const parsed = parseUsageSource('csv', input.csv);
  const prepared = await prepareRows(database, workspaceId, parsed.rows);
  const storedErrors = parsed.errors.slice(0, USAGE_IMPORT_ERROR_LIMIT);
  const preview = previewUsageImport({
    rows: parsed.rows,
    errors: parsed.errors,
    rowCountNoTokens: parsed.rowCountNoTokens,
    existingHashes: prepared.existingHashes,
    taskIdByCloudAgentId: prepared.taskIdByCloudAgentId,
  });

  const [created] = await database.db
    .insert(aiUsageImports)
    .values({
      workspaceId,
      source: 'csv',
      fileName: sanitizeUsageFileName(input.fileName),
      createdBy: input.actorUserId,
      rowCountTotal:
        parsed.rows.length + parsed.errors.length + parsed.rowCountNoTokens,
      rowCountInserted: 0,
      rowCountDuplicate: prepared.duplicateCount,
      rowCountLinked: 0,
      rowCountErrors: parsed.errors.length,
      rowCountNoTokens: parsed.rowCountNoTokens,
      errorsJson: storedErrors,
    })
    .returning({ id: aiUsageImports.id });
  if (!created) {
    throw new AppError({
      code: 'USAGE_IMPORT_FAILED',
      message: 'Could not record the usage import',
      statusCode: 500,
    });
  }

  let inserted = 0;
  let linked = 0;
  const taskIds = new Set<string>();
  for (const chunk of chunks(prepared.fresh, INSERT_CHUNK)) {
    const written = await database.db
      .insert(aiUsageEvents)
      .values(
        chunk.map((row) => ({
          workspaceId,
          importId: created.id,
          source: 'csv' as const,
          occurredAt: row.occurredAt,
          occurredAtKey: row.occurredAtKey,
          cloudAgentId: row.cloudAgentId,
          automationId: row.automationId,
          kind: row.kind,
          model: row.model,
          maxMode: row.maxMode,
          tokensInput: row.tokensInput,
          tokensCacheWrite: row.tokensCacheWrite,
          tokensCache: row.tokensCache,
          tokensOutput: row.tokensOutput,
          tokensTotal: row.tokensTotal,
          cost: row.cost,
          rowHash: row.rowHash,
          projectTaskId: row.projectTaskId,
        })),
      )
      .onConflictDoNothing({
        target: [aiUsageEvents.workspaceId, aiUsageEvents.rowHash],
      })
      .returning({
        projectTaskId: aiUsageEvents.projectTaskId,
      });
    inserted += written.length;
    for (const row of written) {
      if (row.projectTaskId) {
        linked += 1;
        taskIds.add(row.projectTaskId);
      }
    }
  }

  const raced = prepared.fresh.length - inserted;
  const affected = new Set<string>();
  const syncErrors: AiUsageRowError[] = [];
  for (const taskId of taskIds) {
    const result = await replaceTaskTokensFromEvents(database, taskId);
    if (result.projectId) affected.add(result.projectId);
    if (result.status === 'overflow') {
      syncErrors.push({
        rowNumber: 0,
        message: 'Linked usage for a task exceeds the token counter limit',
      });
    }
  }

  const errors = [...storedErrors, ...syncErrors].slice(0, USAGE_IMPORT_ERROR_LIMIT);
  await database.db
    .update(aiUsageImports)
    .set({
      rowCountInserted: inserted,
      rowCountDuplicate: prepared.duplicateCount + raced,
      rowCountLinked: linked,
      rowCountErrors: parsed.errors.length + syncErrors.length,
      rowCountNoTokens: parsed.rowCountNoTokens,
      errorsJson: errors,
      summaryJson: usageImportSummary(preview, inserted, linked),
      updatedAt: new Date(),
    })
    .where(eq(aiUsageImports.id, created.id));

  const usageImport = await getAiUsageImport(database, workspaceId, created.id);
  if (!usageImport) {
    throw new AppError({
      code: 'USAGE_IMPORT_FAILED',
      message: 'Could not read the usage import',
      statusCode: 500,
    });
  }
  return { usageImport, affectedProjectIds: [...affected] };
}

export async function listAiUsageImports(
  database: Database,
  workspaceId: string,
  limit = 50,
): Promise<PublicAiUsageImport[]> {
  await requireWorkspace(database, workspaceId);
  const rows = await database.db
    .select({
      row: aiUsageImports,
      displayName: users.displayName,
      email: users.email,
    })
    .from(aiUsageImports)
    .leftJoin(users, eq(users.id, aiUsageImports.createdBy))
    .where(eq(aiUsageImports.workspaceId, workspaceId))
    .orderBy(desc(aiUsageImports.createdAt))
    .limit(Math.min(Math.max(limit, 1), 100));
  return rows.map((item) => toPublicImport(item.row, item));
}

export async function getAiUsageImport(
  database: Database,
  workspaceId: string,
  importId: string,
): Promise<PublicAiUsageImport | null> {
  const [item] = await database.db
    .select({
      row: aiUsageImports,
      displayName: users.displayName,
      email: users.email,
    })
    .from(aiUsageImports)
    .leftJoin(users, eq(users.id, aiUsageImports.createdBy))
    .where(
      and(eq(aiUsageImports.id, importId), eq(aiUsageImports.workspaceId, workspaceId)),
    )
    .limit(1);
  if (!item) return null;
  return toPublicImport(item.row, item);
}

export async function listUnassignedUsage(
  database: Database,
  workspaceId: string,
  limit = 50,
): Promise<{
  total: number;
  groups: UnassignedUsageGroup[];
  theoretical: Array<{ currency: string; amount: number }>;
  unpricedModels: Array<{ model: string; rowCount: number; tokensTotal: number }>;
}> {
  await requireWorkspace(database, workspaceId);
  const unassigned = and(
    eq(aiUsageEvents.workspaceId, workspaceId),
    isNull(aiUsageEvents.projectTaskId),
  );
  const [countRow] = await database.db
    .select({ total: sql<number>`count(*)::int` })
    .from(aiUsageEvents)
    .where(unassigned);
  const groups = await database.db
    .select({
      cloudAgentId: aiUsageEvents.cloudAgentId,
      rowCount: sql<number>`count(*)::int`,
      tokensTotal: sql<number>`coalesce(sum(${aiUsageEvents.tokensTotal}), 0)::bigint`,
      latestAt: sql<Date>`max(${aiUsageEvents.occurredAt})`,
      models: sql<string[]>`array_remove(array_agg(distinct ${aiUsageEvents.model}), null)`,
    })
    .from(aiUsageEvents)
    .where(unassigned)
    .groupBy(aiUsageEvents.cloudAgentId)
    .orderBy(desc(sql`max(${aiUsageEvents.occurredAt})`))
    .limit(Math.min(Math.max(limit, 1), 100));
  const priced = await loadImportedTheoretical(database, workspaceId);
  const theoretical = new Map<string, number>();
  for (const row of priced.rows) {
    if (row.linked || row.theoretical === 0) continue;
    theoretical.set(row.currency, (theoretical.get(row.currency) ?? 0) + row.theoretical);
  }
  return {
    total: Number(countRow?.total ?? 0),
    groups: groups.map((group) => ({
      cloudAgentId: group.cloudAgentId,
      rowCount: Number(group.rowCount),
      tokensTotal: Number(group.tokensTotal),
      latestAt: new Date(group.latestAt).toISOString(),
      models: Array.isArray(group.models) ? group.models : [],
    })),
    theoretical: [...theoretical.entries()].map(([currency, amount]) => ({
      currency,
      amount: roundAiMoney(amount),
    })),
    unpricedModels: priced.unpricedModels,
  };
}

const SUMMARY_PAGE_MAX = 100;
const UNASSIGNED_PAGE_MAX = 100;

function pageLimit(value: number | undefined, fallback: number, max: number): number {
  if (value == null) return fallback;
  return Math.min(Math.max(Math.trunc(value), 1), max);
}

/**
 * Paged import summaries and the unassigned usage rows behind them.
 * `importId` limits both lists to one import.
 */
export async function listAiUsageImportSummaries(
  database: Database,
  workspaceId: string,
  input: {
    importId?: string;
    limit?: number;
    cursor?: string;
    unassignedLimit?: number;
    unassignedCursor?: string;
  } = {},
): Promise<UsageImportSummaryPage> {
  await requireWorkspace(database, workspaceId);
  const summaryLimit = pageLimit(input.limit, 25, SUMMARY_PAGE_MAX);
  const summaryOffset = decodeListCursor(input.cursor);
  const summaryWhere = input.importId
    ? and(
        eq(aiUsageImports.workspaceId, workspaceId),
        eq(aiUsageImports.id, input.importId),
      )
    : eq(aiUsageImports.workspaceId, workspaceId);
  const [summaryCount] = await database.db
    .select({ total: sql<number>`count(*)::int` })
    .from(aiUsageImports)
    .where(summaryWhere);
  const summaryRows = await database.db
    .select({
      row: aiUsageImports,
      displayName: users.displayName,
      email: users.email,
    })
    .from(aiUsageImports)
    .leftJoin(users, eq(users.id, aiUsageImports.createdBy))
    .where(summaryWhere)
    .orderBy(desc(aiUsageImports.createdAt), desc(aiUsageImports.id))
    .offset(summaryOffset)
    .limit(summaryLimit);
  const summaryTotal = Number(summaryCount?.total ?? 0);
  const summaryHasMore = summaryOffset + summaryRows.length < summaryTotal;
  const unassigned = await listUnassignedUsageRows(database, workspaceId, {
    importId: input.importId,
    limit: input.unassignedLimit,
    cursor: input.unassignedCursor,
  });
  return {
    summaries: summaryRows.map((item) => toPublicImport(item.row, item)),
    summaryTotal,
    summaryLimit,
    summaryNextCursor: summaryHasMore
      ? encodeListCursor(summaryOffset + summaryRows.length)
      : null,
    summaryHasMore,
    unassigned: unassigned.rows,
    unassignedTotal: unassigned.total,
    unassignedLimit: unassigned.limit,
    unassignedNextCursor: unassigned.nextCursor,
    unassignedHasMore: unassigned.hasMore,
  };
}

export async function listUnassignedUsageRows(
  database: Database,
  workspaceId: string,
  input: { importId?: string; limit?: number; cursor?: string } = {},
): Promise<{
  rows: UnassignedUsageRow[];
  total: number;
  limit: number;
  nextCursor: string | null;
  hasMore: boolean;
}> {
  await requireWorkspace(database, workspaceId);
  const limit = pageLimit(input.limit, 25, UNASSIGNED_PAGE_MAX);
  const offset = decodeListCursor(input.cursor);
  const where = input.importId
    ? and(
        eq(aiUsageEvents.workspaceId, workspaceId),
        isNull(aiUsageEvents.projectTaskId),
        eq(aiUsageEvents.importId, input.importId),
      )
    : and(
        eq(aiUsageEvents.workspaceId, workspaceId),
        isNull(aiUsageEvents.projectTaskId),
      );
  const [countRow] = await database.db
    .select({ total: sql<number>`count(*)::int` })
    .from(aiUsageEvents)
    .where(where);
  const rows = await database.db
    .select({
      id: aiUsageEvents.id,
      importId: aiUsageEvents.importId,
      occurredAt: aiUsageEvents.occurredAt,
      cloudAgentId: aiUsageEvents.cloudAgentId,
      model: aiUsageEvents.model,
      tokensInput: aiUsageEvents.tokensInput,
      tokensCacheWrite: aiUsageEvents.tokensCacheWrite,
      tokensCache: aiUsageEvents.tokensCache,
      tokensOutput: aiUsageEvents.tokensOutput,
      tokensTotal: aiUsageEvents.tokensTotal,
    })
    .from(aiUsageEvents)
    .where(where)
    .orderBy(desc(aiUsageEvents.occurredAt), desc(aiUsageEvents.id))
    .offset(offset)
    .limit(limit);
  const total = Number(countRow?.total ?? 0);
  const hasMore = offset + rows.length < total;
  return {
    rows: rows.map((row) => ({
      id: row.id,
      importId: row.importId,
      occurredAt: row.occurredAt.toISOString(),
      cloudAgentId: row.cloudAgentId,
      model: row.model,
      tokensInput: row.tokensInput,
      tokensCacheWrite: row.tokensCacheWrite,
      tokensCache: row.tokensCache,
      tokensOutput: row.tokensOutput,
      tokensTotal: row.tokensTotal,
    })),
    total,
    limit,
    nextCursor: hasMore ? encodeListCursor(offset + rows.length) : null,
    hasMore,
  };
}

/**
 * Point workspace usage at a task after its cloud agent id changes, then
 * replace that task's token counters with the sum of linked events.
 */
export async function relinkTaskUsage(
  database: Database,
  input: { taskId: string; workspaceId: string; cloudAgentId: string | null },
): Promise<{ changed: boolean }> {
  const unlinkWhere = input.cloudAgentId
    ? and(
        eq(aiUsageEvents.projectTaskId, input.taskId),
        or(
          isNull(aiUsageEvents.cloudAgentId),
          ne(aiUsageEvents.cloudAgentId, input.cloudAgentId),
        ),
      )
    : eq(aiUsageEvents.projectTaskId, input.taskId);
  const unlinked = await database.db
    .update(aiUsageEvents)
    .set({ projectTaskId: null })
    .where(unlinkWhere)
    .returning({ id: aiUsageEvents.id });

  let linkedNew = 0;
  if (input.cloudAgentId) {
    const linked = await database.db
      .update(aiUsageEvents)
      .set({ projectTaskId: input.taskId })
      .where(
        and(
          eq(aiUsageEvents.workspaceId, input.workspaceId),
          eq(aiUsageEvents.cloudAgentId, input.cloudAgentId),
          isNull(aiUsageEvents.projectTaskId),
        ),
      )
      .returning({ id: aiUsageEvents.id });
    linkedNew = linked.length;
  }

  if (unlinked.length === 0 && linkedNew === 0) {
    return { changed: false };
  }
  const result = await replaceTaskTokensFromEvents(database, input.taskId);
  if (result.status === 'empty') {
    await zeroTaskTokens(database, input.taskId);
  }
  return { changed: true };
}

async function prepareRows(
  database: Database,
  workspaceId: string,
  rows: NormalizedAiUsageRow[],
) {
  const existingHashes = await loadExistingHashes(
    database,
    workspaceId,
    rows.map((row) => row.rowHash),
  );
  const agentIds = [
    ...new Set(
      rows.flatMap((row) => (row.cloudAgentId ? [row.cloudAgentId] : [])),
    ),
  ];
  const taskIdByCloudAgentId = await loadTaskIdsByCloudAgent(
    database,
    workspaceId,
    agentIds,
  );
  const deduped = dedupeUsageRows(rows, existingHashes);
  const fresh = linkUsageRows(deduped.fresh, taskIdByCloudAgentId);
  return {
    fresh,
    duplicateCount: deduped.duplicateCount,
    existingHashes,
    taskIdByCloudAgentId,
  };
}

async function loadExistingHashes(
  database: Database,
  workspaceId: string,
  hashes: string[],
): Promise<Set<string>> {
  const found = new Set<string>();
  const unique = [...new Set(hashes)];
  for (const part of chunks(unique, HASH_CHUNK)) {
    if (part.length === 0) continue;
    const rows = await database.db
      .select({ rowHash: aiUsageEvents.rowHash })
      .from(aiUsageEvents)
      .where(
        and(
          eq(aiUsageEvents.workspaceId, workspaceId),
          inArray(aiUsageEvents.rowHash, part),
        ),
      );
    for (const row of rows) found.add(row.rowHash);
  }
  return found;
}

async function loadTaskIdsByCloudAgent(
  database: Database,
  workspaceId: string,
  agentIds: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const part of chunks(agentIds, HASH_CHUNK)) {
    if (part.length === 0) continue;
    const rows = await database.db
      .select({
        id: projectTasks.id,
        cloudAgentId: projectTasks.cloudAgentId,
      })
      .from(projectTasks)
      .innerJoin(projects, eq(projects.id, projectTasks.projectId))
      .where(
        and(
          eq(projects.workspaceId, workspaceId),
          inArray(projectTasks.cloudAgentId, part),
        ),
      );
    for (const row of rows) {
      if (row.cloudAgentId) map.set(row.cloudAgentId, row.id);
    }
  }
  return map;
}

async function replaceTaskTokensFromEvents(
  database: Database,
  taskId: string,
): Promise<{ status: 'ok' | 'overflow' | 'empty'; projectId: string | null }> {
  const events = await database.db
    .select({
      occurredAt: aiUsageEvents.occurredAt,
      model: aiUsageEvents.model,
      maxMode: aiUsageEvents.maxMode,
      tokensInput: aiUsageEvents.tokensInput,
      tokensCacheWrite: aiUsageEvents.tokensCacheWrite,
      tokensCache: aiUsageEvents.tokensCache,
      tokensOutput: aiUsageEvents.tokensOutput,
    })
    .from(aiUsageEvents)
    .where(eq(aiUsageEvents.projectTaskId, taskId));
  const [task] = await database.db
    .select({ projectId: projectTasks.projectId })
    .from(projectTasks)
    .where(eq(projectTasks.id, taskId))
    .limit(1);
  if (events.length === 0) {
    return { status: 'empty', projectId: task?.projectId ?? null };
  }
  const aggregate = aggregateLinkedUsage(events);
  if (aggregate === 'overflow' || aggregate == null) {
    return { status: 'overflow', projectId: task?.projectId ?? null };
  }
  await database.db
    .update(projectTasks)
    .set({
      tokensUsed: aggregate.tokensUsed,
      tokensInput: aggregate.tokensInput,
      tokensOutput: aggregate.tokensOutput,
      tokensCache: aggregate.tokensCache,
      tokensCacheWrite: aggregate.tokensCacheWrite,
      aiModelId: aggregate.modelId,
      aiPricingTier: aggregate.pricingTier,
      usageOccurredAt: aggregate.usageOccurredAt,
      billingPeriod: aggregate.billingPeriod,
      updatedAt: new Date(),
    })
    .where(eq(projectTasks.id, taskId));
  return { status: 'ok', projectId: task?.projectId ?? null };
}

async function zeroTaskTokens(database: Database, taskId: string): Promise<void> {
  await database.db
    .update(projectTasks)
    .set({
      tokensUsed: 0,
      tokensInput: 0,
      tokensOutput: 0,
      tokensCache: 0,
      tokensCacheWrite: 0,
      updatedAt: new Date(),
    })
    .where(eq(projectTasks.id, taskId));
}

async function requireWorkspace(database: Database, workspaceId: string): Promise<void> {
  const [workspace] = await database.db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  if (!workspace) {
    throw new AppError({
      code: 'WORKSPACE_NOT_FOUND',
      message: 'Workspace not found',
      statusCode: 404,
    });
  }
}

function toPublicImport(
  row: typeof aiUsageImports.$inferSelect,
  actor: { displayName: string | null; email: string | null },
): PublicAiUsageImport {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    source: row.source === 'cursor_admin_api' ? 'cursor_admin_api' : 'csv',
    fileName: row.fileName,
    createdBy:
      row.createdBy && actor.displayName && actor.email
        ? { id: row.createdBy, displayName: actor.displayName, email: actor.email }
        : null,
    createdAt: row.createdAt.toISOString(),
    rowCountTotal: row.rowCountTotal,
    rowCountInserted: row.rowCountInserted,
    rowCountDuplicate: row.rowCountDuplicate,
    rowCountLinked: row.rowCountLinked,
    rowCountErrors: row.rowCountErrors,
    rowCountNoTokens: row.rowCountNoTokens,
    errors: readErrors(row.errorsJson),
    summary: readSummary(row.summaryJson),
  };
}

function usageImportSummary(
  preview: UsageImportStats,
  inserted: number,
  linked: number,
): AiUsageImportSummary {
  return {
    dateFrom: preview.dateFrom,
    dateTo: preview.dateTo,
    totals: preview.totals,
    models: preview.models,
    linkedCount: linked,
    unassignedCount: Math.max(0, inserted - linked),
  };
}

function readSummary(value: unknown): AiUsageImportSummary | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Partial<AiUsageImportSummary>;
  const totals = row.totals;
  if (!totals || typeof totals !== 'object') return null;
  const models = Array.isArray(row.models) ? row.models : [];
  return {
    dateFrom: typeof row.dateFrom === 'string' ? row.dateFrom : null,
    dateTo: typeof row.dateTo === 'string' ? row.dateTo : null,
    totals: {
      tokensInput: numberField(totals.tokensInput),
      tokensCacheWrite: numberField(totals.tokensCacheWrite),
      tokensCache: numberField(totals.tokensCache),
      tokensOutput: numberField(totals.tokensOutput),
      tokensTotal: numberField(totals.tokensTotal),
    },
    models: models.flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const model = item as { model?: unknown; rowCount?: unknown; tokensTotal?: unknown };
      if (typeof model.model !== 'string') return [];
      return [{
        model: model.model,
        rowCount: numberField(model.rowCount),
        tokensTotal: numberField(model.tokensTotal),
      }];
    }),
    linkedCount: numberField(row.linkedCount),
    unassignedCount: numberField(row.unassignedCount),
  };
}

function numberField(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function readErrors(value: unknown): AiUsageRowError[] {
  if (!Array.isArray(value)) return [];
  const errors: AiUsageRowError[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const row = item as { rowNumber?: unknown; message?: unknown };
    if (typeof row.rowNumber !== 'number' || typeof row.message !== 'string') continue;
    errors.push({ rowNumber: row.rowNumber, message: row.message });
  }
  return errors;
}

function sanitizeUsageFileName(value: string | null | undefined): string | null {
  if (!value) return null;
  const base = value.trim().split(/[/\\]/).pop()?.trim() ?? '';
  if (!base) return null;
  return base.slice(0, 200);
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    out.push(items.slice(index, index + size));
  }
  return out;
}
