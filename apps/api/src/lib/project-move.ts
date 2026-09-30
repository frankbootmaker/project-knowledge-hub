import { randomUUID } from 'node:crypto';
import { and, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import type { BlobStore } from '@project-knowledge-hub/blob-store';
import {
  auditEvents,
  conversationImports,
  documentImportMedia,
  documentImports,
  gitRepositoryConnections,
  knowledgeRecordChunks,
  knowledgeRecordTags,
  knowledgeRecords,
  memberships,
  projectChangeItems,
  projectEpics,
  projectInitialStakeholders,
  projectMilestones,
  projectRaidItems,
  projectSprints,
  projectStakeholders,
  projectTags,
  projectTasks,
  projectTaskRaci,
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
import { writeAuditEvent } from './identity.js';
import {
  deleteMediaBytes,
  readMediaBytes,
  writeMediaBytes,
} from './workspace-media.js';

const MEDIA_URL = /\/api\/v1\/media\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi;

type AssignmentReason =
  | 'owner'
  | 'stakeholder'
  | 'reports_to'
  | 'initial_stakeholder'
  | 'task_owner'
  | 'raci'
  | 'raid_owner'
  | 'system_owner';

export type ProjectMoveConflict =
  | { type: 'slug'; entity: 'project' | 'system' | 'knowledge_record'; name: string; slug: string }
  | { type: 'key_prefix'; keyPrefix: string }
  | { type: 'membership'; userId: string; displayName: string; reasons: AssignmentReason[] }
  | { type: 'shared_system'; systemId: string; name: string }
  | {
      type: 'git_connection';
      provider: string;
      owner: string;
      repo: string;
      branch: string;
    };

export type ProjectMoveTagRemap = {
  slug: string;
  name: string;
  fromTagId: string;
  toTagId: string | null;
  reused: boolean;
};

export type ProjectMoveCounts = {
  systems: number;
  knowledgeRecords: number;
  chunks: number;
  gitConnections: number;
  conversationImports: number;
  documentImports: number;
  mediaMoved: number;
  mediaDuplicated: number;
  auditCopied: number;
};

export type ProjectMoveResult = {
  dryRun: boolean;
  crossOrganization: boolean;
  confirmRequired: boolean;
  project: {
    id: string;
    name: string;
    slug: string;
    workspaceId: string;
    workspaceSlug: string;
  };
  counts: ProjectMoveCounts;
  tagRemaps: ProjectMoveTagRemap[];
  conflicts: ProjectMoveConflict[];
  /** Set when an MCP client moved the project out of its organization. */
  apiClientAccess: 'unchanged' | 'left_client_organization';
};

type MoveLogger = { warn: (message: string) => void };

type PlannedMedia = {
  exclusiveIds: string[];
  duplicates: Array<{ fromId: string; toId: string; row: typeof workspaceMedia.$inferSelect }>;
};

function addReason(
  reasons: Map<string, Set<AssignmentReason>>,
  userId: string | null | undefined,
  reason: AssignmentReason,
): void {
  if (!userId) return;
  const set = reasons.get(userId) ?? new Set<AssignmentReason>();
  set.add(reason);
  reasons.set(userId, set);
}

function mediaIdsInMarkdown(markdown: string): string[] {
  const ids: string[] = [];
  for (const match of markdown.matchAll(MEDIA_URL)) {
    const id = match[1];
    if (id) ids.push(id);
  }
  return ids;
}

function rewriteMediaUrls(markdown: string, replacements: Map<string, string>): string {
  if (replacements.size === 0) return markdown;
  return markdown.replace(MEDIA_URL, (full, id: string) => {
    const next = replacements.get(id);
    return next ? `/api/v1/media/${next}` : full;
  });
}

async function loadMoveGraph(database: Database, projectId: string) {
  const [
    systemRows,
    recordRows,
    gitRows,
    conversationRows,
    documentRows,
    milestoneRows,
    epicRows,
    storyRows,
    sprintRows,
    taskRows,
    raidRows,
    changeRows,
    stakeholderRows,
    initialRows,
    raciRows,
  ] = await Promise.all([
    database.db
      .select()
      .from(systems)
      .where(eq(systems.projectId, projectId)),
    database.db
      .select()
      .from(knowledgeRecords)
      .where(eq(knowledgeRecords.projectId, projectId)),
    database.db
      .select()
      .from(gitRepositoryConnections)
      .where(eq(gitRepositoryConnections.projectId, projectId)),
    database.db
      .select({ id: conversationImports.id, systemId: conversationImports.systemId })
      .from(conversationImports)
      .where(eq(conversationImports.projectId, projectId)),
    database.db
      .select({ id: documentImports.id, systemId: documentImports.systemId })
      .from(documentImports)
      .where(eq(documentImports.projectId, projectId)),
    database.db
      .select({ id: projectMilestones.id })
      .from(projectMilestones)
      .where(eq(projectMilestones.projectId, projectId)),
    database.db
      .select({ id: projectEpics.id })
      .from(projectEpics)
      .where(eq(projectEpics.projectId, projectId)),
    database.db
      .select({ id: projectUserStories.id })
      .from(projectUserStories)
      .where(eq(projectUserStories.projectId, projectId)),
    database.db
      .select({ id: projectSprints.id })
      .from(projectSprints)
      .where(eq(projectSprints.projectId, projectId)),
    database.db
      .select({
        id: projectTasks.id,
        currentOwnerUserId: projectTasks.currentOwnerUserId,
        aiSystemId: projectTasks.aiSystemId,
      })
      .from(projectTasks)
      .where(eq(projectTasks.projectId, projectId)),
    database.db
      .select({ id: projectRaidItems.id, ownerUserId: projectRaidItems.ownerUserId })
      .from(projectRaidItems)
      .where(eq(projectRaidItems.projectId, projectId)),
    database.db
      .select({ id: projectChangeItems.id })
      .from(projectChangeItems)
      .where(eq(projectChangeItems.projectId, projectId)),
    database.db
      .select({
        id: projectStakeholders.id,
        userId: projectStakeholders.userId,
        reportsToUserId: projectStakeholders.reportsToUserId,
      })
      .from(projectStakeholders)
      .where(eq(projectStakeholders.projectId, projectId)),
    database.db
      .select({ userId: projectInitialStakeholders.userId })
      .from(projectInitialStakeholders)
      .where(eq(projectInitialStakeholders.projectId, projectId)),
    database.db
      .select({ userId: projectTaskRaci.userId })
      .from(projectTaskRaci)
      .innerJoin(projectTasks, eq(projectTaskRaci.taskId, projectTasks.id))
      .where(eq(projectTasks.projectId, projectId)),
  ]);

  const recordIds = recordRows.map((row) => row.id);
  const chunkRows =
    recordIds.length === 0
      ? []
      : await database.db
          .select({ id: knowledgeRecordChunks.id })
          .from(knowledgeRecordChunks)
          .where(inArray(knowledgeRecordChunks.knowledgeRecordId, recordIds));

  return {
    systemRows,
    recordRows,
    gitRows,
    conversationRows,
    documentRows,
    milestoneRows,
    epicRows,
    storyRows,
    sprintRows,
    taskRows,
    raidRows,
    changeRows,
    stakeholderRows,
    initialRows,
    raciRows,
    chunkCount: chunkRows.length,
  };
}

async function findConflicts(
  database: Database,
  project: typeof projects.$inferSelect,
  targetWorkspaceId: string,
  graph: Awaited<ReturnType<typeof loadMoveGraph>>,
): Promise<ProjectMoveConflict[]> {
  const conflicts: ProjectMoveConflict[] = [];

  const [slugTaken] = await database.db
    .select({ id: projects.id, name: projects.name, slug: projects.slug })
    .from(projects)
    .where(
      and(eq(projects.workspaceId, targetWorkspaceId), eq(projects.slug, project.slug)),
    )
    .limit(1);
  if (slugTaken) {
    conflicts.push({
      type: 'slug',
      entity: 'project',
      name: project.name,
      slug: project.slug,
    });
  }

  if (project.keyPrefix) {
    const [prefixTaken] = await database.db
      .select({ id: projects.id })
      .from(projects)
      .where(
        and(
          eq(projects.workspaceId, targetWorkspaceId),
          sql`upper(${projects.keyPrefix}) = ${project.keyPrefix.toUpperCase()}`,
        ),
      )
      .limit(1);
    if (prefixTaken) {
      conflicts.push({ type: 'key_prefix', keyPrefix: project.keyPrefix });
    }
  }

  const systemSlugs = graph.systemRows.map((row) => row.slug);
  if (systemSlugs.length > 0) {
    const taken = await database.db
      .select({ name: systems.name, slug: systems.slug })
      .from(systems)
      .where(
        and(eq(systems.workspaceId, targetWorkspaceId), inArray(systems.slug, systemSlugs)),
      );
    for (const row of taken) {
      conflicts.push({ type: 'slug', entity: 'system', name: row.name, slug: row.slug });
    }
  }

  const recordSlugs = graph.recordRows.map((row) => row.slug);
  if (recordSlugs.length > 0) {
    const taken = await database.db
      .select({ title: knowledgeRecords.title, slug: knowledgeRecords.slug })
      .from(knowledgeRecords)
      .where(
        and(
          eq(knowledgeRecords.workspaceId, targetWorkspaceId),
          inArray(knowledgeRecords.slug, recordSlugs),
        ),
      );
    for (const row of taken) {
      conflicts.push({
        type: 'slug',
        entity: 'knowledge_record',
        name: row.title,
        slug: row.slug,
      });
    }
  }

  for (const connection of graph.gitRows) {
    const [taken] = await database.db
      .select({ id: gitRepositoryConnections.id })
      .from(gitRepositoryConnections)
      .where(
        and(
          eq(gitRepositoryConnections.workspaceId, targetWorkspaceId),
          eq(gitRepositoryConnections.provider, connection.provider),
          eq(gitRepositoryConnections.owner, connection.owner),
          eq(gitRepositoryConnections.repo, connection.repo),
          eq(gitRepositoryConnections.branch, connection.branch),
        ),
      )
      .limit(1);
    if (taken) {
      conflicts.push({
        type: 'git_connection',
        provider: connection.provider,
        owner: connection.owner,
        repo: connection.repo,
        branch: connection.branch,
      });
    }
  }

  const movingSystemIds = graph.systemRows.map((row) => row.id);
  if (movingSystemIds.length > 0) {
    const outsideProject = or(
      isNull(knowledgeRecords.projectId),
      ne(knowledgeRecords.projectId, project.id),
    );
    const [externalRecords, externalConversations, externalDocuments, externalTasks] =
      await Promise.all([
        database.db
          .select({ systemId: knowledgeRecords.systemId })
          .from(knowledgeRecords)
          .where(and(inArray(knowledgeRecords.systemId, movingSystemIds), outsideProject)),
        database.db
          .select({ systemId: conversationImports.systemId })
          .from(conversationImports)
          .where(
            and(
              inArray(conversationImports.systemId, movingSystemIds),
              or(
                isNull(conversationImports.projectId),
                ne(conversationImports.projectId, project.id),
              ),
            ),
          ),
        database.db
          .select({ systemId: documentImports.systemId })
          .from(documentImports)
          .where(
            and(
              inArray(documentImports.systemId, movingSystemIds),
              or(
                isNull(documentImports.projectId),
                ne(documentImports.projectId, project.id),
              ),
            ),
          ),
        database.db
          .select({ systemId: projectTasks.aiSystemId })
          .from(projectTasks)
          .where(
            and(
              inArray(projectTasks.aiSystemId, movingSystemIds),
              ne(projectTasks.projectId, project.id),
            ),
          ),
      ]);
    const sharedIds = new Set<string>();
    for (const row of [
      ...externalRecords,
      ...externalConversations,
      ...externalDocuments,
      ...externalTasks,
    ]) {
      if (row.systemId) sharedIds.add(row.systemId);
    }
    for (const systemId of sharedIds) {
      const system = graph.systemRows.find((row) => row.id === systemId);
      conflicts.push({
        type: 'shared_system',
        systemId,
        name: system?.name ?? systemId,
      });
    }
  }

  const reasons = new Map<string, Set<AssignmentReason>>();
  addReason(reasons, project.ownerUserId, 'owner');
  for (const row of graph.stakeholderRows) {
    addReason(reasons, row.userId, 'stakeholder');
    addReason(reasons, row.reportsToUserId, 'reports_to');
  }
  for (const row of graph.initialRows) {
    addReason(reasons, row.userId, 'initial_stakeholder');
  }
  for (const row of graph.taskRows) {
    addReason(reasons, row.currentOwnerUserId, 'task_owner');
  }
  for (const row of graph.raciRows) {
    addReason(reasons, row.userId, 'raci');
  }
  for (const row of graph.raidRows) {
    addReason(reasons, row.ownerUserId, 'raid_owner');
  }
  for (const row of graph.systemRows) {
    addReason(reasons, row.ownerUserId, 'system_owner');
  }

  const userIds = [...reasons.keys()];
  if (userIds.length > 0) {
    const members = await database.db
      .select({ userId: memberships.userId })
      .from(memberships)
      .innerJoin(users, eq(memberships.userId, users.id))
      .where(
        and(
          eq(memberships.workspaceId, targetWorkspaceId),
          inArray(memberships.userId, userIds),
          eq(users.status, 'active'),
        ),
      );
    const memberIds = new Set(members.map((row) => row.userId));
    const missing = userIds.filter((id) => !memberIds.has(id));
    if (missing.length > 0) {
      const people = await database.db
        .select({ id: users.id, displayName: users.displayName })
        .from(users)
        .where(inArray(users.id, missing));
      const names = new Map(people.map((row) => [row.id, row.displayName]));
      for (const userId of missing) {
        conflicts.push({
          type: 'membership',
          userId,
          displayName: names.get(userId) ?? userId,
          reasons: [...(reasons.get(userId) ?? [])],
        });
      }
    }
  }

  return conflicts;
}

async function planTagRemaps(
  database: Database,
  projectId: string,
  systemIds: string[],
  recordIds: string[],
  targetOrganizationId: string,
): Promise<ProjectMoveTagRemap[]> {
  const tagIds = new Set<string>();
  const projectTagRows = await database.db
    .select({ tagId: projectTags.tagId })
    .from(projectTags)
    .where(eq(projectTags.projectId, projectId));
  for (const row of projectTagRows) tagIds.add(row.tagId);
  if (systemIds.length > 0) {
    const rows = await database.db
      .select({ tagId: systemTags.tagId })
      .from(systemTags)
      .where(inArray(systemTags.systemId, systemIds));
    for (const row of rows) tagIds.add(row.tagId);
  }
  if (recordIds.length > 0) {
    const rows = await database.db
      .select({ tagId: knowledgeRecordTags.tagId })
      .from(knowledgeRecordTags)
      .where(inArray(knowledgeRecordTags.knowledgeRecordId, recordIds));
    for (const row of rows) tagIds.add(row.tagId);
  }
  if (tagIds.size === 0) return [];

  const sourceTags = await database.db
    .select()
    .from(tags)
    .where(inArray(tags.id, [...tagIds]));
  const slugs = sourceTags.map((tag) => tag.slug);
  const destinationTags =
    slugs.length === 0
      ? []
      : await database.db
          .select()
          .from(tags)
          .where(
            and(eq(tags.organizationId, targetOrganizationId), inArray(tags.slug, slugs)),
          );
  const destBySlug = new Map(destinationTags.map((tag) => [tag.slug, tag]));

  return sourceTags.map((tag) => {
    const existing = destBySlug.get(tag.slug);
    return {
      slug: tag.slug,
      name: tag.name,
      fromTagId: tag.id,
      toTagId: existing?.id ?? null,
      reused: Boolean(existing),
    };
  });
}

async function planMedia(
  database: Database,
  projectId: string,
  recordRows: Array<{ id: string; contentMarkdown: string }>,
  documentImportIds: string[],
): Promise<PlannedMedia> {
  const movingRecordIds = new Set(recordRows.map((row) => row.id));
  const candidateIds = new Set<string>();
  for (const record of recordRows) {
    for (const id of mediaIdsInMarkdown(record.contentMarkdown)) candidateIds.add(id);
  }
  if (movingRecordIds.size > 0) {
    const linked = await database.db
      .select({ id: workspaceMedia.id })
      .from(workspaceMedia)
      .where(inArray(workspaceMedia.knowledgeRecordId, [...movingRecordIds]));
    for (const row of linked) candidateIds.add(row.id);
  }
  if (documentImportIds.length > 0) {
    const linked = await database.db
      .select({ id: documentImportMedia.workspaceMediaId })
      .from(documentImportMedia)
      .where(inArray(documentImportMedia.importId, documentImportIds));
    for (const row of linked) candidateIds.add(row.id);
  }
  if (candidateIds.size === 0) {
    return { exclusiveIds: [], duplicates: [] };
  }

  const mediaRows = await database.db
    .select()
    .from(workspaceMedia)
    .where(inArray(workspaceMedia.id, [...candidateIds]));
  const stayingMarkdown = await database.db
    .select({ id: knowledgeRecords.id, contentMarkdown: knowledgeRecords.contentMarkdown })
    .from(knowledgeRecords)
    .where(sql`${knowledgeRecords.contentMarkdown} like '%/api/v1/media/%'`);

  const sharedByMarkdown = new Set<string>();
  for (const record of stayingMarkdown) {
    if (movingRecordIds.has(record.id)) continue;
    for (const id of mediaIdsInMarkdown(record.contentMarkdown)) {
      if (candidateIds.has(id)) sharedByMarkdown.add(id);
    }
  }

  let sharedByImport = new Set<string>();
  if (candidateIds.size > 0) {
    const importLinks = await database.db
      .select({
        mediaId: documentImportMedia.workspaceMediaId,
        projectId: documentImports.projectId,
      })
      .from(documentImportMedia)
      .innerJoin(documentImports, eq(documentImportMedia.importId, documentImports.id))
      .where(inArray(documentImportMedia.workspaceMediaId, [...candidateIds]));
    sharedByImport = new Set(
      importLinks
        .filter((row) => row.projectId !== projectId)
        .map((row) => row.mediaId),
    );
  }

  const exclusiveIds: string[] = [];
  const duplicates: PlannedMedia['duplicates'] = [];
  for (const row of mediaRows) {
    const linkedElsewhere = Boolean(
      row.knowledgeRecordId && !movingRecordIds.has(row.knowledgeRecordId),
    );
    const shared =
      linkedElsewhere || sharedByMarkdown.has(row.id) || sharedByImport.has(row.id);
    if (shared) {
      duplicates.push({ fromId: row.id, toId: randomUUID(), row });
    } else {
      exclusiveIds.push(row.id);
    }
  }
  return { exclusiveIds, duplicates };
}

export async function moveProjectToWorkspace(
  database: Database,
  input: {
    projectId: string;
    targetWorkspaceId: string;
    dryRun?: boolean;
    confirmCrossOrganization?: boolean;
    actorType: 'user' | 'api_client';
    actorId: string;
    ipAddress?: string | null;
    uploadDir: string;
    blobStore?: BlobStore;
    viaMcp?: boolean;
    log?: MoveLogger;
  },
): Promise<ProjectMoveResult> {
  const dryRun = input.dryRun === true;
  const log = input.log ?? console;

  const [project] = await database.db
    .select()
    .from(projects)
    .where(eq(projects.id, input.projectId))
    .limit(1);
  if (!project) {
    throw new AppError({
      code: 'PROJECT_NOT_FOUND',
      message: 'Project not found',
      statusCode: 404,
    });
  }
  if (project.workspaceId === input.targetWorkspaceId) {
    throw new AppError({
      code: 'PROJECT_MOVE_SAME_WORKSPACE',
      message: 'The project is already in that workspace',
      statusCode: 400,
    });
  }

  const [sourceWorkspace] = await database.db
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, project.workspaceId))
    .limit(1);
  const [targetWorkspace] = await database.db
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, input.targetWorkspaceId))
    .limit(1);
  if (!sourceWorkspace || !targetWorkspace) {
    throw new AppError({
      code: 'WORKSPACE_NOT_FOUND',
      message: 'Workspace not found',
      statusCode: 404,
    });
  }
  if (targetWorkspace.archivedAt) {
    throw new AppError({
      code: 'PROJECT_MOVE_ARCHIVED_WORKSPACE',
      message: 'The destination workspace is archived',
      statusCode: 409,
    });
  }

  const crossOrganization = sourceWorkspace.organizationId !== targetWorkspace.organizationId;
  const graph = await loadMoveGraph(database, project.id);
  const conflicts = await findConflicts(database, project, targetWorkspace.id, graph);
  const tagRemaps = crossOrganization
    ? await planTagRemaps(
        database,
        project.id,
        graph.systemRows.map((row) => row.id),
        graph.recordRows.map((row) => row.id),
        targetWorkspace.organizationId,
      )
    : [];
  const mediaPlan = await planMedia(
    database,
    project.id,
    graph.recordRows,
    graph.documentRows.map((row) => row.id),
  );

  const counts: ProjectMoveCounts = {
    systems: graph.systemRows.length,
    knowledgeRecords: graph.recordRows.length,
    chunks: graph.chunkCount,
    gitConnections: graph.gitRows.length,
    conversationImports: graph.conversationRows.length,
    documentImports: graph.documentRows.length,
    mediaMoved: mediaPlan.exclusiveIds.length,
    mediaDuplicated: mediaPlan.duplicates.length,
    auditCopied: 0,
  };

  const base: ProjectMoveResult = {
    dryRun,
    crossOrganization,
    confirmRequired: crossOrganization && !input.confirmCrossOrganization,
    project: {
      id: project.id,
      name: project.name,
      slug: project.slug,
      workspaceId: dryRun ? project.workspaceId : targetWorkspace.id,
      workspaceSlug: dryRun ? sourceWorkspace.slug : targetWorkspace.slug,
    },
    counts,
    tagRemaps,
    conflicts,
    apiClientAccess:
      input.viaMcp && crossOrganization ? 'left_client_organization' : 'unchanged',
  };

  if (dryRun) {
    return {
      ...base,
      project: {
        ...base.project,
        workspaceId: targetWorkspace.id,
        workspaceSlug: targetWorkspace.slug,
      },
    };
  }
  if (conflicts.length > 0) {
    throw new AppError({
      code: 'PROJECT_MOVE_BLOCKED',
      message: 'The project cannot move until the listed conflicts are resolved',
      statusCode: 409,
      details: { conflicts },
    });
  }
  if (crossOrganization && !input.confirmCrossOrganization) {
    throw new AppError({
      code: 'PROJECT_MOVE_CONFIRM_REQUIRED',
      message:
        'Moving to another organization copies Git tokens and conversation imports. Confirm to continue.',
      statusCode: 400,
      details: {
        crossOrganization: true,
        gitConnections: counts.gitConnections,
        conversationImports: counts.conversationImports,
      },
    });
  }

  const copiedKeys: Array<{ workspaceId: string; mediaId: string }> = [];
  const copiedDuplicateToIds = new Set<string>();
  const mediaOptions = { blobStore: input.blobStore };
  try {
    for (const mediaId of mediaPlan.exclusiveIds) {
      const [row] = await database.db
        .select()
        .from(workspaceMedia)
        .where(eq(workspaceMedia.id, mediaId))
        .limit(1);
      if (!row) continue;
      const bytes = await readMediaBytes(input.uploadDir, row.workspaceId, row.id, mediaOptions);
      if (!bytes) {
        log.warn(`Project move skipped missing media bytes for ${row.id}`);
        continue;
      }
      await writeMediaBytes(input.uploadDir, targetWorkspace.id, row.id, bytes, {
        ...mediaOptions,
        contentType: row.contentType,
      });
      copiedKeys.push({ workspaceId: targetWorkspace.id, mediaId: row.id });
    }
    for (const duplicate of mediaPlan.duplicates) {
      const bytes = await readMediaBytes(
        input.uploadDir,
        duplicate.row.workspaceId,
        duplicate.fromId,
        mediaOptions,
      );
      if (!bytes) {
        log.warn(`Project move skipped missing shared media bytes for ${duplicate.fromId}`);
        continue;
      }
      await writeMediaBytes(input.uploadDir, targetWorkspace.id, duplicate.toId, bytes, {
        ...mediaOptions,
        contentType: duplicate.row.contentType,
      });
      copiedKeys.push({ workspaceId: targetWorkspace.id, mediaId: duplicate.toId });
      copiedDuplicateToIds.add(duplicate.toId);
    }

    const readyDuplicates = mediaPlan.duplicates.filter((item) =>
      copiedDuplicateToIds.has(item.toId),
    );
    const replacements = new Map(readyDuplicates.map((item) => [item.fromId, item.toId]));
    const recordIds = graph.recordRows.map((row) => row.id);
    const systemIds = graph.systemRows.map((row) => row.id);
    const movingRecordIds = new Set(recordIds);

    const auditCopied = await database.db.transaction(async (tx) => {
      await tx
        .update(projects)
        .set({ workspaceId: targetWorkspace.id, updatedAt: new Date() })
        .where(eq(projects.id, project.id));
      if (systemIds.length > 0) {
        await tx
          .update(systems)
          .set({ workspaceId: targetWorkspace.id, updatedAt: new Date() })
          .where(inArray(systems.id, systemIds));
      }
      if (recordIds.length > 0) {
        await tx
          .update(knowledgeRecords)
          .set({ workspaceId: targetWorkspace.id, updatedAt: new Date() })
          .where(inArray(knowledgeRecords.id, recordIds));
        await tx
          .update(knowledgeRecordChunks)
          .set({ workspaceId: targetWorkspace.id, updatedAt: new Date() })
          .where(inArray(knowledgeRecordChunks.knowledgeRecordId, recordIds));
      }
      if (graph.gitRows.length > 0) {
        await tx
          .update(gitRepositoryConnections)
          .set({ workspaceId: targetWorkspace.id, updatedAt: new Date() })
          .where(eq(gitRepositoryConnections.projectId, project.id));
      }
      if (graph.conversationRows.length > 0) {
        await tx
          .update(conversationImports)
          .set({ workspaceId: targetWorkspace.id, updatedAt: new Date() })
          .where(eq(conversationImports.projectId, project.id));
      }
      if (graph.documentRows.length > 0) {
        await tx
          .update(documentImports)
          .set({ workspaceId: targetWorkspace.id, updatedAt: new Date() })
          .where(eq(documentImports.projectId, project.id));
      }

      if (mediaPlan.exclusiveIds.length > 0) {
        await tx
          .update(workspaceMedia)
          .set({ workspaceId: targetWorkspace.id })
          .where(inArray(workspaceMedia.id, mediaPlan.exclusiveIds));
      }
      for (const duplicate of readyDuplicates) {
        const sourceRecordId = duplicate.row.knowledgeRecordId;
        await tx.insert(workspaceMedia).values({
          id: duplicate.toId,
          workspaceId: targetWorkspace.id,
          knowledgeRecordId:
            sourceRecordId && movingRecordIds.has(sourceRecordId) ? sourceRecordId : null,
          contentType: duplicate.row.contentType,
          byteSize: duplicate.row.byteSize,
          originalFilename: duplicate.row.originalFilename,
          altText: duplicate.row.altText,
          createdBy: duplicate.row.createdBy,
          archivedAt: duplicate.row.archivedAt,
        });
        if (sourceRecordId && movingRecordIds.has(sourceRecordId)) {
          await tx
            .update(workspaceMedia)
            .set({ knowledgeRecordId: null })
            .where(eq(workspaceMedia.id, duplicate.fromId));
        }
        if (graph.documentRows.length > 0) {
          await tx
            .update(documentImportMedia)
            .set({ workspaceMediaId: duplicate.toId })
            .where(
              and(
                eq(documentImportMedia.workspaceMediaId, duplicate.fromId),
                inArray(
                  documentImportMedia.importId,
                  graph.documentRows.map((row) => row.id),
                ),
              ),
            );
        }
      }
      if (replacements.size > 0 && recordIds.length > 0) {
        const fresh = await tx
          .select({
            id: knowledgeRecords.id,
            contentMarkdown: knowledgeRecords.contentMarkdown,
            contentHtmlCache: knowledgeRecords.contentHtmlCache,
          })
          .from(knowledgeRecords)
          .where(inArray(knowledgeRecords.id, recordIds));
        for (const record of fresh) {
          const nextMarkdown = rewriteMediaUrls(record.contentMarkdown, replacements);
          const nextHtml = record.contentHtmlCache
            ? rewriteMediaUrls(record.contentHtmlCache, replacements)
            : record.contentHtmlCache;
          if (nextMarkdown === record.contentMarkdown && nextHtml === record.contentHtmlCache) {
            continue;
          }
          await tx
            .update(knowledgeRecords)
            .set({
              contentMarkdown: nextMarkdown,
              contentHtmlCache: nextHtml,
              updatedAt: new Date(),
            })
            .where(eq(knowledgeRecords.id, record.id));
        }
      }

      if (crossOrganization && tagRemaps.length > 0) {
        const resolved = new Map<string, string>();
        for (const remap of tagRemaps) {
          if (remap.toTagId) {
            resolved.set(remap.fromTagId, remap.toTagId);
            continue;
          }
          const [created] = await tx
            .insert(tags)
            .values({
              organizationId: targetWorkspace.organizationId,
              name: remap.name,
              slug: remap.slug,
            })
            .returning();
          if (!created) continue;
          resolved.set(remap.fromTagId, created.id);
          remap.toTagId = created.id;
        }
        for (const [fromTagId, toTagId] of resolved) {
          await tx
            .update(projectTags)
            .set({ tagId: toTagId })
            .where(and(eq(projectTags.projectId, project.id), eq(projectTags.tagId, fromTagId)));
          if (systemIds.length > 0) {
            await tx
              .update(systemTags)
              .set({ tagId: toTagId })
              .where(
                and(inArray(systemTags.systemId, systemIds), eq(systemTags.tagId, fromTagId)),
              );
          }
          if (recordIds.length > 0) {
            await tx
              .update(knowledgeRecordTags)
              .set({ tagId: toTagId })
              .where(
                and(
                  inArray(knowledgeRecordTags.knowledgeRecordId, recordIds),
                  eq(knowledgeRecordTags.tagId, fromTagId),
                ),
              );
          }
        }
      }

      let copied = 0;
      if (crossOrganization) {
        const entityIds = [
          project.id,
          ...systemIds,
          ...recordIds,
          ...graph.milestoneRows.map((row) => row.id),
          ...graph.epicRows.map((row) => row.id),
          ...graph.storyRows.map((row) => row.id),
          ...graph.sprintRows.map((row) => row.id),
          ...graph.taskRows.map((row) => row.id),
          ...graph.raidRows.map((row) => row.id),
          ...graph.changeRows.map((row) => row.id),
          ...graph.stakeholderRows.map((row) => row.id),
        ];
        const history = await tx
          .select()
          .from(auditEvents)
          .where(
            and(
              eq(auditEvents.organizationId, sourceWorkspace.organizationId),
              inArray(auditEvents.entityId, entityIds),
            ),
          );
        if (history.length > 0) {
          await tx.insert(auditEvents).values(
            history.map((row) => ({
              organizationId: targetWorkspace.organizationId,
              actorType: row.actorType,
              actorId: row.actorId,
              action: row.action,
              entityType: row.entityType,
              entityId: row.entityId,
              metadataJson: row.metadataJson,
              ipAddress: row.ipAddress,
              createdAt: row.createdAt,
            })),
          );
          copied = history.length;
        }
      }
      return copied;
    });

    counts.auditCopied = auditCopied;
    for (const mediaId of mediaPlan.exclusiveIds) {
      await deleteMediaBytes(input.uploadDir, sourceWorkspace.id, mediaId, mediaOptions).catch(
        () => {
          log.warn(`Project move left old media bytes for ${mediaId}`);
        },
      );
    }
  } catch (error) {
    for (const key of copiedKeys) {
      await deleteMediaBytes(input.uploadDir, key.workspaceId, key.mediaId, mediaOptions).catch(
        () => undefined,
      );
    }
    throw error;
  }

  const metadata = {
    fromOrganizationId: sourceWorkspace.organizationId,
    toOrganizationId: targetWorkspace.organizationId,
    fromWorkspaceId: sourceWorkspace.id,
    toWorkspaceId: targetWorkspace.id,
    counts,
    via: input.viaMcp ? 'mcp' : 'rest',
  };
  await writeAuditEvent(database, {
    organizationId: targetWorkspace.organizationId,
    actorType: input.actorType,
    actorId: input.actorId,
    action: 'project.move',
    entityType: 'project',
    entityId: project.id,
    metadata,
    ipAddress: input.ipAddress ?? null,
  });
  if (crossOrganization) {
    await writeAuditEvent(database, {
      organizationId: sourceWorkspace.organizationId,
      actorType: input.actorType,
      actorId: input.actorId,
      action: 'project.move',
      entityType: 'project',
      entityId: project.id,
      metadata,
      ipAddress: input.ipAddress ?? null,
    });
  }

  return {
    ...base,
    dryRun: false,
    confirmRequired: false,
    project: {
      id: project.id,
      name: project.name,
      slug: project.slug,
      workspaceId: targetWorkspace.id,
      workspaceSlug: targetWorkspace.slug,
    },
    counts,
    tagRemaps,
  };
}
