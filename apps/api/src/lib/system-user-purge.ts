import { and, asc, eq, inArray, isNotNull, isNull, ne, or } from 'drizzle-orm';
import {
  auditEvents,
  conversationImportRecords,
  conversationImports,
  documentImportMedia,
  documentImportRecords,
  documentImports,
  knowledgeRecordDeliveryLinks,
  knowledgeRecordTags,
  knowledgeRecordVersions,
  knowledgeRecords,
  projectChangeDeliveryLinks,
  projectChangeItems,
  projectEpics,
  projectInitialStakeholders,
  projectMilestones,
  projectRaidItems,
  projectRaidTaskLinks,
  projectSprints,
  projectStakeholders,
  projectTags,
  projectTaskActivities,
  projectTaskRaci,
  projectTasks,
  projectUserStories,
  projects,
  systemTags,
  systems,
  tags,
  users,
  workspaceMedia,
  workspaces,
  type Database,
} from '@project-knowledge-hub/database';
import { AppError } from '@project-knowledge-hub/domain';
import { upsertProjectCostSnapshot } from './project-budget.js';

/**
 * Admin purge of rows created by one system user inside one project.
 *
 * Creator tracking:
 * - tasks, knowledge records, versions, media already store created_by
 * - activities/comments use actor_user_id (the acting user)
 * - milestones, epics, stories, sprints, RAID, changes, stakeholders, systems,
 *   tags, RACI, and delivery/RAID links gained nullable created_by (0048)
 * - translations are knowledge_records rows (same created_by)
 * - AI usage is not its own table: fields_updated activities that touch
 *   tokensUsed/aiSystemId, plus tokens stored on the task itself
 *
 * Conflict strategy: all-or-nothing for in-project cascades. Nullable FKs
 * from kept rows in the target project onto system-owned rows are detached
 * and listed in `detaches`. A cascade that would remove a row the system
 * user did not create inside the target project (human story under a system
 * epic, human comment, human version, human delivery link on a deleted
 * parent, media still used by a kept record in this project) is a conflict
 * and the purge writes nothing.
 *
 * Workspace and org rows (null projectId record, system, media, tag) are
 * deleted only when the system user created them and every reference sits
 * inside the target project's delete set or on a target-project row that is
 * detached. Any other reference skips that item (`skippedSharedItems`) and
 * leaves the outside row untouched. Tag joins outside the project are never
 * removed. The same skip rule covers project-scoped rows when a database
 * ON DELETE SET NULL or CASCADE would touch another project
 * (`project_tasks.ai_system_id`, story `epic_id`, change
 * `knowledge_record_id`, import `system_id`, `projects.charter_record_id` /
 * `initial_plan_record_id`, record `system_id` / `supersedes_record_id`).
 * Charter and initial-plan pointers on the target project are detached and
 * reported; they are not left to a silent database SET NULL.
 *
 * Polymorphic delivery links have no FK. System-created links whose parent
 * is in this project, or whose entity is in the delete set, are deleted.
 * Human links whose entity is in the delete set are removed and reported in
 * `detaches` so the pointer does not dangle. A skipped record keeps its
 * versions, media, and links; those children are not conflicts and are not
 * deleted. Links, versions, and media of records outside this project are
 * ignored unless the link's entity is in the delete set.
 *
 * Any import reference outside the target project skips the record or media,
 * including imports the system user created. Imports are never deleted, so
 * a cascade would remove another project's join. In-project imports the
 * system user did not create still conflict.
 *
 * System media is deleted only when its knowledge record is in the delete
 * set, or a system-created import in the target project attaches it.
 * Unattached system media is skipped with reason `unattached_media`.
 *
 * AI usage is `tokens_used` / `ai_system_id` on a task plus every user's
 * `fields_updated` activity, in time order. If the last write of a field
 * was not the system user, the value stays. Otherwise the purge restores
 * the previous value of the first system write after the last human write
 * (or the earliest system write). A restored `aiSystemId` that is missing
 * or in the delete set becomes null and is reported. Activities without
 * `metadata.previous` are listed in `unrecoverableAiUsage`.
 *
 * Issue-key counters are not reclaimed. Budget summary, sprint burndown,
 * and velocity are computed on read. The daily cost snapshot for today is
 * refreshed after a committed purge only. Dry-run opens no transaction,
 * deletes nothing, and writes only a flagged audit row.
 *
 * The commit transaction is SERIALIZABLE and retried once on SQLSTATE 40001.
 * Counts, detaches, and media ids in the response come from that transaction's
 * plan. A conflict discovered inside the transaction is audited after rollback.
 */

export const PURGE_COUNT_KEYS = [
  'tasks',
  'sprints',
  'epics',
  'userStories',
  'milestones',
  'raidItems',
  'changeItems',
  'comments',
  'activities',
  'raci',
  'stakeholders',
  'initialStakeholders',
  'aiUsageReports',
  'deliveryLinks',
  'knowledgeRecords',
  'knowledgeRecordVersions',
  'translations',
  'media',
  'systems',
  'tags',
] as const;

export type PurgeCountKey = (typeof PURGE_COUNT_KEYS)[number];
export type PurgeCounts = Record<PurgeCountKey, number>;

export type PurgeConflict = {
  entityType: string;
  entityId: string;
  reason: string;
};

export type PurgeDetach = {
  entityType:
    | 'task'
    | 'knowledge_record'
    | 'change_item'
    | 'raid_item'
    | 'media'
    | 'tag_link'
    | 'project'
    | 'document_import'
    | 'conversation_import'
    | 'knowledge_delivery_link'
    | 'change_delivery_link';
  entityId: string;
  field: string;
  tagId?: string;
  ownerType?: 'project' | 'system' | 'knowledge_record';
};

export type PurgeSkippedItem = {
  entityType: string;
  entityId: string;
  reason: string;
};

export type PurgeUnrecoverable = {
  entityType: 'task';
  entityId: string;
  field: 'tokensUsed' | 'aiSystemId';
  reason: string;
};

export type PurgeAiRestore = {
  taskId: string;
  tokensUsed?: number | null;
  aiSystemId?: string | null;
};

export type SystemUserPurgeSnapshot = {
  systemUserId: string;
  projectId: string;
  workspaceId: string;
  organizationId: string;
  tasks: Array<{
    id: string;
    createdBy: string | null;
    projectId: string;
    milestoneId: string | null;
    userStoryId: string | null;
    sprintId: string | null;
    aiSystemId: string | null;
  }>;
  sprints: Array<{ id: string; createdBy: string | null; projectId: string }>;
  epics: Array<{ id: string; createdBy: string | null; projectId: string }>;
  userStories: Array<{
    id: string;
    createdBy: string | null;
    projectId: string;
    epicId: string;
  }>;
  milestones: Array<{ id: string; createdBy: string | null; projectId: string }>;
  raidItems: Array<{
    id: string;
    createdBy: string | null;
    projectId: string;
    transferredToRaidItemId: string | null;
    transferredFromRaidItemId: string | null;
  }>;
  changeItems: Array<{
    id: string;
    createdBy: string | null;
    projectId: string;
    knowledgeRecordId: string | null;
  }>;
  activities: Array<{
    id: string;
    actorUserId: string | null;
    taskId: string;
    type: string;
    fields: string[];
    recordedTokensUsed?: boolean;
    previousTokensUsed?: number | null;
    recordedAiSystemId?: boolean;
    previousAiSystemId?: string | null;
    createdAt?: string;
  }>;
  raci: Array<{ id: string; createdBy: string | null; taskId: string }>;
  stakeholders: Array<{
    id: string;
    createdBy: string | null;
    projectId: string;
  }>;
  initialStakeholders?: Array<{
    id: string;
    createdBy: string | null;
    projectId: string;
  }>;
  knowledgeDeliveryLinks: Array<{
    id: string;
    createdBy: string | null;
    knowledgeRecordId: string;
    entityType?: string;
    entityId?: string;
  }>;
  changeDeliveryLinks: Array<{
    id: string;
    createdBy: string | null;
    changeId: string;
    entityType?: string;
    entityId?: string;
  }>;
  raidTaskLinks: Array<{
    id: string;
    createdBy: string | null;
    raidItemId: string;
    taskId: string;
  }>;
  knowledgeRecords: Array<{
    id: string;
    createdBy: string | null;
    projectId: string | null;
    workspaceId: string;
    systemId: string | null;
    translationGroupId: string | null;
    supersedesRecordId: string | null;
  }>;
  knowledgeRecordVersions: Array<{
    id: string;
    createdBy: string | null;
    knowledgeRecordId: string;
  }>;
  media: Array<{
    id: string;
    createdBy: string | null;
    workspaceId: string;
    knowledgeRecordId: string | null;
  }>;
  systems: Array<{
    id: string;
    createdBy: string | null;
    workspaceId: string;
    projectId: string | null;
  }>;
  tags: Array<{ id: string; createdBy: string | null; organizationId: string }>;
  tagLinks: Array<{
    tagId: string;
    ownerType: 'project' | 'system' | 'knowledge_record';
    ownerId: string;
    ownerProjectId?: string | null;
  }>;
  mediaImportRefs: Array<{
    mediaId: string;
    importCreatedBy: string;
    projectId?: string | null;
  }>;
  recordImportRefs: Array<{
    knowledgeRecordId: string;
    importCreatedBy: string;
    kind: 'document_import' | 'conversation_import';
    projectId?: string | null;
  }>;
  projectPointers?: Array<{
    projectId: string;
    field: 'charterRecordId' | 'initialPlanRecordId';
    recordId: string;
  }>;
  importSystemRefs?: Array<{
    systemId: string;
    sourceId: string;
    kind: 'document_import' | 'conversation_import';
    projectId: string | null;
  }>;
};

export type SystemUserPurgePlan = {
  counts: PurgeCounts;
  deleteIds: {
    tasks: string[];
    sprints: string[];
    epics: string[];
    userStories: string[];
    milestones: string[];
    raidItems: string[];
    changeItems: string[];
    comments: string[];
    activities: string[];
    aiUsageReports: string[];
    raci: string[];
    stakeholders: string[];
    initialStakeholders: string[];
    knowledgeDeliveryLinks: string[];
    changeDeliveryLinks: string[];
    raidTaskLinks: string[];
    knowledgeRecords: string[];
    knowledgeRecordVersions: string[];
    media: string[];
    systems: string[];
    tags: string[];
  };
  detaches: PurgeDetach[];
  conflicts: PurgeConflict[];
  skippedSharedItems: PurgeSkippedItem[];
  unrecoverableAiUsage: PurgeUnrecoverable[];
  aiRestores: PurgeAiRestore[];
};

