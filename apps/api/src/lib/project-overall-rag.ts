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
import { listProjectBudgetSignals } from './project-budget-signals.js';

export { emptyProjectHealth, type ProjectHealth };

export type ProjectHealthSnapshot = {
  health: ProjectHealth;
  bac: number | null;
  cpi: number | null;
  spi: number | null;
};

/**
 * Overall project health for many projects, plus the budget figures the
 * dashboard uses for attention rows.
 *
 * Timeline uses TIMELINE_AT_RISK_DAYS (7). Risk and financial come from the
 * same signal as the budget summary (assessRiskRag / computeFinancialRag).
 * If that signal throws or a project is missing from it, overall is the
 * timeline RAG only and financial is null.
 *
 * Schedule rows are two queries. Budget signals are one batched load, not
 * one getProjectBudgetSummary per project.
 */
export async function listProjectHealthSnapshots(
  database: Database,
  projectIds: string[],
  today = todayYmd(),
): Promise<Map<string, ProjectHealthSnapshot>> {
  const result = new Map<string, ProjectHealthSnapshot>();
  if (projectIds.length === 0) return result;

  const [milestoneRows, taskRows, signals] = await Promise.all([
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
    listProjectBudgetSignals(database, projectIds, today).catch(() => null),
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

  for (const projectId of projectIds) {
    const timeline = timelineRag(scheduleByProject.get(projectId) ?? [], today);
    const signal = signals?.get(projectId);
    if (!signal) {
      result.set(projectId, {
        health: projectHealthFromBudget({ timeline, budget: null }),
        bac: null,
        cpi: null,
        spi: null,
      });
      continue;
    }
    result.set(projectId, {
      health: projectHealthFromBudget({
        timeline,
        budget: {
          risk: signal.riskRag,
          financial: signal.financialRag,
          riskReasons: signal.riskReasons,
        },
      }),
      bac: signal.bac,
      cpi: signal.cpi,
      spi: signal.spi,
    });
  }

  return result;
}

export async function listProjectHealth(
  database: Database,
  projectIds: string[],
  today = todayYmd(),
): Promise<Map<string, ProjectHealth>> {
  const snapshots = await listProjectHealthSnapshots(database, projectIds, today);
  const result = new Map<string, ProjectHealth>();
  for (const [projectId, snapshot] of snapshots) {
    result.set(projectId, snapshot.health);
  }
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
