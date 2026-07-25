import {
  and,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  like,
  or,
  sql,
} from 'drizzle-orm';
import {
  apiClients,
  auditEvents,
  knowledgeRecords,
  projects,
  sessions,
  systems,
  users,
  workspaces,
  type Database,
} from '@project-knowledge-hub/database';

export async function getSchemaVersionLabel(database: Database): Promise<string> {
  try {
    const rows = (await database.db.execute(
      sql`SELECT COALESCE((SELECT MAX(id)::text FROM drizzle.__drizzle_migrations), 'unknown') AS v`,
    )) as unknown as Array<{ v: string }>;
    return rows[0]?.v ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

export async function getActiveSessionCount(database: Database): Promise<number> {
  const now = new Date();
  const [row] = await database.db
    .select({ value: count() })
    .from(sessions)
    .where(and(isNull(sessions.revokedAt), gte(sessions.expiresAt, now)));
  return Number(row?.value ?? 0);
}

export async function getPendingAttention(database: Database): Promise<{
  pendingUsers: number;
  pendingApiClients: number;
}> {
  const [userRow] = await database.db
    .select({ value: count() })
    .from(users)
    .where(eq(users.status, 'pending_approval'));
  const [clientRow] = await database.db
    .select({ value: count() })
    .from(apiClients)
    .where(eq(apiClients.status, 'pending_approval'));
  return {
    pendingUsers: Number(userRow?.value ?? 0),
    pendingApiClients: Number(clientRow?.value ?? 0),
  };
}

/** MCP Streamable HTTP (`mcp.*`) + ChatGPT/OpenAPI Actions (`llm.*`). */
function agentAuditWhere(since: Date) {
  return and(
    gte(auditEvents.createdAt, since),
    or(like(auditEvents.action, 'mcp.%'), like(auditEvents.action, 'llm.%')),
  );
}

export async function getMcpActivitySummary(
  database: Database,
  since: Date,
): Promise<{
  requestCount: number;
  toolCallCount: number;
  toolErrorCount: number;
  topActions: Array<{ action: string; count: number }>;
}> {
  const agentWhere = agentAuditWhere(since);

  const [totalRow] = await database.db
    .select({ value: count() })
    .from(auditEvents)
    .where(agentWhere);

  const [toolCalls] = await database.db
    .select({ value: count() })
    .from(auditEvents)
    .where(
      and(
        gte(auditEvents.createdAt, since),
        or(
          eq(auditEvents.action, 'mcp.tool_call'),
          eq(auditEvents.action, 'llm.tool_call'),
        ),
      ),
    );

  const [toolErrors] = await database.db
    .select({ value: count() })
    .from(auditEvents)
    .where(
      and(
        gte(auditEvents.createdAt, since),
        or(
          eq(auditEvents.action, 'mcp.tool_error'),
          eq(auditEvents.action, 'llm.tool_error'),
        ),
      ),
    );

  const topRows = await database.db
    .select({
      action: auditEvents.action,
      value: count(),
    })
    .from(auditEvents)
    .where(agentWhere)
    .groupBy(auditEvents.action)
    .orderBy(desc(count()))
    .limit(8);

  return {
    requestCount: Number(totalRow?.value ?? 0),
    toolCallCount: Number(toolCalls?.value ?? 0),
    toolErrorCount: Number(toolErrors?.value ?? 0),
    topActions: topRows.map((row) => ({
      action: row.action,
      count: Number(row.value),
    })),
  };
}

export type MonitoringLeaderboardClient = {
  actorId: string;
  clientName: string | null;
  requestCount: number;
  toolCallCount: number;
  toolErrorCount: number;
};

export type MonitoringCatalogueHit = {
  entityId: string;
  label: string | null;
  count: number;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/** drizzle execute() may return a row array or `{ rows: [...] }` depending on driver. */
function rowsFromExecute<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (
    result &&
    typeof result === 'object' &&
    Array.isArray((result as { rows?: unknown }).rows)
  ) {
    return (result as { rows: T[] }).rows;
  }
  return [];
}

function uuidEntityIds(
  items: Array<{ entityId: string; count: number }>,
): Array<{ entityId: string; count: number }> {
  return items.filter((item) => isUuid(item.entityId));
}

export async function getClientLeaderboard(
  database: Database,
  since: Date,
  limit = 10,
): Promise<MonitoringLeaderboardClient[]> {
  const rows = rowsFromExecute<{
    actorId: string;
    requestCount: number;
    toolCallCount: number;
    toolErrorCount: number;
  }>(
    await database.db.execute(sql`
      SELECT
        actor_id AS "actorId",
        COUNT(*)::int AS "requestCount",
        COUNT(*) FILTER (
          WHERE action IN ('mcp.tool_call', 'llm.tool_call')
        )::int AS "toolCallCount",
        COUNT(*) FILTER (
          WHERE action IN ('mcp.tool_error', 'llm.tool_error')
        )::int AS "toolErrorCount"
      FROM audit_events
      WHERE created_at >= ${since.toISOString()}
        AND actor_type = 'api_client'
        AND (action LIKE 'mcp.%' OR action LIKE 'llm.%')
        AND actor_id IS NOT NULL
      GROUP BY actor_id
      ORDER BY COUNT(*) DESC
      LIMIT ${limit}
    `),
  );

  if (rows.length === 0) {
    return [];
  }

  // actor_id is text; only UUID values can join api_clients.id (uuid column).
  const ids = rows.map((row) => row.actorId).filter(isUuid);
  const clients = ids.length
    ? await database.db
        .select({ id: apiClients.id, name: apiClients.name })
        .from(apiClients)
        .where(inArray(apiClients.id, ids))
    : [];
  const nameById = new Map(clients.map((c) => [c.id, c.name]));

  return rows.map((row) => ({
    actorId: row.actorId,
    clientName: nameById.get(row.actorId) ?? null,
    requestCount: Number(row.requestCount),
    toolCallCount: Number(row.toolCallCount),
    toolErrorCount: Number(row.toolErrorCount),
  }));
}

async function topEntityIdsFromActions(
  database: Database,
  since: Date,
  actionPrefix: string,
  limit: number,
): Promise<Array<{ entityId: string; count: number }>> {
  const rows = rowsFromExecute<{ entityId: string; count: number }>(
    await database.db.execute(sql`
      SELECT entity_id AS "entityId", COUNT(*)::int AS count
      FROM audit_events
      WHERE created_at >= ${since.toISOString()}
        AND action LIKE ${`${actionPrefix}%`}
        AND entity_id IS NOT NULL
        AND entity_id <> ''
      GROUP BY entity_id
      ORDER BY COUNT(*) DESC
      LIMIT ${limit}
    `),
  );
  return uuidEntityIds(
    rows.map((row) => ({
      entityId: row.entityId,
      count: Number(row.count),
    })),
  );
}

async function topIdsFromMcpMetadata(
  database: Database,
  since: Date,
  metaKey: 'recordId' | 'projectId' | 'systemId',
  limit: number,
): Promise<Array<{ entityId: string; count: number }>> {
  // Literal keys only — parameterized ->> / GROUP BY slots are not equal in Postgres.
  const entityExpr =
    metaKey === 'recordId'
      ? sql`metadata_json->>'recordId'`
      : metaKey === 'projectId'
        ? sql`metadata_json->>'projectId'`
        : sql`metadata_json->>'systemId'`;

  const rows = rowsFromExecute<{ entityId: string | null; count: number }>(
    await database.db.execute(sql`
      SELECT ${entityExpr} AS "entityId", COUNT(*)::int AS count
      FROM audit_events
      WHERE created_at >= ${since.toISOString()}
        AND action IN (
          'mcp.tool_call',
          'mcp.tool_error',
          'llm.tool_call',
          'llm.tool_error'
        )
        AND metadata_json ? ${metaKey}
        AND COALESCE(${entityExpr}, '') <> ''
      GROUP BY 1
      ORDER BY COUNT(*) DESC
      LIMIT ${limit}
    `),
  );
  return uuidEntityIds(
    rows
      .filter((row): row is { entityId: string; count: number } => Boolean(row.entityId))
      .map((row) => ({ entityId: row.entityId, count: Number(row.count) })),
  );
}

function mergeTopCounts(
  a: Array<{ entityId: string; count: number }>,
  b: Array<{ entityId: string; count: number }>,
  limit: number,
): Array<{ entityId: string; count: number }> {
  const map = new Map<string, number>();
  for (const item of [...a, ...b]) {
    map.set(item.entityId, (map.get(item.entityId) ?? 0) + item.count);
  }
  return [...map.entries()]
    .map(([entityId, count]) => ({ entityId, count }))
    .sort((x, y) => y.count - x.count)
    .slice(0, limit);
}

async function topViewedRecordIds(
  database: Database,
  since: Date,
  limit: number,
): Promise<Array<{ entityId: string; count: number }>> {
  const rows = await database.db
    .select({
      entityId: auditEvents.entityId,
      value: count(),
    })
    .from(auditEvents)
    .where(
      and(
        gte(auditEvents.createdAt, since),
        eq(auditEvents.action, 'knowledge.view'),
        isNotNull(auditEvents.entityId),
      ),
    )
    .groupBy(auditEvents.entityId)
    .orderBy(desc(count()))
    .limit(limit);

  return rows
    .filter((row): row is { entityId: string; value: number } => Boolean(row.entityId))
    .map((row) => ({ entityId: row.entityId, count: Number(row.value) }));
}

export async function getSearchTelemetrySummary(
  database: Database,
  since: Date,
  limit = 8,
): Promise<{
  searchCount: number;
  topQueryHashes: Array<{ queryHash: string; queryLength: number | null; count: number }>;
}> {
  const [totalRow] = await database.db
    .select({ value: count() })
    .from(auditEvents)
    .where(
      and(gte(auditEvents.createdAt, since), eq(auditEvents.action, 'knowledge.search')),
    );

  const rows = rowsFromExecute<{
    queryHash: string | null;
    queryLength: number | null;
    count: number;
  }>(
    await database.db.execute(sql`
      SELECT
        metadata_json->>'queryHash' AS "queryHash",
        CASE
          WHEN (metadata_json->>'queryLength') ~ '^[0-9]+$'
          THEN (metadata_json->>'queryLength')::int
          ELSE NULL
        END AS "queryLength",
        COUNT(*)::int AS count
      FROM audit_events
      WHERE created_at >= ${since.toISOString()}
        AND action = 'knowledge.search'
        AND COALESCE(metadata_json->>'queryHash', '') <> ''
      GROUP BY 1, 2
      ORDER BY COUNT(*) DESC
      LIMIT ${limit}
    `),
  );

  return {
    searchCount: Number(totalRow?.value ?? 0),
    topQueryHashes: rows
      .filter((row): row is { queryHash: string; queryLength: number | null; count: number } =>
        Boolean(row.queryHash),
      )
      .map((row) => ({
        queryHash: row.queryHash,
        queryLength: row.queryLength,
        count: Number(row.count),
      })),
  };
}

export async function getCatalogueUsageSummary(
  database: Database,
  since: Date,
  limit = 8,
): Promise<{
  topRecords: MonitoringCatalogueHit[];
  topViewedRecords: MonitoringCatalogueHit[];
  topProjects: MonitoringCatalogueHit[];
  topSystems: MonitoringCatalogueHit[];
  search: {
    searchCount: number;
    topQueryHashes: Array<{ queryHash: string; queryLength: number | null; count: number }>;
  };
}> {
  const [
    recordMutations,
    recordMcp,
    projectMutations,
    projectMcp,
    systemMutations,
    systemMcp,
    viewed,
    search,
  ] =
    await Promise.all([
      topEntityIdsFromActions(database, since, 'knowledge_record.', limit * 2),
      topIdsFromMcpMetadata(database, since, 'recordId', limit * 2),
      topEntityIdsFromActions(database, since, 'project.', limit * 2),
      topIdsFromMcpMetadata(database, since, 'projectId', limit * 2),
      topEntityIdsFromActions(database, since, 'system.', limit * 2),
      topIdsFromMcpMetadata(database, since, 'systemId', limit * 2),
      topViewedRecordIds(database, since, limit),
      getSearchTelemetrySummary(database, since, limit),
    ]);

  const topRecordIds = uuidEntityIds(mergeTopCounts(recordMutations, recordMcp, limit));
  const topProjectIds = uuidEntityIds(mergeTopCounts(projectMutations, projectMcp, limit));
  const topSystemIds = uuidEntityIds(mergeTopCounts(systemMutations, systemMcp, limit));
  const viewedSafe = uuidEntityIds(viewed);
  const labelIds = [
    ...new Set([
      ...topRecordIds.map((r) => r.entityId),
      ...viewedSafe.map((r) => r.entityId),
    ]),
  ];

  const [recordRows, projectRows, systemRows] = await Promise.all([
    labelIds.length
      ? database.db
          .select({
            id: knowledgeRecords.id,
            title: knowledgeRecords.title,
            slug: knowledgeRecords.slug,
          })
          .from(knowledgeRecords)
          .where(inArray(knowledgeRecords.id, labelIds))
      : Promise.resolve([]),
    topProjectIds.length
      ? database.db
          .select({ id: projects.id, name: projects.name, slug: projects.slug })
          .from(projects)
          .where(
            inArray(
              projects.id,
              topProjectIds.map((r) => r.entityId),
            ),
          )
      : Promise.resolve([]),
    topSystemIds.length
      ? database.db
          .select({ id: systems.id, name: systems.name, slug: systems.slug })
          .from(systems)
          .where(
            inArray(
              systems.id,
              topSystemIds.map((r) => r.entityId),
            ),
          )
      : Promise.resolve([]),
  ]);

  const recordLabel = new Map(
    recordRows.map((r) => [r.id, r.title || r.slug] as const),
  );
  const projectLabel = new Map(
    projectRows.map((r) => [r.id, r.name || r.slug] as const),
  );
  const systemLabel = new Map(
    systemRows.map((r) => [r.id, r.name || r.slug] as const),
  );

  return {
    topRecords: topRecordIds.map((row) => ({
      entityId: row.entityId,
      label: recordLabel.get(row.entityId) ?? null,
      count: row.count,
    })),
    topViewedRecords: viewedSafe.map((row) => ({
      entityId: row.entityId,
      label: recordLabel.get(row.entityId) ?? null,
      count: row.count,
    })),
    topProjects: topProjectIds.map((row) => ({
      entityId: row.entityId,
      label: projectLabel.get(row.entityId) ?? null,
      count: row.count,
    })),
    topSystems: topSystemIds.map((row) => ({
      entityId: row.entityId,
      label: systemLabel.get(row.entityId) ?? null,
      count: row.count,
    })),
    search,
  };
}

export async function getArchivedEntityCounts(database: Database): Promise<{
  workspaces: number;
  projects: number;
  systems: number;
  knowledgeRecords: number;
}> {
  const [ws, pr, sy, kr] = await Promise.all([
    database.db
      .select({ value: count() })
      .from(workspaces)
      .where(isNotNull(workspaces.archivedAt)),
    database.db
      .select({ value: count() })
      .from(projects)
      .where(isNotNull(projects.archivedAt)),
    database.db
      .select({ value: count() })
      .from(systems)
      .where(isNotNull(systems.archivedAt)),
    database.db
      .select({ value: count() })
      .from(knowledgeRecords)
      .where(isNotNull(knowledgeRecords.archivedAt)),
  ]);
  return {
    workspaces: Number(ws[0]?.value ?? 0),
    projects: Number(pr[0]?.value ?? 0),
    systems: Number(sy[0]?.value ?? 0),
    knowledgeRecords: Number(kr[0]?.value ?? 0),
  };
}

export async function listActiveWorkspacesForMonitoring(
  database: Database,
): Promise<Array<{ id: string; name: string; slug: string }>> {
  return database.db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      slug: workspaces.slug,
    })
    .from(workspaces)
    .where(isNull(workspaces.archivedAt))
    .orderBy(workspaces.name)
    .limit(200);
}