export type PurgeCommitDecision = 'dry_run' | 'refuse_conflicts' | 'commit';

export function emptyPurgeCounts(): PurgeCounts {
  return {
    tasks: 0,
    sprints: 0,
    epics: 0,
    userStories: 0,
    milestones: 0,
    raidItems: 0,
    changeItems: 0,
    comments: 0,
    activities: 0,
    raci: 0,
    stakeholders: 0,
    initialStakeholders: 0,
    aiUsageReports: 0,
    deliveryLinks: 0,
    knowledgeRecords: 0,
    knowledgeRecordVersions: 0,
    translations: 0,
    media: 0,
    systems: 0,
    tags: 0,
  };
}

export function assertPurgeTargetUser(
  user: { id: string; userType: string } | null,
): asserts user is { id: string; userType: 'system' } {
  if (!user) {
    throw new AppError({
      code: 'USER_NOT_FOUND',
      message: 'User not found',
      statusCode: 404,
    });
  }
  if (user.userType !== 'system') {
    throw new AppError({
      code: 'PURGE_TARGET_NOT_SYSTEM',
      message: 'Purge only runs for users whose category is system',
      statusCode: 409,
    });
  }
}

export function assertPurgeProject(
  project: { id: string } | null,
): asserts project is { id: string } {
  if (!project) {
    throw new AppError({
      code: 'PROJECT_NOT_FOUND',
      message: 'Project not found',
      statusCode: 404,
    });
  }
}

/** Dry-run writes only a flagged audit row. Conflicts block a real purge. */
export function purgeCommitDecision(input: {
  dryRun: boolean;
  conflictCount: number;
}): PurgeCommitDecision {
  if (input.dryRun) return 'dry_run';
  if (input.conflictCount > 0) return 'refuse_conflicts';
  return 'commit';
}

function isAiUsageActivity(activity: {
  type: string;
  fields: string[];
}): boolean {
  if (activity.type !== 'fields_updated') return false;
  return (
    activity.fields.includes('tokensUsed') ||
    activity.fields.includes('aiSystemId')
  );
}

function ids(rows: Array<{ id: string }>): Set<string> {
  return new Set(rows.map((row) => row.id));
}

