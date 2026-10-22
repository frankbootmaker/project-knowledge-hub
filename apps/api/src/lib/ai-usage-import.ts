import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Database } from '@project-knowledge-hub/database';
import {
  aiUsageEvents,
  aiUsageImports,
  projectTaskCloudAgentLinks,
  projectTasks,
  projects,
  users,
  workspaces,
} from '@project-knowledge-hub/database';
import {
  AppError,
  USAGE_IMPORT_ERROR_LIMIT,
  agentHasLinkedTask,
  aggregateLinkedUsage,
  dedupeUsageRows,
  linkUsageRows,
  parseUsageSource,
  previewUsageImport,
  priceImportedUsage,
  roundAiMoney,
  splitTokensAcrossTasks,
  type AiUsageImportSource,
  type AiUsageImportSummary,
  type AiUsageRowError,
  type CloudAgentTaskIndex,
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
        ? agentHasLinkedTask(prepared.taskIdByCloudAgentId, row.cloudAgentId)
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
  const agents = new Set<string>();
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
        cloudAgentId: aiUsageEvents.cloudAgentId,
      });
    inserted += written.length;
    for (const row of written) {
      if (
        row.cloudAgentId
        && agentHasLinkedTask(prepared.taskIdByCloudAgentId, row.cloudAgentId)
      ) {
        linked += 1;
        agents.add(row.cloudAgentId);
      }
    }
  }

  const raced = prepared.fresh.length - inserted;
  const syncErrors: AiUsageRowError[] = [];
  const distributed = await redistributeCloudAgentUsage(database, workspaceId, [...agents]);
  const affected = new Set(distributed.projectIds);
  if (distributed.overflow) {
    syncErrors.push({
      rowNumber: 0,
      message: 'Linked usage for a task exceeds the token counter limit',
    });
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
  const unassigned = unassignedEventWhere(workspaceId);
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
  const where = unassignedEventWhere(workspaceId, input.importId);
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
 * Replace one task's cloud-agent links, then split imported usage for every
 * agent that was added or removed. A second identical set does not write.
 */
export async function setTaskCloudAgentLinks(
  database: Database,
  input: { taskId: string; workspaceId: string; cloudAgentIds: readonly string[] },
): Promise<{ changed: boolean }> {
  const existing = await database.db
    .select({ cloudAgentId: projectTaskCloudAgentLinks.cloudAgentId })
    .from(projectTaskCloudAgentLinks)
    .where(eq(projectTaskCloudAgentLinks.taskId, input.taskId));
  const previous = existing.map((row) => row.cloudAgentId).sort();
  const next = [...new Set(input.cloudAgentIds)].sort();
  if (previous.join('\0') === next.join('\0')) {
    return { changed: false };
  }
  await database.db
    .delete(projectTaskCloudAgentLinks)
    .where(eq(projectTaskCloudAgentLinks.taskId, input.taskId));
  if (next.length > 0) {
    await database.db.insert(projectTaskCloudAgentLinks).values(
      next.map((cloudAgentId) => ({
        taskId: input.taskId,
        cloudAgentId,
      })),
    );
  }
  await database.db
    .update(projectTasks)
    .set({
      cloudAgentId: next[0] ?? null,
      updatedAt: new Date(),
    })
    .where(eq(projectTasks.id, input.taskId));
  await redistributeCloudAgentUsage(database, input.workspaceId, [...previous, ...next]);
  if (next.length === 0) {
    await zeroTaskTokens(database, input.taskId);
  }
  return { changed: true };
}

/** @deprecated Callers pass one id. Prefer setTaskCloudAgentLinks. */
export async function relinkTaskUsage(
  database: Database,
  input: { taskId: string; workspaceId: string; cloudAgentId: string | null },
): Promise<{ changed: boolean }> {
  return setTaskCloudAgentLinks(database, {
    taskId: input.taskId,
    workspaceId: input.workspaceId,
    cloudAgentIds: input.cloudAgentId ? [input.cloudAgentId] : [],
  });
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
): Promise<CloudAgentTaskIndex> {
  const map = new Map<string, string[]>();
  for (const part of chunks(agentIds, HASH_CHUNK)) {
    if (part.length === 0) continue;
    const rows = await database.db
      .select({
        id: projectTaskCloudAgentLinks.taskId,
        cloudAgentId: projectTaskCloudAgentLinks.cloudAgentId,
      })
      .from(projectTaskCloudAgentLinks)
      .innerJoin(projectTasks, eq(projectTasks.id, projectTaskCloudAgentLinks.taskId))
      .innerJoin(projects, eq(projects.id, projectTasks.projectId))
      .where(
        and(
          eq(projects.workspaceId, workspaceId),
          inArray(projectTaskCloudAgentLinks.cloudAgentId, part),
          isNull(projectTasks.archivedAt),
        ),
      );
    for (const row of rows) {
      const list = map.get(row.cloudAgentId) ?? [];
      list.push(row.id);
      map.set(row.cloudAgentId, list);
    }
  }
  return map;
}

function unassignedEventWhere(workspaceId: string, importId?: string) {
  const noTaskLink = sql`NOT EXISTS (
    SELECT 1
    FROM project_task_cloud_agent_links l
    INNER JOIN project_tasks t ON t.id = l.task_id
    INNER JOIN projects p ON p.id = t.project_id
    WHERE l.cloud_agent_id = ${aiUsageEvents.cloudAgentId}
      AND p.workspace_id = ${aiUsageEvents.workspaceId}
      AND t.archived_at IS NULL
  )`;
  return and(
    eq(aiUsageEvents.workspaceId, workspaceId),
    importId ? eq(aiUsageEvents.importId, importId) : undefined,
    noTaskLink,
  );
}

/**
 * Write each linked task's equal share of the agents' imported events.
 * One task keeps the whole run. Events point at that task only then.
 */
export async function redistributeCloudAgentUsage(
  database: Database,
  workspaceId: string,
  agentIds: readonly string[],
): Promise<{ projectIds: string[]; overflow: boolean }> {
  const seed = [...new Set(agentIds.map((id) => id.trim()).filter((id) => id !== ''))];
  if (seed.length === 0) return { projectIds: [], overflow: false };

  // A task's counters are the sum of every agent it links. Rewriting one
  // agent has to include the other agents on those tasks, and those agents'
  // other tasks, or a share would replace a total and drop the rest.
  const linkRows = await loadAgentLinkClosure(database, workspaceId, seed);
  const ids = [
    ...new Set([...seed, ...linkRows.map((row) => row.cloudAgentId)]),
  ];
  const events = await database.db
    .select({
      id: aiUsageEvents.id,
      cloudAgentId: aiUsageEvents.cloudAgentId,
      occurredAt: aiUsageEvents.occurredAt,
      model: aiUsageEvents.model,
      maxMode: aiUsageEvents.maxMode,
      tokensInput: aiUsageEvents.tokensInput,
      tokensCacheWrite: aiUsageEvents.tokensCacheWrite,
      tokensCache: aiUsageEvents.tokensCache,
      tokensOutput: aiUsageEvents.tokensOutput,
    })
    .from(aiUsageEvents)
    .where(
      and(
        eq(aiUsageEvents.workspaceId, workspaceId),
        inArray(aiUsageEvents.cloudAgentId, ids),
      ),
    );

  const tasksByAgent = new Map<string, Array<{ taskId: string; projectId: string }>>();
  for (const row of linkRows) {
    const list = tasksByAgent.get(row.cloudAgentId) ?? [];
    if (!list.some((item) => item.taskId === row.taskId)) list.push(row);
    tasksByAgent.set(row.cloudAgentId, list);
  }

  let overflow = false;
  for (const agentId of ids) {
    const tasks = tasksByAgent.get(agentId) ?? [];
    const sole = tasks.length === 1 ? tasks[0]?.taskId ?? null : null;
    await database.db
      .update(aiUsageEvents)
      .set({ projectTaskId: sole })
      .where(
        and(
          eq(aiUsageEvents.workspaceId, workspaceId),
          eq(aiUsageEvents.cloudAgentId, agentId),
        ),
      );
  }

  type ShareAcc = {
    tokensInput: number;
    tokensOutput: number;
    tokensCache: number;
    tokensCacheWrite: number;
    modelId: string | null;
    pricingTier: string | null;
    usageOccurredAt: Date | null;
    billingPeriod: string | null;
    projectId: string;
  };
  const byTask = new Map<string, ShareAcc>();
  for (const agentId of ids) {
    const tasks = tasksByAgent.get(agentId) ?? [];
    const agentEvents = events.filter((row) => row.cloudAgentId === agentId);
    const aggregate = aggregateLinkedUsage(agentEvents);
    if (aggregate === 'overflow') {
      overflow = true;
      continue;
    }
    if (!aggregate || tasks.length === 0) continue;
    const shares = splitTokensAcrossTasks(aggregate, tasks.map((task) => task.taskId));
    for (const share of shares) {
      const projectId = tasks.find((task) => task.taskId === share.taskId)?.projectId ?? '';
      const current = byTask.get(share.taskId) ?? {
        tokensInput: 0,
        tokensOutput: 0,
        tokensCache: 0,
        tokensCacheWrite: 0,
        modelId: null,
        pricingTier: null,
        usageOccurredAt: null,
        billingPeriod: null,
        projectId,
      };
      current.tokensInput += share.tokensInput;
      current.tokensOutput += share.tokensOutput;
      current.tokensCache += share.tokensCache;
      current.tokensCacheWrite += share.tokensCacheWrite;
      if (
        !current.usageOccurredAt
        || aggregate.usageOccurredAt.getTime() >= current.usageOccurredAt.getTime()
      ) {
        current.modelId = aggregate.modelId;
        current.pricingTier = aggregate.pricingTier;
        current.usageOccurredAt = aggregate.usageOccurredAt;
        current.billingPeriod = aggregate.billingPeriod;
      }
      byTask.set(share.taskId, current);
    }
  }

  const projectIds = new Set<string>();
  const linkedTaskIds = [...new Set(linkRows.map((row) => row.taskId))];
  for (const taskId of linkedTaskIds) {
    const share = byTask.get(taskId);
    const projectId = share?.projectId
      ?? linkRows.find((row) => row.taskId === taskId)?.projectId
      ?? null;
    if (projectId) projectIds.add(projectId);
    if (!share) {
      await zeroTaskTokens(database, taskId);
      continue;
    }
    const tokensUsed =
      share.tokensInput + share.tokensOutput + share.tokensCache + share.tokensCacheWrite;
    await database.db
      .update(projectTasks)
      .set({
        tokensUsed,
        tokensInput: share.tokensInput,
        tokensOutput: share.tokensOutput,
        tokensCache: share.tokensCache,
        tokensCacheWrite: share.tokensCacheWrite,
        aiModelId: share.modelId,
        aiPricingTier: share.pricingTier,
        usageOccurredAt: share.usageOccurredAt,
        billingPeriod: share.billingPeriod,
        updatedAt: new Date(),
      })
      .where(eq(projectTasks.id, taskId));
  }
  return { projectIds: [...projectIds], overflow };
}

async function loadAgentLinkClosure(
  database: Database,
  workspaceId: string,
  seed: readonly string[],
): Promise<Array<{ taskId: string; cloudAgentId: string; projectId: string }>> {
  const agentIds = new Set(seed);
  const taskIds = new Set<string>();
  let rows: Array<{ taskId: string; cloudAgentId: string; projectId: string }> = [];
  for (let hop = 0; hop < 20; hop += 1) {
    const byAgent = agentIds.size === 0
      ? []
      : await selectAgentLinks(database, workspaceId, {
          agentIds: [...agentIds],
        });
    const byTask = taskIds.size === 0
      ? []
      : await selectAgentLinks(database, workspaceId, {
          taskIds: [...taskIds],
        });
    const merged = new Map<string, { taskId: string; cloudAgentId: string; projectId: string }>();
    for (const row of [...byAgent, ...byTask]) {
      merged.set(`${row.taskId}\0${row.cloudAgentId}`, row);
    }
    const nextAgents = new Set(seed);
    const nextTasks = new Set<string>();
    for (const row of merged.values()) {
      nextAgents.add(row.cloudAgentId);
      nextTasks.add(row.taskId);
    }
    const grew = nextAgents.size !== agentIds.size
      || nextTasks.size !== taskIds.size
      || merged.size !== rows.length;
    agentIds.clear();
    for (const id of nextAgents) agentIds.add(id);
    taskIds.clear();
    for (const id of nextTasks) taskIds.add(id);
    rows = [...merged.values()];
    if (!grew) break;
  }
  return rows;
}

async function selectAgentLinks(
  database: Database,
  workspaceId: string,
  filter: { agentIds?: string[]; taskIds?: string[] },
): Promise<Array<{ taskId: string; cloudAgentId: string; projectId: string }>> {
  const agentIds = filter.agentIds ?? [];
  const taskIds = filter.taskIds ?? [];
  if (agentIds.length === 0 && taskIds.length === 0) return [];
  return database.db
    .select({
      taskId: projectTaskCloudAgentLinks.taskId,
      cloudAgentId: projectTaskCloudAgentLinks.cloudAgentId,
      projectId: projectTasks.projectId,
    })
    .from(projectTaskCloudAgentLinks)
    .innerJoin(projectTasks, eq(projectTasks.id, projectTaskCloudAgentLinks.taskId))
    .innerJoin(projects, eq(projects.id, projectTasks.projectId))
    .where(
      and(
        eq(projects.workspaceId, workspaceId),
        agentIds.length > 0
          ? inArray(projectTaskCloudAgentLinks.cloudAgentId, agentIds)
          : inArray(projectTaskCloudAgentLinks.taskId, taskIds),
        isNull(projectTasks.archivedAt),
      ),
    );
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
