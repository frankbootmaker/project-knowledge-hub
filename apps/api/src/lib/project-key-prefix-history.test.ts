import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { loadEnv } from '@project-knowledge-hub/config';
import {
  createDatabase,
  knowledgeRecords,
  organizations,
  projectTasks,
  projects,
  users,
  workspaces,
  type Database,
} from '@project-knowledge-hub/database';
import { AppError } from '@project-knowledge-hub/domain';
import { uniqueIntegrationKeyPrefix } from '../integration-test/unique-key-prefix.js';
import {
  assertUniqueKeyPrefix,
  resolveEntityId,
  resolveKnowledgeRecordId,
  resolveScopedIssueKey,
} from './project-issue-keys.js';
import {
  listKeyPrefixMentions,
  releaseProjectKeyPrefix,
  retireProjectKeyPrefix,
} from './project-key-prefix-history.js';

const hasTestDb = Boolean(process.env.DATABASE_URL);

function testEnv() {
  return loadEnv({
    ...process.env,
    NODE_ENV: 'test',
    APP_ENV: 'test',
    LOG_LEVEL: 'silent',
    SESSION_SECRET:
      process.env.SESSION_SECRET ?? 'test-session-secret-at-least-32-chars',
  });
}

describe.skipIf(!hasTestDb)('PRO-T-127 project key prefix history', () => {
  let database: Database;
  let closeDatabase: () => Promise<void>;

  beforeEach(() => {
    const env = testEnv();
    database = createDatabase(env.DATABASE_URL);
    closeDatabase = () => database.close();
  });

  afterEach(async () => {
    await closeDatabase();
  });

  it('resolves the old key after a prefix change and reserves it', async () => {
    const suffix = randomUUID().slice(0, 8);
    const oldPrefix = uniqueIntegrationKeyPrefix();
    const nextPrefix = uniqueIntegrationKeyPrefix();
    const [org] = await database.db
      .insert(organizations)
      .values({ name: `Prefix ${suffix}`, slug: `prefix-${suffix}` })
      .returning();
    const [author] = await database.db
      .insert(users)
      .values({
        email: `prefix-${suffix}@example.com`,
        displayName: 'Prefix author',
        status: 'active',
      })
      .returning();
    const [workspace] = await database.db
      .insert(workspaces)
      .values({
        organizationId: org!.id,
        name: `Workspace ${suffix}`,
        slug: `ws-${suffix}`,
      })
      .returning();
    const [project] = await database.db
      .insert(projects)
      .values({
        workspaceId: workspace!.id,
        name: 'RelayHorizon',
        slug: `relay-${suffix}`,
        keyPrefix: oldPrefix,
      })
      .returning();
    const [task] = await database.db
      .insert(projectTasks)
      .values({
        projectId: project!.id,
        title: 'Keep the old key',
        issueKeyType: 'T',
        issueNumber: 12,
      })
      .returning();
    const [record] = await database.db
      .insert(knowledgeRecords)
      .values({
        workspaceId: workspace!.id,
        projectId: project!.id,
        title: 'Notes',
        slug: `notes-${suffix}`,
        recordType: 'conversation',
        contentMarkdown: `See ${oldPrefix}-T-12 before the rename.`,
        createdBy: author!.id,
      })
      .returning();

    await database.db.transaction(async (tx) => {
      await retireProjectKeyPrefix(tx, {
        projectId: project!.id,
        workspaceId: workspace!.id,
        previousPrefix: oldPrefix,
        nextPrefix,
        actorUserId: author!.id,
      });
      await tx
        .update(projects)
        .set({ keyPrefix: nextPrefix })
        .where(eq(projects.id, project!.id));
    });

    await expect(
      resolveEntityId(database, {
        entityType: 'task',
        idOrKey: `${oldPrefix}-T-12`,
        projectId: project!.id,
      }),
    ).resolves.toBe(task!.id);
    await expect(
      resolveEntityId(database, {
        entityType: 'task',
        idOrKey: `${nextPrefix}-T-12`,
        workspaceIds: [workspace!.id],
      }),
    ).resolves.toBe(task!.id);
    const scoped = await resolveScopedIssueKey(database, {
      projectId: project!.id,
      key: `${oldPrefix}-T-12`,
      workspaceId: workspace!.id,
    });
    expect(scoped).toEqual({
      entityType: 'task',
      entityId: task!.id,
      queryParam: 'task',
    });

    const mentions = await listKeyPrefixMentions(database, {
      workspaceId: workspace!.id,
      keyPrefix: oldPrefix,
    });
    expect(mentions.map((row) => row.id)).toContain(record!.id);

    await expect(
      assertUniqueKeyPrefix(database, {
        workspaceId: workspace!.id,
        keyPrefix: oldPrefix,
      }),
    ).rejects.toMatchObject({ code: 'KEY_PREFIX_TAKEN', statusCode: 409 });

    await releaseProjectKeyPrefix(database, {
      projectId: project!.id,
      keyPrefix: oldPrefix,
      actorUserId: author!.id,
    });
    await expect(
      assertUniqueKeyPrefix(database, {
        workspaceId: workspace!.id,
        keyPrefix: oldPrefix,
      }),
    ).resolves.toMatchObject({ keyPrefix: oldPrefix });
    await expect(
      resolveEntityId(database, {
        entityType: 'task',
        idOrKey: `${oldPrefix}-T-12`,
        workspaceIds: [workspace!.id],
      }),
    ).rejects.toBeInstanceOf(AppError);
  });

  it('keeps cross-workspace prefix collisions ambiguous (PRO-T-3)', async () => {
    const suffix = randomUUID().slice(0, 8);
    const shared = uniqueIntegrationKeyPrefix();
    const renamed = uniqueIntegrationKeyPrefix();
    const [org] = await database.db
      .insert(organizations)
      .values({ name: `Ambiguous ${suffix}`, slug: `amb-${suffix}` })
      .returning();
    const [author] = await database.db
      .insert(users)
      .values({
        email: `amb-${suffix}@example.com`,
        displayName: 'Ambiguous author',
        status: 'active',
      })
      .returning();
    const [workspaceA, workspaceB] = await database.db
      .insert(workspaces)
      .values([
        {
          organizationId: org!.id,
          name: `A ${suffix}`,
          slug: `a-${suffix}`,
        },
        {
          organizationId: org!.id,
          name: `B ${suffix}`,
          slug: `b-${suffix}`,
        },
      ])
      .returning();
    const [projectA, projectB] = await database.db
      .insert(projects)
      .values([
        {
          workspaceId: workspaceA!.id,
          name: 'Alpha',
          slug: `alpha-${suffix}`,
          keyPrefix: shared,
        },
        {
          workspaceId: workspaceB!.id,
          name: 'Beta',
          slug: `beta-${suffix}`,
          keyPrefix: shared,
        },
      ])
      .returning();
    const [taskA, taskB] = await database.db
      .insert(projectTasks)
      .values([
        {
          projectId: projectA!.id,
          title: 'Alpha task',
          issueKeyType: 'T',
          issueNumber: 1,
        },
        {
          projectId: projectB!.id,
          title: 'Beta task',
          issueKeyType: 'T',
          issueNumber: 1,
        },
      ])
      .returning();
    await database.db
      .insert(knowledgeRecords)
      .values({
        workspaceId: workspaceA!.id,
        projectId: projectA!.id,
        title: 'Alpha note',
        slug: `alpha-note-${suffix}`,
        recordType: 'conversation',
        contentMarkdown: 'Alpha',
        documentKeyType: 'NOTE',
        documentNumber: 1,
        createdBy: author!.id,
      });

    await database.db.transaction(async (tx) => {
      await retireProjectKeyPrefix(tx, {
        projectId: projectA!.id,
        workspaceId: workspaceA!.id,
        previousPrefix: shared,
        nextPrefix: renamed,
        actorUserId: author!.id,
      });
      await tx
        .update(projects)
        .set({ keyPrefix: renamed })
        .where(eq(projects.id, projectA!.id));
    });

    await expect(
      resolveEntityId(database, {
        entityType: 'task',
        idOrKey: `${shared}-T-1`,
      }),
    ).rejects.toMatchObject({ code: 'ISSUE_KEY_AMBIGUOUS' });
    await expect(
      resolveEntityId(database, {
        entityType: 'task',
        idOrKey: `${shared}-T-1`,
        workspaceIds: [workspaceA!.id],
      }),
    ).resolves.toBe(taskA!.id);
    await expect(
      resolveEntityId(database, {
        entityType: 'task',
        idOrKey: `${shared}-T-1`,
        workspaceIds: [workspaceB!.id],
      }),
    ).resolves.toBe(taskB!.id);
    await expect(
      resolveKnowledgeRecordId(database, {
        idOrKey: `${shared}-NOTE-1`,
        workspaceIds: [workspaceA!.id],
      }),
    ).resolves.toEqual(expect.any(String));
    const warning = await assertUniqueKeyPrefix(database, {
      workspaceId: workspaceA!.id,
      keyPrefix: shared,
      excludeProjectId: projectA!.id,
      checkCrossWorkspace: true,
    });
    expect(warning.warning).toMatch(/PRO-T-3/);
    expect(warning.warning).toMatch(/Beta/);
  });
});
