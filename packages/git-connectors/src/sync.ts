import { createHash } from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { slugify } from '@project-knowledge-hub/auth';
import {
  gitRepositoryConnections,
  gitSyncRuns,
  knowledgeRecords,
  knowledgeSources,
  type Database,
  type GitPathMapping,
} from '@project-knowledge-hub/database';
import { AppError, recordTypeSchema } from '@project-knowledge-hub/domain';
import { renderMarkdown } from '@project-knowledge-hub/markdown';
import {
  fetchBlobText,
  githubBlobUrl,
  listRepositoryTree,
  resolveBranchCommitSha,
  type GitHubRepoRef,
} from './github.js';
import { mapPathToRecord, titleFromMarkdown } from './path-map.js';
import { filterSyncedPaths } from './path-match.js';

export type SyncTrigger = 'manual' | 'webhook' | 'scheduled';

export type SyncStats = {
  matched: number;
  created: number;
  updated: number;
  skipped: number;
  archived: number;
  failed: number;
};

export type SyncResult = {
  syncRunId: string;
  connectionId: string;
  commitSha: string | null;
  status: 'succeeded' | 'failed';
  stats: SyncStats;
  errorMessage?: string;
};

function contentSha(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

function slugForGitPath(path: string): string {
  const base = slugify(`git-${path.replace(/\//g, '-')}`) || 'git-doc';
  return base.slice(0, 96);
}

function connectionRef(row: typeof gitRepositoryConnections.$inferSelect): GitHubRepoRef {
  return {
    owner: row.owner,
    repo: row.repo,
    branch: row.branch,
    accessToken: row.accessToken,
  };
}

async function ensureUniqueSlug(
  database: Database,
  workspaceId: string,
  desired: string,
  excludeRecordId?: string,
): Promise<string> {
  let candidate = desired.slice(0, 96);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const [existing] = await database.db
      .select({ id: knowledgeRecords.id })
      .from(knowledgeRecords)
      .where(
        and(
          eq(knowledgeRecords.workspaceId, workspaceId),
          eq(knowledgeRecords.slug, candidate),
        ),
      )
      .limit(1);
    if (!existing || existing.id === excludeRecordId) {
      return candidate;
    }
    const suffix = `-${attempt + 2}`;
    candidate = `${desired.slice(0, 96 - suffix.length)}${suffix}`;
  }
  throw new AppError({
    code: 'SLUG_CONFLICT',
    message: `Unable to allocate slug for ${desired}`,
    statusCode: 409,
  });
}

