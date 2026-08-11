import { and, eq, ne, sql } from 'drizzle-orm';
import type { Database } from '@project-knowledge-hub/database';
import {
  projectChangeItems,
  projectEpics,
  projectMilestones,
  projectRaidItems,
  projectTasks,
  projectUserStories,
  projects,
} from '@project-knowledge-hub/database';
import {
  AppError,
  formatHumanKey,
  isUuid,
  issueKeyTypeToRaidKind,
  keyPrefixSchema,
  normalizeKeyPrefix,
  parseHumanKey,
  readIssueCounter,
  suggestKeyPrefix,
  type IssueKeyType,
} from '@project-knowledge-hub/domain';

export type AllocatedIssueKey = {
  issueKeyType: IssueKeyType;
  issueNumber: number;
  keyPrefix: string | null;
  humanKey: string | null;
};

export type HumanKeyFields = {
  issueKeyType: IssueKeyType | null;
  issueNumber: number | null;
  humanKey: string | null;
};

export function toHumanKeyFields(
  keyPrefix: string | null | undefined,
  issueKeyType: string | null | undefined,
  issueNumber: number | null | undefined,
): HumanKeyFields {
  const typed =
    issueKeyType &&
    [
      'E',
      'S',
      'M',
      'T',
      'C',
      'RR',
      'RI',
      'RA',
      'RD',
    ].includes(issueKeyType)
      ? (issueKeyType as IssueKeyType)
      : null;
  return {
    issueKeyType: typed,
    issueNumber: issueNumber ?? null,
    humanKey: formatHumanKey(keyPrefix, typed, issueNumber),
  };
}

export async function getProjectKeyPrefix(
  database: Database,
  projectId: string,
): Promise<string | null> {
  const [row] = await database.db
    .select({ keyPrefix: projects.keyPrefix })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  return row?.keyPrefix ?? null;
}

export async function assertUniqueKeyPrefix(
  database: Database,
  input: {
    workspaceId: string;
    keyPrefix: string;
    excludeProjectId?: string;
  },
): Promise<string> {
  const parsed = keyPrefixSchema.safeParse(input.keyPrefix);
  if (!parsed.success) {
    throw new AppError({
      code: 'KEY_PREFIX_INVALID',
      message:
        'Issue key prefix must be 3 characters: AAA or AA0 (two letters + digit)',
      statusCode: 400,
      details: parsed.error.flatten(),
    });
  }
  const keyPrefix = parsed.data;
  const conditions = [
    eq(projects.workspaceId, input.workspaceId),
    sql`upper(${projects.keyPrefix}) = ${keyPrefix}`,
  ];
  if (input.excludeProjectId) {
    conditions.push(ne(projects.id, input.excludeProjectId));
  }
  const [existing] = await database.db
    .select({ id: projects.id })
    .from(projects)
    .where(and(...conditions))
    .limit(1);
  if (existing) {
    throw new AppError({
      code: 'KEY_PREFIX_TAKEN',
      message: `Issue key prefix ${keyPrefix} is already used by another project in this workspace`,
      statusCode: 409,
    });
  }
  return keyPrefix;
}

export async function allocateUniqueKeyPrefix(
  database: Database,
  input: { workspaceId: string; nameOrSlug: string },
): Promise<string> {
  const base = suggestKeyPrefix(input.nameOrSlug);
  for (let attempt = 0; attempt < 40; attempt += 1) {
    let candidate = base;
    if (attempt > 0) {
      const letters = base.replace(/[^A-Z]/g, '').slice(0, 2).padEnd(2, 'X');
      candidate = `${letters}${attempt % 10}`;
    }
    try {
      return await assertUniqueKeyPrefix(database, {
        workspaceId: input.workspaceId,
        keyPrefix: candidate,
      });
    } catch (error) {
      if (error instanceof AppError && error.code === 'KEY_PREFIX_TAKEN') {
        continue;
      }
      throw error;
    }
  }
  throw new AppError({
    code: 'KEY_PREFIX_ALLOCATE_FAILED',
    message: 'Could not allocate a unique issue key prefix',
    statusCode: 500,
  });
}

export async function allocateIssueNumber(
  database: Database,
  projectId: string,
  issueKeyType: IssueKeyType,
): Promise<AllocatedIssueKey> {
  return database.db.transaction(async (tx) => {
    const [project] = await tx
      .select({
        id: projects.id,
        keyPrefix: projects.keyPrefix,
        issueCounters: projects.issueCounters,
      })
      .from(projects)
      .where(eq(projects.id, projectId))
      .for('update')
      .limit(1);
    if (!project) {
      throw new AppError({
        code: 'PROJECT_NOT_FOUND',
        message: 'Project not found',
        statusCode: 404,
      });
    }

    const next = readIssueCounter(project.issueCounters, issueKeyType) + 1;
    const counters = {
      ...(project.issueCounters ?? {}),
      [issueKeyType]: next,
    };
    await tx
      .update(projects)
      .set({
        issueCounters: counters,
        updatedAt: new Date(),
      })
      .where(eq(projects.id, projectId));

    return {
      issueKeyType,
      issueNumber: next,
      keyPrefix: project.keyPrefix,
      humanKey: formatHumanKey(project.keyPrefix, issueKeyType, next),
    };
  });
}

