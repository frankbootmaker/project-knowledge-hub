import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import {
  apiClients,
  gitRepositoryConnections,
  knowledgeRecordDeliveryLinks,
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
  projectTaskActivities,
  projectTaskRaci,
  projectTasks,
  projectUserStories,
  sessions,
  systems,
  tags,
  users,
  workspaceMedia,
  type Database,
} from '@project-knowledge-hub/database';
import type { BlobStore } from '@project-knowledge-hub/blob-store';
import { AppError } from '@project-knowledge-hub/domain';
import { deleteAvatarFile } from './avatars.js';

export function isHardUserDeleteAllowed(appEnv: string): boolean {
  return appEnv === 'development' || appEnv === 'test';
}

export async function countOtherSystemAdmins(
  database: Database,
  userId: string,
): Promise<number> {
  const [row] = await database.db
    .select({ count: sql<number>`count(*)::int` })
    .from(users)
    .where(
      and(
        eq(users.isSystemAdmin, true),
        eq(users.status, 'active'),
        ne(users.id, userId),
      ),
    );
  return row?.count ?? 0;
}

async function assertNotLastSystemAdmin(
  database: Database,
  user: typeof users.$inferSelect,
): Promise<void> {
  if (!user.isSystemAdmin || user.status !== 'active') {
    return;
  }
  const others = await countOtherSystemAdmins(database, user.id);
  if (others < 1) {
    throw new AppError({
      code: 'LAST_SYSTEM_ADMIN',
      message: 'Cannot remove the last active system administrator',
      statusCode: 400,
    });
  }
}

/**
 * Soft-remove a user: disable login, free the email for re-registration,
 * revoke sessions, and clear credentials / avatar / IdP stub.
 */
export async function closeUserAccount(
  database: Database,
  input: {
    userId: string;
    avatarUploadDir: string;
    blobStore?: BlobStore;
  },
): Promise<typeof users.$inferSelect> {
  const [existing] = await database.db
    .select()
    .from(users)
    .where(eq(users.id, input.userId))
    .limit(1);

  if (!existing) {
    throw new AppError({
      code: 'USER_NOT_FOUND',
      message: 'User not found',
      statusCode: 404,
    });
  }

  if (existing.status === 'disabled' && !existing.passwordHash) {
    throw new AppError({
      code: 'USER_ALREADY_CLOSED',
      message: 'This account is already closed',
      statusCode: 400,
    });
  }

  await assertNotLastSystemAdmin(database, existing);

  const closedEmail = `closed+${existing.id.replaceAll('-', '').slice(0, 12)}.${Date.now()}@closed.local`;

  await database.db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.userId, existing.id), isNull(sessions.revokedAt)));

  await deleteAvatarFile(input.avatarUploadDir, existing.id, {
    blobStore: input.blobStore,
  });

  const [updated] = await database.db
    .update(users)
    .set({
      email: closedEmail,
      passwordHash: null,
      status: 'disabled',
      isSystemAdmin: false,
      idpSource: null,
      idpSubject: null,
      avatarContentType: null,
      updatedAt: new Date(),
    })
    .where(eq(users.id, existing.id))
    .returning();

  if (!updated) {
    throw new AppError({
      code: 'USER_NOT_FOUND',
      message: 'User not found',
      statusCode: 404,
    });
  }

  return updated;
}

/**
 * Hard-delete a user and authored knowledge / git connections.
 * Allowed only in development/test so production keeps soft-close for audit.
 */
export async function purgeUserAccount(
  database: Database,
  input: {
    userId: string;
    avatarUploadDir: string;
    appEnv: string;
    blobStore?: BlobStore;
  },
): Promise<{ id: string; email: string; displayName: string }> {
  if (!isHardUserDeleteAllowed(input.appEnv)) {
    throw new AppError({
      code: 'HARD_DELETE_DISABLED',
      message:
        'Permanent user delete is only available in development and test environments',
      statusCode: 403,
    });
  }

  const [existing] = await database.db
    .select()
    .from(users)
    .where(eq(users.id, input.userId))
    .limit(1);

  if (!existing) {
    throw new AppError({
      code: 'USER_NOT_FOUND',
      message: 'User not found',
      statusCode: 404,
    });
  }

  await assertNotLastSystemAdmin(database, existing);
  if (
    existing.userType === 'system' &&
    (await systemUserOwnsRows(database, existing.id))
  ) {
    throw new AppError({
      code: 'SYSTEM_USER_PURGE_REQUIRED',
      message:
        'Purge first: this system user still owns rows. Run the project purge before hard-deleting the account.',
      statusCode: 409,
    });
  }
  await deleteAvatarFile(input.avatarUploadDir, existing.id, {
    blobStore: input.blobStore,
  });

  // Clear / remove restrict FKs before deleting the user row.
  await database.db
    .update(apiClients)
    .set({ actingUserId: null })
    .where(eq(apiClients.actingUserId, existing.id));

  await database.db
    .delete(gitRepositoryConnections)
    .where(eq(gitRepositoryConnections.createdBy, existing.id));

  await database.db
    .delete(knowledgeRecordVersions)
    .where(eq(knowledgeRecordVersions.createdBy, existing.id));

  await database.db
    .delete(knowledgeRecords)
    .where(eq(knowledgeRecords.createdBy, existing.id));

  const [deleted] = await database.db
    .delete(users)
    .where(eq(users.id, existing.id))
    .returning({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
    });

  if (!deleted) {
    throw new AppError({
      code: 'USER_NOT_FOUND',
      message: 'User not found',
      statusCode: 404,
    });
  }

  return deleted;
}

