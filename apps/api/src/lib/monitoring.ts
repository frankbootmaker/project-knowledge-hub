import { and, count, desc, eq, gte, inArray, isNotNull, isNull, like, sql } from 'drizzle-orm';
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

export async function getMcpActivitySummary(
  database: Database,
  since: Date,
): Promise<{
  requestCount: number;
  toolCallCount: number;
  toolErrorCount: number;
  topActions: Array<{ action: string; count: number }>;
}> {
  const mcpWhere = and(
    gte(auditEvents.createdAt, since),
    like(auditEvents.action, 'mcp.%'),
  );

  const [totalRow] = await database.db
    .select({ value: count() })
    .from(auditEvents)
    .where(mcpWhere);

  const [toolCalls] = await database.db
    .select({ value: count() })
    .from(auditEvents)
    .where(
      and(
        gte(auditEvents.createdAt, since),
        eq(auditEvents.action, 'mcp.tool_call'),
      ),
    );

  const [toolErrors] = await database.db
    .select({ value: count() })
    .from(auditEvents)
    .where(
      and(
        gte(auditEvents.createdAt, since),
        eq(auditEvents.action, 'mcp.tool_error'),
      ),
    );

  const topRows = await database.db
    .select({
      action: auditEvents.action,
      value: count(),
    })
    .from(auditEvents)
    .where(mcpWhere)
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

export async function getClientLeaderboard(
  database: Database,
  since: Date,
  limit = 10,
): Promise<MonitoringLeaderboardClient[]> {
  const rows = (await database.db.execute(sql`
    SELECT
      actor_id AS "actorId",
      COUNT(*)::int AS "requestCount",
      COUNT(*) FILTER (WHERE action = 'mcp.tool_call')::int AS "toolCallCount",
      COUNT(*) FILTER (WHERE action = 'mcp.tool_error')::int AS "toolErrorCount"
    FROM audit_events
    WHERE created_at >= ${since.toISOString()}
      AND actor_type = 'api_client'
      AND action LIKE 'mcp.%'
      AND actor_id IS NOT NULL
    GROUP BY actor_id
    ORDER BY COUNT(*) DESC
    LIMIT ${limit}
  `)) as unknown as Array<{
    actorId: string;
    requestCount: number;
    toolCallCount: number;
    toolErrorCount: number;
  }>;

  if (rows.length === 0) {
    return [];
  }

  const ids = rows.map((row) => row.actorId);
  const clients = await database.db
    .select({ id: apiClients.id, name: apiClients.name })
    .from(apiClients)
    .where(inArray(apiClients.id, ids));
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
  const rows = (await database.db.execute(sql`
    SELECT entity_id AS "entityId", COUNT(*)::int AS count
    FROM audit_events
    WHERE created_at >= ${since.toISOString()}
      AND action LIKE ${`${actionPrefix}%`}
      AND entity_id IS NOT NULL
      AND entity_id <> ''
    GROUP BY entity_id
    ORDER BY COUNT(*) DESC
    LIMIT ${limit}
  `)) as unknown as Array<{ entityId: string; count: number }>;
  return rows.map((row) => ({
    entityId: row.entityId,
    count: Number(row.count),
  }));
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

  const rows = (await database.db.execute(sql`
    SELECT ${entityExpr} AS "entityId", COUNT(*)::int AS count
    FROM audit_events
    WHERE created_at >= ${since.toISOString()}
      AND action IN ('mcp.tool_call', 'mcp.tool_error')
      AND metadata_json ? ${metaKey}
      AND COALESCE(${entityExpr}, '') <> ''
    GROUP BY 1
    ORDER BY COUNT(*) DESC
    LIMIT ${limit}
  `)) as unknown as Array<{ entityId: string | null; count: number }>;
  return rows
    .filter((row): row is { entityId: string; count: number } => Boolean(row.entityId))
    .map((row) => ({ entityId: row.entityId, count: Number(row.count) }));
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

export async function getCatalogueUsageSummary(
  database: Database,
  since: Date,
  limit = 8,
): Promise<{
  topRecords: MonitoringCatalogueHit[];
  topProjects: MonitoringCatalogueHit[];
  topSystems: MonitoringCatalogueHit[];
}> {
  const [recordMutations, recordMcp, projectMutations, projectMcp, systemMutations, systemMcp] =
    await Promise.all([
      topEntityIdsFromActions(database, since, 'knowledge_record.', limit * 2),
      topIdsFromMcpMetadata(database, since, 'recordId', limit * 2),
      topEntityIdsFromActions(database, since, 'project.', limit * 2),
      topIdsFromMcpMetadata(database, since, 'projectId', limit * 2),
      topEntityIdsFromActions(database, since, 'system.', limit * 2),
      topIdsFromMcpMetadata(database, since, 'systemId', limit * 2),
    ]);

  const topRecordIds = mergeTopCounts(recordMutations, recordMcp, limit);
  const topProjectIds = mergeTopCounts(projectMutations, projectMcp, limit);
  const topSystemIds = mergeTopCounts(systemMutations, systemMcp, limit);

  const [recordRows, projectRows, systemRows] = await Promise.all([
    topRecordIds.length
      ? database.db
          .select({
            id: knowledgeRecords.id,
            title: knowledgeRecords.title,
            slug: knowledgeRecords.slug,
          })
          .from(knowledgeRecords)
          .where(
            inArray(
              knowledgeRecords.id,
              topRecordIds.map((r) => r.entityId),
            ),
          )
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
    .where(
      and(
        gte(auditEvents.createdAt, since),
        sql`(
          ${auditEvents.action} ILIKE '%error%'
          OR ${auditEvents.action} ILIKE '%fail%'
          OR ${auditEvents.action} = 'mcp.tool_error'
        )`,
      ),
    )
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

export function isBackupStale(
  ageSeconds: number | null,
  staleAfterHours: number,
): boolean {
  if (ageSeconds == null) return true;
  return ageSeconds > staleAfterHours * 3600;
}