export function planSystemUserPurge(
  snapshot: SystemUserPurgeSnapshot,
): SystemUserPurgePlan {
  const systemUserId = snapshot.systemUserId;
  const projectId = snapshot.projectId;
  const owned = (createdBy: string | null) => createdBy === systemUserId;
  const inProject = <T extends { projectId: string }>(rows: T[]) =>
    rows.filter((row) => row.projectId === projectId);

  const conflicts: PurgeConflict[] = [];
  const detaches: PurgeDetach[] = [];
  const skipped: PurgeSkippedItem[] = [];
  const skippedIds = {
    tasks: new Set<string>(),
    sprints: new Set<string>(),
    epics: new Set<string>(),
    userStories: new Set<string>(),
    milestones: new Set<string>(),
    raidItems: new Set<string>(),
    records: new Set<string>(),
    media: new Set<string>(),
    systems: new Set<string>(),
    tags: new Set<string>(),
  };
  const skip = (
    kind: keyof typeof skippedIds,
    entityId: string,
    reason: string,
  ) => {
    if (skippedIds[kind].has(entityId)) return;
    skippedIds[kind].add(entityId);
    skipped.push({ entityType: kind, entityId, reason });
  };

  let tasks = inProject(snapshot.tasks).filter((row) => owned(row.createdBy));
  let sprints = inProject(snapshot.sprints).filter((row) => owned(row.createdBy));
  let epics = inProject(snapshot.epics).filter((row) => owned(row.createdBy));
  let userStories = inProject(snapshot.userStories).filter((row) =>
    owned(row.createdBy),
  );
  let milestones = inProject(snapshot.milestones).filter((row) =>
    owned(row.createdBy),
  );
  let raidItems = inProject(snapshot.raidItems).filter((row) =>
    owned(row.createdBy),
  );
  const changeItems = inProject(snapshot.changeItems).filter((row) =>
    owned(row.createdBy),
  );
  const stakeholders = inProject(snapshot.stakeholders).filter((row) =>
    owned(row.createdBy),
  );
  const initialStakeholders = inProject(snapshot.initialStakeholders ?? []).filter(
    (row) => owned(row.createdBy),
  );

  const recordsById = new Map(snapshot.knowledgeRecords.map((row) => [row.id, row]));
  const systemsById = new Map(snapshot.systems.map((row) => [row.id, row]));

  let records = snapshot.knowledgeRecords.filter(
    (row) =>
      row.workspaceId === snapshot.workspaceId &&
      (row.projectId === null || row.projectId === projectId) &&
      owned(row.createdBy),
  );
  let systemRows = snapshot.systems.filter(
    (row) =>
      row.workspaceId === snapshot.workspaceId &&
      (row.projectId === null || row.projectId === projectId) &&
      owned(row.createdBy),
  );

  const candidate = {
    tasks: ids(tasks),
    sprints: ids(sprints),
    epics: ids(epics),
    stories: ids(userStories),
    milestones: ids(milestones),
    raid: ids(raidItems),
    records: ids(records),
    systems: ids(systemRows),
  };

  const refProject = (project: string | null | undefined) =>
    project === undefined ? projectId : project;

  for (const task of snapshot.tasks) {
    if (task.projectId === projectId) continue;
    if (task.milestoneId && candidate.milestones.has(task.milestoneId)) {
      skip(
        'milestones',
        task.milestoneId,
        'Another project references this milestone; deleting it would SET NULL outside the purge.',
      );
    }
    if (task.userStoryId && candidate.stories.has(task.userStoryId)) {
      skip(
        'userStories',
        task.userStoryId,
        'Another project references this user story; deleting it would SET NULL outside the purge.',
      );
    }
    if (task.sprintId && candidate.sprints.has(task.sprintId)) {
      skip(
        'sprints',
        task.sprintId,
        'Another project references this sprint; deleting it would SET NULL outside the purge.',
      );
    }
    if (task.aiSystemId && candidate.systems.has(task.aiSystemId)) {
      skip(
        'systems',
        task.aiSystemId,
        'Another project references this system; deleting it would SET NULL outside the purge.',
      );
    }
  }

  for (const story of snapshot.userStories) {
    if (story.projectId === projectId) continue;
    if (candidate.epics.has(story.epicId)) {
      skip(
        'epics',
        story.epicId,
        'Another project has a user story under this epic; deleting it would cascade outside the purge.',
      );
    }
  }

  for (const item of snapshot.raidItems) {
    if (item.projectId === projectId) continue;
    if (
      item.transferredToRaidItemId &&
      candidate.raid.has(item.transferredToRaidItemId)
    ) {
      skip(
        'raidItems',
        item.transferredToRaidItemId,
        'Another project references this RAID item; deleting it would SET NULL outside the purge.',
      );
    }
    if (
      item.transferredFromRaidItemId &&
      candidate.raid.has(item.transferredFromRaidItemId)
    ) {
      skip(
        'raidItems',
        item.transferredFromRaidItemId,
        'Another project references this RAID item; deleting it would SET NULL outside the purge.',
      );
    }
  }

  for (const item of snapshot.changeItems) {
    if (!item.knowledgeRecordId || !candidate.records.has(item.knowledgeRecordId)) {
      continue;
    }
    if (item.projectId !== projectId) {
      skip(
        'records',
        item.knowledgeRecordId,
        'Another project change item references this record; deleting it would SET NULL outside the purge.',
      );
    }
  }

  for (const pointer of snapshot.projectPointers ?? []) {
    if (!candidate.records.has(pointer.recordId)) continue;
    if (pointer.projectId !== projectId) {
      skip(
        'records',
        pointer.recordId,
        'Another project pins this record as charter or initial plan.',
      );
    }
  }

  for (const ref of snapshot.importSystemRefs ?? []) {
    if (!candidate.systems.has(ref.systemId)) continue;
    if (ref.projectId !== projectId) {
      skip(
        'systems',
        ref.systemId,
        'An import outside the target project references this system.',
      );
    }
  }

  for (const ref of snapshot.recordImportRefs) {
    if (!candidate.records.has(ref.knowledgeRecordId)) continue;
    if (refProject(ref.projectId) !== projectId) {
      skip(
        'records',
        ref.knowledgeRecordId,
        'An import outside the target project links this record.',
      );
    }
  }

  // Supersedes and system pointers depend on the final delete set. A record
  // skipped above can itself point at something still queued for deletion.
  const recordWillDelete = (id: string) =>
    candidate.records.has(id) && !skippedIds.records.has(id);
  let skipGrew = true;
  while (skipGrew) {
    const skippedBefore = skippedIds.records.size + skippedIds.systems.size;
    for (const record of snapshot.knowledgeRecords) {
      if (!record.supersedesRecordId || !recordWillDelete(record.supersedesRecordId)) {
        continue;
      }
      const referencerKept = !recordWillDelete(record.id);
      const inProjectDetach = record.projectId === projectId;
      if (referencerKept && !inProjectDetach) {
        skip(
          'records',
          record.supersedesRecordId,
          'A record outside the target project supersedes this record.',
        );
      }
    }
    for (const record of snapshot.knowledgeRecords) {
      if (!record.systemId || !candidate.systems.has(record.systemId)) continue;
      if (recordWillDelete(record.id)) continue;
      if (record.projectId === projectId) continue;
      skip(
        'systems',
        record.systemId,
        'A record outside the target project references this system.',
      );
    }
    skipGrew = skippedIds.records.size + skippedIds.systems.size > skippedBefore;
  }

  tasks = tasks.filter((row) => !skippedIds.tasks.has(row.id));
  sprints = sprints.filter((row) => !skippedIds.sprints.has(row.id));
  epics = epics.filter((row) => !skippedIds.epics.has(row.id));
  userStories = userStories.filter((row) => !skippedIds.userStories.has(row.id));
  milestones = milestones.filter((row) => !skippedIds.milestones.has(row.id));
  raidItems = raidItems.filter((row) => !skippedIds.raidItems.has(row.id));
  records = records.filter((row) => !skippedIds.records.has(row.id));
  systemRows = systemRows.filter((row) => !skippedIds.systems.has(row.id));

  const taskIds = ids(tasks);
  const sprintIds = ids(sprints);
  const epicIds = ids(epics);
  const storyIds = ids(userStories);
  const milestoneIds = ids(milestones);
  const raidIds = ids(raidItems);
  const changeIds = ids(changeItems);
  const recordIds = ids(records);
  const systemIds = ids(systemRows);
  const projectTaskIds = ids(inProject(snapshot.tasks));
  const inScopeRecord = (recordId: string) => {
    const record = recordsById.get(recordId);
    if (!record) return false;
    return record.projectId === projectId || record.projectId === null;
  };

  for (const story of inProject(snapshot.userStories)) {
    if (!owned(story.createdBy) && epicIds.has(story.epicId)) {
      conflicts.push({
        entityType: 'user_story',
        entityId: story.id,
        reason:
          'User story was not created by the system user, but its epic was. Deleting the epic would cascade-delete the story.',
      });
    }
  }

  const comments: string[] = [];
  const activities: string[] = [];
  const aiUsageReports: string[] = [];
  for (const activity of snapshot.activities) {
    if (!projectTaskIds.has(activity.taskId)) continue;
    const bySystem = activity.actorUserId === systemUserId;
    if (bySystem) {
      if (activity.type === 'comment') comments.push(activity.id);
      else if (isAiUsageActivity(activity)) aiUsageReports.push(activity.id);
      else activities.push(activity.id);
      continue;
    }
    if (taskIds.has(activity.taskId)) {
      conflicts.push({
        entityType: activity.type === 'comment' ? 'comment' : 'activity',
        entityId: activity.id,
        reason:
          'Activity on a system-created task was not created by that user. Deleting the task would cascade-delete it.',
      });
    }
  }

  const raci: string[] = [];
  for (const row of snapshot.raci) {
    if (!projectTaskIds.has(row.taskId)) continue;
    if (owned(row.createdBy)) {
      raci.push(row.id);
      continue;
    }
    if (taskIds.has(row.taskId)) {
      conflicts.push({
        entityType: 'raci',
        entityId: row.id,
        reason:
          'RACI row on a system-created task was not created by that user. Deleting the task would cascade-delete it.',
      });
    }
  }

  const unrecoverable: PurgeUnrecoverable[] = [];
  const aiRestores: PurgeAiRestore[] = [];
  const keptTaskIds = [...projectTaskIds].filter((id) => !taskIds.has(id));
  const aiUsageByTask = new Map<
    string,
    Array<{ activity: (typeof snapshot.activities)[number]; index: number }>
  >();
  snapshot.activities.forEach((activity, index) => {
    if (!isAiUsageActivity(activity)) return;
    const list = aiUsageByTask.get(activity.taskId) ?? [];
    list.push({ activity, index });
    aiUsageByTask.set(activity.taskId, list);
  });
  for (const list of aiUsageByTask.values()) {
    list.sort((a, b) => {
      if (a.activity.createdAt && b.activity.createdAt) {
        const cmp = a.activity.createdAt.localeCompare(b.activity.createdAt);
        if (cmp !== 0) return cmp;
      }
      return a.index - b.index;
    });
  }
  for (const taskId of keptTaskIds) {
    const acts = (aiUsageByTask.get(taskId) ?? []).map((row) => row.activity);
    const restore: PurgeAiRestore = { taskId };
    let restoreAny = false;
    for (const field of ['tokensUsed', 'aiSystemId'] as const) {
      const writes = acts.filter((activity) => activity.fields.includes(field));
      if (writes.length === 0) continue;
      const last = writes[writes.length - 1];
      if (!last || last.actorUserId !== systemUserId) continue;
      let lastHuman = -1;
      writes.forEach((activity, index) => {
        if (activity.actorUserId !== systemUserId) lastHuman = index;
      });
      const firstSystem = writes
        .slice(lastHuman + 1)
        .find((activity) => activity.actorUserId === systemUserId);
      if (!firstSystem) continue;
      if (field === 'tokensUsed') {
        if (firstSystem.recordedTokensUsed) {
          restore.tokensUsed = firstSystem.previousTokensUsed ?? null;
          restoreAny = true;
        } else {
          unrecoverable.push({
            entityType: 'task',
            entityId: taskId,
            field: 'tokensUsed',
            reason:
              'System user overwrote tokensUsed and the activity did not record the previous value.',
          });
        }
        continue;
      }
      if (!firstSystem.recordedAiSystemId) {
        unrecoverable.push({
          entityType: 'task',
          entityId: taskId,
          field: 'aiSystemId',
          reason:
            'System user overwrote aiSystemId and the activity did not record the previous value.',
        });
        continue;
      }
      let restoredSystem = firstSystem.previousAiSystemId ?? null;
      if (
        restoredSystem !== null &&
        (!systemsById.has(restoredSystem) || systemIds.has(restoredSystem))
      ) {
        unrecoverable.push({
          entityType: 'task',
          entityId: taskId,
          field: 'aiSystemId',
          reason: systemIds.has(restoredSystem)
            ? 'Restored aiSystemId points at a system this purge deletes.'
            : 'Restored aiSystemId points at a system that no longer exists.',
        });
        restoredSystem = null;
      }
      restore.aiSystemId = restoredSystem;
      restoreAny = true;
    }
    if (restoreAny) aiRestores.push(restore);
  }
  const restoredAiSystem = new Map(
    aiRestores
      .filter((row) => 'aiSystemId' in row)
      .map((row) => [row.taskId, row.aiSystemId ?? null]),
  );

  const parentRecordSkipped = (recordId: string) =>
    candidate.records.has(recordId) && !recordIds.has(recordId);

  const versions: string[] = [];
  for (const version of snapshot.knowledgeRecordVersions) {
    if (!inScopeRecord(version.knowledgeRecordId)) continue;
    if (parentRecordSkipped(version.knowledgeRecordId)) continue;
    const parentDeleted = recordIds.has(version.knowledgeRecordId);
    if (parentDeleted && !owned(version.createdBy)) {
      conflicts.push({
        entityType: 'knowledge_record_version',
        entityId: version.id,
        reason:
          'Version on a system-created record was not created by that user. Deleting the record would cascade-delete it.',
      });
      continue;
    }
    const parent = recordsById.get(version.knowledgeRecordId);
    if (
      !parentDeleted &&
      owned(version.createdBy) &&
      parent?.projectId === projectId
    ) {
      conflicts.push({
        entityType: 'knowledge_record_version',
        entityId: version.id,
        reason:
          'System user authored a version of a record that will be kept. Deleting the version would rewrite real history.',
      });
      continue;
    }
    if (parentDeleted) versions.push(version.id);
  }

  for (const ref of snapshot.recordImportRefs) {
    if (!recordIds.has(ref.knowledgeRecordId)) continue;
    if (ref.importCreatedBy === systemUserId) continue;
    if (refProject(ref.projectId) !== projectId) continue;
    conflicts.push({
      entityType: ref.kind,
      entityId: ref.knowledgeRecordId,
      reason:
        'An import the system user did not create links this record. Deleting the record would remove that link.',
    });
  }

  const entityInDeleteSet = (entityType: string | undefined, entityId: string | undefined) => {
    if (!entityType || !entityId) return false;
    if (entityType === 'epic') return epicIds.has(entityId);
    if (entityType === 'user_story') return storyIds.has(entityId);
    if (entityType === 'task') return taskIds.has(entityId);
    if (entityType === 'sprint') return sprintIds.has(entityId);
    if (entityType === 'milestone') return milestoneIds.has(entityId);
    return false;
  };

  const knowledgeDeliveryLinks: string[] = [];
  const seenKnowledgeLinks = new Set<string>();
  for (const link of snapshot.knowledgeDeliveryLinks) {
    if (seenKnowledgeLinks.has(link.id)) continue;
    seenKnowledgeLinks.add(link.id);
    const parent = recordsById.get(link.knowledgeRecordId);
    const parentInScope = parent
      ? parent.projectId === projectId || parent.projectId === null
      : false;
    const parentDeleted = recordIds.has(link.knowledgeRecordId);
    const entityDeleted = entityInDeleteSet(link.entityType, link.entityId);
    if (parentRecordSkipped(link.knowledgeRecordId) && !entityDeleted) continue;
    if (!parentInScope && !entityDeleted) continue;
    if (parentDeleted) {
      if (owned(link.createdBy)) knowledgeDeliveryLinks.push(link.id);
      else {
        conflicts.push({
          entityType: 'knowledge_delivery_link',
          entityId: link.id,
          reason:
            'Delivery link on a system-created record was not created by that user.',
        });
      }
      continue;
    }
    if (parentInScope && parent?.projectId === projectId && owned(link.createdBy)) {
      knowledgeDeliveryLinks.push(link.id);
      continue;
    }
    if (!entityDeleted) continue;
    knowledgeDeliveryLinks.push(link.id);
    if (!owned(link.createdBy)) {
      detaches.push({
        entityType: 'knowledge_delivery_link',
        entityId: link.id,
        field: 'entityId',
      });
    }
  }

  const changeDeliveryLinks: string[] = [];
  const changesById = new Map(snapshot.changeItems.map((row) => [row.id, row]));
  const seenChangeLinks = new Set<string>();
  for (const link of snapshot.changeDeliveryLinks) {
    if (seenChangeLinks.has(link.id)) continue;
    seenChangeLinks.add(link.id);
    const parent = changesById.get(link.changeId);
    const parentInScope = parent?.projectId === projectId;
    const parentDeleted = changeIds.has(link.changeId);
    const entityDeleted = entityInDeleteSet(link.entityType, link.entityId);
    if (!parentInScope && !entityDeleted) continue;
    if (parentDeleted) {
      if (owned(link.createdBy)) changeDeliveryLinks.push(link.id);
      else {
        conflicts.push({
          entityType: 'change_delivery_link',
          entityId: link.id,
          reason:
            'Delivery link on a system-created change item was not created by that user.',
        });
      }
      continue;
    }
    if (parentInScope && owned(link.createdBy)) {
      changeDeliveryLinks.push(link.id);
      continue;
    }
    if (!entityDeleted) continue;
    changeDeliveryLinks.push(link.id);
    if (!owned(link.createdBy)) {
      detaches.push({
        entityType: 'change_delivery_link',
        entityId: link.id,
        field: 'entityId',
      });
    }
  }

  const raidById = new Map(snapshot.raidItems.map((row) => [row.id, row]));
  const taskById = new Map(snapshot.tasks.map((row) => [row.id, row]));
  const raidTaskLinks: string[] = [];
  for (const link of snapshot.raidTaskLinks) {
    const raidInProject = raidById.get(link.raidItemId)?.projectId === projectId;
    const taskInProject = taskById.get(link.taskId)?.projectId === projectId;
    if (!raidInProject && !taskInProject) continue;
    const parentDeleted = raidIds.has(link.raidItemId) || taskIds.has(link.taskId);
    if (owned(link.createdBy)) {
      if (parentDeleted || raidInProject) raidTaskLinks.push(link.id);
      continue;
    }
    if (parentDeleted) {
      conflicts.push({
        entityType: 'raid_task_link',
        entityId: link.id,
        reason:
          'RAID task link was not created by the system user, but one of its endpoints will be deleted.',
      });
    }
  }

  const mediaRows: Array<(typeof snapshot.media)[number]> = [];
  for (const row of snapshot.media) {
    if (row.workspaceId !== snapshot.workspaceId || !owned(row.createdBy)) continue;
    const imports = snapshot.mediaImportRefs.filter((ref) => ref.mediaId === row.id);
    const outsideImport = imports.find(
      (ref) => refProject(ref.projectId) !== projectId,
    );
    if (outsideImport) {
      skip(
        'media',
        row.id,
        'Media is attached to an import outside the target project.',
      );
      continue;
    }
    const humanInProjectImport = imports.some(
      (ref) =>
        ref.importCreatedBy !== systemUserId &&
        refProject(ref.projectId) === projectId,
    );
    if (row.knowledgeRecordId && parentRecordSkipped(row.knowledgeRecordId)) {
      skip(
        'media',
        row.id,
        'Media stays with a knowledge record that was skipped.',
      );
      continue;
    }
    if (row.knowledgeRecordId && recordIds.has(row.knowledgeRecordId)) {
      if (humanInProjectImport) {
        conflicts.push({
          entityType: 'media',
          entityId: row.id,
          reason:
            'Media is attached to a document import the system user did not create.',
        });
        continue;
      }
      mediaRows.push(row);
      continue;
    }
    if (row.knowledgeRecordId) {
      const parent = recordsById.get(row.knowledgeRecordId);
      if (parent?.projectId !== projectId) {
        skip(
          'media',
          row.id,
          'Media is still referenced by a record outside the target project.',
        );
        continue;
      }
      conflicts.push({
        entityType: 'media',
        entityId: row.id,
        reason:
          'Media created by the system user is still referenced by a knowledge record that will be kept.',
      });
      continue;
    }
    if (humanInProjectImport) {
      conflicts.push({
        entityType: 'media',
        entityId: row.id,
        reason:
          'Media is attached to a document import the system user did not create.',
      });
      continue;
    }
    const systemInProjectImport = imports.some(
      (ref) =>
        ref.importCreatedBy === systemUserId &&
        refProject(ref.projectId) === projectId,
    );
    if (systemInProjectImport) {
      mediaRows.push(row);
      continue;
    }
    skip('media', row.id, 'unattached_media');
  }

  const tagOwnerProject = (link: (typeof snapshot.tagLinks)[number]) => {
    if (link.ownerProjectId !== undefined) return link.ownerProjectId;
    if (link.ownerType === 'project') return link.ownerId;
    if (link.ownerType === 'system') {
      return systemsById.get(link.ownerId)?.projectId ?? null;
    }
    return recordsById.get(link.ownerId)?.projectId ?? null;
  };
  const tagOwnerInScope = (link: (typeof snapshot.tagLinks)[number]) => {
    if (tagOwnerProject(link) === projectId) return true;
    if (link.ownerType === 'system' && systemIds.has(link.ownerId)) return true;
    if (link.ownerType === 'knowledge_record' && recordIds.has(link.ownerId)) {
      return true;
    }
    return false;
  };

  const tagCandidates = snapshot.tags.filter(
    (row) =>
      row.organizationId === snapshot.organizationId && owned(row.createdBy),
  );
  const tagRows = tagCandidates.filter((tag) => {
    const links = snapshot.tagLinks.filter((link) => link.tagId === tag.id);
    const outside = links.find((link) => !tagOwnerInScope(link));
    if (!outside) return true;
    skip(
      'tags',
      tag.id,
      'Tag is used outside the target project. Its join rows are left in place.',
    );
    return false;
  });
  const tagIds = ids(tagRows);
  for (const link of snapshot.tagLinks) {
    if (!tagIds.has(link.tagId)) continue;
    const ownerDeleted =
      (link.ownerType === 'system' && systemIds.has(link.ownerId)) ||
      (link.ownerType === 'knowledge_record' && recordIds.has(link.ownerId)) ||
      (link.ownerType === 'project' && false);
    if (ownerDeleted) continue;
    detaches.push({
      entityType: 'tag_link',
      entityId: link.ownerId,
      field: 'tagId',
      tagId: link.tagId,
      ownerType: link.ownerType,
    });
  }

  for (const task of snapshot.tasks) {
    if (task.projectId !== projectId || taskIds.has(task.id)) continue;
    if (task.milestoneId && milestoneIds.has(task.milestoneId)) {
      detaches.push({
        entityType: 'task',
        entityId: task.id,
        field: 'milestoneId',
      });
    }
    if (task.userStoryId && storyIds.has(task.userStoryId)) {
      detaches.push({
        entityType: 'task',
        entityId: task.id,
        field: 'userStoryId',
      });
    }
    if (task.sprintId && sprintIds.has(task.sprintId)) {
      detaches.push({
        entityType: 'task',
        entityId: task.id,
        field: 'sprintId',
      });
    }
    if (task.aiSystemId && systemIds.has(task.aiSystemId)) {
      const restored = restoredAiSystem.get(task.id);
      const restoredKept =
        restored !== undefined && restored !== null && !systemIds.has(restored);
      if (!restoredKept) {
        detaches.push({
          entityType: 'task',
          entityId: task.id,
          field: 'aiSystemId',
        });
      }
    }
  }

  for (const record of snapshot.knowledgeRecords) {
    if (recordIds.has(record.id)) continue;
    if (record.projectId !== projectId) continue;
    if (record.systemId && systemIds.has(record.systemId)) {
      detaches.push({
        entityType: 'knowledge_record',
        entityId: record.id,
        field: 'systemId',
      });
    }
    if (record.supersedesRecordId && recordIds.has(record.supersedesRecordId)) {
      detaches.push({
        entityType: 'knowledge_record',
        entityId: record.id,
        field: 'supersedesRecordId',
      });
    }
  }

  for (const pointer of snapshot.projectPointers ?? []) {
    if (pointer.projectId !== projectId) continue;
    if (!recordIds.has(pointer.recordId)) continue;
    detaches.push({
      entityType: 'project',
      entityId: pointer.projectId,
      field: pointer.field,
    });
  }

  for (const ref of snapshot.importSystemRefs ?? []) {
    if (ref.projectId !== projectId) continue;
    if (!systemIds.has(ref.systemId)) continue;
    detaches.push({
      entityType: ref.kind,
      entityId: ref.sourceId,
      field: 'systemId',
    });
  }

  const groupMembers = new Map<string, string[]>();
  for (const record of snapshot.knowledgeRecords) {
    if (!record.translationGroupId) continue;
    if (record.projectId !== projectId && record.projectId !== null) continue;
    const list = groupMembers.get(record.translationGroupId) ?? [];
    list.push(record.id);
    groupMembers.set(record.translationGroupId, list);
  }
  const translationIds = new Set<string>();
  for (const record of records) {
    if (!record.translationGroupId) continue;
    const members = groupMembers.get(record.translationGroupId) ?? [];
    if (members.some((id) => id !== record.id)) translationIds.add(record.id);
  }
  for (const members of groupMembers.values()) {
    const survivors = members.filter((id) => !recordIds.has(id));
    const removed = members.some((id) => recordIds.has(id));
    const survivorId = survivors[0];
    const survivor = survivorId ? recordsById.get(survivorId) : undefined;
    if (
      removed &&
      survivors.length === 1 &&
      survivorId &&
      survivor?.projectId === projectId
    ) {
      detaches.push({
        entityType: 'knowledge_record',
        entityId: survivorId,
        field: 'translationGroupId',
      });
    }
  }

  for (const item of snapshot.changeItems) {
    if (item.projectId !== projectId || changeIds.has(item.id)) continue;
    if (item.knowledgeRecordId && recordIds.has(item.knowledgeRecordId)) {
      detaches.push({
        entityType: 'change_item',
        entityId: item.id,
        field: 'knowledgeRecordId',
      });
    }
  }

  for (const item of snapshot.raidItems) {
    if (item.projectId !== projectId || raidIds.has(item.id)) continue;
    if (
      item.transferredToRaidItemId &&
      raidIds.has(item.transferredToRaidItemId)
    ) {
      detaches.push({
        entityType: 'raid_item',
        entityId: item.id,
        field: 'transferredToRaidItemId',
      });
    }
    if (
      item.transferredFromRaidItemId &&
      raidIds.has(item.transferredFromRaidItemId)
    ) {
      detaches.push({
        entityType: 'raid_item',
        entityId: item.id,
        field: 'transferredFromRaidItemId',
      });
    }
  }

  for (const row of snapshot.media) {
    if (ids(mediaRows).has(row.id)) continue;
    if (row.workspaceId !== snapshot.workspaceId) continue;
    if (row.knowledgeRecordId && recordIds.has(row.knowledgeRecordId)) {
      detaches.push({
        entityType: 'media',
        entityId: row.id,
        field: 'knowledgeRecordId',
      });
    }
  }

  const counts = emptyPurgeCounts();
  counts.tasks = tasks.length;
  counts.sprints = sprints.length;
  counts.epics = epics.length;
  counts.userStories = userStories.length;
  counts.milestones = milestones.length;
  counts.raidItems = raidItems.length;
  counts.changeItems = changeItems.length;
  counts.comments = comments.length;
  counts.activities = activities.length;
  counts.raci = raci.length;
  counts.stakeholders = stakeholders.length;
  counts.initialStakeholders = initialStakeholders.length;
  counts.aiUsageReports = aiUsageReports.length;
  counts.deliveryLinks =
    knowledgeDeliveryLinks.length +
    changeDeliveryLinks.length +
    raidTaskLinks.length;
  counts.translations = translationIds.size;
  counts.knowledgeRecords = records.length - translationIds.size;
  counts.knowledgeRecordVersions = versions.length;
  counts.media = mediaRows.length;
  counts.systems = systemRows.length;
  counts.tags = tagRows.length;

  return {
    counts,
    deleteIds: {
      tasks: tasks.map((row) => row.id),
      sprints: sprints.map((row) => row.id),
      epics: epics.map((row) => row.id),
      userStories: userStories.map((row) => row.id),
      milestones: milestones.map((row) => row.id),
      raidItems: raidItems.map((row) => row.id),
      changeItems: changeItems.map((row) => row.id),
      comments,
      activities,
      aiUsageReports,
      raci,
      stakeholders: stakeholders.map((row) => row.id),
      initialStakeholders: initialStakeholders.map((row) => row.id),
      knowledgeDeliveryLinks,
      changeDeliveryLinks,
      raidTaskLinks,
      knowledgeRecords: records.map((row) => row.id),
      knowledgeRecordVersions: versions,
      media: mediaRows.map((row) => row.id),
      systems: systemRows.map((row) => row.id),
      tags: tagRows.map((row) => row.id),
    },
    detaches,
    conflicts,
    skippedSharedItems: skipped,
    unrecoverableAiUsage: unrecoverable,
    aiRestores,
  };
}

