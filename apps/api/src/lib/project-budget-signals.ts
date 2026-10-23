import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { Database } from '@project-knowledge-hub/database';
import {
  projectRaidItems,
  projectStakeholders,
  projectTaskRaci,
  projectTasks,
  projects,
  systems,
} from '@project-knowledge-hub/database';
import { todayYmd } from '@project-knowledge-hub/domain';
import {
  loadWorkspacePaidAiContexts,
  projectPaidAiFromContext,
} from './ai-billing.js';
import { AI_ASSISTANT_SYSTEM_TYPE } from './ai-assistant-systems.js';
import { loadCompletedAtByTask } from './project-delivery.js';
import {
  budgetTaskCostsFromParts,
  buildProjectAiBill,
  projectBudgetSignalFromParts,
  systemItCostsFromRows,
  type ProjectBudgetSignal,
} from './project-budget.js';

export type { ProjectBudgetSignal };

/**
 * Financial and risk signals for many projects.
 *
 * Query count follows the number of workspaces, not the number of projects.
 * One failing project is omitted so the caller can fall back to timeline RAG.
 */
export async function listProjectBudgetSignals(
  database: Database,
  projectIds: string[],
  today = todayYmd(),
): Promise<Map<string, ProjectBudgetSignal>> {
  const result = new Map<string, ProjectBudgetSignal>();
  const ids = [...new Set(projectIds)];
  if (ids.length === 0) return result;

  const [projectRows, taskRows, raciRows, rateRows, systemRows, raidRows] =
    await Promise.all([
      database.db
        .select({
          id: projects.id,
          workspaceId: projects.workspaceId,
          currency: projects.currency,
          initialBudget: projects.initialBudget,
          approvedBudget: projects.approvedBudget,
          startDate: projects.startDate,
          endDate: projects.endDate,
        })
        .from(projects)
        .where(inArray(projects.id, ids)),
      database.db
        .select({
          id: projectTasks.id,
          projectId: projectTasks.projectId,
          status: projectTasks.status,
          userStoryId: projectTasks.userStoryId,
          currentOwnerUserId: projectTasks.currentOwnerUserId,
          forecastHours: projectTasks.forecastHours,
          actualHours: projectTasks.actualHours,
          tokensUsed: projectTasks.tokensUsed,
          tokensInput: projectTasks.tokensInput,
          tokensOutput: projectTasks.tokensOutput,
          tokensCache: projectTasks.tokensCache,
          tokensCacheWrite: projectTasks.tokensCacheWrite,
          aiSystemId: projectTasks.aiSystemId,
          aiModelId: projectTasks.aiModelId,
          billingPeriod: projectTasks.billingPeriod,
          usageOccurredAt: projectTasks.usageOccurredAt,
          updatedAt: projectTasks.updatedAt,
        })
        .from(projectTasks)
        .where(
          and(inArray(projectTasks.projectId, ids), isNull(projectTasks.archivedAt)),
        ),
      database.db
        .select({
          projectId: projectTasks.projectId,
          taskId: projectTaskRaci.taskId,
          userId: projectTaskRaci.userId,
          role: projectTaskRaci.role,
        })
        .from(projectTaskRaci)
        .innerJoin(projectTasks, eq(projectTaskRaci.taskId, projectTasks.id))
        .where(inArray(projectTasks.projectId, ids)),
      database.db
        .select({
          projectId: projectStakeholders.projectId,
          userId: projectStakeholders.userId,
          hourlyRate: projectStakeholders.hourlyRate,
        })
        .from(projectStakeholders)
        .where(inArray(projectStakeholders.projectId, ids)),
      database.db
        .select({
          id: systems.id,
          projectId: systems.projectId,
          name: systems.name,
          systemType: systems.systemType,
          aiCostMode: systems.aiCostMode,
          aiFlatMonthlyFee: systems.aiFlatMonthlyFee,
          aiTokenRatePer1k: systems.aiTokenRatePer1k,
          aiTokenRateInputPer1k: systems.aiTokenRateInputPer1k,
          aiTokenRateOutputPer1k: systems.aiTokenRateOutputPer1k,
          aiTokenRateCachePer1k: systems.aiTokenRateCachePer1k,
          aiTokenRateCacheWritePer1k: systems.aiTokenRateCacheWritePer1k,
          aiTokenRateCurrency: systems.aiTokenRateCurrency,
          aiBudgetAllocation: systems.aiBudgetAllocation,
          itCostMode: systems.itCostMode,
          itFlatMonthlyFee: systems.itFlatMonthlyFee,
          itOneTimeCost: systems.itOneTimeCost,
          itBudgetAllocation: systems.itBudgetAllocation,
        })
        .from(systems)
        .where(and(inArray(systems.projectId, ids), isNull(systems.archivedAt))),
      database.db
        .select({
          projectId: projectRaidItems.projectId,
          kind: projectRaidItems.kind,
          status: projectRaidItems.status,
          severity: projectRaidItems.severity,
          dueDate: projectRaidItems.dueDate,
        })
        .from(projectRaidItems)
        .where(
          and(
            inArray(projectRaidItems.projectId, ids),
            isNull(projectRaidItems.archivedAt),
          ),
        ),
    ]);

  const tasksByProject = groupBy(taskRows, (row) => row.projectId);
  const raciByProject = new Map<string, Map<string, Array<{ userId: string; role: string }>>>();
  for (const row of raciRows) {
    let byTask = raciByProject.get(row.projectId);
    if (!byTask) {
      byTask = new Map();
      raciByProject.set(row.projectId, byTask);
    }
    const list = byTask.get(row.taskId) ?? [];
    list.push({ userId: row.userId, role: row.role });
    byTask.set(row.taskId, list);
  }
  const ratesByProject = new Map<string, Map<string, number>>();
  for (const row of rateRows) {
    if (!row.userId || row.hourlyRate == null || !Number.isFinite(row.hourlyRate)) continue;
    let rates = ratesByProject.get(row.projectId);
    if (!rates) {
      rates = new Map();
      ratesByProject.set(row.projectId, rates);
    }
    rates.set(row.userId, row.hourlyRate);
  }
  const systemsByProject = groupBy(
    systemRows.filter((row): row is typeof row & { projectId: string } => row.projectId != null),
    (row) => row.projectId,
  );
  const raidByProject = groupBy(raidRows, (row) => row.projectId);

  const workspaceIds = [...new Set(projectRows.map((row) => row.workspaceId))];
  const [completedAt, contextByWorkspace] = await Promise.all([
    loadCompletedAtByTask(
      database,
      taskRows.map((row) => row.id),
    ),
    loadWorkspacePaidAiContexts(database, workspaceIds, today),
  ]);

  for (const project of projectRows) {
    try {
      const projectTasksForBill = tasksByProject.get(project.id) ?? [];
      const projectSystems = systemsByProject.get(project.id) ?? [];
      const assistants = projectSystems.filter(
        (row) => row.systemType === AI_ASSISTANT_SYSTEM_TYPE,
      );
      const itSystems = projectSystems.filter(
        (row) => row.systemType !== AI_ASSISTANT_SYSTEM_TYPE,
      );
      const context = contextByWorkspace.get(project.workspaceId);
      if (!context) continue;
      const built = buildProjectAiBill({
        project,
        assistantRows: assistants,
        taskRows: projectTasksForBill,
        completedAt,
        catalogPrices: context.imported.prices,
        today,
      });
      const paid = projectPaidAiFromContext(context, project, built.systemInputs);
      const it = systemItCostsFromRows(itSystems, project, today);
      const signal = projectBudgetSignalFromParts({
        project,
        costs: budgetTaskCostsFromParts({
          tasks: projectTasksForBill,
          raciByTask: raciByProject.get(project.id) ?? new Map(),
          epicByStory: new Map(),
          rates: ratesByProject.get(project.id) ?? new Map(),
        }),
        aiBillableCost: paid.aiPaidAc,
        systemBillableCost: it.systemBillableCost,
        raidRows: raidByProject.get(project.id) ?? [],
        today,
      });
      result.set(project.id, signal);
    } catch {
      // Caller treats a missing id as a failed budget summary.
    }
  }

  return result;
}

function groupBy<T>(rows: readonly T[], key: (row: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const id = key(row);
    const list = map.get(id) ?? [];
    list.push(row);
    map.set(id, list);
  }
  return map;
}
