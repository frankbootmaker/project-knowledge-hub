import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { workspaces, type Database } from '@project-knowledge-hub/database';
import { writeAuditEvent } from './identity.js';

export function hashSearchQuery(query: string): string {
  const normalized = query.trim().toLowerCase().replace(/\s+/g, ' ');
  return createHash('sha256').update(normalized).digest('hex');
}

export async function resolveWorkspaceOrganizationId(
  database: Database,
  workspaceId: string,
): Promise<string | null> {
  const [row] = await database.db
    .select({ organizationId: workspaces.organizationId })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  return row?.organizationId ?? null;
}

export async function auditKnowledgeView(input: {
  database: Database;
  organizationId: string | null;
  actorType: 'user' | 'api_client';
  actorId: string;
  recordId: string;
  workspaceId: string;
  projectId: string | null;
  systemId: string | null;
  slug?: string;
  via: 'session' | 'mcp' | 'llm';
  ipAddress?: string | null;
}): Promise<void> {
  await writeAuditEvent(input.database, {
    organizationId: input.organizationId,
    actorType: input.actorType,
    actorId: input.actorId,
    action: 'knowledge.view',
    entityType: 'knowledge_record',
    entityId: input.recordId,
    metadata: {
      via: input.via,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      systemId: input.systemId,
      ...(input.slug ? { slug: input.slug } : {}),
    },
    ipAddress: input.ipAddress ?? null,
  });
}

export async function auditKnowledgeSearch(input: {
  database: Database;
  organizationId: string | null;
  actorType: 'user' | 'api_client';
  actorId: string;
  workspaceId: string;
  query: string;
  mode: string;
  resultCount: number;
  projectId?: string | null;
  systemId?: string | null;
  via: 'session' | 'mcp' | 'llm';
  ipAddress?: string | null;
}): Promise<void> {
  await writeAuditEvent(input.database, {
    organizationId: input.organizationId,
    actorType: input.actorType,
    actorId: input.actorId,
    action: 'knowledge.search',
    entityType: 'workspace',
    entityId: input.workspaceId,
    metadata: {
      via: input.via,
      queryHash: hashSearchQuery(input.query),
      queryLength: input.query.trim().length,
      mode: input.mode,
      resultCount: input.resultCount,
      ...(input.projectId ? { projectId: input.projectId } : {}),
      ...(input.systemId ? { systemId: input.systemId } : {}),
    },
    ipAddress: input.ipAddress ?? null,
  });
}