async function systemUserOwnsRows(
  database: Database,
  userId: string,
): Promise<boolean> {
  const queries = [
    database.db
      .select({ id: projectTasks.id })
      .from(projectTasks)
      .where(eq(projectTasks.createdBy, userId))
      .limit(1),
    database.db
      .select({ id: projectTaskActivities.id })
      .from(projectTaskActivities)
      .where(eq(projectTaskActivities.actorUserId, userId))
      .limit(1),
    database.db
      .select({ id: projectTaskRaci.id })
      .from(projectTaskRaci)
      .where(eq(projectTaskRaci.createdBy, userId))
      .limit(1),
    database.db
      .select({ id: projectMilestones.id })
      .from(projectMilestones)
      .where(eq(projectMilestones.createdBy, userId))
      .limit(1),
    database.db
      .select({ id: projectEpics.id })
      .from(projectEpics)
      .where(eq(projectEpics.createdBy, userId))
      .limit(1),
    database.db
      .select({ id: projectUserStories.id })
      .from(projectUserStories)
      .where(eq(projectUserStories.createdBy, userId))
      .limit(1),
    database.db
      .select({ id: projectSprints.id })
      .from(projectSprints)
      .where(eq(projectSprints.createdBy, userId))
      .limit(1),
    database.db
      .select({ id: projectRaidItems.id })
      .from(projectRaidItems)
      .where(eq(projectRaidItems.createdBy, userId))
      .limit(1),
    database.db
      .select({ id: projectChangeItems.id })
      .from(projectChangeItems)
      .where(eq(projectChangeItems.createdBy, userId))
      .limit(1),
    database.db
      .select({ id: projectStakeholders.id })
      .from(projectStakeholders)
      .where(eq(projectStakeholders.createdBy, userId))
      .limit(1),
    database.db
      .select({ id: projectInitialStakeholders.id })
      .from(projectInitialStakeholders)
      .where(eq(projectInitialStakeholders.createdBy, userId))
      .limit(1),
    database.db
      .select({ id: systems.id })
      .from(systems)
      .where(eq(systems.createdBy, userId))
      .limit(1),
    database.db
      .select({ id: tags.id })
      .from(tags)
      .where(eq(tags.createdBy, userId))
      .limit(1),
    database.db
      .select({ id: knowledgeRecords.id })
      .from(knowledgeRecords)
      .where(eq(knowledgeRecords.createdBy, userId))
      .limit(1),
    database.db
      .select({ id: knowledgeRecordVersions.id })
      .from(knowledgeRecordVersions)
      .where(eq(knowledgeRecordVersions.createdBy, userId))
      .limit(1),
    database.db
      .select({ id: workspaceMedia.id })
      .from(workspaceMedia)
      .where(eq(workspaceMedia.createdBy, userId))
      .limit(1),
    database.db
      .select({ id: projectRaidTaskLinks.id })
      .from(projectRaidTaskLinks)
      .where(eq(projectRaidTaskLinks.createdBy, userId))
      .limit(1),
    database.db
      .select({ id: knowledgeRecordDeliveryLinks.id })
      .from(knowledgeRecordDeliveryLinks)
      .where(eq(knowledgeRecordDeliveryLinks.createdBy, userId))
      .limit(1),
    database.db
      .select({ id: projectChangeDeliveryLinks.id })
      .from(projectChangeDeliveryLinks)
      .where(eq(projectChangeDeliveryLinks.createdBy, userId))
      .limit(1),
  ];
  for (const query of queries) {
    const rows = await query;
    if (rows.length > 0) return true;
  }
  return false;
}