const ERROR_AUDIT_ACTION_SQL = sql`(
  ${auditEvents.action} ILIKE '%error%'
  OR ${auditEvents.action} ILIKE '%fail%'
  OR ${auditEvents.action} IN ('mcp.tool_error', 'llm.tool_error')
)`;

/** Recent audit rows that look like failures (ids/actions only — no metadata). */
export async function getRecentErrorAuditEvents(
  database: Database,
  since: Date,
  limit = 40,
): Promise<
  Array<{
    id: string;
    action: string;
    entityType: string;
    entityId: string | null;
    createdAt: string;
  }>
> {
  const rows = await database.db
    .select({
      id: auditEvents.id,
      action: auditEvents.action,
      entityType: auditEvents.entityType,
      entityId: auditEvents.entityId,
      createdAt: auditEvents.createdAt,
    })
    .from(auditEvents)
    .where(and(gte(auditEvents.createdAt, since), ERROR_AUDIT_ACTION_SQL))
    .orderBy(desc(auditEvents.createdAt))
    .limit(limit);

  return rows.map((row) => ({
    id: row.id,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    createdAt: row.createdAt.toISOString(),
  }));
}

/** Count error-like audit events since `since` (for Monitoring ops export). */
export async function countErrorAuditEvents(
  database: Database,
  since: Date,
): Promise<number> {
  const [row] = await database.db
    .select({ value: count() })
    .from(auditEvents)
    .where(and(gte(auditEvents.createdAt, since), ERROR_AUDIT_ACTION_SQL));
  return Number(row?.value ?? 0);
}

export function isBackupStale(
  ageSeconds: number | null,
  staleAfterHours: number,
): boolean {
  if (ageSeconds == null) return true;
  return ageSeconds > staleAfterHours * 3600;
}
