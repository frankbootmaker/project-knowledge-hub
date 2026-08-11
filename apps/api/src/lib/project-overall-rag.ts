import { and, inArray, isNull } from 'drizzle-orm';
import type { Database } from '@project-knowledge-hub/database';
import {
  projectMilestones,
  projectTasks,
} from '@project-knowledge-hub/database';
import {
  getProjectBudgetSummary,
  type ProjectRagStatus,
} from './project-budget.js';

const RAG_RANK: Record<ProjectRagStatus, number> = {
  green: 0,
  amber: 1,
  red: 2,
};

function worstRag(statuses: ProjectRagStatus[]): ProjectRagStatus {
  let worst: ProjectRagStatus = 'green';
  for (const status of statuses) {
    if (RAG_RANK[status] > RAG_RANK[worst]) worst = status;
  }
  return worst;
}

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

function timelineRag(
  items: Array<{ status: string; date: string | null | undefined }>,
  today: string,
): ProjectRagStatus {
  let worst: ProjectRagStatus = 'green';
  for (const item of items) {
    const tone = scheduleTone(item.status, item.date, today);
    if (tone === 'overdue') return 'red';
    if (tone === 'atRisk') worst = 'amber';
  }
  return worst;
}

/**
 * Overall project health (worst of timeline / risks / financials) for many projects.
 * Matches the project page overall indicator.
 */
export async function listProjectOverallRags(
  database: Database,
  projectIds: string[],
): Promise<Map<string, ProjectRagStatus>> {
  const result = new Map<string, ProjectRagStatus>();
  if (projectIds.length === 0) return result;

  const today = todayYmd();
  const [milestoneRows, taskRows] = await Promise.all([
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

  await Promise.all(
    projectIds.map(async (projectId) => {
      const timeline = timelineRag(scheduleByProject.get(projectId) ?? [], today);
      try {
        const summary = await getProjectBudgetSummary(database, projectId);
        result.set(
          projectId,
          worstRag([timeline, summary.riskRag, summary.financialRag]),
        );
      } catch {
        result.set(projectId, timeline);
      }
    }),
  );

  return result;
}
