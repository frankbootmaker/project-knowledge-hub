import { and, inArray, isNull } from 'drizzle-orm';
import type { Database } from '@project-knowledge-hub/database';
import {
  projectMilestones,
  projectTasks,
  projects,
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
import { coalesceRead, liveReadTtl } from './read-cache.js';

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
 * Schedule rows are two indexed reads (`project_id`, plus `archived_at`
 * filtered on that index). The fixed cost is the workspace paid-AI context
 * inside the budget signals, not the milestone or task scan. That context
 * and these snapshots are reused for a short time per workspace and day so
 * the project list, the project page, and budget-summary do not rebuild them.
 */
const HEALTH_TTL_MS = 20_000;

type CachedSnapshot = {
  expiresAt: number;
  snapshot: ProjectHealthSnapshot;
};

const healthByDatabase = new WeakMap<Database, Map<string, CachedSnapshot>>();

function snapshotCache(database: Database): Map<string, CachedSnapshot> {
  let cache = healthByDatabase.get(database);
  if (!cache) {
    cache = new Map();
    healthByDatabase.set(database, cache);
  }
  return cache;
}

function healthCacheKey(workspaceId: string, today: string, projectId: string): string {
  return `${workspaceId}:${today}:${projectId}`;
}

async function loadProjectWorkspaces(
  database: Database,
  projectIds: string[],
): Promise<Map<string, string>> {
  const rows = await database.db
    .select({
      id: projects.id,
      workspaceId: projects.workspaceId,
    })
    .from(projects)
    .where(inArray(projects.id, projectIds));
  return new Map(rows.map((row) => [row.id, row.workspaceId]));
}

async function computeProjectHealthSnapshots(
  database: Database,
  projectIds: string[],
  today: string,
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

export async function listProjectHealthSnapshots(
  database: Database,
  projectIds: string[],
  today = todayYmd(),
): Promise<Map<string, ProjectHealthSnapshot>> {
  const ids = [...new Set(projectIds)];
  const result = new Map<string, ProjectHealthSnapshot>();
  if (ids.length === 0) return result;

  const now = Date.now();
  const ttl = liveReadTtl(HEALTH_TTL_MS);
  const cache = snapshotCache(database);
  const workspaceOf = await loadProjectWorkspaces(database, ids);
  const missingByWorkspace = new Map<string, string[]>();

  for (const projectId of ids) {
    const workspaceId = workspaceOf.get(projectId) ?? '_';
    const hit = cache.get(healthCacheKey(workspaceId, today, projectId));
    if (hit && hit.expiresAt > now) {
      result.set(projectId, hit.snapshot);
      continue;
    }
    const missing = missingByWorkspace.get(workspaceId) ?? [];
    missing.push(projectId);
    missingByWorkspace.set(workspaceId, missing);
  }

  await Promise.all([...missingByWorkspace].map(async ([workspaceId, missing]) => {
    const sorted = [...missing].sort();
    const computed = await coalesceRead(
      database,
      `health-batch:${workspaceId}:${today}:${sorted.join(',')}`,
      ttl,
      () => computeProjectHealthSnapshots(database, sorted, today),
    );
    const expiresAt = now + ttl;
    for (const projectId of sorted) {
      const snapshot = computed.get(projectId);
      if (!snapshot) continue;
      if (ttl > 0) {
        cache.set(healthCacheKey(workspaceId, today, projectId), {
          expiresAt,
          snapshot,
        });
      }
      result.set(projectId, snapshot);
    }
  }));

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
