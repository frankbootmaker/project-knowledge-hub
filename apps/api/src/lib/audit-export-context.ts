import { eq, inArray } from 'drizzle-orm';
import {
  organizations,
  projects,
  workspaces,
  type Database,
} from '@project-knowledge-hub/database';
import type { PublicAuditEvent } from './audit-export.js';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

function metadataProjectId(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return null;
  }
  const record = metadata as Record<string, unknown>;
  if (isUuid(record.projectId)) return record.projectId;
  if (isUuid(record.project_id)) return record.project_id;
  return null;
}

function summarizeLabels(
  names: string[],
  emptyLabel: string,
  multiLabel: string,
): string {
  const unique = [...new Set(names)].filter(Boolean).sort((a, b) => a.localeCompare(b));
  if (unique.length === 0) return emptyLabel;
  if (unique.length === 1) return unique[0]!;
  if (unique.length <= 3) return unique.join(', ');
  return `${multiLabel} (${unique.length})`;
}

export type AuditExportLabels = {
  organizationLabel: string;
  projectLabel: string;
};

export async function resolveAuditExportLabels(
  db: Database['db'],
  events: PublicAuditEvent[],
  filterOrganizationId?: string,
): Promise<AuditExportLabels> {
  const orgIds = new Set<string>();
  if (filterOrganizationId) {
    orgIds.add(filterOrganizationId);
  }
  for (const event of events) {
    if (event.organizationId) {
      orgIds.add(event.organizationId);
    }
  }

  const projectIds = new Set<string>();
  for (const event of events) {
    if (event.entityType === 'project' && isUuid(event.entityId)) {
      projectIds.add(event.entityId);
    }
    const fromMeta = metadataProjectId(event.metadata);
    if (fromMeta) {
      projectIds.add(fromMeta);
    }
  }

  let organizationNames: string[] = [];
  if (orgIds.size > 0) {
    const rows = await db
      .select({ name: organizations.name })
      .from(organizations)
      .where(inArray(organizations.id, [...orgIds]));
    organizationNames = rows.map((row) => row.name);
  }

  let projectNames: string[] = [];
  if (projectIds.size > 0) {
    const rows = await db
      .select({
        name: projects.name,
        workspaceName: workspaces.name,
      })
      .from(projects)
      .innerJoin(workspaces, eq(workspaces.id, projects.workspaceId))
      .where(inArray(projects.id, [...projectIds]));
    projectNames = rows.map((row) => `${row.name} (${row.workspaceName})`);
  }

  return {
    organizationLabel: summarizeLabels(
      organizationNames,
      'All organizations',
      'Multiple organizations',
    ),
    projectLabel: summarizeLabels(projectNames, 'Not specified', 'Multiple projects'),
  };
}
