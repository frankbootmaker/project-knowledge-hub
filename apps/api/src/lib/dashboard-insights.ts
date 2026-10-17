import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Database } from '@project-knowledge-hub/database';
import {
  memberships,
  projectRaidItems,
  projects,
  workspaces,
} from '@project-knowledge-hub/database';
import { addDaysYmd, todayYmd } from '@project-knowledge-hub/domain';
import { getProjectBudgetSummary } from './project-budget.js';
import { listAssignedTasksForUser } from './project-delivery.js';
import { listProjectHealth } from './project-overall-rag.js';

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

async function accessibleWorkspaceIds(
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

  const assigned = await listAssignedTasksForUser(database, input.userId, {
    isSystemAdmin: input.isSystemAdmin,
    includeArchived: false,
  });

  const tasksByDue = { overdue: 0, dueSoon: 0, later: 0, none: 0 };
  for (const task of assigned) {
    if (task.status === 'done' || task.status === 'cancelled') continue;
    if (!task.dueDate) {
      tasksByDue.none += 1;
      continue;
    }
    if (task.dueDate < today) tasksByDue.overdue += 1;
    else if (task.dueDate <= soon) tasksByDue.dueSoon += 1;
    else tasksByDue.later += 1;
  }

  const workspaceIds = await accessibleWorkspaceIds(
    database,
    input.userId,
    input.isSystemAdmin,
  );

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
    listProjectHealth(database, projectIds, today),
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
    const overall = healthById.get(project.id)?.overall ?? 'green';
    projectHealthRag[overall] += 1;
  }

  const budgetCandidates = projectRows.slice(0, 16);
  const budgetSummaries = await Promise.all(
    budgetCandidates.map(async (project) => {
      try {
        const summary = await getProjectBudgetSummary(database, project.id);
        return { project, summary };
      } catch {
        return null;
      }
    }),
  );

  const budgetAttention = budgetSummaries
    .filter((row): row is NonNullable<typeof row> => row != null)
    .filter(({ summary }) => {
      if (summary.bac == null) return false;
      if (summary.financialRag === 'red' || summary.financialRag === 'amber') {
        return true;
      }
      if (summary.cpi != null && summary.cpi < 1) return true;
      if (summary.spi != null && summary.spi < 1) return true;
      return false;
    })
    .slice(0, 8)
    .map(({ project, summary }) => ({
      projectId: project.id,
      projectName: project.name,
      projectSlug: project.slug,
      workspaceSlug: project.workspaceSlug,
      cpi: summary.cpi,
      spi: summary.spi,
      financialRag: summary.financialRag,
    }));

  return {
    tasksByDue,
    projectHealthRag,
    openRaid,
    budgetAttention,
  };
}