type QueryDb = Database['db'];

function activityFields(metadata: unknown): string[] {
  if (!metadata || typeof metadata !== 'object') return [];
  const fields = (metadata as { fields?: unknown }).fields;
  if (!Array.isArray(fields)) return [];
  return fields.filter((item): item is string => typeof item === 'string');
}

function activityPrevious(metadata: unknown): {
  recordedTokensUsed: boolean;
  previousTokensUsed: number | null;
  recordedAiSystemId: boolean;
  previousAiSystemId: string | null;
} {
  const empty = {
    recordedTokensUsed: false,
    previousTokensUsed: null,
    recordedAiSystemId: false,
    previousAiSystemId: null,
  };
  if (!metadata || typeof metadata !== 'object') return empty;
  const previous = (metadata as { previous?: unknown }).previous;
  if (!previous || typeof previous !== 'object') return empty;
  const prev = previous as { tokensUsed?: unknown; aiSystemId?: unknown };
  const recordedTokensUsed =
    Object.prototype.hasOwnProperty.call(prev, 'tokensUsed') &&
    (typeof prev.tokensUsed === 'number' || prev.tokensUsed === null);
  const recordedAiSystemId =
    Object.prototype.hasOwnProperty.call(prev, 'aiSystemId') &&
    (typeof prev.aiSystemId === 'string' || prev.aiSystemId === null);
  return {
    recordedTokensUsed,
    previousTokensUsed: recordedTokensUsed ? (prev.tokensUsed as number | null) : null,
    recordedAiSystemId,
    previousAiSystemId: recordedAiSystemId
      ? (prev.aiSystemId as string | null)
      : null,
  };
}

