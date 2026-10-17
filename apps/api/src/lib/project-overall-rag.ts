import { and, inArray, isNull } from 'drizzle-orm';
import type { Database } from '@project-knowledge-hub/database';
import {
  projectMilestones,
  projectTasks,
} from '@project-knowledge-hub/database';
import {
  emptyProjectHealth,
  projectHealthFromBudget,
  timelineRag,
  todayYmd,
  type ProjectHealth,
  type ProjectRagStatus,
} from '@project-knowledge-hub/domain';
import { getProjectBudgetSummary } from './project-budget.js';

export { emptyProjectHealth, type ProjectHealth };

/**
 * Overall project health for many projects.
 *
 * Timeline uses TIMELINE_AT_RISK_DAYS (7). Risk and financial come from the
 * budget summary (assessRiskRag / computeFinancialRag). Risk reasons travel
 * with that same result. Overall is the worst of the three. If the budget
 * summary throws, overall is the timeline RAG only and financial is null.
 *
 * Schedule rows are loaded in two queries. Budget summaries stay one call
 * per project, matching the previous list endpoint.
 */
export async function listProjectHealth(
  database: Database,
  projectIds: string[],
  today = todayYmd(),
): Promise<Map<string, ProjectHealth>> {
  const result = new Map<string, ProjectHealth>();
  if (projectIds.length === 0) return result;

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
          projectHealthFromBudget({
            timeline,
            budget: {
              risk: summary.riskRag,
              financial: summary.financialRag,
              riskReasons: summary.riskReasons,
            },
          }),
        );
      } catch {
        result.set(projectId, projectHealthFromBudget({ timeline, budget: null }));
      }
    }),
  );

  return result;
}

/** Overall RAG only. Prefer {@link listProjectHealth} when the breakdown is needed. */
export async function listProjectOverallRags(
  database: Database,
  projectIds: string[],
): Promise<Map<string, ProjectRagStatus>> {
  const health = await listProjectHealth(database, projectIds);
  const result = new Map<string, ProjectRagStatus>();
  for (const [projectId, row] of health) {
    result.set(projectId, row.overall);
  }
  return result;
}
