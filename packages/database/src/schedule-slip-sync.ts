import { and, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import {
  SCHEDULE_SLIP_ITEM_TYPES,
  SCHEDULE_SLIP_SOURCE,
  coerceProjectCalendar,
  decideScheduleSlipRisk,
  evaluateDeliveryScheduleSlips,
  formatHumanKey,
  keyPrefixSchema,
  readIssueCounter,
  scheduleSlipSettingsFromRow,
  suggestKeyPrefix,
  type ScheduleSlipHit,
  type ScheduleSlipItemType,
} from '@project-knowledge-hub/domain';
import type { Database } from './index.js';
import {
  memberships,
  projectEpics,
  projectMilestoneItemLinks,
  projectMilestones,
  projectNonWorkingDays,
  projectRaidDeliveryLinks,
  projectRaidItems,
  projectRaidTaskLinks,
  projectTasks,
  projectUserStories,
  projects,
  users,
} from './schema/index.js';

const OPEN_RAID_STATUSES = ['open', 'mitigating', 'accepted'] as const;

export type ScheduleSlipSyncResult = {
  created: number;
  updated: number;
  suggestedClose: number;
};

const EMPTY_RESULT: ScheduleSlipSyncResult = {
  created: 0,
  updated: 0,
  suggestedClose: 0,
};

function todayUtc(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function isSlipType(value: string | null): value is ScheduleSlipItemType {
  return (SCHEDULE_SLIP_ITEM_TYPES as readonly string[]).includes(value ?? '');
}

/**
 * Keep the first saved finish. Later writes leave that date in place so a
 * move past it is a slip. PostgreSQL SET uses the previous column values.
 */
export function preservedBaselineFinish(
  baseline: PgColumn,
  currentFinish: PgColumn,
  nextFinish: string | null,
): SQL {
  return sql`COALESCE(${baseline}, ${currentFinish}, ${nextFinish})`;
}

function isUniqueViolation(error: unknown): boolean {
  const current = error as { code?: string; cause?: { code?: string } };
  return current.code === '23505' || current.cause?.code === '23505';
}

function slipLabel(input: {
  keyPrefix: string | null;
  issueKeyType: string | null;
  issueNumber: number | null;
  title: string;
}): string {
  return formatHumanKey(input.keyPrefix, input.issueKeyType, input.issueNumber)
    ?? (input.title.trim().slice(0, 80) || 'item');
}

async function allocateRiskKey(
  database: Database,
  projectId: string,
): Promise<{ issueKeyType: string; issueNumber: number; keyPrefix: string }> {
  return database.db.transaction(async (tx) => {
    const [project] = await tx
      .select({
        id: projects.id,
        workspaceId: projects.workspaceId,
        name: projects.name,
        slug: projects.slug,
        keyPrefix: projects.keyPrefix,
        issueCounters: projects.issueCounters,
      })
      .from(projects)
      .where(eq(projects.id, projectId))
      .for('update')
      .limit(1);
    if (!project) {
      throw new Error('Project not found while allocating a schedule-slip risk key');
    }
    let keyPrefix = project.keyPrefix;
    if (!keyPrefix) {
      const base = suggestKeyPrefix(project.slug || project.name);
      for (let attempt = 0; attempt < 40; attempt += 1) {
        let candidate = base;
        if (attempt > 0) {
          const letters = base.replace(/[^A-Z]/g, '').slice(0, 2).padEnd(2, 'X');
          candidate = `${letters}${attempt % 10}`;
        }
        const parsed = keyPrefixSchema.safeParse(candidate);
        if (!parsed.success) continue;
        const [taken] = await tx
          .select({ id: projects.id })
          .from(projects)
          .where(and(
            eq(projects.workspaceId, project.workspaceId),
            sql`upper(${projects.keyPrefix}) = ${parsed.data}`,
          ))
          .limit(1);
        if (!taken) {
          keyPrefix = parsed.data;
          break;
        }
      }
    }
    if (!keyPrefix) {
      throw new Error('Could not allocate an issue key prefix for a schedule-slip risk');
    }
    const next = readIssueCounter(project.issueCounters, 'RR') + 1;
    await tx
      .update(projects)
      .set({
        keyPrefix,
        issueCounters: { ...(project.issueCounters ?? {}), RR: next },
        updatedAt: new Date(),
      })
      .where(eq(projects.id, projectId));
    return { issueKeyType: 'RR', issueNumber: next, keyPrefix };
  });
}

async function ensureLink(
  database: Database,
  raidItemId: string,
  type: ScheduleSlipItemType,
  entityId: string,
): Promise<void> {
  if (type === 'task') {
    await database.db
      .insert(projectRaidTaskLinks)
      .values({ raidItemId, taskId: entityId })
      .onConflictDoNothing();
    return;
  }
  await database.db
    .insert(projectRaidDeliveryLinks)
    .values({ raidItemId, entityType: type, entityId })
    .onConflictDoNothing();
}

async function activeOwnerIds(
  database: Database,
  workspaceId: string,
  userIds: string[],
): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const rows = await database.db
    .select({ userId: memberships.userId })
    .from(memberships)
    .innerJoin(users, eq(memberships.userId, users.id))
    .where(and(
      eq(memberships.workspaceId, workspaceId),
      inArray(memberships.userId, userIds),
      eq(users.status, 'active'),
    ));
  return new Set(rows.map((row) => row.userId));
}

/**
 * Raise, update, or flag one open auto risk per slipping delivery item.
 * A resolved slip is noted for closure and left open.
 * Disabled projects are left unchanged.
 */
export async function syncScheduleSlipRisks(
  database: Database,
  projectId: string,
  options?: { today?: string },
): Promise<ScheduleSlipSyncResult> {
  const [project] = await database.db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!project || project.archivedAt) return EMPTY_RESULT;
  const settings = scheduleSlipSettingsFromRow({
    enabled: project.scheduleSlipRiskEnabled,
    thresholdWorkingDays: project.scheduleSlipThresholdDays,
    itemTypes: project.scheduleSlipItemTypes,
  });
  if (!settings.enabled) return EMPTY_RESULT;

  const [taskRows, storyRows, epicRows, milestoneRows, holidayRows] = await Promise.all([
    database.db
      .select({
        id: projectTasks.id,
        itemType: projectTasks.itemType,
        status: projectTasks.status,
        archivedAt: projectTasks.archivedAt,
        dueDate: projectTasks.dueDate,
        baselineFinishDate: projectTasks.baselineFinishDate,
        userStoryId: projectTasks.userStoryId,
        currentOwnerUserId: projectTasks.currentOwnerUserId,
        title: projectTasks.title,
        issueKeyType: projectTasks.issueKeyType,
        issueNumber: projectTasks.issueNumber,
      })
      .from(projectTasks)
      .where(eq(projectTasks.projectId, projectId)),
    database.db
      .select({
        id: projectUserStories.id,
        epicId: projectUserStories.epicId,
        status: projectUserStories.status,
        archivedAt: projectUserStories.archivedAt,
        endDate: projectUserStories.endDate,
        baselineFinishDate: projectUserStories.baselineFinishDate,
        title: projectUserStories.title,
        issueKeyType: projectUserStories.issueKeyType,
        issueNumber: projectUserStories.issueNumber,
      })
      .from(projectUserStories)
      .where(eq(projectUserStories.projectId, projectId)),
    database.db
      .select({
        id: projectEpics.id,
        status: projectEpics.status,
        archivedAt: projectEpics.archivedAt,
        endDate: projectEpics.endDate,
        baselineFinishDate: projectEpics.baselineFinishDate,
        title: projectEpics.title,
        issueKeyType: projectEpics.issueKeyType,
        issueNumber: projectEpics.issueNumber,
      })
      .from(projectEpics)
      .where(eq(projectEpics.projectId, projectId)),
    database.db
      .select({
        id: projectMilestones.id,
        status: projectMilestones.status,
        archivedAt: projectMilestones.archivedAt,
        targetDate: projectMilestones.targetDate,
        baselineFinishDate: projectMilestones.baselineFinishDate,
        title: projectMilestones.title,
        issueKeyType: projectMilestones.issueKeyType,
        issueNumber: projectMilestones.issueNumber,
      })
      .from(projectMilestones)
      .where(eq(projectMilestones.projectId, projectId)),
    database.db
      .select({ day: projectNonWorkingDays.day })
      .from(projectNonWorkingDays)
      .where(eq(projectNonWorkingDays.projectId, projectId)),
  ]);

  const milestoneIds = milestoneRows.map((row) => row.id);
  const linkRows = milestoneIds.length === 0
    ? []
    : await database.db
      .select({
        milestoneId: projectMilestoneItemLinks.milestoneId,
        entityType: projectMilestoneItemLinks.entityType,
        entityId: projectMilestoneItemLinks.entityId,
      })
      .from(projectMilestoneItemLinks)
      .where(inArray(projectMilestoneItemLinks.milestoneId, milestoneIds));
  const linksByMilestone = new Map<string, Array<{
    entityType: 'task' | 'user_story' | 'epic';
    entityId: string;
  }>>();
  for (const link of linkRows) {
    if (
      link.entityType !== 'task'
      && link.entityType !== 'user_story'
      && link.entityType !== 'epic'
    ) {
      continue;
    }
    const list = linksByMilestone.get(link.milestoneId) ?? [];
    list.push({ entityType: link.entityType, entityId: link.entityId });
    linksByMilestone.set(link.milestoneId, list);
  }

  const hits = evaluateDeliveryScheduleSlips({
    settings,
    today: options?.today ?? todayUtc(),
    calendar: coerceProjectCalendar({
      hoursPerWorkday: project.hoursPerWorkday,
      workdaysPerWeek: project.workdaysPerWeek,
      nonWorkingDays: holidayRows.map((row) => row.day),
    }),
    tasks: taskRows.map((row) => ({
      id: row.id,
      itemType: row.itemType,
      status: row.status,
      archived: row.archivedAt != null,
      dueDate: row.dueDate,
      baselineFinishDate: row.baselineFinishDate,
      userStoryId: row.userStoryId,
    })),
    stories: storyRows.map((row) => ({
      id: row.id,
      epicId: row.epicId,
      status: row.status,
      archived: row.archivedAt != null,
      endDate: row.endDate,
      baselineFinishDate: row.baselineFinishDate,
    })),
    epics: epicRows.map((row) => ({
      id: row.id,
      status: row.status,
      archived: row.archivedAt != null,
      endDate: row.endDate,
      baselineFinishDate: row.baselineFinishDate,
    })),
    milestones: milestoneRows.map((row) => ({
      id: row.id,
      status: row.status,
      archived: row.archivedAt != null,
      targetDate: row.targetDate,
      baselineFinishDate: row.baselineFinishDate,
      links: linksByMilestone.get(row.id) ?? [],
    })),
  });
  const openRisks = await database.db
    .select()
    .from(projectRaidItems)
    .where(and(
      eq(projectRaidItems.projectId, projectId),
      eq(projectRaidItems.source, SCHEDULE_SLIP_SOURCE),
      isNull(projectRaidItems.archivedAt),
      inArray(projectRaidItems.status, [...OPEN_RAID_STATUSES]),
    ));
  const riskByEntity = new Map(openRisks.map((row) => [
    `${row.sourceEntityType}:${row.sourceEntityId}`,
    row,
  ]));

  const ownerIds = taskRows
    .map((row) => row.currentOwnerUserId)
    .filter((id): id is string => Boolean(id));
  const owners = await activeOwnerIds(database, project.workspaceId, [...new Set(ownerIds)]);
  const taskById = new Map(taskRows.map((row) => [row.id, row]));
  const storyById = new Map(storyRows.map((row) => [row.id, row]));
  const epicById = new Map(epicRows.map((row) => [row.id, row]));
  const milestoneById = new Map(milestoneRows.map((row) => [row.id, row]));

  const result = { ...EMPTY_RESULT };
  const seen = new Set<string>();
  for (const hit of hits.values()) {
    seen.add(`${hit.type}:${hit.id}`);
    const applied = await applyHit(database, projectId, project.keyPrefix, hit, {
      riskByEntity,
      owners,
      taskById,
      storyById,
      epicById,
      milestoneById,
    });
    result.created += applied.created;
    result.updated += applied.updated;
    result.suggestedClose += applied.suggestedClose;
  }
  for (const risk of openRisks) {
    const type = risk.sourceEntityType;
    const entityId = risk.sourceEntityId;
    if (!isSlipType(type) || !entityId) continue;
    if (!settings.itemTypes.includes(type)) continue;
    if (seen.has(`${type}:${entityId}`)) continue;
    if (risk.closureSuggested) continue;
    const decision = decideScheduleSlipRisk({
      enabled: true,
      watched: true,
      evaluation: {
        slipping: false,
        slipWorkingDays: 0,
        forecastWorkingDays: 0,
        overdueWorkingDays: 0,
        probability: null,
        impact: null,
        severity: null,
      },
      label: risk.title,
      ownerUserId: risk.ownerUserId,
      existing: {
        id: risk.id,
        title: risk.title,
        description: risk.description,
        probability: risk.probability,
        impact: risk.impact,
        severity: risk.severity,
        ownerUserId: risk.ownerUserId,
        slipWorkingDays: risk.slipWorkingDays,
        closureSuggested: risk.closureSuggested,
      },
    });
    if (decision.action !== 'suggest_close') continue;
    await database.db
      .update(projectRaidItems)
      .set({
        description: decision.description,
        closureSuggested: true,
        updatedAt: new Date(),
      })
      .where(eq(projectRaidItems.id, risk.id));
    result.suggestedClose += 1;
  }
  return result;
}