function dedupeById<T extends { id: string }>(rows: T[]): T[] {
  const map = new Map<string, T>();
  for (const row of rows) map.set(row.id, row);
  return [...map.values()];
}

export async function loadSystemUserPurgeSnapshot(
  db: QueryDb,
  input: {
    systemUserId: string;
    projectId: string;
    workspaceId: string;
    organizationId: string;
  },
): Promise<SystemUserPurgeSnapshot> {
  const projectTaskIds = db
    .select({ id: projectTasks.id })
    .from(projectTasks)
    .where(eq(projectTasks.projectId, input.projectId));
  const projectSprintIds = db
    .select({ id: projectSprints.id })
    .from(projectSprints)
    .where(eq(projectSprints.projectId, input.projectId));
  const projectStoryIds = db
    .select({ id: projectUserStories.id })
    .from(projectUserStories)
    .where(eq(projectUserStories.projectId, input.projectId));
  const projectEpicIds = db
    .select({ id: projectEpics.id })
    .from(projectEpics)
    .where(eq(projectEpics.projectId, input.projectId));
  const projectMilestoneIds = db
    .select({ id: projectMilestones.id })
    .from(projectMilestones)
    .where(eq(projectMilestones.projectId, input.projectId));
  const projectRaidIds = db
    .select({ id: projectRaidItems.id })
    .from(projectRaidItems)
    .where(eq(projectRaidItems.projectId, input.projectId));
  const projectChangeIds = db
    .select({ id: projectChangeItems.id })
    .from(projectChangeItems)
    .where(eq(projectChangeItems.projectId, input.projectId));
  const inScopeRecordIds = db
    .select({ id: knowledgeRecords.id })
    .from(knowledgeRecords)
    .where(
      and(
        eq(knowledgeRecords.workspaceId, input.workspaceId),
        or(
          eq(knowledgeRecords.projectId, input.projectId),
          isNull(knowledgeRecords.projectId),
        ),
      ),
    );
  const candidateSystemIds = db
    .select({ id: systems.id })
    .from(systems)
    .where(
      and(
        eq(systems.workspaceId, input.workspaceId),
        eq(systems.createdBy, input.systemUserId),
        or(isNull(systems.projectId), eq(systems.projectId, input.projectId)),
      ),
    );
  const systemTagIds = db
    .select({ id: tags.id })
    .from(tags)
    .where(
      and(
        eq(tags.organizationId, input.organizationId),
        eq(tags.createdBy, input.systemUserId),
      ),
    );

  const taskColumns = {
    id: projectTasks.id,
    createdBy: projectTasks.createdBy,
    projectId: projectTasks.projectId,
    milestoneId: projectTasks.milestoneId,
    userStoryId: projectTasks.userStoryId,
    sprintId: projectTasks.sprintId,
    aiSystemId: projectTasks.aiSystemId,
  };
  const projectTaskRows = await db
    .select(taskColumns)
    .from(projectTasks)
    .where(eq(projectTasks.projectId, input.projectId));
  const foreignTaskRows = await db
    .select(taskColumns)
    .from(projectTasks)
    .where(
      and(
        ne(projectTasks.projectId, input.projectId),
        or(
          inArray(projectTasks.milestoneId, projectMilestoneIds),
          inArray(projectTasks.sprintId, projectSprintIds),
          inArray(projectTasks.userStoryId, projectStoryIds),
          inArray(projectTasks.aiSystemId, candidateSystemIds),
        ),
      ),
    );

  const activityRows = await db
    .select({
      id: projectTaskActivities.id,
      actorUserId: projectTaskActivities.actorUserId,
      taskId: projectTaskActivities.taskId,
      type: projectTaskActivities.type,
      metadataJson: projectTaskActivities.metadataJson,
      createdAt: projectTaskActivities.createdAt,
    })
    .from(projectTaskActivities)
    .where(inArray(projectTaskActivities.taskId, projectTaskIds))
    .orderBy(asc(projectTaskActivities.createdAt));
  const raciRows = await db
    .select({
      id: projectTaskRaci.id,
      createdBy: projectTaskRaci.createdBy,
      taskId: projectTaskRaci.taskId,
    })
    .from(projectTaskRaci)
    .where(inArray(projectTaskRaci.taskId, projectTaskIds));

  const recordColumns = {
    id: knowledgeRecords.id,
    createdBy: knowledgeRecords.createdBy,
    projectId: knowledgeRecords.projectId,
    workspaceId: knowledgeRecords.workspaceId,
    systemId: knowledgeRecords.systemId,
    translationGroupId: knowledgeRecords.translationGroupId,
    supersedesRecordId: knowledgeRecords.supersedesRecordId,
  };
  const inScopeRecords = await db
    .select(recordColumns)
    .from(knowledgeRecords)
    .where(
      and(
        eq(knowledgeRecords.workspaceId, input.workspaceId),
        or(
          eq(knowledgeRecords.projectId, input.projectId),
          isNull(knowledgeRecords.projectId),
        ),
      ),
    );
  const foreignRecords = await db
    .select(recordColumns)
    .from(knowledgeRecords)
    .where(
      and(
        eq(knowledgeRecords.workspaceId, input.workspaceId),
        isNotNull(knowledgeRecords.projectId),
        ne(knowledgeRecords.projectId, input.projectId),
        or(
          inArray(knowledgeRecords.systemId, candidateSystemIds),
          inArray(knowledgeRecords.supersedesRecordId, inScopeRecordIds),
        ),
      ),
    );

  const versionRows = await db
    .select({
      id: knowledgeRecordVersions.id,
      createdBy: knowledgeRecordVersions.createdBy,
      knowledgeRecordId: knowledgeRecordVersions.knowledgeRecordId,
    })
    .from(knowledgeRecordVersions)
    .where(inArray(knowledgeRecordVersions.knowledgeRecordId, inScopeRecordIds));

  const knowledgeLinks = await db
    .select({
      id: knowledgeRecordDeliveryLinks.id,
      createdBy: knowledgeRecordDeliveryLinks.createdBy,
      knowledgeRecordId: knowledgeRecordDeliveryLinks.knowledgeRecordId,
      entityType: knowledgeRecordDeliveryLinks.entityType,
      entityId: knowledgeRecordDeliveryLinks.entityId,
    })
    .from(knowledgeRecordDeliveryLinks)
    .where(
      or(
        inArray(knowledgeRecordDeliveryLinks.knowledgeRecordId, inScopeRecordIds),
        and(
          eq(knowledgeRecordDeliveryLinks.entityType, 'epic'),
          inArray(knowledgeRecordDeliveryLinks.entityId, projectEpicIds),
        ),
        and(
          eq(knowledgeRecordDeliveryLinks.entityType, 'user_story'),
          inArray(knowledgeRecordDeliveryLinks.entityId, projectStoryIds),
        ),
        and(
          eq(knowledgeRecordDeliveryLinks.entityType, 'task'),
          inArray(knowledgeRecordDeliveryLinks.entityId, projectTaskIds),
        ),
        and(
          eq(knowledgeRecordDeliveryLinks.entityType, 'sprint'),
          inArray(knowledgeRecordDeliveryLinks.entityId, projectSprintIds),
        ),
      ),
    );

  const raidColumns = {
    id: projectRaidItems.id,
    createdBy: projectRaidItems.createdBy,
    projectId: projectRaidItems.projectId,
    transferredToRaidItemId: projectRaidItems.transferredToRaidItemId,
    transferredFromRaidItemId: projectRaidItems.transferredFromRaidItemId,
  };
  const raidRows = await db
    .select(raidColumns)
    .from(projectRaidItems)
    .where(eq(projectRaidItems.projectId, input.projectId));
  const foreignRaidRows = await db
    .select(raidColumns)
    .from(projectRaidItems)
    .where(
      and(
        ne(projectRaidItems.projectId, input.projectId),
        or(
          inArray(projectRaidItems.transferredToRaidItemId, projectRaidIds),
          inArray(projectRaidItems.transferredFromRaidItemId, projectRaidIds),
        ),
      ),
    );
  const raidLinks = await db
    .select({
      id: projectRaidTaskLinks.id,
      createdBy: projectRaidTaskLinks.createdBy,
      raidItemId: projectRaidTaskLinks.raidItemId,
      taskId: projectRaidTaskLinks.taskId,
    })
    .from(projectRaidTaskLinks)
    .where(
      or(
        inArray(projectRaidTaskLinks.raidItemId, projectRaidIds),
        inArray(projectRaidTaskLinks.taskId, projectTaskIds),
      ),
    );

  const changeColumns = {
    id: projectChangeItems.id,
    createdBy: projectChangeItems.createdBy,
    projectId: projectChangeItems.projectId,
    knowledgeRecordId: projectChangeItems.knowledgeRecordId,
  };
  const changeRows = await db
    .select(changeColumns)
    .from(projectChangeItems)
    .where(eq(projectChangeItems.projectId, input.projectId));
  const foreignChangeRows = await db
    .select(changeColumns)
    .from(projectChangeItems)
    .where(
      and(
        ne(projectChangeItems.projectId, input.projectId),
        inArray(projectChangeItems.knowledgeRecordId, inScopeRecordIds),
      ),
    );
  const changeLinks = await db
    .select({
      id: projectChangeDeliveryLinks.id,
      createdBy: projectChangeDeliveryLinks.createdBy,
      changeId: projectChangeDeliveryLinks.changeId,
      entityType: projectChangeDeliveryLinks.entityType,
      entityId: projectChangeDeliveryLinks.entityId,
    })
    .from(projectChangeDeliveryLinks)
    .where(
      or(
        inArray(projectChangeDeliveryLinks.changeId, projectChangeIds),
        and(
          eq(projectChangeDeliveryLinks.entityType, 'epic'),
          inArray(projectChangeDeliveryLinks.entityId, projectEpicIds),
        ),
        and(
          eq(projectChangeDeliveryLinks.entityType, 'user_story'),
          inArray(projectChangeDeliveryLinks.entityId, projectStoryIds),
        ),
        and(
          eq(projectChangeDeliveryLinks.entityType, 'milestone'),
          inArray(projectChangeDeliveryLinks.entityId, projectMilestoneIds),
        ),
        and(
          eq(projectChangeDeliveryLinks.entityType, 'task'),
          inArray(projectChangeDeliveryLinks.entityId, projectTaskIds),
        ),
      ),
    );

  const mediaRows = await db
    .select({
      id: workspaceMedia.id,
      createdBy: workspaceMedia.createdBy,
      workspaceId: workspaceMedia.workspaceId,
      knowledgeRecordId: workspaceMedia.knowledgeRecordId,
    })
    .from(workspaceMedia)
    .where(
      and(
        eq(workspaceMedia.workspaceId, input.workspaceId),
        or(
          eq(workspaceMedia.createdBy, input.systemUserId),
          inArray(workspaceMedia.knowledgeRecordId, inScopeRecordIds),
        ),
      ),
    );
  const mediaImportRefs = await db
    .select({
      mediaId: documentImportMedia.workspaceMediaId,
      importCreatedBy: documentImports.createdBy,
      projectId: documentImports.projectId,
    })
    .from(documentImportMedia)
    .innerJoin(
      documentImports,
      eq(documentImportMedia.importId, documentImports.id),
    )
    .where(
      inArray(
        documentImportMedia.workspaceMediaId,
        db
          .select({ id: workspaceMedia.id })
          .from(workspaceMedia)
          .where(
            and(
              eq(workspaceMedia.workspaceId, input.workspaceId),
              eq(workspaceMedia.createdBy, input.systemUserId),
            ),
          ),
      ),
    );

  const documentRecordImportRefs = await db
    .select({
      knowledgeRecordId: documentImportRecords.knowledgeRecordId,
      importCreatedBy: documentImports.createdBy,
      projectId: documentImports.projectId,
    })
    .from(documentImportRecords)
    .innerJoin(
      documentImports,
      eq(documentImportRecords.importId, documentImports.id),
    )
    .where(inArray(documentImportRecords.knowledgeRecordId, inScopeRecordIds));
  const conversationRecordImportRefs = await db
    .select({
      knowledgeRecordId: conversationImportRecords.knowledgeRecordId,
      importCreatedBy: conversationImports.createdBy,
      projectId: conversationImports.projectId,
    })
    .from(conversationImportRecords)
    .innerJoin(
      conversationImports,
      eq(conversationImportRecords.importId, conversationImports.id),
    )
    .where(
      inArray(conversationImportRecords.knowledgeRecordId, inScopeRecordIds),
    );

  const documentSystemRefs = await db
    .select({
      systemId: documentImports.systemId,
      sourceId: documentImports.id,
      projectId: documentImports.projectId,
    })
    .from(documentImports)
    .where(
      and(
        eq(documentImports.workspaceId, input.workspaceId),
        inArray(documentImports.systemId, candidateSystemIds),
      ),
    );
  const conversationSystemRefs = await db
    .select({
      systemId: conversationImports.systemId,
      sourceId: conversationImports.id,
      projectId: conversationImports.projectId,
    })
    .from(conversationImports)
    .where(
      and(
        eq(conversationImports.workspaceId, input.workspaceId),
        inArray(conversationImports.systemId, candidateSystemIds),
      ),
    );

  const pointerRows = await db
    .select({
      id: projects.id,
      charterRecordId: projects.charterRecordId,
      initialPlanRecordId: projects.initialPlanRecordId,
    })
    .from(projects)
    .where(
      and(
        eq(projects.workspaceId, input.workspaceId),
        or(
          inArray(projects.charterRecordId, inScopeRecordIds),
          inArray(projects.initialPlanRecordId, inScopeRecordIds),
        ),
      ),
    );
  const projectPointers: NonNullable<SystemUserPurgeSnapshot['projectPointers']> =
    [];
  for (const row of pointerRows) {
    if (row.charterRecordId) {
      projectPointers.push({
        projectId: row.id,
        field: 'charterRecordId',
        recordId: row.charterRecordId,
      });
    }
    if (row.initialPlanRecordId) {
      projectPointers.push({
        projectId: row.id,
        field: 'initialPlanRecordId',
        recordId: row.initialPlanRecordId,
      });
    }
  }

  const tagRows = await db
    .select({
      id: tags.id,
      createdBy: tags.createdBy,
      organizationId: tags.organizationId,
    })
    .from(tags)
    .where(eq(tags.organizationId, input.organizationId));
  const projectTagLinks = await db
    .select({
      tagId: projectTags.tagId,
      ownerId: projectTags.projectId,
    })
    .from(projectTags)
    .where(inArray(projectTags.tagId, systemTagIds));
  const systemTagLinks = await db
    .select({
      tagId: systemTags.tagId,
      ownerId: systemTags.systemId,
      ownerProjectId: systems.projectId,
    })
    .from(systemTags)
    .innerJoin(systems, eq(systemTags.systemId, systems.id))
    .where(inArray(systemTags.tagId, systemTagIds));
  const recordTagLinks = await db
    .select({
      tagId: knowledgeRecordTags.tagId,
      ownerId: knowledgeRecordTags.knowledgeRecordId,
      ownerProjectId: knowledgeRecords.projectId,
    })
    .from(knowledgeRecordTags)
    .innerJoin(
      knowledgeRecords,
      eq(knowledgeRecordTags.knowledgeRecordId, knowledgeRecords.id),
    )
    .where(inArray(knowledgeRecordTags.tagId, systemTagIds));

  const storyColumns = {
    id: projectUserStories.id,
    createdBy: projectUserStories.createdBy,
    projectId: projectUserStories.projectId,
    epicId: projectUserStories.epicId,
  };
  const storyRows = await db
    .select(storyColumns)
    .from(projectUserStories)
    .where(eq(projectUserStories.projectId, input.projectId));
  const foreignStoryRows = await db
    .select(storyColumns)
    .from(projectUserStories)
    .where(
      and(
        ne(projectUserStories.projectId, input.projectId),
        inArray(projectUserStories.epicId, projectEpicIds),
      ),
    );

  return {
    systemUserId: input.systemUserId,
    projectId: input.projectId,
    workspaceId: input.workspaceId,
    organizationId: input.organizationId,
    tasks: dedupeById([...projectTaskRows, ...foreignTaskRows]),
    sprints: await db
      .select({
        id: projectSprints.id,
        createdBy: projectSprints.createdBy,
        projectId: projectSprints.projectId,
      })
      .from(projectSprints)
      .where(eq(projectSprints.projectId, input.projectId)),
    epics: await db
      .select({
        id: projectEpics.id,
        createdBy: projectEpics.createdBy,
        projectId: projectEpics.projectId,
      })
      .from(projectEpics)
      .where(eq(projectEpics.projectId, input.projectId)),
    userStories: dedupeById([...storyRows, ...foreignStoryRows]),
    milestones: await db
      .select({
        id: projectMilestones.id,
        createdBy: projectMilestones.createdBy,
        projectId: projectMilestones.projectId,
      })
      .from(projectMilestones)
      .where(eq(projectMilestones.projectId, input.projectId)),
    raidItems: dedupeById([...raidRows, ...foreignRaidRows]),
    changeItems: dedupeById([...changeRows, ...foreignChangeRows]),
    activities: activityRows.map((row) => ({
      id: row.id,
      actorUserId: row.actorUserId,
      taskId: row.taskId,
      type: row.type,
      fields: activityFields(row.metadataJson),
      ...activityPrevious(row.metadataJson),
      createdAt: row.createdAt.toISOString(),
    })),
    raci: raciRows,
    stakeholders: await db
      .select({
        id: projectStakeholders.id,
        createdBy: projectStakeholders.createdBy,
        projectId: projectStakeholders.projectId,
      })
      .from(projectStakeholders)
      .where(eq(projectStakeholders.projectId, input.projectId)),
    initialStakeholders: await db
      .select({
        id: projectInitialStakeholders.id,
        createdBy: projectInitialStakeholders.createdBy,
        projectId: projectInitialStakeholders.projectId,
      })
      .from(projectInitialStakeholders)
      .where(eq(projectInitialStakeholders.projectId, input.projectId)),
    knowledgeDeliveryLinks: knowledgeLinks,
    changeDeliveryLinks: changeLinks,
    raidTaskLinks: raidLinks,
    knowledgeRecords: dedupeById([...inScopeRecords, ...foreignRecords]),
    knowledgeRecordVersions: versionRows,
    media: mediaRows,
    systems: await db
      .select({
        id: systems.id,
        createdBy: systems.createdBy,
        workspaceId: systems.workspaceId,
        projectId: systems.projectId,
      })
      .from(systems)
      .where(eq(systems.workspaceId, input.workspaceId)),
    tags: tagRows,
    tagLinks: [
      ...projectTagLinks.map((row) => ({
        tagId: row.tagId,
        ownerType: 'project' as const,
        ownerId: row.ownerId,
        ownerProjectId: row.ownerId,
      })),
      ...systemTagLinks.map((row) => ({
        tagId: row.tagId,
        ownerType: 'system' as const,
        ownerId: row.ownerId,
        ownerProjectId: row.ownerProjectId,
      })),
      ...recordTagLinks.map((row) => ({
        tagId: row.tagId,
        ownerType: 'knowledge_record' as const,
        ownerId: row.ownerId,
        ownerProjectId: row.ownerProjectId,
      })),
    ],
    mediaImportRefs,
    recordImportRefs: [
      ...documentRecordImportRefs.map((row) => ({
        knowledgeRecordId: row.knowledgeRecordId,
        importCreatedBy: row.importCreatedBy,
        projectId: row.projectId,
        kind: 'document_import' as const,
      })),
      ...conversationRecordImportRefs.map((row) => ({
        knowledgeRecordId: row.knowledgeRecordId,
        importCreatedBy: row.importCreatedBy,
        projectId: row.projectId,
        kind: 'conversation_import' as const,
      })),
    ],
    projectPointers,
    importSystemRefs: [
      ...documentSystemRefs.flatMap((row) =>
        row.systemId
          ? [{
              systemId: row.systemId,
              sourceId: row.sourceId,
              projectId: row.projectId,
              kind: 'document_import' as const,
            }]
          : [],
      ),
      ...conversationSystemRefs.flatMap((row) =>
        row.systemId
          ? [{
              systemId: row.systemId,
              sourceId: row.sourceId,
              projectId: row.projectId,
              kind: 'conversation_import' as const,
            }]
          : [],
      ),
    ],
  };
}

