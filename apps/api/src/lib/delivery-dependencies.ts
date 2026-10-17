import { and, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import type { Database } from '@project-knowledge-hub/database';
import {
  preservedBaselineFinish,
  projectDeliveryDependencies,
  projectEpics,
  projectMilestones,
  projectSprints,
  projectTasks,
  projectUserStories,
  projects,
  syncScheduleSlipRisks,
} from '@project-knowledge-hub/database';
import {
  addWorkingDays,
  AppError,
  DELIVERY_DEPENDENCY_ENTITY_TYPES,
  DELIVERY_DEPENDENCY_LINK_LABELS,
  dependencyCycleKeys,
  dependencyEntityTypeFromIssueKey,
  deliveryItemKey,
  formatHumanKey,
  isUuid,
  parseHumanKey,
  predecessorConstraintApplies,
  scheduleDeliveryGraph,
  type DeliveryDependencyEntityType,
  type DeliveryDependencyLinkType,
  type ScheduleLink,
  type ScheduleNode,
} from '@project-knowledge-hub/domain';
import {
  recomputeDeliveryParentStatuses,
  rollupLockedParentKeys,
} from './parent-status.js';
import { loadProjectCalendar } from './project-calendar.js';

export type DeliveryDependencyEndpoint = {
  entityType: DeliveryDependencyEntityType;
  id: string;
  title: string;
  humanKey: string | null;
  itemType: 'task' | 'bug' | null;
  projectId: string;
};

export type PublicDeliveryDependency = {
  id: string;
  projectId: string;
  linkType: DeliveryDependencyLinkType;
  lagDays: number;
  predecessor: DeliveryDependencyEndpoint;
  successor: DeliveryDependencyEndpoint;
  createdAt: string;
};

export type ScheduleWrite = {
  entityType: DeliveryDependencyEntityType;
  id: string;
  startDate: string | null;
  finishDate: string | null;
  durationDays: number | null;
};

type LoadedItem = DeliveryDependencyEndpoint & {
  start: string | null;
  finish: string | null;
  durationDays: number | null;
};

const ENTITY_LABEL: Record<DeliveryDependencyEntityType, string> = {
  epic: 'epic',
  user_story: 'user story',
  task: 'task',
  milestone: 'milestone',
  sprint: 'sprint',
};

function isEntityType(value: string): value is DeliveryDependencyEntityType {
  return (DELIVERY_DEPENDENCY_ENTITY_TYPES as readonly string[]).includes(value);
}

function endpointOf(item: LoadedItem): DeliveryDependencyEndpoint {
  return {
    entityType: item.entityType,
    id: item.id,
    title: item.title,
    humanKey: item.humanKey,
    itemType: item.itemType,
    projectId: item.projectId,
  };
}

function itemLabel(item: Pick<LoadedItem, 'humanKey' | 'entityType' | 'itemType' | 'title'>): string {
  if (item.humanKey) return item.humanKey;
  const kind = item.itemType === 'bug' ? 'bug' : ENTITY_LABEL[item.entityType];
  return `${kind} “${item.title}”`;
}

function assertLag(lagDays: number): void {
  if (!Number.isInteger(lagDays) || lagDays < -3650 || lagDays > 3650) {
    throw new AppError({
      code: 'INVALID_LAG',
      message: 'lagDays must be a whole number from -3650 to 3650',
      statusCode: 400,
    });
  }
}

async function loadById(
  database: Database,
  entityType: DeliveryDependencyEntityType,
  id: string,
): Promise<LoadedItem | null> {
  if (entityType === 'epic') {
    const [row] = await database.db
      .select({
        id: projectEpics.id,
        projectId: projectEpics.projectId,
        title: projectEpics.title,
        start: projectEpics.startDate,
        finish: projectEpics.endDate,
        issueKeyType: projectEpics.issueKeyType,
        issueNumber: projectEpics.issueNumber,
        keyPrefix: projects.keyPrefix,
      })
      .from(projectEpics)
      .innerJoin(projects, eq(projectEpics.projectId, projects.id))
      .where(eq(projectEpics.id, id))
      .limit(1);
    if (!row) return null;
    return {
      entityType,
      id: row.id,
      projectId: row.projectId,
      title: row.title,
      humanKey: formatHumanKey(row.keyPrefix, row.issueKeyType, row.issueNumber),
      itemType: null,
      start: row.start,
      finish: row.finish,
      durationDays: null,
    };
  }
  if (entityType === 'user_story') {
    const [row] = await database.db
      .select({
        id: projectUserStories.id,
        projectId: projectUserStories.projectId,
        title: projectUserStories.title,
        start: projectUserStories.startDate,
        finish: projectUserStories.endDate,
        issueKeyType: projectUserStories.issueKeyType,
        issueNumber: projectUserStories.issueNumber,
        keyPrefix: projects.keyPrefix,
      })
      .from(projectUserStories)
      .innerJoin(projects, eq(projectUserStories.projectId, projects.id))
      .where(eq(projectUserStories.id, id))
      .limit(1);
    if (!row) return null;
    return {
      entityType,
      id: row.id,
      projectId: row.projectId,
      title: row.title,
      humanKey: formatHumanKey(row.keyPrefix, row.issueKeyType, row.issueNumber),
      itemType: null,
      start: row.start,
      finish: row.finish,
      durationDays: null,
    };
  }
  if (entityType === 'milestone') {
    const [row] = await database.db
      .select({
        id: projectMilestones.id,
        projectId: projectMilestones.projectId,
        title: projectMilestones.title,
        start: projectMilestones.startDate,
        finish: projectMilestones.targetDate,
        issueKeyType: projectMilestones.issueKeyType,
        issueNumber: projectMilestones.issueNumber,
        keyPrefix: projects.keyPrefix,
      })
      .from(projectMilestones)
      .innerJoin(projects, eq(projectMilestones.projectId, projects.id))
      .where(eq(projectMilestones.id, id))
      .limit(1);
    if (!row) return null;
    return {
      entityType,
      id: row.id,
      projectId: row.projectId,
      title: row.title,
      humanKey: formatHumanKey(row.keyPrefix, row.issueKeyType, row.issueNumber),
      itemType: null,
      start: row.start,
      finish: row.finish,
      durationDays: null,
    };
  }
  if (entityType === 'sprint') {
    const [row] = await database.db
      .select({
        id: projectSprints.id,
        projectId: projectSprints.projectId,
        title: projectSprints.name,
        start: projectSprints.startDate,
        finish: projectSprints.endDate,
        issueKeyType: projectSprints.issueKeyType,
        issueNumber: projectSprints.issueNumber,
        keyPrefix: projects.keyPrefix,
      })
      .from(projectSprints)
      .innerJoin(projects, eq(projectSprints.projectId, projects.id))
      .where(eq(projectSprints.id, id))
      .limit(1);
    if (!row) return null;
    return {
      entityType,
      id: row.id,
      projectId: row.projectId,
      title: row.title,
      humanKey: formatHumanKey(row.keyPrefix, row.issueKeyType, row.issueNumber),
      itemType: null,
      start: row.start,
      finish: row.finish,
      durationDays: null,
    };
  }
  const [row] = await database.db
    .select({
      id: projectTasks.id,
      projectId: projectTasks.projectId,
      title: projectTasks.title,
      start: projectTasks.startDate,
      finish: projectTasks.dueDate,
      durationDays: projectTasks.durationDays,
      itemType: projectTasks.itemType,
      issueKeyType: projectTasks.issueKeyType,
      issueNumber: projectTasks.issueNumber,
      keyPrefix: projects.keyPrefix,
    })
    .from(projectTasks)
    .innerJoin(projects, eq(projectTasks.projectId, projects.id))
    .where(eq(projectTasks.id, id))
    .limit(1);
  if (!row) return null;
  return {
    entityType: 'task',
    id: row.id,
    projectId: row.projectId,
    title: row.title,
    humanKey: formatHumanKey(row.keyPrefix, row.issueKeyType, row.issueNumber),
    itemType: row.itemType === 'bug' ? 'bug' : 'task',
    start: row.start,
    finish: row.finish,
    durationDays: row.durationDays,
  };
}

async function loadByKey(
  database: Database,
  entityType: DeliveryDependencyEntityType,
  prefix: string,
  issueKeyType: string,
  issueNumber: number,
): Promise<LoadedItem[]> {
  const prefixMatch = sql`upper(${projects.keyPrefix}) = ${prefix}`;
  if (entityType === 'task') {
    const rows = await database.db
      .select({ id: projectTasks.id })
      .from(projectTasks)
      .innerJoin(projects, eq(projectTasks.projectId, projects.id))
      .where(
        and(
          prefixMatch,
          eq(projectTasks.issueKeyType, issueKeyType),
          eq(projectTasks.issueNumber, issueNumber),
        ),
      );
    const loaded = await Promise.all(
      rows.map((row) => loadById(database, 'task', row.id)),
    );
    return loaded.filter((row): row is LoadedItem => row != null);
  }
  const table =
    entityType === 'epic'
      ? projectEpics
      : entityType === 'user_story'
        ? projectUserStories
        : entityType === 'milestone'
          ? projectMilestones
          : projectSprints;
  const rows = await database.db
    .select({ id: table.id })
    .from(table)
    .innerJoin(projects, eq(table.projectId, projects.id))
    .where(
      and(
        prefixMatch,
        eq(table.issueKeyType, issueKeyType),
        eq(table.issueNumber, issueNumber),
      ),
    );
  const loaded = await Promise.all(
    rows.map((row) => loadById(database, entityType, row.id)),
  );
  return loaded.filter((row): row is LoadedItem => row != null);
}

export async function resolveDeliveryDependencyRef(
  database: Database,
  input: {
    projectId: string;
    idOrKey: string;
    entityType?: DeliveryDependencyEntityType;
    role: 'predecessor' | 'successor' | 'item';
  },
): Promise<LoadedItem> {
  const raw = input.idOrKey.trim();
  const role =
    input.role === 'predecessor'
      ? 'Predecessor'
      : input.role === 'successor'
        ? 'Successor'
        : 'Item';
  if (isUuid(raw)) {
    if (!input.entityType) {
      throw new AppError({
        code: 'DEPENDENCY_TYPE_REQUIRED',
        message: `${role} type is required when the id is a UUID`,
        statusCode: 400,
      });
    }
    const item = await loadById(database, input.entityType, raw);
    if (!item) {
      throw new AppError({
        code: 'DEPENDENCY_ENTITY_NOT_FOUND',
        message: `${role} ${ENTITY_LABEL[input.entityType]} was not found`,
        statusCode: 404,
      });
    }
    if (item.projectId !== input.projectId) {
      throw new AppError({
        code: 'DEPENDENCY_CROSS_PROJECT',
        message: `${itemLabel(item)} belongs to a different project. Dependency links must stay inside one project.`,
        statusCode: 400,
      });
    }
    return item;
  }

  const parsed = parseHumanKey(raw);
  if (!parsed) {
    throw new AppError({
      code: 'ISSUE_KEY_INVALID',
      message: `Invalid id or human key: ${raw}`,
      statusCode: 400,
    });
  }
  const inferred = dependencyEntityTypeFromIssueKey(parsed.issueKeyType);
  if (!inferred) {
    throw new AppError({
      code: 'DEPENDENCY_TYPE_MISMATCH',
      message: `Human key ${raw} is not a delivery item. Use an epic, story, task, bug, milestone, or sprint key.`,
      statusCode: 400,
    });
  }
  if (input.entityType && input.entityType !== inferred) {
    throw new AppError({
      code: 'DEPENDENCY_TYPE_MISMATCH',
      message: `Human key ${raw} is a ${inferred === 'task' && parsed.issueKeyType === 'B' ? 'bug' : ENTITY_LABEL[inferred]}, not a ${ENTITY_LABEL[input.entityType]}.`,
      statusCode: 400,
    });
  }
  const matches = await loadByKey(
    database,
    inferred,
    parsed.prefix,
    parsed.issueKeyType,
    parsed.issueNumber,
  );
  const inProject = matches.filter((row) => row.projectId === input.projectId);
  if (inProject.length === 1) return inProject[0]!;
  if (inProject.length > 1) {
    throw new AppError({
      code: 'ISSUE_KEY_AMBIGUOUS',
      message: `Key ${raw} matches more than one item in this project. Pass the UUID.`,
      statusCode: 400,
    });
  }
  if (matches.length > 0) {
    throw new AppError({
      code: 'DEPENDENCY_CROSS_PROJECT',
      message: `${raw} belongs to a different project. Dependency links must stay inside one project.`,
      statusCode: 400,
    });
  }
  throw new AppError({
    code: 'DEPENDENCY_ENTITY_NOT_FOUND',
    message: `No ${parsed.issueKeyType === 'B' ? 'bug' : ENTITY_LABEL[inferred]} found for ${raw}`,
    statusCode: 404,
  });
}

async function loadProjectItems(
  database: Database,
  projectId: string,
): Promise<LoadedItem[]> {
  const [epics, stories, milestones, sprints, tasks] = await Promise.all([
    database.db
      .select({ id: projectEpics.id })
      .from(projectEpics)
      .where(eq(projectEpics.projectId, projectId)),
    database.db
      .select({ id: projectUserStories.id })
      .from(projectUserStories)
      .where(eq(projectUserStories.projectId, projectId)),
    database.db
      .select({ id: projectMilestones.id })
      .from(projectMilestones)
      .where(eq(projectMilestones.projectId, projectId)),
    database.db
      .select({ id: projectSprints.id })
      .from(projectSprints)
      .where(eq(projectSprints.projectId, projectId)),
    database.db
      .select({ id: projectTasks.id })
      .from(projectTasks)
      .where(eq(projectTasks.projectId, projectId)),
  ]);
  const loaded = await Promise.all([
    ...epics.map((row) => loadById(database, 'epic', row.id)),
    ...stories.map((row) => loadById(database, 'user_story', row.id)),
    ...milestones.map((row) => loadById(database, 'milestone', row.id)),
    ...sprints.map((row) => loadById(database, 'sprint', row.id)),
    ...tasks.map((row) => loadById(database, 'task', row.id)),
  ]);
  return loaded.filter((row): row is LoadedItem => row != null);
}

function toNode(item: LoadedItem, locked: Set<string> = new Set()): ScheduleNode {
  const key = deliveryItemKey(item.entityType, item.id);
  return {
    key,
    entityType: item.entityType,
    start: item.start,
    finish: item.finish,
    durationDays: item.entityType === 'task' ? item.durationDays : null,
    rollupLocked: locked.has(key),
  };
}

async function writeSchedule(
  database: Database,
  changes: ScheduleNode[],
): Promise<ScheduleWrite[]> {
  const writes: ScheduleWrite[] = [];
  for (const change of changes) {
    const id = change.key.slice(change.entityType.length + 1);
    if (change.entityType === 'task') {
      await database.db
        .update(projectTasks)
        .set({
          startDate: change.start,
          dueDate: change.finish,
          durationDays: change.durationDays,
          baselineFinishDate: preservedBaselineFinish(
            projectTasks.baselineFinishDate,
            projectTasks.dueDate,
            change.finish,
          ),
          updatedAt: new Date(),
        })
        .where(eq(projectTasks.id, id));
    } else if (change.entityType === 'milestone') {
      await database.db
        .update(projectMilestones)
        .set({
          startDate: change.start,
          targetDate: change.finish,
          baselineFinishDate: preservedBaselineFinish(
            projectMilestones.baselineFinishDate,
            projectMilestones.targetDate,
            change.finish,
          ),
          updatedAt: new Date(),
        })
        .where(eq(projectMilestones.id, id));
    } else if (change.entityType === 'epic') {
      await database.db
        .update(projectEpics)
        .set({
          startDate: change.start,
          endDate: change.finish,
          baselineFinishDate: preservedBaselineFinish(
            projectEpics.baselineFinishDate,
            projectEpics.endDate,
            change.finish,
          ),
          updatedAt: new Date(),
        })
        .where(eq(projectEpics.id, id));
    } else if (change.entityType === 'user_story') {
      await database.db
        .update(projectUserStories)
        .set({
          startDate: change.start,
          endDate: change.finish,
          baselineFinishDate: preservedBaselineFinish(
            projectUserStories.baselineFinishDate,
            projectUserStories.endDate,
            change.finish,
          ),
          updatedAt: new Date(),
        })
        .where(eq(projectUserStories.id, id));
    } else {
      await database.db
        .update(projectSprints)
        .set({
          startDate: change.start,
          endDate: change.finish,
          updatedAt: new Date(),
        })
        .where(eq(projectSprints.id, id));
    }
    writes.push({
      entityType: change.entityType,
      id,
      startDate: change.start,
      finishDate: change.finish,
      durationDays: change.durationDays,
    });
  }
  return writes;
}

async function rescheduleDeliveryGraph(
  database: Database,
  projectId: string,
  seed:
    | { entityType: DeliveryDependencyEntityType; id: string }
    | Array<{ entityType: DeliveryDependencyEntityType; id: string }>,
  depth = 0,
): Promise<ScheduleWrite[]> {
  const seeds = Array.isArray(seed) ? seed : [seed];
  const linkRows = await database.db
    .select()
    .from(projectDeliveryDependencies)
    .where(eq(projectDeliveryDependencies.projectId, projectId));
  if (!Array.isArray(linkRows) || linkRows.length === 0) return [];

  let seedItems = seeds;
  if (depth === 0) {
    const applied = await recomputeDeliveryParentStatuses(database, projectId, {
      projectScope: true,
    });
    const seen = new Set(seeds.map((item) => `${item.entityType}:${item.id}`));
    seedItems = [...seeds];
    for (const change of applied.dateChanges) {
      const key = `${change.entityType}:${change.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      seedItems.push(change);
    }
  }

  const items = await loadProjectItems(database, projectId);
  const locked = await rollupLockedParentKeys(database, projectId);
  const nodes = items.map((item) => toNode(item, locked));
  const links: ScheduleLink[] = [];
  for (const row of linkRows) {
    if (!isEntityType(row.predecessorType) || !isEntityType(row.successorType)) {
      continue;
    }
    if (
      row.linkType !== 'FS'
      && row.linkType !== 'SS'
      && row.linkType !== 'FF'
      && row.linkType !== 'SF'
    ) {
      continue;
    }
    links.push({
      predecessorKey: deliveryItemKey(row.predecessorType, row.predecessorId),
      successorKey: deliveryItemKey(row.successorType, row.successorId),
      linkType: row.linkType,
      lagDays: row.lagDays,
    });
  }
  const calendar = await loadProjectCalendar(database, projectId);
  const changed = scheduleDeliveryGraph({
    nodes,
    links,
    seeds: seedItems.map((item) => deliveryItemKey(item.entityType, item.id)),
    calendar,
  });
  const writes = await writeSchedule(database, changed);
  if (depth >= 4) return writes;
  const movedTaskIds = writes
    .filter((row) => row.entityType === 'task')
    .map((row) => row.id);
  if (movedTaskIds.length === 0) return writes;
  const applied = await recomputeDeliveryParentStatuses(database, projectId, {
    taskIds: movedTaskIds,
  });
  if (applied.dateChanges.length === 0) return writes;
  const more = await rescheduleDeliveryGraph(
    database,
    projectId,
    applied.dateChanges,
    depth + 1,
  );
  return [...writes, ...more];
}

export async function rescheduleDeliveryFrom(
  database: Database,
  projectId: string,
  seed:
    | { entityType: DeliveryDependencyEntityType; id: string }
    | Array<{ entityType: DeliveryDependencyEntityType; id: string }>,
  depth = 0,
): Promise<ScheduleWrite[]> {
  const writes = await rescheduleDeliveryGraph(database, projectId, seed, depth);
  if (depth === 0) await syncScheduleSlipRisks(database, projectId);
  return writes;
}

/**
 * Rewrite duration-based task dues onto the project calendar, roll parent
 * dates back up, then walk dependency links so FS/SS/FF/SF skip non-working days.
 */
export async function rescheduleProjectCalendar(
  database: Database,
  projectId: string,
): Promise<void> {
  const calendar = await loadProjectCalendar(database, projectId);
  const tasks = await database.db
    .select({
      id: projectTasks.id,
      startDate: projectTasks.startDate,
      dueDate: projectTasks.dueDate,
      durationDays: projectTasks.durationDays,
      status: projectTasks.status,
    })
    .from(projectTasks)
    .where(
      and(
        eq(projectTasks.projectId, projectId),
        isNull(projectTasks.archivedAt),
        ne(projectTasks.status, 'cancelled'),
      ),
    );
  const moved: Array<{ entityType: 'task'; id: string }> = [];
  for (const task of tasks) {
    if (task.startDate == null || task.durationDays == null) continue;
    const dueDate = addWorkingDays(task.startDate, task.durationDays, calendar);
    if (dueDate === task.dueDate) continue;
    await database.db
      .update(projectTasks)
      .set({
        dueDate,
        baselineFinishDate: preservedBaselineFinish(
          projectTasks.baselineFinishDate,
          projectTasks.dueDate,
          dueDate,
        ),
        updatedAt: new Date(),
      })
      .where(eq(projectTasks.id, task.id));
    moved.push({ entityType: 'task', id: task.id });
  }

  await recomputeDeliveryParentStatuses(database, projectId, { projectScope: true });

  const linkRows = await database.db
    .select({
      predecessorType: projectDeliveryDependencies.predecessorType,
      predecessorId: projectDeliveryDependencies.predecessorId,
    })
    .from(projectDeliveryDependencies)
    .where(eq(projectDeliveryDependencies.projectId, projectId));
  if (linkRows.length === 0) {
    await syncScheduleSlipRisks(database, projectId);
    return;
  }

  const seeds: Array<{ entityType: DeliveryDependencyEntityType; id: string }> = [
    ...moved,
  ];
  const seen = new Set(moved.map((row) => row.id));
  for (const row of linkRows) {
    if (!isEntityType(row.predecessorType) || seen.has(row.predecessorId)) continue;
    seen.add(row.predecessorId);
    seeds.push({
      entityType: row.predecessorType,
      id: row.predecessorId,
    });
  }
  if (seeds.length === 0) {
    await syncScheduleSlipRisks(database, projectId);
    return;
  }
  await rescheduleDeliveryFrom(database, projectId, seeds);
}

export function overlaySchedule<T extends { id: string; startDate: string | null }>(
  item: T,
  entityType: DeliveryDependencyEntityType,
  writes: ScheduleWrite[],
  finishField: 'endDate' | 'targetDate' | 'dueDate',
): T {
  const hit = writes.find(
    (row) => row.entityType === entityType && row.id === item.id,
  );
  if (!hit) return item;
  return {
    ...item,
    startDate: hit.startDate,
    [finishField]: hit.finishDate,
  };
}

function toPublicLink(
  row: typeof projectDeliveryDependencies.$inferSelect,
  items: Map<string, LoadedItem>,
): PublicDeliveryDependency | null {
  if (!isEntityType(row.predecessorType) || !isEntityType(row.successorType)) {
    return null;
  }
  if (
    row.linkType !== 'FS'
    && row.linkType !== 'SS'
    && row.linkType !== 'FF'
    && row.linkType !== 'SF'
  ) {
    return null;
  }
  const predecessor = items.get(
    deliveryItemKey(row.predecessorType, row.predecessorId),
  );
  const successor = items.get(deliveryItemKey(row.successorType, row.successorId));
  if (!predecessor || !successor) return null;
  return {
    id: row.id,
    projectId: row.projectId,
    linkType: row.linkType,
    lagDays: row.lagDays,
    predecessor: endpointOf(predecessor),
    successor: endpointOf(successor),
    createdAt: row.createdAt.toISOString(),
  };
}

function sortLinks(links: PublicDeliveryDependency[]): PublicDeliveryDependency[] {
  return [...links].sort((a, b) => {
    const aKey = a.predecessor.humanKey ?? a.predecessor.title;
    const bKey = b.predecessor.humanKey ?? b.predecessor.title;
    return aKey.localeCompare(bKey) || a.linkType.localeCompare(b.linkType);
  });
}

function keyedItem(
  entityType: DeliveryDependencyEntityType,
  row: {
    id: string;
    projectId: string;
    title: string;
    start: string | null;
    finish: string | null;
    durationDays?: number | null;
    itemType?: string | null;
    issueKeyType: string | null;
    issueNumber: number | null;
    keyPrefix: string | null;
  },
): LoadedItem {
  return {
    entityType,
    id: row.id,
    projectId: row.projectId,
    title: row.title,
    humanKey: formatHumanKey(row.keyPrefix, row.issueKeyType, row.issueNumber),
    itemType: entityType === 'task' ? (row.itemType === 'bug' ? 'bug' : 'task') : null,
    start: row.start,
    finish: row.finish,
    durationDays: row.durationDays ?? null,
  };
}

async function loadMany(
  database: Database,
  entityType: DeliveryDependencyEntityType,
  ids: string[],
): Promise<LoadedItem[]> {
  if (ids.length === 0) return [];
  if (entityType === 'epic') {
    const rows = await database.db
      .select({
        id: projectEpics.id,
        projectId: projectEpics.projectId,
        title: projectEpics.title,
        start: projectEpics.startDate,
        finish: projectEpics.endDate,
        issueKeyType: projectEpics.issueKeyType,
        issueNumber: projectEpics.issueNumber,
        keyPrefix: projects.keyPrefix,
      })
      .from(projectEpics)
      .innerJoin(projects, eq(projectEpics.projectId, projects.id))
      .where(inArray(projectEpics.id, ids));
    return rows.map((row) => keyedItem('epic', row));
  }
  if (entityType === 'user_story') {
    const rows = await database.db
      .select({
        id: projectUserStories.id,
        projectId: projectUserStories.projectId,
        title: projectUserStories.title,
        start: projectUserStories.startDate,
        finish: projectUserStories.endDate,
        issueKeyType: projectUserStories.issueKeyType,
        issueNumber: projectUserStories.issueNumber,
        keyPrefix: projects.keyPrefix,
      })
      .from(projectUserStories)
      .innerJoin(projects, eq(projectUserStories.projectId, projects.id))
      .where(inArray(projectUserStories.id, ids));
    return rows.map((row) => keyedItem('user_story', row));
  }
  if (entityType === 'milestone') {
    const rows = await database.db
      .select({
        id: projectMilestones.id,
        projectId: projectMilestones.projectId,
        title: projectMilestones.title,
        start: projectMilestones.startDate,
        finish: projectMilestones.targetDate,
        issueKeyType: projectMilestones.issueKeyType,
        issueNumber: projectMilestones.issueNumber,
        keyPrefix: projects.keyPrefix,
      })
      .from(projectMilestones)
      .innerJoin(projects, eq(projectMilestones.projectId, projects.id))
      .where(inArray(projectMilestones.id, ids));
    return rows.map((row) => keyedItem('milestone', row));
  }
  if (entityType === 'sprint') {
    const rows = await database.db
      .select({
        id: projectSprints.id,
        projectId: projectSprints.projectId,
        title: projectSprints.name,
        start: projectSprints.startDate,
        finish: projectSprints.endDate,
        issueKeyType: projectSprints.issueKeyType,
        issueNumber: projectSprints.issueNumber,
        keyPrefix: projects.keyPrefix,
      })
      .from(projectSprints)
      .innerJoin(projects, eq(projectSprints.projectId, projects.id))
      .where(inArray(projectSprints.id, ids));
    return rows.map((row) => keyedItem('sprint', row));
  }
  const rows = await database.db
    .select({
      id: projectTasks.id,
      projectId: projectTasks.projectId,
      title: projectTasks.title,
      start: projectTasks.startDate,
      finish: projectTasks.dueDate,
      durationDays: projectTasks.durationDays,
      itemType: projectTasks.itemType,
      issueKeyType: projectTasks.issueKeyType,
      issueNumber: projectTasks.issueNumber,
      keyPrefix: projects.keyPrefix,
    })
    .from(projectTasks)
    .innerJoin(projects, eq(projectTasks.projectId, projects.id))
    .where(inArray(projectTasks.id, ids));
  return rows.map((row) => keyedItem('task', row));
}

/** Every predecessor link in the project, for the Gantt arrows and labels. */
export async function listProjectDeliveryDependencies(input: {
  database: Database;
  projectId: string;
}): Promise<{ dependencies: PublicDeliveryDependency[] }> {
  const rows = await input.database.db
    .select()
    .from(projectDeliveryDependencies)
    .where(eq(projectDeliveryDependencies.projectId, input.projectId));
  const wanted = new Map<DeliveryDependencyEntityType, Set<string>>();
  const add = (type: string, id: string) => {
    if (!isEntityType(type)) return;
    const set = wanted.get(type) ?? new Set<string>();
    set.add(id);
    wanted.set(type, set);
  };
  for (const row of rows) {
    add(row.predecessorType, row.predecessorId);
    add(row.successorType, row.successorId);
  }
  const items = new Map<string, LoadedItem>();
  await Promise.all([...wanted.entries()].map(async ([type, ids]) => {
    const loaded = await loadMany(input.database, type, [...ids]);
    for (const item of loaded) {
      items.set(deliveryItemKey(item.entityType, item.id), item);
    }
  }));
  return {
    dependencies: sortLinks(
      rows
        .map((row) => toPublicLink(row, items))
        .filter((link): link is PublicDeliveryDependency => link != null),
    ),
  };
}

export async function listDeliveryDependencies(input: {
  database: Database;
  projectId: string;
  idOrKey: string;
  entityType?: DeliveryDependencyEntityType;
}): Promise<{
  predecessors: PublicDeliveryDependency[];
  successors: PublicDeliveryDependency[];
  scheduleDriven: boolean;
}> {
  const item = await resolveDeliveryDependencyRef(input.database, {
    projectId: input.projectId,
    idOrKey: input.idOrKey,
    entityType: input.entityType,
    role: 'item',
  });
  const rows = await input.database.db
    .select()
    .from(projectDeliveryDependencies)
    .where(
      and(
        eq(projectDeliveryDependencies.projectId, input.projectId),
        or(
          and(
            eq(projectDeliveryDependencies.successorType, item.entityType),
            eq(projectDeliveryDependencies.successorId, item.id),
          ),
          and(
            eq(projectDeliveryDependencies.predecessorType, item.entityType),
            eq(projectDeliveryDependencies.predecessorId, item.id),
          ),
        ),
      ),
    );
  const items = new Map<string, LoadedItem>([
    [deliveryItemKey(item.entityType, item.id), item],
  ]);
  for (const row of rows) {
    if (!isEntityType(row.predecessorType) || !isEntityType(row.successorType)) {
      continue;
    }
    const predKey = deliveryItemKey(row.predecessorType, row.predecessorId);
    const succKey = deliveryItemKey(row.successorType, row.successorId);
    if (!items.has(predKey)) {
      const loaded = await loadById(
        input.database,
        row.predecessorType,
        row.predecessorId,
      );
      if (loaded) items.set(predKey, loaded);
    }
    if (!items.has(succKey)) {
      const loaded = await loadById(
        input.database,
        row.successorType,
        row.successorId,
      );
      if (loaded) items.set(succKey, loaded);
    }
  }
  const predecessors: PublicDeliveryDependency[] = [];
  const successors: PublicDeliveryDependency[] = [];
  const predDated: Array<{
    linkType: DeliveryDependencyLinkType;
    lagDays: number;
    predecessor: { start: string | null; finish: string | null };
  }> = [];
  for (const row of rows) {
    const link = toPublicLink(row, items);
    if (!link) continue;
    if (link.successor.id === item.id && link.successor.entityType === item.entityType) {
      predecessors.push(link);
      const pred = items.get(
        deliveryItemKey(link.predecessor.entityType, link.predecessor.id),
      );
      if (pred) {
        predDated.push({
          linkType: link.linkType,
          lagDays: link.lagDays,
          predecessor: pred,
        });
      }
    }
    if (
      link.predecessor.id === item.id
      && link.predecessor.entityType === item.entityType
    ) {
      successors.push(link);
    }
  }
  return {
    predecessors: sortLinks(predecessors),
    successors: sortLinks(successors),
    scheduleDriven: predecessorConstraintApplies(toNode(item), predDated),
  };
}

function isUniqueViolation(error: unknown): boolean {
  const current = error as { code?: string; cause?: { code?: string } };
  return current.code === '23505' || current.cause?.code === '23505';
}

export async function setDeliveryDependency(
  database: Database,
  input: {
    projectId: string;
    predecessorId: string;
    predecessorType?: DeliveryDependencyEntityType;
    successorId: string;
    successorType?: DeliveryDependencyEntityType;
    linkType: DeliveryDependencyLinkType;
    lagDays?: number;
    createdBy?: string | null;
  },
): Promise<{
  dependency: PublicDeliveryDependency;
  schedule: ScheduleWrite[];
}> {
  const lagDays = input.lagDays ?? 0;
  assertLag(lagDays);
  const predecessor = await resolveDeliveryDependencyRef(database, {
    projectId: input.projectId,
    idOrKey: input.predecessorId,
    entityType: input.predecessorType,
    role: 'predecessor',
  });
  const successor = await resolveDeliveryDependencyRef(database, {
    projectId: input.projectId,
    idOrKey: input.successorId,
    entityType: input.successorType,
    role: 'successor',
  });
  if (
    predecessor.entityType === successor.entityType
    && predecessor.id === successor.id
  ) {
    throw new AppError({
      code: 'DEPENDENCY_SELF_LINK',
      message: `${itemLabel(successor)} cannot depend on itself.`,
      statusCode: 400,
    });
  }

  const existingLinks = await database.db
    .select()
    .from(projectDeliveryDependencies)
    .where(eq(projectDeliveryDependencies.projectId, input.projectId));
  const duplicate = existingLinks.find(
    (row) =>
      row.predecessorType === predecessor.entityType
      && row.predecessorId === predecessor.id
      && row.successorType === successor.entityType
      && row.successorId === successor.id,
  );
  if (duplicate) {
    const existingType = duplicate.linkType;
    const label =
      existingType === 'FS'
      || existingType === 'SS'
      || existingType === 'FF'
      || existingType === 'SF'
        ? DELIVERY_DEPENDENCY_LINK_LABELS[existingType]
        : 'dependency';
    throw new AppError({
      code: 'DEPENDENCY_DUPLICATE',
      message: `A ${label} dependency from ${itemLabel(predecessor)} to ${itemLabel(successor)} already exists. Remove it before adding another.`,
      statusCode: 409,
    });
  }

  const cycle = dependencyCycleKeys(
    existingLinks
      .filter(
        (row) => isEntityType(row.predecessorType) && isEntityType(row.successorType),
      )
      .map((row) => ({
        predecessorKey: deliveryItemKey(
          row.predecessorType as DeliveryDependencyEntityType,
          row.predecessorId,
        ),
        successorKey: deliveryItemKey(
          row.successorType as DeliveryDependencyEntityType,
          row.successorId,
        ),
      })),
    deliveryItemKey(predecessor.entityType, predecessor.id),
    deliveryItemKey(successor.entityType, successor.id),
  );
  if (cycle) {
    const labels = new Map<string, string>();
    const items = await loadProjectItems(database, input.projectId);
    for (const item of items) {
      labels.set(deliveryItemKey(item.entityType, item.id), itemLabel(item));
    }
    labels.set(deliveryItemKey(predecessor.entityType, predecessor.id), itemLabel(predecessor));
    labels.set(deliveryItemKey(successor.entityType, successor.id), itemLabel(successor));
    const path = cycle.map((key) => labels.get(key) ?? key).join(' → ');
    throw new AppError({
      code: 'DEPENDENCY_CYCLE',
      message: `This link would create a cycle: ${path}.`,
      statusCode: 400,
    });
  }

  let created: typeof projectDeliveryDependencies.$inferSelect;
  try {
    const [row] = await database.db
      .insert(projectDeliveryDependencies)
      .values({
        projectId: input.projectId,
        predecessorType: predecessor.entityType,
        predecessorId: predecessor.id,
        successorType: successor.entityType,
        successorId: successor.id,
        linkType: input.linkType,
        lagDays,
        createdBy: input.createdBy ?? null,
      })
      .returning();
    if (!row) {
      throw new AppError({
        code: 'DEPENDENCY_CREATE_FAILED',
        message: 'Failed to save the dependency',
        statusCode: 500,
      });
    }
    created = row;
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError({
        code: 'DEPENDENCY_DUPLICATE',
        message: `A dependency from ${itemLabel(predecessor)} to ${itemLabel(successor)} already exists. Remove it before adding another.`,
        statusCode: 409,
      });
    }
    throw error;
  }

  const schedule = await rescheduleDeliveryFrom(database, input.projectId, {
    entityType: successor.entityType,
    id: successor.id,
  });
  const dependency: PublicDeliveryDependency = {
    id: created.id,
    projectId: created.projectId,
    linkType: input.linkType,
    lagDays,
    predecessor: endpointOf(predecessor),
    successor: endpointOf(successor),
    createdAt: created.createdAt.toISOString(),
  };
  return { dependency, schedule };
}

type DependencyLinkInput = {
  predecessorId: string;
  predecessorType?: DeliveryDependencyEntityType;
  successorId: string;
  successorType?: DeliveryDependencyEntityType;
  linkType: DeliveryDependencyLinkType;
  lagDays?: number;
};

function dependencyPairKey(
  predecessorType: string,
  predecessorId: string,
  successorType: string,
  successorId: string,
): string {
  return `${predecessorType}:${predecessorId}->${successorType}:${successorId}`;
}

async function cycleMessage(
  database: Database,
  projectId: string,
  cycle: string[],
  extra: LoadedItem[],
): Promise<string> {
  const labels = new Map<string, string>();
  const items = await loadProjectItems(database, projectId);
  for (const item of items) {
    labels.set(deliveryItemKey(item.entityType, item.id), itemLabel(item));
  }
  for (const item of extra) {
    labels.set(deliveryItemKey(item.entityType, item.id), itemLabel(item));
  }
  const path = cycle.map((key) => labels.get(key) ?? key).join(' → ');
  return `This link would create a cycle: ${path}.`;
}

/**
 * Add several predecessor links, then schedule once from every new successor.
 * A link is rejected when it repeats a pair already stored or earlier in the batch.
 */
export async function setDeliveryDependencies(
  database: Database,
  input: {
    projectId: string;
    links: DependencyLinkInput[];
    createdBy?: string | null;
  },
): Promise<{
  dependencies: PublicDeliveryDependency[];
  schedule: ScheduleWrite[];
}> {
  if (input.links.length === 0) {
    throw new AppError({
      code: 'DEPENDENCY_TARGET_REQUIRED',
      message: 'Pass at least one predecessor link.',
      statusCode: 400,
    });
  }
  if (input.links.length > 50) {
    throw new AppError({
      code: 'VALIDATION_ERROR',
      message: 'At most 50 dependency links can be saved at once.',
      statusCode: 400,
    });
  }

  const existingLinks = await database.db
    .select()
    .from(projectDeliveryDependencies)
    .where(eq(projectDeliveryDependencies.projectId, input.projectId));
  const pairs = new Set(
    existingLinks.map((row) =>
      dependencyPairKey(
        row.predecessorType,
        row.predecessorId,
        row.successorType,
        row.successorId,
      ),
    ),
  );
  const graph = existingLinks
    .filter((row) => isEntityType(row.predecessorType) && isEntityType(row.successorType))
    .map((row) => ({
      predecessorKey: deliveryItemKey(
        row.predecessorType as DeliveryDependencyEntityType,
        row.predecessorId,
      ),
      successorKey: deliveryItemKey(
        row.successorType as DeliveryDependencyEntityType,
        row.successorId,
      ),
    }));

  const prepared: Array<{
    predecessor: LoadedItem;
    successor: LoadedItem;
    linkType: DeliveryDependencyLinkType;
    lagDays: number;
  }> = [];

  for (const link of input.links) {
    const lagDays = link.lagDays ?? 0;
    assertLag(lagDays);
    const predecessor = await resolveDeliveryDependencyRef(database, {
      projectId: input.projectId,
      idOrKey: link.predecessorId,
      entityType: link.predecessorType,
      role: 'predecessor',
    });
    const successor = await resolveDeliveryDependencyRef(database, {
      projectId: input.projectId,
      idOrKey: link.successorId,
      entityType: link.successorType,
      role: 'successor',
    });
    if (
      predecessor.entityType === successor.entityType
      && predecessor.id === successor.id
    ) {
      throw new AppError({
        code: 'DEPENDENCY_SELF_LINK',
        message: `${itemLabel(successor)} cannot depend on itself.`,
        statusCode: 400,
      });
    }
    const pair = dependencyPairKey(
      predecessor.entityType,
      predecessor.id,
      successor.entityType,
      successor.id,
    );
    if (pairs.has(pair)) {
      throw new AppError({
        code: 'DEPENDENCY_DUPLICATE',
        message: `A dependency from ${itemLabel(predecessor)} to ${itemLabel(successor)} already exists. Remove it before adding another.`,
        statusCode: 409,
      });
    }
    const cycle = dependencyCycleKeys(
      graph,
      deliveryItemKey(predecessor.entityType, predecessor.id),
      deliveryItemKey(successor.entityType, successor.id),
    );
    if (cycle) {
      throw new AppError({
        code: 'DEPENDENCY_CYCLE',
        message: await cycleMessage(database, input.projectId, cycle, [
          predecessor,
          successor,
        ]),
        statusCode: 400,
      });
    }
    pairs.add(pair);
    graph.push({
      predecessorKey: deliveryItemKey(predecessor.entityType, predecessor.id),
      successorKey: deliveryItemKey(successor.entityType, successor.id),
    });
    prepared.push({ predecessor, successor, linkType: link.linkType, lagDays });
  }

  let created: Array<typeof projectDeliveryDependencies.$inferSelect>;
  try {
    created = await database.db
      .insert(projectDeliveryDependencies)
      .values(
        prepared.map((link) => ({
          projectId: input.projectId,
          predecessorType: link.predecessor.entityType,
          predecessorId: link.predecessor.id,
          successorType: link.successor.entityType,
          successorId: link.successor.id,
          linkType: link.linkType,
          lagDays: link.lagDays,
          createdBy: input.createdBy ?? null,
        })),
      )
      .returning();
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError({
        code: 'DEPENDENCY_DUPLICATE',
        message: 'A dependency on one of these pairs already exists. Remove it before adding another.',
        statusCode: 409,
      });
    }
    throw error;
  }

  const schedule = await rescheduleDeliveryFrom(
    database,
    input.projectId,
    prepared.map((link) => ({
      entityType: link.successor.entityType,
      id: link.successor.id,
    })),
  );
  return {
    dependencies: prepared.map((link) => {
      const row = created.find(
        (item) =>
          item.predecessorType === link.predecessor.entityType
          && item.predecessorId === link.predecessor.id
          && item.successorType === link.successor.entityType
          && item.successorId === link.successor.id,
      );
      if (!row) {
        throw new AppError({
          code: 'DEPENDENCY_CREATE_FAILED',
          message: 'Failed to save the dependency',
          statusCode: 500,
        });
      }
      return {
        id: row.id,
        projectId: row.projectId,
        linkType: link.linkType,
        lagDays: link.lagDays,
        predecessor: endpointOf(link.predecessor),
        successor: endpointOf(link.successor),
        createdAt: row.createdAt.toISOString(),
      };
    }),
    schedule,
  };
}

export async function updateDeliveryDependency(
  database: Database,
  input: {
    projectId: string;
    linkId: string;
    linkType?: DeliveryDependencyLinkType;
    lagDays?: number;
  },
): Promise<{
  dependency: PublicDeliveryDependency;
  schedule: ScheduleWrite[];
}> {
  if (input.linkType === undefined && input.lagDays === undefined) {
    throw new AppError({
      code: 'DEPENDENCY_TARGET_REQUIRED',
      message: 'Pass linkType or lagDays to update a dependency.',
      statusCode: 400,
    });
  }
  const [existing] = await database.db
    .select()
    .from(projectDeliveryDependencies)
    .where(eq(projectDeliveryDependencies.id, input.linkId))
    .limit(1);
  if (!existing || existing.projectId !== input.projectId) {
    throw new AppError({
      code: 'DEPENDENCY_NOT_FOUND',
      message: 'Dependency link was not found in this project',
      statusCode: 404,
    });
  }
  if (!isEntityType(existing.predecessorType) || !isEntityType(existing.successorType)) {
    throw new AppError({
      code: 'DEPENDENCY_NOT_FOUND',
      message: 'Dependency link was not found in this project',
      statusCode: 404,
    });
  }
  const linkType = input.linkType
    ?? (existing.linkType === 'FS'
      || existing.linkType === 'SS'
      || existing.linkType === 'FF'
      || existing.linkType === 'SF'
      ? existing.linkType
      : null);
  if (!linkType) {
    throw new AppError({
      code: 'DEPENDENCY_NOT_FOUND',
      message: 'Dependency link was not found in this project',
      statusCode: 404,
    });
  }
  const lagDays = input.lagDays ?? existing.lagDays;
  assertLag(lagDays);
  const [row] = await database.db
    .update(projectDeliveryDependencies)
    .set({ linkType, lagDays })
    .where(eq(projectDeliveryDependencies.id, existing.id))
    .returning();
  if (!row) {
    throw new AppError({
      code: 'DEPENDENCY_CREATE_FAILED',
      message: 'Failed to save the dependency',
      statusCode: 500,
    });
  }
  const predecessor = await loadById(database, existing.predecessorType, existing.predecessorId);
  const successor = await loadById(database, existing.successorType, existing.successorId);
  if (!predecessor || !successor) {
    throw new AppError({
      code: 'DEPENDENCY_ENTITY_NOT_FOUND',
      message: 'A linked delivery item was not found',
      statusCode: 404,
    });
  }
  const schedule = await rescheduleDeliveryFrom(database, input.projectId, {
    entityType: successor.entityType,
    id: successor.id,
  });
  return {
    dependency: {
      id: row.id,
      projectId: row.projectId,
      linkType,
      lagDays,
      predecessor: endpointOf(predecessor),
      successor: endpointOf(successor),
      createdAt: row.createdAt.toISOString(),
    },
    schedule,
  };
}

export async function removeDeliveryDependency(
  database: Database,
  input: {
    projectId: string;
    linkId?: string;
    predecessorId?: string;
    predecessorType?: DeliveryDependencyEntityType;
    successorId?: string;
    successorType?: DeliveryDependencyEntityType;
  },
): Promise<{ removedId: string; schedule: ScheduleWrite[] }> {
  let row: typeof projectDeliveryDependencies.$inferSelect | undefined;
  if (input.linkId) {
    const [found] = await database.db
      .select()
      .from(projectDeliveryDependencies)
      .where(eq(projectDeliveryDependencies.id, input.linkId))
      .limit(1);
    if (!found || found.projectId !== input.projectId) {
      throw new AppError({
        code: 'DEPENDENCY_NOT_FOUND',
        message: 'Dependency link was not found in this project',
        statusCode: 404,
      });
    }
    row = found;
  } else if (input.predecessorId && input.successorId) {
    const predecessor = await resolveDeliveryDependencyRef(database, {
      projectId: input.projectId,
      idOrKey: input.predecessorId,
      entityType: input.predecessorType,
      role: 'predecessor',
    });
    const successor = await resolveDeliveryDependencyRef(database, {
      projectId: input.projectId,
      idOrKey: input.successorId,
      entityType: input.successorType,
      role: 'successor',
    });
    const [found] = await database.db
      .select()
      .from(projectDeliveryDependencies)
      .where(
        and(
          eq(projectDeliveryDependencies.projectId, input.projectId),
          eq(projectDeliveryDependencies.predecessorType, predecessor.entityType),
          eq(projectDeliveryDependencies.predecessorId, predecessor.id),
          eq(projectDeliveryDependencies.successorType, successor.entityType),
          eq(projectDeliveryDependencies.successorId, successor.id),
        ),
      )
      .limit(1);
    if (!found) {
      throw new AppError({
        code: 'DEPENDENCY_NOT_FOUND',
        message: `No dependency from ${itemLabel(predecessor)} to ${itemLabel(successor)} exists.`,
        statusCode: 404,
      });
    }
    row = found;
  } else {
    throw new AppError({
      code: 'DEPENDENCY_TARGET_REQUIRED',
      message: 'Pass linkId, or both predecessorId and successorId, to remove a dependency.',
      statusCode: 400,
    });
  }

  await database.db
    .delete(projectDeliveryDependencies)
    .where(eq(projectDeliveryDependencies.id, row.id));
  const successorType = row.successorType;
  if (!isEntityType(successorType)) {
    return { removedId: row.id, schedule: [] };
  }
  const schedule = await rescheduleDeliveryFrom(database, input.projectId, {
    entityType: successorType,
    id: row.successorId,
  });
  return { removedId: row.id, schedule };
}

export async function deleteDeliveryDependenciesFor(
  database: Database,
  entityType: DeliveryDependencyEntityType,
  ids: string[],
): Promise<void> {
  if (ids.length === 0) return;
  await database.db
    .delete(projectDeliveryDependencies)
    .where(
      or(
        and(
          eq(projectDeliveryDependencies.predecessorType, entityType),
          inArray(projectDeliveryDependencies.predecessorId, ids),
        ),
        and(
          eq(projectDeliveryDependencies.successorType, entityType),
          inArray(projectDeliveryDependencies.successorId, ids),
        ),
      ),
    );
}