export async function syncGitRepositoryConnection(options: {
  database: Database;
  connectionId: string;
  trigger: SyncTrigger;
  actorUserId: string;
}): Promise<SyncResult> {
  const { database, connectionId, trigger, actorUserId } = options;

  const [connection] = await database.db
    .select()
    .from(gitRepositoryConnections)
    .where(eq(gitRepositoryConnections.id, connectionId))
    .limit(1);

  if (!connection) {
    throw new AppError({
      code: 'GIT_CONNECTION_NOT_FOUND',
      message: 'Git repository connection not found',
      statusCode: 404,
    });
  }

  if (connection.status === 'paused') {
    throw new AppError({
      code: 'GIT_CONNECTION_PAUSED',
      message: 'Git repository connection is paused',
      statusCode: 400,
    });
  }

  const [syncRun] = await database.db
    .insert(gitSyncRuns)
    .values({
      connectionId,
      status: 'running',
      trigger,
      startedAt: new Date(),
    })
    .returning();

  if (!syncRun) {
    throw new AppError({
      code: 'GIT_SYNC_RUN_FAILED',
      message: 'Failed to create sync run',
      statusCode: 500,
    });
  }

  const stats: SyncStats = {
    matched: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    archived: 0,
    failed: 0,
  };

  try {
    const ref = connectionRef(connection);
    const commitSha = await resolveBranchCommitSha(ref);
    const tree = await listRepositoryTree(ref, commitSha);
    const paths = filterSyncedPaths(
      tree.map((entry) => entry.path),
      connection.includePaths,
      connection.excludePaths,
    );
    stats.matched = paths.length;

    const treeByPath = new Map(tree.map((entry) => [entry.path, entry]));
    const seenRecordIds = new Set<string>();
    const mappings = connection.pathMappings as GitPathMapping[];

    for (const path of paths) {
      const entry = treeByPath.get(path);
      if (!entry) continue;

      try {
        const mapped = mapPathToRecord(path, mappings);
        const recordType = recordTypeSchema.parse(mapped.recordType);

        const existingRows = await database.db
          .select({
            record: knowledgeRecords,
            source: knowledgeSources,
          })
          .from(knowledgeRecords)
          .leftJoin(
            knowledgeSources,
            eq(knowledgeSources.knowledgeRecordId, knowledgeRecords.id),
          )
          .where(
            and(
              eq(knowledgeRecords.workspaceId, connection.workspaceId),
              sql`${knowledgeRecords.metadataJson}->>'gitConnectionId' = ${connectionId}`,
              sql`${knowledgeRecords.metadataJson}->>'gitPath' = ${path}`,
            ),
          )
          .limit(1);

        const existing = existingRows[0];
        const priorMeta = (existing?.record.metadataJson ?? {}) as Record<string, unknown>;
        if (
          existing &&
          priorMeta.gitBlobSha === entry.sha &&
          !existing.record.archivedAt
        ) {
          seenRecordIds.add(existing.record.id);
          stats.skipped += 1;
          continue;
        }

        const markdown = await fetchBlobText(ref, entry.sha);
        const title = titleFromMarkdown(markdown, path);
        const rendered = await renderMarkdown(markdown);
        const sha = contentSha(markdown);
        const sourceUri = githubBlobUrl(
          connection.owner,
          connection.repo,
          connection.branch,
          path,
        );
        const metadata = {
          gitConnectionId: connectionId,
          gitProvider: 'github',
          gitOwner: connection.owner,
          gitRepo: connection.repo,
          gitBranch: connection.branch,
          gitPath: path,
          gitBlobSha: entry.sha,
          gitCommitSha: commitSha,
          gitContentSha: sha,
        };

        if (existing) {
          const shouldVersion = existing.record.contentMarkdown !== markdown;
          let nextVersion = existing.record.currentVersionNumber;
          if (shouldVersion) {
            nextVersion = existing.record.currentVersionNumber + 1;
          }

          const [updated] = await database.db
            .update(knowledgeRecords)
            .set({
              title,
              recordType,
              projectId: connection.projectId,
              contentMarkdown: markdown,
              contentHtmlCache: rendered.html,
              sourceOfTruthMode: 'git_managed',
              lifecycleStatus: 'verified',
              archivedAt: null,
              currentVersionNumber: nextVersion,
              metadataJson: metadata,
              updatedAt: new Date(),
            })
            .where(eq(knowledgeRecords.id, existing.record.id))
            .returning();

          if (updated) {
            await database.db
              .delete(knowledgeSources)
              .where(eq(knowledgeSources.knowledgeRecordId, updated.id));
            await database.db.insert(knowledgeSources).values({
              knowledgeRecordId: updated.id,
              sourceType: 'git',
              sourceProvider: 'github',
              sourceReference: `${commitSha}:${path}`,
              sourceTitle: path,
              sourceUri,
              metadataJson: metadata,
            });
            seenRecordIds.add(updated.id);
            stats.updated += 1;
          }
        } else {
          const slug = await ensureUniqueSlug(
            database,
            connection.workspaceId,
            slugForGitPath(path),
          );
          const [created] = await database.db
            .insert(knowledgeRecords)
            .values({
              workspaceId: connection.workspaceId,
              projectId: connection.projectId,
              title,
              slug,
              summary: null,
              recordType,
              lifecycleStatus: 'verified',
              sourceOfTruthMode: 'git_managed',
              contentMarkdown: markdown,
              contentHtmlCache: rendered.html,
              language: 'en',
              metadataJson: metadata,
              currentVersionNumber: 1,
              createdBy: actorUserId,
            })
            .returning();

          if (created) {
            await database.db.insert(knowledgeSources).values({
              knowledgeRecordId: created.id,
              sourceType: 'git',
              sourceProvider: 'github',
              sourceReference: `${commitSha}:${path}`,
              sourceTitle: path,
              sourceUri,
              metadataJson: metadata,
            });
            seenRecordIds.add(created.id);
            stats.created += 1;
          }
        }
      } catch {
        stats.failed += 1;
      }
    }

    const priorSynced = await database.db
      .select()
      .from(knowledgeRecords)
      .where(
        and(
          eq(knowledgeRecords.workspaceId, connection.workspaceId),
          isNull(knowledgeRecords.archivedAt),
          sql`${knowledgeRecords.metadataJson}->>'gitConnectionId' = ${connectionId}`,
        ),
      );

    for (const record of priorSynced) {
      if (seenRecordIds.has(record.id)) continue;
      await database.db
        .update(knowledgeRecords)
        .set({
          archivedAt: new Date(),
          lifecycleStatus: 'archived',
          updatedAt: new Date(),
        })
        .where(eq(knowledgeRecords.id, record.id));
      stats.archived += 1;
    }

    await database.db
      .update(gitRepositoryConnections)
      .set({
        lastSyncedAt: new Date(),
        lastSyncedCommitSha: commitSha,
        lastError: null,
        status: 'active',
        updatedAt: new Date(),
      })
      .where(eq(gitRepositoryConnections.id, connectionId));

    await database.db
      .update(gitSyncRuns)
      .set({
        status: 'succeeded',
        commitSha,
        statsJson: stats,
        finishedAt: new Date(),
      })
      .where(eq(gitSyncRuns.id, syncRun.id));

    return {
      syncRunId: syncRun.id,
      connectionId,
      commitSha,
      status: 'succeeded',
      stats,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Sync failed';
    await database.db
      .update(gitRepositoryConnections)
      .set({
        lastError: message.slice(0, 2000),
        status: 'error',
        updatedAt: new Date(),
      })
      .where(eq(gitRepositoryConnections.id, connectionId));

    await database.db
      .update(gitSyncRuns)
      .set({
        status: 'failed',
        errorMessage: message.slice(0, 2000),
        statsJson: stats,
        finishedAt: new Date(),
      })
      .where(eq(gitSyncRuns.id, syncRun.id));

    return {
      syncRunId: syncRun.id,
      connectionId,
      commitSha: null,
      status: 'failed',
      stats,
      errorMessage: message,
    };
  }
}