function detachIds(
  detaches: PurgeDetach[],
  entityType: PurgeDetach['entityType'],
  field: string,
): string[] {
  return detaches
    .filter((row) => row.entityType === entityType && row.field === field)
    .map((row) => row.entityId);
}

async function runIfIds(
  idList: string[],
  apply: (ids: string[]) => Promise<unknown>,
): Promise<void> {
  if (idList.length === 0) return;
  await apply(idList);
}

export async function applySystemUserPurge(
  db: QueryDb,
  plan: SystemUserPurgePlan,
): Promise<void> {
  const now = new Date();
  const { deleteIds: del, detaches } = plan;

  for (const restore of plan.aiRestores) {
    const values: {
      tokensUsed?: number | null;
      aiSystemId?: string | null;
      updatedAt: Date;
    } = { updatedAt: now };
    if ('tokensUsed' in restore) values.tokensUsed = restore.tokensUsed ?? null;
    if ('aiSystemId' in restore) values.aiSystemId = restore.aiSystemId ?? null;
    await db
      .update(projectTasks)
      .set(values)
      .where(eq(projectTasks.id, restore.taskId));
  }

  await runIfIds(detachIds(detaches, 'task', 'milestoneId'), async (idList) => {
    await db
      .update(projectTasks)
      .set({ milestoneId: null, updatedAt: now })
      .where(inArray(projectTasks.id, idList));
  });
  await runIfIds(detachIds(detaches, 'task', 'userStoryId'), async (idList) => {
    await db
      .update(projectTasks)
      .set({ userStoryId: null, updatedAt: now })
      .where(inArray(projectTasks.id, idList));
  });
  await runIfIds(detachIds(detaches, 'task', 'sprintId'), async (idList) => {
    await db
      .update(projectTasks)
      .set({ sprintId: null, updatedAt: now })
      .where(inArray(projectTasks.id, idList));
  });
  await runIfIds(detachIds(detaches, 'task', 'aiSystemId'), async (idList) => {
    await db
      .update(projectTasks)
      .set({ aiSystemId: null, updatedAt: now })
      .where(inArray(projectTasks.id, idList));
  });
  await runIfIds(detachIds(detaches, 'project', 'charterRecordId'), async (idList) => {
    await db
      .update(projects)
      .set({ charterRecordId: null, updatedAt: now })
      .where(inArray(projects.id, idList));
  });
  await runIfIds(
    detachIds(detaches, 'project', 'initialPlanRecordId'),
    async (idList) => {
      await db
        .update(projects)
        .set({ initialPlanRecordId: null, updatedAt: now })
        .where(inArray(projects.id, idList));
    },
  );
  await runIfIds(detachIds(detaches, 'document_import', 'systemId'), async (idList) => {
    await db
      .update(documentImports)
      .set({ systemId: null, updatedAt: now })
      .where(inArray(documentImports.id, idList));
  });
  await runIfIds(
    detachIds(detaches, 'conversation_import', 'systemId'),
    async (idList) => {
      await db
        .update(conversationImports)
        .set({ systemId: null, updatedAt: now })
        .where(inArray(conversationImports.id, idList));
    },
  );

  await runIfIds(detachIds(detaches, 'knowledge_record', 'systemId'), async (idList) => {
    await db
      .update(knowledgeRecords)
      .set({ systemId: null, updatedAt: now })
      .where(inArray(knowledgeRecords.id, idList));
  });
  await runIfIds(
    detachIds(detaches, 'knowledge_record', 'supersedesRecordId'),
    async (idList) => {
      await db
        .update(knowledgeRecords)
        .set({ supersedesRecordId: null, updatedAt: now })
        .where(inArray(knowledgeRecords.id, idList));
    },
  );
  await runIfIds(
    detachIds(detaches, 'knowledge_record', 'translationGroupId'),
    async (idList) => {
      await db
        .update(knowledgeRecords)
        .set({ translationGroupId: null, updatedAt: now })
        .where(inArray(knowledgeRecords.id, idList));
    },
  );

  await runIfIds(
    detachIds(detaches, 'change_item', 'knowledgeRecordId'),
    async (idList) => {
      await db
        .update(projectChangeItems)
        .set({ knowledgeRecordId: null, updatedAt: now })
        .where(inArray(projectChangeItems.id, idList));
    },
  );
  await runIfIds(
    detachIds(detaches, 'raid_item', 'transferredToRaidItemId'),
    async (idList) => {
      await db
        .update(projectRaidItems)
        .set({ transferredToRaidItemId: null, updatedAt: now })
        .where(inArray(projectRaidItems.id, idList));
    },
  );
  await runIfIds(
    detachIds(detaches, 'raid_item', 'transferredFromRaidItemId'),
    async (idList) => {
      await db
        .update(projectRaidItems)
        .set({ transferredFromRaidItemId: null, updatedAt: now })
        .where(inArray(projectRaidItems.id, idList));
    },
  );
  await runIfIds(
    detachIds(detaches, 'media', 'knowledgeRecordId'),
    async (idList) => {
      await db
        .update(workspaceMedia)
        .set({ knowledgeRecordId: null })
        .where(inArray(workspaceMedia.id, idList));
    },
  );

  // Skipped tags are not in del.tags, so joins outside the project stay.
  if (del.tags.length > 0) {
    await db.delete(projectTags).where(inArray(projectTags.tagId, del.tags));
    await db.delete(systemTags).where(inArray(systemTags.tagId, del.tags));
    await db
      .delete(knowledgeRecordTags)
      .where(inArray(knowledgeRecordTags.tagId, del.tags));
  }

  const activityIds = [
    ...del.comments,
    ...del.activities,
    ...del.aiUsageReports,
  ];
  await runIfIds(activityIds, async (idList) => {
    await db
      .delete(projectTaskActivities)
      .where(inArray(projectTaskActivities.id, idList));
  });
  await runIfIds(del.raci, async (idList) => {
    await db.delete(projectTaskRaci).where(inArray(projectTaskRaci.id, idList));
  });
  await runIfIds(del.knowledgeDeliveryLinks, async (idList) => {
    await db
      .delete(knowledgeRecordDeliveryLinks)
      .where(inArray(knowledgeRecordDeliveryLinks.id, idList));
  });
  await runIfIds(del.changeDeliveryLinks, async (idList) => {
    await db
      .delete(projectChangeDeliveryLinks)
      .where(inArray(projectChangeDeliveryLinks.id, idList));
  });
  await runIfIds(del.raidTaskLinks, async (idList) => {
    await db
      .delete(projectRaidTaskLinks)
      .where(inArray(projectRaidTaskLinks.id, idList));
  });

  await runIfIds(del.tasks, async (idList) => {
    await db.delete(projectTasks).where(inArray(projectTasks.id, idList));
  });
  await runIfIds(del.userStories, async (idList) => {
    await db
      .delete(projectUserStories)
      .where(inArray(projectUserStories.id, idList));
  });
  await runIfIds(del.epics, async (idList) => {
    await db.delete(projectEpics).where(inArray(projectEpics.id, idList));
  });
  await runIfIds(del.sprints, async (idList) => {
    await db.delete(projectSprints).where(inArray(projectSprints.id, idList));
  });
  await runIfIds(del.milestones, async (idList) => {
    await db
      .delete(projectMilestones)
      .where(inArray(projectMilestones.id, idList));
  });
  await runIfIds(del.raidItems, async (idList) => {
    await db.delete(projectRaidItems).where(inArray(projectRaidItems.id, idList));
  });
  await runIfIds(del.changeItems, async (idList) => {
    await db
      .delete(projectChangeItems)
      .where(inArray(projectChangeItems.id, idList));
  });
  await runIfIds(del.stakeholders, async (idList) => {
    await db
      .delete(projectStakeholders)
      .where(inArray(projectStakeholders.id, idList));
  });
  await runIfIds(del.initialStakeholders, async (idList) => {
    await db
      .delete(projectInitialStakeholders)
      .where(inArray(projectInitialStakeholders.id, idList));
  });

  await runIfIds(del.knowledgeRecordVersions, async (idList) => {
    await db
      .delete(knowledgeRecordVersions)
      .where(inArray(knowledgeRecordVersions.id, idList));
  });
  await runIfIds(del.knowledgeRecords, async (idList) => {
    await db
      .delete(knowledgeRecords)
      .where(inArray(knowledgeRecords.id, idList));
  });
  await runIfIds(del.media, async (idList) => {
    await db.delete(workspaceMedia).where(inArray(workspaceMedia.id, idList));
  });
  await runIfIds(del.systems, async (idList) => {
    await db.delete(systems).where(inArray(systems.id, idList));
  });
  await runIfIds(del.tags, async (idList) => {
    await db.delete(tags).where(inArray(tags.id, idList));
  });
}

