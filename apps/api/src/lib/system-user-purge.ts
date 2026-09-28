import { eq, inArray } from 'drizzle-orm';
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
 * Conflict strategy: all-or-nothing. Nullable FKs from real rows onto
 * system-owned rows are detached (set null). Tag joins are detached.
 * A cascade that would remove a row the system user did not create
 * (human story under a system epic, human comment on a system task,
 * human version, human delivery link, media still used by a real record)
 * is a conflict and the purge writes nothing.
 *
 * Issue-key counters are not reclaimed. Budget summary, sprint burndown,
 * and velocity are computed on read. The daily cost snapshot for today is
 * refreshed after a committed purge; older snapshots stay historical.
 * Project charter and initial-plan pointers are nullable and set null by
 * the database if they referenced a deleted record.
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
    | 'tag_link';
  entityId: string;
  field: string;
  tagId?: string;
  ownerType?: 'project' | 'system' | 'knowledge_record';
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
  }>;
  raci: Array<{ id: string; createdBy: string | null; taskId: string }>;
  stakeholders: Array<{
    id: string;
    createdBy: string | null;
    projectId: string;
  }>;
  knowledgeDeliveryLinks: Array<{
    id: string;
    createdBy: string | null;
    knowledgeRecordId: string;
  }>;
  changeDeliveryLinks: Array<{
    id: string;
    createdBy: string | null;
    changeId: string;
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
  }>;
  mediaImportRefs: Array<{ mediaId: string; importCreatedBy: string }>;
  recordImportRefs: Array<{
    knowledgeRecordId: string;
    importCreatedBy: string;
    kind: 'document_import' | 'conversation_import';
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

/** Dry-run never writes. Conflicts block a real purge. Otherwise commit. */
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

  const tasks = inProject(snapshot.tasks).filter((row) => owned(row.createdBy));
  const sprints = inProject(snapshot.sprints).filter((row) =>
    owned(row.createdBy),
  );
  const epics = inProject(snapshot.epics).filter((row) => owned(row.createdBy));
  const userStories = inProject(snapshot.userStories).filter((row) =>
    owned(row.createdBy),
  );
  const milestones = inProject(snapshot.milestones).filter((row) =>
    owned(row.createdBy),
  );
  const raidItems = inProject(snapshot.raidItems).filter((row) =>
    owned(row.createdBy),
  );
  const changeItems = inProject(snapshot.changeItems).filter((row) =>
    owned(row.createdBy),
  );
  const stakeholders = inProject(snapshot.stakeholders).filter((row) =>
    owned(row.createdBy),
  );

  const taskIds = ids(tasks);
  const sprintIds = ids(sprints);
  const epicIds = ids(epics);
  const storyIds = ids(userStories);
  const milestoneIds = ids(milestones);
  const raidIds = ids(raidItems);
  const changeIds = ids(changeItems);

  const projectTaskIds = ids(inProject(snapshot.tasks));

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

  const records = snapshot.knowledgeRecords.filter(
    (row) =>
      row.workspaceId === snapshot.workspaceId &&
      (row.projectId === null || row.projectId === projectId) &&
      owned(row.createdBy),
  );
  const recordIds = ids(records);

  const versions: string[] = [];
  for (const version of snapshot.knowledgeRecordVersions) {
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
    if (!parentDeleted && owned(version.createdBy)) {
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
    if (
      recordIds.has(ref.knowledgeRecordId) &&
      ref.importCreatedBy !== systemUserId
    ) {
      conflicts.push({
        entityType: ref.kind,
        entityId: ref.knowledgeRecordId,
        reason:
          'An import the system user did not create links this record. Deleting the record would remove that link.',
      });
    }
  }

  const knowledgeDeliveryLinks: string[] = [];
  for (const link of snapshot.knowledgeDeliveryLinks) {
    const parentDeleted = recordIds.has(link.knowledgeRecordId);
    if (owned(link.createdBy)) {
      knowledgeDeliveryLinks.push(link.id);
      continue;
    }
    if (parentDeleted) {
      conflicts.push({
        entityType: 'knowledge_delivery_link',
        entityId: link.id,
        reason:
          'Delivery link on a system-created record was not created by that user.',
      });
    }
  }

  const changeDeliveryLinks: string[] = [];
  for (const link of snapshot.changeDeliveryLinks) {
    const parentDeleted = changeIds.has(link.changeId);
    if (owned(link.createdBy)) {
      changeDeliveryLinks.push(link.id);
      continue;
    }
    if (parentDeleted) {
      conflicts.push({
        entityType: 'change_delivery_link',
        entityId: link.id,
        reason:
          'Delivery link on a system-created change item was not created by that user.',
      });
    }
  }

  const raidTaskLinks: string[] = [];
  for (const link of snapshot.raidTaskLinks) {
    const parentDeleted =
      raidIds.has(link.raidItemId) || taskIds.has(link.taskId);
    if (owned(link.createdBy)) {
      raidTaskLinks.push(link.id);
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

  const systemRows = snapshot.systems.filter(
    (row) =>
      row.workspaceId === snapshot.workspaceId &&
      (row.projectId === null || row.projectId === projectId) &&
      owned(row.createdBy),
  );
  const systemIds = ids(systemRows);

  const mediaRows: Array<(typeof snapshot.media)[number]> = [];
  for (const row of snapshot.media) {
    if (row.workspaceId !== snapshot.workspaceId || !owned(row.createdBy)) {
      continue;
    }
    if (row.knowledgeRecordId && !recordIds.has(row.knowledgeRecordId)) {
      conflicts.push({
        entityType: 'media',
        entityId: row.id,
        reason:
          'Media created by the system user is still referenced by a knowledge record that will be kept.',
      });
      continue;
    }
    const blocked = snapshot.mediaImportRefs.some(
      (ref) =>
        ref.mediaId === row.id && ref.importCreatedBy !== systemUserId,
    );
    if (blocked) {
      conflicts.push({
        entityType: 'media',
        entityId: row.id,
        reason:
          'Media is attached to a document import the system user did not create.',
      });
      continue;
    }
    mediaRows.push(row);
  }
  const mediaIds = ids(mediaRows);

  const tagRows = snapshot.tags.filter(
    (row) =>
      row.organizationId === snapshot.organizationId && owned(row.createdBy),
  );
  const tagIds = ids(tagRows);
  for (const link of snapshot.tagLinks) {
    if (!tagIds.has(link.tagId)) continue;
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
      detaches.push({
        entityType: 'task',
        entityId: task.id,
        field: 'aiSystemId',
      });
    }
  }

  for (const record of snapshot.knowledgeRecords) {
    if (recordIds.has(record.id)) continue;
    if (record.systemId && systemIds.has(record.systemId)) {
      detaches.push({
        entityType: 'knowledge_record',
        entityId: record.id,
        field: 'systemId',
      });
    }
    if (
      record.supersedesRecordId &&
      recordIds.has(record.supersedesRecordId)
    ) {
      detaches.push({
        entityType: 'knowledge_record',
        entityId: record.id,
        field: 'supersedesRecordId',
      });
    }
  }

  const groupMembers = new Map<string, string[]>();
  for (const record of snapshot.knowledgeRecords) {
    if (!record.translationGroupId) continue;
    const list = groupMembers.get(record.translationGroupId) ?? [];
    list.push(record.id);
    groupMembers.set(record.translationGroupId, list);
  }
  const translationIds = new Set<string>();
  for (const record of records) {
    if (!record.translationGroupId) continue;
    const members = groupMembers.get(record.translationGroupId) ?? [];
    if (members.some((id) => id !== record.id)) {
      translationIds.add(record.id);
    }
  }
  for (const members of groupMembers.values()) {
    const survivors = members.filter((id) => !recordIds.has(id));
    const removed = members.some((id) => recordIds.has(id));
    const survivorId = survivors[0];
    if (removed && survivors.length === 1 && survivorId) {
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
    if (mediaIds.has(row.id)) continue;
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
  };
}

type QueryDb = Database['db'];

function activityFields(metadata: unknown): string[] {
  if (!metadata || typeof metadata !== 'object') return [];
  const fields = (metadata as { fields?: unknown }).fields;
  if (!Array.isArray(fields)) return [];
  return fields.filter((item): item is string => typeof item === 'string');
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
  const projectTasksRows = await db
    .select({
      id: projectTasks.id,
      createdBy: projectTasks.createdBy,
      projectId: projectTasks.projectId,
      milestoneId: projectTasks.milestoneId,
      userStoryId: projectTasks.userStoryId,
      sprintId: projectTasks.sprintId,
      aiSystemId: projectTasks.aiSystemId,
    })
    .from(projectTasks)
    .where(eq(projectTasks.projectId, input.projectId));

  const taskIdList = projectTasksRows.map((row) => row.id);
  const activityRows =
    taskIdList.length === 0
      ? []
      : await db
          .select({
            id: projectTaskActivities.id,
            actorUserId: projectTaskActivities.actorUserId,
            taskId: projectTaskActivities.taskId,
            type: projectTaskActivities.type,
            metadataJson: projectTaskActivities.metadataJson,
          })
          .from(projectTaskActivities)
          .where(inArray(projectTaskActivities.taskId, taskIdList));
  const raciRows =
    taskIdList.length === 0
      ? []
      : await db
          .select({
            id: projectTaskRaci.id,
            createdBy: projectTaskRaci.createdBy,
            taskId: projectTaskRaci.taskId,
          })
          .from(projectTaskRaci)
          .where(inArray(projectTaskRaci.taskId, taskIdList));

  const recordRows = await db
    .select({
      id: knowledgeRecords.id,
      createdBy: knowledgeRecords.createdBy,
      projectId: knowledgeRecords.projectId,
      workspaceId: knowledgeRecords.workspaceId,
      systemId: knowledgeRecords.systemId,
      translationGroupId: knowledgeRecords.translationGroupId,
      supersedesRecordId: knowledgeRecords.supersedesRecordId,
    })
    .from(knowledgeRecords)
    .where(eq(knowledgeRecords.workspaceId, input.workspaceId));
  const recordIdList = recordRows.map((row) => row.id);

  const versionRows =
    recordIdList.length === 0
      ? []
      : await db
          .select({
            id: knowledgeRecordVersions.id,
            createdBy: knowledgeRecordVersions.createdBy,
            knowledgeRecordId: knowledgeRecordVersions.knowledgeRecordId,
          })
          .from(knowledgeRecordVersions)
          .where(inArray(knowledgeRecordVersions.knowledgeRecordId, recordIdList));

  const knowledgeLinks =
    recordIdList.length === 0
      ? []
      : await db
          .select({
            id: knowledgeRecordDeliveryLinks.id,
            createdBy: knowledgeRecordDeliveryLinks.createdBy,
            knowledgeRecordId: knowledgeRecordDeliveryLinks.knowledgeRecordId,
          })
          .from(knowledgeRecordDeliveryLinks)
          .where(
            inArray(knowledgeRecordDeliveryLinks.knowledgeRecordId, recordIdList),
          );

  const raidRows = await db
    .select({
      id: projectRaidItems.id,
      createdBy: projectRaidItems.createdBy,
      projectId: projectRaidItems.projectId,
      transferredToRaidItemId: projectRaidItems.transferredToRaidItemId,
      transferredFromRaidItemId: projectRaidItems.transferredFromRaidItemId,
    })
    .from(projectRaidItems)
    .where(eq(projectRaidItems.projectId, input.projectId));
  const raidIdList = raidRows.map((row) => row.id);
  const raidLinks =
    raidIdList.length === 0
      ? []
      : await db
          .select({
            id: projectRaidTaskLinks.id,
            createdBy: projectRaidTaskLinks.createdBy,
            raidItemId: projectRaidTaskLinks.raidItemId,
            taskId: projectRaidTaskLinks.taskId,
          })
          .from(projectRaidTaskLinks)
          .where(inArray(projectRaidTaskLinks.raidItemId, raidIdList));

  const changeRows = await db
    .select({
      id: projectChangeItems.id,
      createdBy: projectChangeItems.createdBy,
      projectId: projectChangeItems.projectId,
      knowledgeRecordId: projectChangeItems.knowledgeRecordId,
    })
    .from(projectChangeItems)
    .where(eq(projectChangeItems.projectId, input.projectId));
  const changeIdList = changeRows.map((row) => row.id);
  const changeLinks =
    changeIdList.length === 0
      ? []
      : await db
          .select({
            id: projectChangeDeliveryLinks.id,
            createdBy: projectChangeDeliveryLinks.createdBy,
            changeId: projectChangeDeliveryLinks.changeId,
          })
          .from(projectChangeDeliveryLinks)
          .where(inArray(projectChangeDeliveryLinks.changeId, changeIdList));

  const mediaRows = await db
    .select({
      id: workspaceMedia.id,
      createdBy: workspaceMedia.createdBy,
      workspaceId: workspaceMedia.workspaceId,
      knowledgeRecordId: workspaceMedia.knowledgeRecordId,
    })
    .from(workspaceMedia)
    .where(eq(workspaceMedia.workspaceId, input.workspaceId));
  const mediaIdList = mediaRows.map((row) => row.id);
  const mediaImportRefs =
    mediaIdList.length === 0
      ? []
      : await db
          .select({
            mediaId: documentImportMedia.workspaceMediaId,
            importCreatedBy: documentImports.createdBy,
          })
          .from(documentImportMedia)
          .innerJoin(
            documentImports,
            eq(documentImportMedia.importId, documentImports.id),
          )
          .where(inArray(documentImportMedia.workspaceMediaId, mediaIdList));

  const documentRecordImportRefs =
    recordIdList.length === 0
      ? []
      : await db
          .select({
            knowledgeRecordId: documentImportRecords.knowledgeRecordId,
            importCreatedBy: documentImports.createdBy,
          })
          .from(documentImportRecords)
          .innerJoin(
            documentImports,
            eq(documentImportRecords.importId, documentImports.id),
          )
          .where(inArray(documentImportRecords.knowledgeRecordId, recordIdList));
  const conversationRecordImportRefs =
    recordIdList.length === 0
      ? []
      : await db
          .select({
            knowledgeRecordId: conversationImportRecords.knowledgeRecordId,
            importCreatedBy: conversationImports.createdBy,
          })
          .from(conversationImportRecords)
          .innerJoin(
            conversationImports,
            eq(conversationImportRecords.importId, conversationImports.id),
          )
          .where(
            inArray(conversationImportRecords.knowledgeRecordId, recordIdList),
          );

  const tagRows = await db
    .select({
      id: tags.id,
      createdBy: tags.createdBy,
      organizationId: tags.organizationId,
    })
    .from(tags)
    .where(eq(tags.organizationId, input.organizationId));
  const systemTagIds = tagRows
    .filter((row) => row.createdBy === input.systemUserId)
    .map((row) => row.id);

  const projectTagLinks =
    systemTagIds.length === 0
      ? []
      : await db
          .select({
            tagId: projectTags.tagId,
            ownerId: projectTags.projectId,
          })
          .from(projectTags)
          .where(inArray(projectTags.tagId, systemTagIds));
  const systemTagLinks =
    systemTagIds.length === 0
      ? []
      : await db
          .select({
            tagId: systemTags.tagId,
            ownerId: systemTags.systemId,
          })
          .from(systemTags)
          .where(inArray(systemTags.tagId, systemTagIds));
  const recordTagLinks =
    systemTagIds.length === 0
      ? []
      : await db
          .select({
            tagId: knowledgeRecordTags.tagId,
            ownerId: knowledgeRecordTags.knowledgeRecordId,
          })
          .from(knowledgeRecordTags)
          .where(inArray(knowledgeRecordTags.tagId, systemTagIds));

  return {
    systemUserId: input.systemUserId,
    projectId: input.projectId,
    workspaceId: input.workspaceId,
    organizationId: input.organizationId,
    tasks: projectTasksRows,
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
    userStories: await db
      .select({
        id: projectUserStories.id,
        createdBy: projectUserStories.createdBy,
        projectId: projectUserStories.projectId,
        epicId: projectUserStories.epicId,
      })
      .from(projectUserStories)
      .where(eq(projectUserStories.projectId, input.projectId)),
    milestones: await db
      .select({
        id: projectMilestones.id,
        createdBy: projectMilestones.createdBy,
        projectId: projectMilestones.projectId,
      })
      .from(projectMilestones)
      .where(eq(projectMilestones.projectId, input.projectId)),
    raidItems: raidRows,
    changeItems: changeRows,
    activities: activityRows.map((row) => ({
      id: row.id,
      actorUserId: row.actorUserId,
      taskId: row.taskId,
      type: row.type,
      fields: activityFields(row.metadataJson),
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
    knowledgeDeliveryLinks: knowledgeLinks,
    changeDeliveryLinks: changeLinks,
    raidTaskLinks: raidLinks,
    knowledgeRecords: recordRows,
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
      })),
      ...systemTagLinks.map((row) => ({
        tagId: row.tagId,
        ownerType: 'system' as const,
        ownerId: row.ownerId,
      })),
      ...recordTagLinks.map((row) => ({
        tagId: row.tagId,
        ownerType: 'knowledge_record' as const,
        ownerId: row.ownerId,
      })),
    ],
    mediaImportRefs,
    recordImportRefs: [
      ...documentRecordImportRefs.map((row) => ({
        ...row,
        kind: 'document_import' as const,
      })),
      ...conversationRecordImportRefs.map((row) => ({
        ...row,
        kind: 'conversation_import' as const,
      })),
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
    'dryRun' | 'committed' | 'projectId' | 'counts' | 'conflicts'
  >,
): Record<string, unknown> {
  return {
    projectId: result.projectId,
    dryRun: result.dryRun,
    committed: result.committed,
    counts: result.counts,
    conflictCount: result.conflicts.length,
    conflicts: result.conflicts,
    issueKeysReclaimed: false,
  };
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
    deleteMedia?: (media: { id: string; workspaceId: string }) => Promise<void>;
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

  const base = {
    dryRun: input.dryRun,
    systemUserId: input.systemUserId,
    projectId: input.projectId,
    counts: preview.counts,
    conflicts: preview.conflicts,
    detaches: preview.detaches,
    issueKeysReclaimed: false as const,
    mediaStorageFailures: 0,
  };

  if (decision !== 'commit') {
    await database.db.insert(auditEvents).values({
      organizationId: input.organizationId,
      actorType: 'user',
      actorId: input.actorUserId,
      action: 'admin.system_user_purge',
      entityType: 'user',
      entityId: input.systemUserId,
      metadataJson: auditMetadata({ ...base, committed: false }),
      ipAddress: input.ipAddress ?? null,
    });
    if (decision === 'refuse_conflicts') {
      throw new AppError({
        code: 'PURGE_CONFLICT',
        message:
          'Purge refused because rows the system user did not create still reference the delete set',
        statusCode: 409,
        details: {
          counts: preview.counts,
          conflicts: preview.conflicts,
        },
      });
    }
    return {
      ...base,
      committed: false,
      aggregates: {
        budgetSummary: 'computed_on_read',
        sprintBurndown: 'computed_on_read',
        velocity: 'computed_on_read',
        costSnapshotRefreshed: false,
      },
    };
  }

  await database.db.transaction(async (tx) => {
    const plan = planSystemUserPurge(
      await loadSystemUserPurgeSnapshot(tx as unknown as QueryDb, scope),
    );
    const again = purgeCommitDecision({
      dryRun: false,
      conflictCount: plan.conflicts.length,
    });
    if (again !== 'commit') {
      throw new AppError({
        code: 'PURGE_CONFLICT',
        message:
          'Purge refused because rows the system user did not create still reference the delete set',
        statusCode: 409,
        details: { counts: plan.counts, conflicts: plan.conflicts },
      });
    }
    await applySystemUserPurge(tx as unknown as QueryDb, plan);
    await tx.insert(auditEvents).values({
      organizationId: input.organizationId,
      actorType: 'user',
      actorId: input.actorUserId,
      action: 'admin.system_user_purge',
      entityType: 'user',
      entityId: input.systemUserId,
      metadataJson: auditMetadata({
        dryRun: false,
        committed: true,
        projectId: input.projectId,
        counts: plan.counts,
        conflicts: plan.conflicts,
      }),
      ipAddress: input.ipAddress ?? null,
    });
  });

  let costSnapshotRefreshed = false;
  try {
    await upsertProjectCostSnapshot(database, input.projectId);
    costSnapshotRefreshed = true;
  } catch (error) {
    input.log?.error({ err: error }, 'Purge cost snapshot refresh failed');
  }

  let mediaStorageFailures = 0;
  if (input.deleteMedia) {
    for (const mediaId of preview.deleteIds.media) {
      try {
        await input.deleteMedia({
          id: mediaId,
          workspaceId: input.workspaceId,
        });
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
    ...base,
    committed: true,
    aggregates: {
      budgetSummary: 'computed_on_read',
      sprintBurndown: 'computed_on_read',
      velocity: 'computed_on_read',
      costSnapshotRefreshed,
    },
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

