import { and, count, desc, eq, inArray, isNull, ne } from 'drizzle-orm';
import type { Database } from '@project-knowledge-hub/database';
import {
  knowledgeRecords,
  projects,
  systems,
  workspaces,
} from '@project-knowledge-hub/database';
import { formatHumanKey } from '@project-knowledge-hub/domain';
import { accessibleWorkspaceIds } from './dashboard-insights.js';

export type WorkspaceEntityCounts = {
  workspaceId: string;
  projectCount: number;
  systemCount: number;
  recordCount: number;
};

export type RecentWorkspaceItem = {
  kind: 'project' | 'system' | 'record';
  id: string;
  humanKey: string | null;
  title: string;
  slug: string;
  workspaceName: string;
  workspaceSlug: string;
  status: string;
  updatedAt: string;
};

async function countByWorkspace(
  workspaceIds: string[],
  load: (ids: string[]) => Promise<Array<{ workspaceId: string; value: number }>>,
): Promise<Map<string, number>> {
  const rows = workspaceIds.length === 0 ? [] : await load(workspaceIds);
  const map = new Map<string, number>();
  for (const row of rows) map.set(row.workspaceId, Number(row.value) || 0);
  return map;
}

export async function listWorkspaceEntityCounts(
  database: Database,
  input: { userId: string; isSystemAdmin: boolean },
): Promise<WorkspaceEntityCounts[]> {
  const workspaceIds = await accessibleWorkspaceIds(
    database,
    input.userId,
    input.isSystemAdmin,
  );
  if (workspaceIds.length === 0) return [];

  const [projectCounts, systemCounts, recordCounts] = await Promise.all([
    countByWorkspace(workspaceIds, (ids) =>
      database.db
        .select({ workspaceId: projects.workspaceId, value: count() })
        .from(projects)
        .where(
          and(
            inArray(projects.workspaceId, ids),
            isNull(projects.archivedAt),
            ne(projects.status, 'archived'),
          ),
        )
        .groupBy(projects.workspaceId),
    ),
    countByWorkspace(workspaceIds, (ids) =>
      database.db
        .select({ workspaceId: systems.workspaceId, value: count() })
        .from(systems)
        .where(
          and(
            inArray(systems.workspaceId, ids),
            isNull(systems.archivedAt),
            ne(systems.status, 'archived'),
          ),
        )
        .groupBy(systems.workspaceId),
    ),
    countByWorkspace(workspaceIds, (ids) =>
      database.db
        .select({
          workspaceId: knowledgeRecords.workspaceId,
          value: count(),
        })
        .from(knowledgeRecords)
        .where(
          and(
            inArray(knowledgeRecords.workspaceId, ids),
            isNull(knowledgeRecords.archivedAt),
            ne(knowledgeRecords.lifecycleStatus, 'archived'),
          ),
        )
        .groupBy(knowledgeRecords.workspaceId),
    ),
  ]);

  return workspaceIds.map((workspaceId) => ({
    workspaceId,
    projectCount: projectCounts.get(workspaceId) ?? 0,
    systemCount: systemCounts.get(workspaceId) ?? 0,
    recordCount: recordCounts.get(workspaceId) ?? 0,
  }));
}

export async function listRecentWorkspaceItems(
  database: Database,
  input: { userId: string; isSystemAdmin: boolean; limit: number },
): Promise<RecentWorkspaceItem[]> {
  const workspaceIds = await accessibleWorkspaceIds(
    database,
    input.userId,
    input.isSystemAdmin,
  );
  if (workspaceIds.length === 0) return [];
  const limit = Math.min(Math.max(input.limit, 1), 20);

  const [projectRows, systemRows, recordRows] = await Promise.all([
    database.db
      .select({
        id: projects.id,
        title: projects.name,
        slug: projects.slug,
        keyPrefix: projects.keyPrefix,
        status: projects.status,
        updatedAt: projects.updatedAt,
        workspaceName: workspaces.name,
        workspaceSlug: workspaces.slug,
      })
      .from(projects)
      .innerJoin(workspaces, eq(projects.workspaceId, workspaces.id))
      .where(
        and(
          inArray(projects.workspaceId, workspaceIds),
          isNull(projects.archivedAt),
          ne(projects.status, 'archived'),
          isNull(workspaces.archivedAt),
        ),
      )
      .orderBy(desc(projects.updatedAt))
      .limit(limit),
    database.db
      .select({
        id: systems.id,
        title: systems.name,
        slug: systems.slug,
        status: systems.status,
        updatedAt: systems.updatedAt,
        workspaceName: workspaces.name,
        workspaceSlug: workspaces.slug,
      })
      .from(systems)
      .innerJoin(workspaces, eq(systems.workspaceId, workspaces.id))
      .where(
        and(
          inArray(systems.workspaceId, workspaceIds),
          isNull(systems.archivedAt),
          ne(systems.status, 'archived'),
          isNull(workspaces.archivedAt),
        ),
      )
      .orderBy(desc(systems.updatedAt))
      .limit(limit),
    database.db
      .select({
        id: knowledgeRecords.id,
        title: knowledgeRecords.title,
        slug: knowledgeRecords.slug,
        status: knowledgeRecords.lifecycleStatus,
        updatedAt: knowledgeRecords.updatedAt,
        documentKeyType: knowledgeRecords.documentKeyType,
        documentNumber: knowledgeRecords.documentNumber,
        keyPrefix: projects.keyPrefix,
        workspaceName: workspaces.name,
        workspaceSlug: workspaces.slug,
      })
      .from(knowledgeRecords)
      .innerJoin(workspaces, eq(knowledgeRecords.workspaceId, workspaces.id))
      .leftJoin(projects, eq(knowledgeRecords.projectId, projects.id))
      .where(
        and(
          inArray(knowledgeRecords.workspaceId, workspaceIds),
          isNull(knowledgeRecords.archivedAt),
          ne(knowledgeRecords.lifecycleStatus, 'archived'),
          isNull(workspaces.archivedAt),
        ),
      )
      .orderBy(desc(knowledgeRecords.updatedAt))
      .limit(limit),
  ]);

  const recent: RecentWorkspaceItem[] = [
    ...projectRows.map((row) => ({
      kind: 'project' as const,
      id: row.id,
      humanKey: row.keyPrefix?.trim() ? row.keyPrefix : null,
      title: row.title,
      slug: row.slug,
      workspaceName: row.workspaceName,
      workspaceSlug: row.workspaceSlug,
      status: row.status,
      updatedAt: row.updatedAt.toISOString(),
    })),
    ...systemRows.map((row) => ({
      kind: 'system' as const,
      id: row.id,
      humanKey: null,
      title: row.title,
      slug: row.slug,
      workspaceName: row.workspaceName,
      workspaceSlug: row.workspaceSlug,
      status: row.status,
      updatedAt: row.updatedAt.toISOString(),
    })),
    ...recordRows.map((row) => ({
      kind: 'record' as const,
      id: row.id,
      humanKey: formatHumanKey(row.keyPrefix, row.documentKeyType, row.documentNumber),
      title: row.title,
      slug: row.slug,
      workspaceName: row.workspaceName,
      workspaceSlug: row.workspaceSlug,
      status: row.status,
      updatedAt: row.updatedAt.toISOString(),
    })),
  ];

  recent.sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
  return recent.slice(0, limit);
}
