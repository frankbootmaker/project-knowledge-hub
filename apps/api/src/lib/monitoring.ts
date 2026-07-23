import { and, count, desc, eq, gte, isNull, like, sql } from 'drizzle-orm';
import {
  apiClients,
  auditEvents,
  sessions,
  users,
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