export type SystemUserPurgeResult = {
  dryRun: boolean;
  committed: boolean;
  systemUserId: string;
  projectId: string;
  counts: PurgeCounts;
  conflicts: PurgeConflict[];
  detaches: PurgeDetach[];
  skippedSharedItems: PurgeSkippedItem[];
  unrecoverableAiUsage: PurgeUnrecoverable[];
  issueKeysReclaimed: false;
  aggregates: {
    budgetSummary: 'computed_on_read';
    sprintBurndown: 'computed_on_read';
    velocity: 'computed_on_read';
    costSnapshotRefreshed: boolean;
  };
  mediaStorageFailures: number;
};

function auditMetadata(
  result: Pick<
    SystemUserPurgeResult,
    | 'dryRun'
    | 'committed'
    | 'projectId'
    | 'counts'
    | 'conflicts'
    | 'skippedSharedItems'
    | 'unrecoverableAiUsage'
  >,
): Record<string, unknown> {
  return {
    projectId: result.projectId,
    dryRun: result.dryRun,
    committed: result.committed,
    counts: result.counts,
    conflictCount: result.conflicts.length,
    conflicts: result.conflicts,
    skippedSharedItems: result.skippedSharedItems,
    unrecoverableAiUsage: result.unrecoverableAiUsage,
    issueKeysReclaimed: false,
  };
}

