import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Database } from '@project-knowledge-hub/database';
import {
  memberships,
  projectMilestones,
  projectRaidItems,
  projectTasks,
  projects,
  workspaces,
} from '@project-knowledge-hub/database';
import { getProjectBudgetSummary } from './project-budget.js';
import { listAssignedTasksForUser } from './project-delivery.js';

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

function todayYmd(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDaysYmd(ymd: string, days: number): string {
  const date = new Date(`${ymd}T12:00:00`);
  date.setDate(date.getDate() + days);
  return todayYmd(date);
}

function scheduleTone(
  status: string,
  date: string | null | undefined,
  today: string,
): 'overdue' | 'atRisk' | 'ok' {
  if (status === 'done' || status === 'cancelled' || !date) return 'ok';
  if (date < today) return 'overdue';
  if (date <= addDaysYmd(today, 7)) return 'atRisk';
  return 'ok';
}

function worstRag(
  items: Array<{ status: string; date: string | null | undefined }>,
  today: string,
): 'green' | 'amber' | 'red' {
  let worst: 'green' | 'amber' | 'red' = 'green';
  for (const item of items) {
    const tone = scheduleTone(item.status, item.date, today);
    if (tone === 'overdue') return 'red';
    if (tone === 'atRisk') worst = 'amber';
  }
  return worst;
}

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
  input: { userId: string; isSystemAdmin: boolean },
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

  const [milestoneRows, taskRows, raidRows] = await Promise.all([
    database.db
      .select({
        projectId: projectMilestones.projectId,
        status: projectMilestones.status,
        targetDate: projectMilestones.targetDate,
      })
      .from(projectMilestones)
      .where(
        and(
          inArray(projectMilestones.projectId, projectIds),
          isNull(projectMilestones.archivedAt),
        ),
      ),
    database.db
      .select({
        projectId: projectTasks.projectId,
        status: projectTasks.status,
        dueDate: projectTasks.dueDate,
      })
      .from(projectTasks)
      .where(
        and(
          inArray(projectTasks.projectId, projectIds),
          isNull(projectTasks.archivedAt),
        ),
      ),
    database.db
      .select({
        projectId: projectRaidItems.projectId,
        kind: projectRaidItems.kind,
        status: projectRaidItems.status,
        severity: projectRaidItems.severity,
      })
      .from(projectRaidItems)
      .where(
        and(
          inArray(projectRaidItems.projectId, projectIds),
          isNull(projectRaidItems.archivedAt),
        ),
      ),
  ]);

  const scheduleByProject = new Map<
    string,
    Array<{ status: string; date: string | null }>
  >();
  for (const row of milestoneRows) {
    const list = scheduleByProject.get(row.projectId) ?? [];
    list.push({ status: row.status, date: row.targetDate });
    scheduleByProject.set(row.projectId, list);
  }
  for (const row of taskRows) {
    const list = scheduleByProject.get(row.projectId) ?? [];
    list.push({ status: row.status, date: row.dueDate });
    scheduleByProject.set(row.projectId, list);
  }

  const openRaidByProject = new Map<
    string,
    Array<{ kind: string; status: string; severity: string }>
  >();
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
    const list = openRaidByProject.get(row.projectId) ?? [];
    list.push(row);
    openRaidByProject.set(row.projectId, list);
  }

  const projectHealthRag = { green: 0, amber: 0, red: 0 };
  for (const project of projectRows) {
    const timeline = worstRag(scheduleByProject.get(project.id) ?? [], today);
    const open = openRaidByProject.get(project.id) ?? [];
    let risk: 'green' | 'amber' | 'red' = 'green';
    if (open.some((item) => item.severity === 'critical')) risk = 'red';
    else if (open.some((item) => item.severity === 'high')) risk = 'amber';
    const combined =
      timeline === 'red' || risk === 'red'
        ? 'red'
        : timeline === 'amber' || risk === 'amber'
          ? 'amber'
          : 'green';
    projectHealthRag[combined] += 1;
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
