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
  type AiUsageImportSource,
  type AiUsageRowError,
  type NormalizedAiUsageRow,
  type UsageImportStats,
} from '@project-knowledge-hub/domain';

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
  errors: AiUsageRowError[];
};

export type PublicUsagePreview = UsageImportStats & {
  source: 'csv';
  fileName: string | null;
};

export type UnassignedUsageGroup = {
  cloudAgentId: string | null;
  rowCount: number;
  tokensTotal: number;
  latestAt: string;
  models: string[];
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
  const stats = await statsForParsed(database, workspaceId, parsed);
  return {
    source: 'csv',
    fileName: sanitizeUsageFileName(input.fileName),
    ...stats,
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

  const [created] = await database.db
    .insert(aiUsageImports)
    .values({
      workspaceId,
      source: 'csv',
      fileName: sanitizeUsageFileName(input.fileName),
      createdBy: input.actorUserId,
      rowCountTotal: parsed.rows.length + parsed.errors.length,
      rowCountInserted: 0,
      rowCountDuplicate: prepared.duplicateCount,
      rowCountLinked: 0,
      rowCountErrors: parsed.errors.length,
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
      errorsJson: errors,
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
): Promise<{ total: number; groups: UnassignedUsageGroup[] }> {
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
  return {
    total: Number(countRow?.total ?? 0),
    groups: groups.map((group) => ({
      cloudAgentId: group.cloudAgentId,
      rowCount: Number(group.rowCount),
      tokensTotal: Number(group.tokensTotal),
      latestAt: new Date(group.latestAt).toISOString(),
      models: Array.isArray(group.models) ? group.models : [],
    })),
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

async function statsForParsed(
  database: Database,
  workspaceId: string,
  parsed: { rows: NormalizedAiUsageRow[]; errors: AiUsageRowError[] },
): Promise<UsageImportStats> {
  const prepared = await prepareRows(database, workspaceId, parsed.rows);
  return previewUsageImport({
    rows: parsed.rows,
    errors: parsed.errors,
    existingHashes: prepared.existingHashes,
    taskIdByCloudAgentId: prepared.taskIdByCloudAgentId,
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
    errors: readErrors(row.errorsJson),
  };
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