function isSerializationFailure(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    if ((current as { code?: unknown }).code === '40001') return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

function purgeConflictError(plan: SystemUserPurgePlan): AppError {
  return new AppError({
    code: 'PURGE_CONFLICT',
    message:
      'Purge refused because rows the system user did not create still reference the delete set',
    statusCode: 409,
    details: {
      counts: plan.counts,
      conflicts: plan.conflicts,
      detaches: plan.detaches,
      skippedSharedItems: plan.skippedSharedItems,
      unrecoverableAiUsage: plan.unrecoverableAiUsage,
    },
  });
}

export async function runSystemUserPurge(
  database: Database,
  input: {
    systemUserId: string;
    projectId: string;
    workspaceId: string;
    organizationId: string | null;
    dryRun: boolean;
    actorUserId: string;
    ipAddress?: string | null;
    deleteMedia?: (
      media: { id: string; workspaceId: string },
    ) => Promise<number | void>;
    refreshCostSnapshot?: (
      database: Database,
      projectId: string,
    ) => Promise<unknown>;
    log?: { error: (obj: unknown, msg?: string) => void };
  },
): Promise<SystemUserPurgeResult> {
  const scope = {
    systemUserId: input.systemUserId,
    projectId: input.projectId,
    workspaceId: input.workspaceId,
    organizationId: input.organizationId ?? '',
  };

  const preview = planSystemUserPurge(
    await loadSystemUserPurgeSnapshot(database.db, scope),
  );
  const decision = purgeCommitDecision({
    dryRun: input.dryRun,
    conflictCount: preview.conflicts.length,
  });

  const aggregatesRead = {
    budgetSummary: 'computed_on_read' as const,
    sprintBurndown: 'computed_on_read' as const,
    velocity: 'computed_on_read' as const,
  };

  const writeAudit = async (
    plan: SystemUserPurgePlan,
    committed: boolean,
    tx?: { insert: Database['db']['insert'] },
  ) => {
    const values = {
      organizationId: input.organizationId,
      actorType: 'user' as const,
      actorId: input.actorUserId,
      action: 'admin.system_user_purge',
      entityType: 'user' as const,
      entityId: input.systemUserId,
      metadataJson: auditMetadata({
        dryRun: input.dryRun,
        committed,
        projectId: input.projectId,
        counts: plan.counts,
        conflicts: plan.conflicts,
        skippedSharedItems: plan.skippedSharedItems,
        unrecoverableAiUsage: plan.unrecoverableAiUsage,
      }),
      ipAddress: input.ipAddress ?? null,
    };
    if (tx) await tx.insert(auditEvents).values(values);
    else await database.db.insert(auditEvents).values(values);
  };

  if (decision !== 'commit') {
    await writeAudit(preview, false);
    if (decision === 'refuse_conflicts') throw purgeConflictError(preview);
    return {
      dryRun: true,
      committed: false,
      systemUserId: input.systemUserId,
      projectId: input.projectId,
      counts: preview.counts,
      conflicts: preview.conflicts,
      detaches: preview.detaches,
      skippedSharedItems: preview.skippedSharedItems,
      unrecoverableAiUsage: preview.unrecoverableAiUsage,
      issueKeysReclaimed: false,
      aggregates: { ...aggregatesRead, costSnapshotRefreshed: false },
      mediaStorageFailures: 0,
    };
  }

  let committedPlan: SystemUserPurgePlan | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let refusedPlan: SystemUserPurgePlan | null = null;
    try {
      committedPlan = await database.db.transaction(
        async (tx) => {
          const plan = planSystemUserPurge(
            await loadSystemUserPurgeSnapshot(tx as unknown as QueryDb, scope),
          );
          if (plan.conflicts.length > 0) {
            refusedPlan = plan;
            throw purgeConflictError(plan);
          }
          await applySystemUserPurge(tx as unknown as QueryDb, plan);
          await writeAudit(plan, true, tx);
          return plan;
        },
        { isolationLevel: 'serializable' },
      );
      break;
    } catch (error) {
      if (refusedPlan) {
        await writeAudit(refusedPlan, false);
        throw purgeConflictError(refusedPlan);
      }
      if (!isSerializationFailure(error) || attempt === 1) throw error;
    }
  }
  if (!committedPlan) {
    throw new AppError({
      code: 'PURGE_FAILED',
      message: 'Purge did not commit',
      statusCode: 500,
    });
  }

  let costSnapshotRefreshed = false;
  try {
    await (input.refreshCostSnapshot ?? upsertProjectCostSnapshot)(
      database,
      input.projectId,
    );
    costSnapshotRefreshed = true;
  } catch (error) {
    input.log?.error({ err: error }, 'Purge cost snapshot refresh failed');
  }

  let mediaStorageFailures = 0;
  if (input.deleteMedia) {
    for (const mediaId of committedPlan.deleteIds.media) {
      try {
        const reported = await input.deleteMedia({
          id: mediaId,
          workspaceId: input.workspaceId,
        });
        if (typeof reported === 'number') mediaStorageFailures += reported;
      } catch (error) {
        mediaStorageFailures += 1;
        input.log?.error(
          { err: error, mediaId },
          'Purge media storage delete failed',
        );
      }
    }
  }

  return {
    dryRun: false,
    committed: true,
    systemUserId: input.systemUserId,
    projectId: input.projectId,
    counts: committedPlan.counts,
    conflicts: committedPlan.conflicts,
    detaches: committedPlan.detaches,
    skippedSharedItems: committedPlan.skippedSharedItems,
    unrecoverableAiUsage: committedPlan.unrecoverableAiUsage,
    issueKeysReclaimed: false,
    aggregates: { ...aggregatesRead, costSnapshotRefreshed },
    mediaStorageFailures,
  };
}

export async function loadPurgeProjectContext(
  database: Database,
  projectId: string,
): Promise<{
  id: string;
  workspaceId: string;
  organizationId: string;
} | null> {
  const [row] = await database.db
    .select({
      id: projects.id,
      workspaceId: projects.workspaceId,
      organizationId: workspaces.organizationId,
    })
    .from(projects)
    .innerJoin(workspaces, eq(projects.workspaceId, workspaces.id))
    .where(eq(projects.id, projectId))
    .limit(1);
  return row ?? null;
}

export async function loadPurgeUser(
  database: Database,
  userId: string,
): Promise<{ id: string; userType: string } | null> {
  const [row] = await database.db
    .select({ id: users.id, userType: users.userType })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row ?? null;
}

