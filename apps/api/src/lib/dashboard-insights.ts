import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Database } from '@project-knowledge-hub/database';
import {
  memberships,
  projectRaidItems,
  projects,
  workspaces,
} from '@project-knowledge-hub/database';
import { addDaysYmd, todayYmd } from '@project-knowledge-hub/domain';
import { countAssignedTasksByDue } from './project-delivery.js';
import { listProjectHealthSnapshots } from './project-overall-rag.js';

export type DashboardInsights = {
  tasksByDue: {
    overdue: number;
    dueSoon: number;
    later: number;
    none: number;
  };
  projectHealthRag: {
    green: number;
    amber: number;
    red: number;
  };
  openRaid: {
    risks: number;
    issues: number;
    assumptions: number;
    dependencies: number;
    total: number;
  };
  budgetAttention: Array<{
    projectId: string;
    projectName: string;
    projectSlug: string;
    workspaceSlug: string;
    cpi: number | null;
    spi: number | null;
    financialRag: 'green' | 'amber' | 'red';
  }>;
};

export async function accessibleWorkspaceIds(
  database: Database,
  userId: string,
  isSystemAdmin: boolean,
): Promise<string[]> {
  if (isSystemAdmin) {
    const rows = await database.db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(isNull(workspaces.archivedAt));
    return rows.map((row) => row.id);
  }
  const rows = await database.db
    .select({ workspaceId: memberships.workspaceId })
    .from(memberships)
    .innerJoin(workspaces, eq(memberships.workspaceId, workspaces.id))
    .where(
      and(eq(memberships.userId, userId), isNull(workspaces.archivedAt)),
    );
  return rows.map((row) => row.workspaceId);
}

export async function getDashboardInsights(
  database: Database,
  input: {
    userId: string;
    isSystemAdmin: boolean;
  },
): Promise<DashboardInsights> {
  const today = todayYmd();
  const soon = addDaysYmd(today, 7);

  const [tasksByDue, workspaceIds] = await Promise.all([
    countAssignedTasksByDue(database, input.userId, {
      isSystemAdmin: input.isSystemAdmin,
      today,
      soon,
    }),
    accessibleWorkspaceIds(database, input.userId, input.isSystemAdmin),
  ]);

  const empty: DashboardInsights = {
    tasksByDue,
    projectHealthRag: { green: 0, amber: 0, red: 0 },
    openRaid: {
      risks: 0,
      issues: 0,
      assumptions: 0,
      dependencies: 0,
      total: 0,
    },
    budgetAttention: [],
  };

  if (workspaceIds.length === 0) return empty;

  const projectRows = await database.db
    .select({
      id: projects.id,
      name: projects.name,
      slug: projects.slug,
      workspaceSlug: workspaces.slug,
      updatedAt: projects.updatedAt,
    })
    .from(projects)
    .innerJoin(workspaces, eq(projects.workspaceId, workspaces.id))
    .where(
      and(
        inArray(projects.workspaceId, workspaceIds),
        isNull(projects.archivedAt),
        isNull(workspaces.archivedAt),
      ),
    )
    .orderBy(sql`${projects.updatedAt} desc`)
    .limit(40);

  if (projectRows.length === 0) return empty;

  const projectIds = projectRows.map((row) => row.id);

  const [raidRows, healthById] = await Promise.all([
    database.db
      .select({
        kind: projectRaidItems.kind,
        status: projectRaidItems.status,
      })
      .from(projectRaidItems)
      .where(
        and(
          inArray(projectRaidItems.projectId, projectIds),
          isNull(projectRaidItems.archivedAt),
        ),
      ),
    listProjectHealthSnapshots(database, projectIds, today),
  ]);

  const openRaid = {
    risks: 0,
    issues: 0,
    assumptions: 0,
    dependencies: 0,
    total: 0,
  };
  for (const row of raidRows) {
    if (row.status !== 'open' && row.status !== 'mitigating') continue;
    openRaid.total += 1;
    if (row.kind === 'risk') openRaid.risks += 1;
    else if (row.kind === 'issue') openRaid.issues += 1;
    else if (row.kind === 'assumption') openRaid.assumptions += 1;
    else if (row.kind === 'dependency') openRaid.dependencies += 1;
  }

  const projectHealthRag = { green: 0, amber: 0, red: 0 };
  for (const project of projectRows) {
    const overall = healthById.get(project.id)?.health.overall ?? 'green';
    projectHealthRag[overall] += 1;
  }

  const budgetAttention = projectRows
    .slice(0, 16)
    .flatMap((project) => {
      const snapshot = healthById.get(project.id);
      const financialRag = snapshot?.health.financial;
      if (!snapshot || financialRag == null || snapshot.bac == null) return [];
      const needsAttention =
        financialRag === 'red' ||
        financialRag === 'amber' ||
        (snapshot.cpi != null && snapshot.cpi < 1) ||
        (snapshot.spi != null && snapshot.spi < 1);
      if (!needsAttention) return [];
      return [
        {
          projectId: project.id,
          projectName: project.name,
          projectSlug: project.slug,
          workspaceSlug: project.workspaceSlug,
          cpi: snapshot.cpi,
          spi: snapshot.spi,
          financialRag,
        },
      ];
    })
    .slice(0, 8);

  return {
    tasksByDue,
    projectHealthRag,
    openRaid,
    budgetAttention,
  };
}