type HitContext = {
  riskByEntity: Map<string, typeof projectRaidItems.$inferSelect>;
  owners: Set<string>;
  taskById: Map<string, {
    title: string;
    issueKeyType: string | null;
    issueNumber: number | null;
    currentOwnerUserId: string | null;
  }>;
  storyById: Map<string, {
    title: string;
    issueKeyType: string | null;
    issueNumber: number | null;
  }>;
  epicById: Map<string, {
    title: string;
    issueKeyType: string | null;
    issueNumber: number | null;
  }>;
  milestoneById: Map<string, {
    title: string;
    issueKeyType: string | null;
    issueNumber: number | null;
  }>;
};

async function applyHit(
  database: Database,
  projectId: string,
  keyPrefix: string | null,
  hit: ScheduleSlipHit,
  context: HitContext,
): Promise<ScheduleSlipSyncResult> {
  const meta = itemMeta(hit, context);
  if (!meta) return EMPTY_RESULT;
  const ownerUserId = hit.type === 'task' && meta.ownerUserId && context.owners.has(meta.ownerUserId)
    ? meta.ownerUserId
    : null;
  const existing = context.riskByEntity.get(`${hit.type}:${hit.id}`) ?? null;
  const decision = decideScheduleSlipRisk({
    enabled: true,
    watched: true,
    evaluation: hit.evaluation,
    label: slipLabel({
      keyPrefix,
      issueKeyType: meta.issueKeyType,
      issueNumber: meta.issueNumber,
      title: meta.title,
    }),
    ownerUserId,
    existing: existing
      ? {
          id: existing.id,
          title: existing.title,
          description: existing.description,
          probability: existing.probability,
          impact: existing.impact,
          severity: existing.severity,
          ownerUserId: existing.ownerUserId,
          slipWorkingDays: existing.slipWorkingDays,
          closureSuggested: existing.closureSuggested,
        }
      : null,
  });
  if (decision.action === 'skip') return EMPTY_RESULT;
  if (decision.action === 'suggest_close') {
    await database.db
      .update(projectRaidItems)
      .set({
        description: decision.description,
        closureSuggested: true,
        updatedAt: new Date(),
      })
      .where(eq(projectRaidItems.id, decision.id));
    return { created: 0, updated: 0, suggestedClose: 1 };
  }
  if (decision.action === 'update') {
    await database.db
      .update(projectRaidItems)
      .set({
        title: decision.title,
        description: decision.description,
        probability: decision.probability,
        impact: decision.impact,
        severity: decision.severity,
        ownerUserId: decision.ownerUserId,
        slipWorkingDays: decision.slipWorkingDays,
        closureSuggested: false,
        updatedAt: new Date(),
      })
      .where(eq(projectRaidItems.id, decision.id));
    await ensureLink(database, decision.id, hit.type, hit.id);
    return { created: 0, updated: 1, suggestedClose: 0 };
  }

  try {
    const key = await allocateRiskKey(database, projectId);
    const [created] = await database.db
      .insert(projectRaidItems)
      .values({
        projectId,
        kind: 'risk',
        title: decision.title,
        description: decision.description,
        status: 'open',
        severity: decision.severity,
        probability: decision.probability,
        impact: decision.impact,
        ownerUserId: decision.ownerUserId,
        source: SCHEDULE_SLIP_SOURCE,
        sourceEntityType: hit.type,
        sourceEntityId: hit.id,
        closureSuggested: false,
        slipWorkingDays: decision.slipWorkingDays,
        issueKeyType: key.issueKeyType,
        issueNumber: key.issueNumber,
      })
      .returning({ id: projectRaidItems.id });
    if (!created) return EMPTY_RESULT;
    await ensureLink(database, created.id, hit.type, hit.id);
    return { created: 1, updated: 0, suggestedClose: 0 };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const [row] = await database.db
      .select({ id: projectRaidItems.id })
      .from(projectRaidItems)
      .where(and(
        eq(projectRaidItems.projectId, projectId),
        eq(projectRaidItems.source, SCHEDULE_SLIP_SOURCE),
        eq(projectRaidItems.sourceEntityType, hit.type),
        eq(projectRaidItems.sourceEntityId, hit.id),
        isNull(projectRaidItems.archivedAt),
        inArray(projectRaidItems.status, [...OPEN_RAID_STATUSES]),
      ))
      .limit(1);
    if (!row) throw error;
    await database.db
      .update(projectRaidItems)
      .set({
        title: decision.title,
        description: decision.description,
        probability: decision.probability,
        impact: decision.impact,
        severity: decision.severity,
        ownerUserId: decision.ownerUserId,
        slipWorkingDays: decision.slipWorkingDays,
        closureSuggested: false,
        updatedAt: new Date(),
      })
      .where(eq(projectRaidItems.id, row.id));
    await ensureLink(database, row.id, hit.type, hit.id);
    return { created: 0, updated: 1, suggestedClose: 0 };
  }
}