export type ResolvableEntityType =
  | 'epic'
  | 'user_story'
  | 'milestone'
  | 'task'
  | 'raid'
  | 'change';

export async function resolveEntityId(
  database: Database,
  input: {
    entityType: ResolvableEntityType;
    idOrKey: string;
    projectId?: string;
  },
): Promise<string> {
  const raw = input.idOrKey.trim();
  if (isUuid(raw)) {
    return raw;
  }

  const parsed = parseHumanKey(raw);
  if (!parsed) {
    throw new AppError({
      code: 'ISSUE_KEY_INVALID',
      message: `Invalid id or human key: ${raw}`,
      statusCode: 400,
    });
  }

  const expectedType: IssueKeyType | null = (() => {
    switch (input.entityType) {
      case 'epic':
        return 'E';
      case 'user_story':
        return 'S';
      case 'milestone':
        return 'M';
      case 'task':
        return 'T';
      case 'change':
        return 'C';
      case 'raid':
        return parsed.issueKeyType.startsWith('R') ? parsed.issueKeyType : null;
      default:
        return null;
    }
  })();

  if (!expectedType || parsed.issueKeyType !== expectedType) {
    if (input.entityType === 'raid') {
      if (!['RR', 'RI', 'RA', 'RD'].includes(parsed.issueKeyType)) {
        throw new AppError({
          code: 'ISSUE_KEY_TYPE_MISMATCH',
          message: `Human key ${raw} is not a RAID item key`,
          statusCode: 400,
        });
      }
    } else {
      throw new AppError({
        code: 'ISSUE_KEY_TYPE_MISMATCH',
        message: `Human key ${raw} does not match ${input.entityType}`,
        statusCode: 400,
      });
    }
  }

  const projectConditions = [
    sql`upper(${projects.keyPrefix}) = ${normalizeKeyPrefix(parsed.prefix)}`,
  ];
  if (input.projectId) {
    projectConditions.push(eq(projects.id, input.projectId));
  }
  const [project] = await database.db
    .select({
      id: projects.id,
      keyPrefix: projects.keyPrefix,
    })
    .from(projects)
    .where(and(...projectConditions))
    .limit(1);
  if (!project) {
    throw new AppError({
      code: 'ISSUE_KEY_NOT_FOUND',
      message: `No project found for key prefix ${parsed.prefix}`,
      statusCode: 404,
    });
  }

  const type = parsed.issueKeyType;
  const number = parsed.issueNumber;

  if (input.entityType === 'epic' || type === 'E') {
    const [row] = await database.db
      .select({ id: projectEpics.id })
      .from(projectEpics)
      .where(
        and(
          eq(projectEpics.projectId, project.id),
          eq(projectEpics.issueKeyType, type),
          eq(projectEpics.issueNumber, number),
        ),
      )
      .limit(1);
    if (row) return row.id;
  }
  if (input.entityType === 'user_story' || type === 'S') {
    const [row] = await database.db
      .select({ id: projectUserStories.id })
      .from(projectUserStories)
      .where(
        and(
          eq(projectUserStories.projectId, project.id),
          eq(projectUserStories.issueKeyType, type),
          eq(projectUserStories.issueNumber, number),
        ),
      )
      .limit(1);
    if (row) return row.id;
  }
  if (input.entityType === 'milestone' || type === 'M') {
    const [row] = await database.db
      .select({ id: projectMilestones.id })
      .from(projectMilestones)
      .where(
        and(
          eq(projectMilestones.projectId, project.id),
          eq(projectMilestones.issueKeyType, type),
          eq(projectMilestones.issueNumber, number),
        ),
      )
      .limit(1);
    if (row) return row.id;
  }
  if (input.entityType === 'task' || type === 'T') {
    const [row] = await database.db
      .select({ id: projectTasks.id })
      .from(projectTasks)
      .where(
        and(
          eq(projectTasks.projectId, project.id),
          eq(projectTasks.issueKeyType, type),
          eq(projectTasks.issueNumber, number),
        ),
      )
      .limit(1);
    if (row) return row.id;
  }
  if (input.entityType === 'change' || type === 'C') {
    const [row] = await database.db
      .select({ id: projectChangeItems.id })
      .from(projectChangeItems)
      .where(
        and(
          eq(projectChangeItems.projectId, project.id),
          eq(projectChangeItems.issueKeyType, type),
          eq(projectChangeItems.issueNumber, number),
        ),
      )
      .limit(1);
    if (row) return row.id;
  }
  if (input.entityType === 'raid' || issueKeyTypeToRaidKind(type)) {
    const [row] = await database.db
      .select({ id: projectRaidItems.id })
      .from(projectRaidItems)
      .where(
        and(
          eq(projectRaidItems.projectId, project.id),
          eq(projectRaidItems.issueKeyType, type),
          eq(projectRaidItems.issueNumber, number),
        ),
      )
      .limit(1);
    if (row) return row.id;
  }

  throw new AppError({
    code: 'ISSUE_KEY_NOT_FOUND',
    message: `No ${input.entityType} found for key ${raw}`,
    statusCode: 404,
  });
}
