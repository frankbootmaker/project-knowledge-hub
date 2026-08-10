import { and, asc, eq, inArray } from 'drizzle-orm';
import type { Database } from '@project-knowledge-hub/database';
import {
  knowledgeRecords,
  memberships,
  projectInitialStakeholders,
  projects,
  users,
} from '@project-knowledge-hub/database';
import {
  AppError,
  projectStakeholderRoleSchema,
  type ProjectStakeholderRole,
} from '@project-knowledge-hub/domain';

export type PublicPinnedRecord = {
  id: string;
  title: string;
  slug: string;
  recordType: string;
};

export type PublicInitialStakeholder = {
  id: string;
  userId: string;
  displayName: string;
  email: string;
  projectRole: ProjectStakeholderRole;
  sortOrder: number;
};

async function assertWorkspaceMembers(
  database: Database,
  workspaceId: string,
  userIds: string[],
): Promise<void> {
  if (userIds.length === 0) return;
  const unique = [...new Set(userIds)];
  const rows = await database.db
    .select({ userId: memberships.userId })
    .from(memberships)
    .innerJoin(users, eq(memberships.userId, users.id))
    .where(
      and(
        eq(memberships.workspaceId, workspaceId),
        inArray(memberships.userId, unique),
        eq(users.status, 'active'),
      ),
    );
  if (rows.length !== unique.length) {
    throw new AppError({
      code: 'INITIAL_STAKEHOLDER_NOT_MEMBER',
      message: 'Initial stakeholders must be active workspace members',
      statusCode: 400,
    });
  }
}

export async function assertPinnedKnowledgeRecord(
  database: Database,
  input: {
    recordId: string;
    projectId: string;
    expectedTypes?: string[];
  },
): Promise<void> {
  const [row] = await database.db
    .select({
      id: knowledgeRecords.id,
      projectId: knowledgeRecords.projectId,
      recordType: knowledgeRecords.recordType,
    })
    .from(knowledgeRecords)
    .where(eq(knowledgeRecords.id, input.recordId))
    .limit(1);
  if (!row) {
    throw new AppError({
      code: 'PINNED_RECORD_NOT_FOUND',
      message: 'Pinned knowledge record not found',
      statusCode: 400,
    });
  }
  if (row.projectId !== input.projectId) {
    throw new AppError({
      code: 'PINNED_RECORD_PROJECT_MISMATCH',
      message: 'Pinned knowledge record must belong to this project',
      statusCode: 400,
    });
  }
  if (
    input.expectedTypes &&
    input.expectedTypes.length > 0 &&
    !input.expectedTypes.includes(row.recordType)
  ) {
    throw new AppError({
      code: 'PINNED_RECORD_TYPE_MISMATCH',
      message: `Pinned record type must be one of: ${input.expectedTypes.join(', ')}`,
      statusCode: 400,
    });
  }
}

export async function loadPinnedRecords(
  database: Database,
  recordIds: Array<string | null | undefined>,
): Promise<Map<string, PublicPinnedRecord>> {
  const ids = [...new Set(recordIds.filter((id): id is string => Boolean(id)))];
  const map = new Map<string, PublicPinnedRecord>();
  if (ids.length === 0) return map;
  const rows = await database.db
    .select({
      id: knowledgeRecords.id,
      title: knowledgeRecords.title,
      slug: knowledgeRecords.slug,
      recordType: knowledgeRecords.recordType,
    })
    .from(knowledgeRecords)
    .where(inArray(knowledgeRecords.id, ids));
  for (const row of rows) {
    map.set(row.id, row);
  }
  return map;
}

export async function listInitialStakeholders(
  database: Database,
  projectId: string,
): Promise<PublicInitialStakeholder[]> {
  const rows = await database.db
    .select({
      id: projectInitialStakeholders.id,
      userId: projectInitialStakeholders.userId,
      projectRole: projectInitialStakeholders.projectRole,
      sortOrder: projectInitialStakeholders.sortOrder,
      displayName: users.displayName,
      email: users.email,
    })
    .from(projectInitialStakeholders)
    .innerJoin(users, eq(projectInitialStakeholders.userId, users.id))
    .where(eq(projectInitialStakeholders.projectId, projectId))
    .orderBy(
      asc(projectInitialStakeholders.sortOrder),
      asc(users.displayName),
    );
  return rows.map((row) => ({
    id: row.id,
    userId: row.userId,
    displayName: row.displayName,
    email: row.email,
    projectRole: projectStakeholderRoleSchema.parse(row.projectRole),
    sortOrder: row.sortOrder,
  }));
}

export async function setInitialStakeholders(
  database: Database,
  input: {
    projectId: string;
    workspaceId: string;
    stakeholders: Array<{
      userId: string;
      projectRole?: ProjectStakeholderRole;
      sortOrder?: number;
    }>;
  },
): Promise<PublicInitialStakeholder[]> {
  const unique = new Map<
    string,
    { userId: string; projectRole: ProjectStakeholderRole; sortOrder: number }
  >();
  input.stakeholders.forEach((entry, index) => {
    unique.set(entry.userId, {
      userId: entry.userId,
      projectRole: entry.projectRole ?? 'stakeholder',
      sortOrder: entry.sortOrder ?? index,
    });
  });
  const rows = [...unique.values()];
  await assertWorkspaceMembers(
    database,
    input.workspaceId,
    rows.map((row) => row.userId),
  );

  await database.db
    .delete(projectInitialStakeholders)
    .where(eq(projectInitialStakeholders.projectId, input.projectId));

  if (rows.length > 0) {
    await database.db.insert(projectInitialStakeholders).values(
      rows.map((row) => ({
        projectId: input.projectId,
        userId: row.userId,
        projectRole: row.projectRole,
        sortOrder: row.sortOrder,
      })),
    );
  }

  return listInitialStakeholders(database, input.projectId);
}

export async function getProjectRow(
  database: Database,
  projectId: string,
): Promise<typeof projects.$inferSelect> {
  const [row] = await database.db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!row) {
    throw new AppError({
      code: 'PROJECT_NOT_FOUND',
      message: 'Project not found',
      statusCode: 404,
    });
  }
  return row;
}