function itemMeta(hit: ScheduleSlipHit, context: HitContext): {
  title: string;
  issueKeyType: string | null;
  issueNumber: number | null;
  ownerUserId: string | null;
} | null {
  if (hit.type === 'task') {
    const row = context.taskById.get(hit.id);
    if (!row) return null;
    return {
      title: row.title,
      issueKeyType: row.issueKeyType,
      issueNumber: row.issueNumber,
      ownerUserId: row.currentOwnerUserId,
    };
  }
  if (hit.type === 'user_story') {
    const row = context.storyById.get(hit.id);
    if (!row) return null;
    return {
      title: row.title,
      issueKeyType: row.issueKeyType,
      issueNumber: row.issueNumber,
      ownerUserId: null,
    };
  }
  if (hit.type === 'epic') {
    const row = context.epicById.get(hit.id);
    if (!row) return null;
    return {
      title: row.title,
      issueKeyType: row.issueKeyType,
      issueNumber: row.issueNumber,
      ownerUserId: null,
    };
  }
  const row = context.milestoneById.get(hit.id);
  if (!row) return null;
  return {
    title: row.title,
    issueKeyType: row.issueKeyType,
    issueNumber: row.issueNumber,
    ownerUserId: null,
  };
}

/** Daily sweep. One project failure does not stop the others. */
export async function syncEnabledScheduleSlipRisks(
  database: Database,
  options?: { today?: string },
): Promise<ScheduleSlipSyncResult & {
  projects: number;
  failed: Array<{ projectId: string; message: string }>;
}> {
  const rows = await database.db
    .select({ id: projects.id })
    .from(projects)
    .where(and(
      eq(projects.scheduleSlipRiskEnabled, true),
      isNull(projects.archivedAt),
    ));
  const totals = { ...EMPTY_RESULT, projects: rows.length, failed: [] as Array<{
    projectId: string;
    message: string;
  }> };
  for (const row of rows) {
    try {
      const result = await syncScheduleSlipRisks(database, row.id, options);
      totals.created += result.created;
      totals.updated += result.updated;
      totals.suggestedClose += result.suggestedClose;
    } catch (error) {
      totals.failed.push({
        projectId: row.id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return totals;
}
