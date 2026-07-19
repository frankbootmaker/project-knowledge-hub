import type { FastifyInstance } from 'fastify';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  gitRepositoryConnections,
  gitSyncRuns,
  workspaces,
} from '@project-knowledge-hub/database';
import {
  assessGitSyncHealth,
  DEFAULT_EXCLUDE_PATHS,
  DEFAULT_INCLUDE_PATHS,
  DEFAULT_PATH_MAPPINGS,
  syncGitRepositoryConnection,
  verifyGitHubWebhookSignature,
  type GitSyncHealth,
} from '@project-knowledge-hub/git-connectors';
import {
  AppError,
  isSyncProviderSupported,
  recordTypeSchema,
  syncProviderSchema,
} from '@project-knowledge-hub/domain';
import { createGitSyncQueue, enqueueGitSyncJob } from '@project-knowledge-hub/jobs';
import {
  requireWorkspaceAdmin,
  requireWorkspaceView,
} from '@project-knowledge-hub/permissions';
import { assertProjectInWorkspace } from '../lib/knowledge-records-service.js';
import { writeAuditEvent } from '../lib/identity.js';
import { requireAuthenticated } from '../plugins/auth.js';

const pathMappingSchema = z.object({
  pattern: z.string().min(1).max(300),
  recordType: recordTypeSchema,
  tags: z.array(z.string().min(1).max(64)).max(20).optional(),
});

const createConnectionSchema = z.object({
  workspaceId: z.string().uuid(),
  projectId: z.string().uuid().nullable().optional(),
  provider: syncProviderSchema.default('github'),
  owner: z.string().min(1).max(120),
  repo: z.string().min(1).max(120),
  branch: z.string().min(1).max(200).default('main'),
  accessToken: z.string().min(8).max(500),
  includePaths: z.array(z.string().min(1).max(300)).max(50).optional(),
  excludePaths: z.array(z.string().min(1).max(300)).max(50).optional(),
  pathMappings: z.array(pathMappingSchema).max(100).optional(),
  webhookSecret: z.string().min(8).max(200).nullable().optional(),
});

const updateConnectionSchema = z.object({
  projectId: z.string().uuid().nullable().optional(),
  branch: z.string().min(1).max(200).optional(),
  accessToken: z.string().min(8).max(500).optional(),
  includePaths: z.array(z.string().min(1).max(300)).max(50).optional(),
  excludePaths: z.array(z.string().min(1).max(300)).max(50).optional(),
  pathMappings: z.array(pathMappingSchema).max(100).optional(),
  webhookSecret: z.string().min(8).max(200).nullable().optional(),
  status: z.enum(['active', 'paused']).optional(),
});

function maskToken(token: string): string {
  if (token.length <= 8) return '••••';
  return `${token.slice(0, 4)}…${token.slice(-4)}`;
}

function toPublicConnection(
  row: typeof gitRepositoryConnections.$inferSelect,
  health?: GitSyncHealth,
) {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    projectId: row.projectId,
    provider: row.provider,
    owner: row.owner,
    repo: row.repo,
    branch: row.branch,
    accessTokenPreview: maskToken(row.accessToken),
    includePaths: row.includePaths,
    excludePaths: row.excludePaths,
    pathMappings: row.pathMappings,
    hasWebhookSecret: Boolean(row.webhookSecret),
    status: row.status,
    lastError: row.lastError,
    lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
    lastSyncedCommitSha: row.lastSyncedCommitSha,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    syncHealth: health ?? null,
  };
}

async function healthForConnection(
  row: typeof gitRepositoryConnections.$inferSelect,
  checkRemote: boolean,
): Promise<GitSyncHealth> {
  return assessGitSyncHealth({
    connectionStatus: row.status,
    lastError: row.lastError,
    lastSyncedAt: row.lastSyncedAt,
    lastSyncedCommitSha: row.lastSyncedCommitSha,
    ref: {
      owner: row.owner,
      repo: row.repo,
      branch: row.branch,
      accessToken: row.accessToken,
    },
    checkRemote,
  });
}

function toPublicSyncRun(row: typeof gitSyncRuns.$inferSelect) {
  return {
    id: row.id,
    connectionId: row.connectionId,
    status: row.status,
    trigger: row.trigger,
    commitSha: row.commitSha,
    stats: row.statsJson,
    errorMessage: row.errorMessage,
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function registerGitConnectionRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/git-connections/defaults', async (request) => {
    requireAuthenticated(request);
    return {
      includePaths: DEFAULT_INCLUDE_PATHS,
      excludePaths: DEFAULT_EXCLUDE_PATHS,
      pathMappings: DEFAULT_PATH_MAPPINGS,
    };
  });

  app.get('/api/v1/workspaces/:workspaceId/git-connections', async (request) => {
    const principal = requireAuthenticated(request);
    const params = z.object({ workspaceId: z.string().uuid() }).parse(request.params);
    const query = z
      .object({
        checkRemote: z
          .enum(['true', 'false'])
          .optional()
          .transform((value) => value !== 'false'),
      })
      .parse(request.query);
    requireWorkspaceView(principal, params.workspaceId);

    const rows = await app.database.db
      .select()
      .from(gitRepositoryConnections)
      .where(eq(gitRepositoryConnections.workspaceId, params.workspaceId))
      .orderBy(desc(gitRepositoryConnections.createdAt));

    const connections = await Promise.all(
      rows.map(async (row) =>
        toPublicConnection(row, await healthForConnection(row, query.checkRemote)),
      ),
    );

    return { connections };
  });

  app.post('/api/v1/git-connections', async (request, reply) => {
    const principal = requireAuthenticated(request);
    const body = createConnectionSchema.parse(request.body);
    requireWorkspaceAdmin(principal, body.workspaceId);

    if (!isSyncProviderSupported(body.provider)) {
      throw new AppError({
        code: 'PROVIDER_NOT_IMPLEMENTED',
        message: `Sync for provider “${body.provider}” is not available yet`,
        statusCode: 400,
      });
    }

    const [workspace] = await app.database.db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, body.workspaceId))
      .limit(1);
    if (!workspace) {
      throw new AppError({
        code: 'WORKSPACE_NOT_FOUND',
        message: 'Workspace not found',
        statusCode: 404,
      });
    }

    await assertProjectInWorkspace(app.database, body.workspaceId, body.projectId);

    const [created] = await app.database.db
      .insert(gitRepositoryConnections)
      .values({
        workspaceId: body.workspaceId,
        projectId: body.projectId ?? null,
        provider: body.provider,
        owner: body.owner,
        repo: body.repo,
        branch: body.branch,
        accessToken: body.accessToken,
        includePaths: body.includePaths ?? DEFAULT_INCLUDE_PATHS,
        excludePaths: body.excludePaths ?? DEFAULT_EXCLUDE_PATHS,
        pathMappings: body.pathMappings ?? DEFAULT_PATH_MAPPINGS,
        webhookSecret: body.webhookSecret ?? null,
        createdBy: principal.userId,
      })
      .returning();

    if (!created) {
      throw new AppError({
        code: 'GIT_CONNECTION_CREATE_FAILED',
        message: 'Failed to create git connection',
        statusCode: 500,
      });
    }

    await writeAuditEvent(app.database, {
      organizationId: workspace.organizationId,
      actorType: 'user',
      actorId: principal.userId,
      action: 'git_connection.create',
      entityType: 'git_repository_connection',
      entityId: created.id,
      metadata: {
        provider: created.provider,
        owner: created.owner,
        repo: created.repo,
        branch: created.branch,
      },
      ipAddress: request.ip,
    });

    return reply.status(201).send({ connection: toPublicConnection(created) });
  });

  app.get('/api/v1/git-connections/:connectionId', async (request) => {
    const principal = requireAuthenticated(request);
    const params = z.object({ connectionId: z.string().uuid() }).parse(request.params);
    const [row] = await app.database.db
      .select()
      .from(gitRepositoryConnections)
      .where(eq(gitRepositoryConnections.id, params.connectionId))
      .limit(1);
    if (!row) {
      throw new AppError({
        code: 'GIT_CONNECTION_NOT_FOUND',
        message: 'Git connection not found',
        statusCode: 404,
      });
    }
    requireWorkspaceView(principal, row.workspaceId);
    const health = await healthForConnection(row, true);
    return { connection: toPublicConnection(row, health) };
  });

  app.get('/api/v1/git-connections/:connectionId/health', async (request) => {
    const principal = requireAuthenticated(request);
    const params = z.object({ connectionId: z.string().uuid() }).parse(request.params);
    const [row] = await app.database.db
      .select()
      .from(gitRepositoryConnections)
      .where(eq(gitRepositoryConnections.id, params.connectionId))
      .limit(1);
    if (!row) {
      throw new AppError({
        code: 'GIT_CONNECTION_NOT_FOUND',
        message: 'Git connection not found',
        statusCode: 404,
      });
    }
    requireWorkspaceView(principal, row.workspaceId);
    const health = await healthForConnection(row, true);
    return { health, connection: toPublicConnection(row, health) };
  });

  app.patch('/api/v1/git-connections/:connectionId', async (request) => {
    const principal = requireAuthenticated(request);
    const params = z.object({ connectionId: z.string().uuid() }).parse(request.params);
    const body = updateConnectionSchema.parse(request.body);

    const [row] = await app.database.db
      .select()
      .from(gitRepositoryConnections)
      .where(eq(gitRepositoryConnections.id, params.connectionId))
      .limit(1);
    if (!row) {
      throw new AppError({
        code: 'GIT_CONNECTION_NOT_FOUND',
        message: 'Git connection not found',
        statusCode: 404,
      });
    }
    requireWorkspaceAdmin(principal, row.workspaceId);

    if (body.projectId !== undefined) {
      await assertProjectInWorkspace(app.database, row.workspaceId, body.projectId);
    }

    const [updated] = await app.database.db
      .update(gitRepositoryConnections)
      .set({
        projectId: body.projectId === undefined ? row.projectId : body.projectId,
        branch: body.branch ?? row.branch,
        accessToken: body.accessToken ?? row.accessToken,
        includePaths: body.includePaths ?? row.includePaths,
        excludePaths: body.excludePaths ?? row.excludePaths,
        pathMappings: body.pathMappings ?? row.pathMappings,
        webhookSecret:
          body.webhookSecret === undefined ? row.webhookSecret : body.webhookSecret,
        status: body.status ?? row.status,
        updatedAt: new Date(),
      })
      .where(eq(gitRepositoryConnections.id, row.id))
      .returning();

    return { connection: toPublicConnection(updated!) };
  });

  app.delete('/api/v1/git-connections/:connectionId', async (request, reply) => {
    const principal = requireAuthenticated(request);
    const params = z.object({ connectionId: z.string().uuid() }).parse(request.params);
    const [row] = await app.database.db
      .select()
      .from(gitRepositoryConnections)
      .where(eq(gitRepositoryConnections.id, params.connectionId))
      .limit(1);
    if (!row) {
      throw new AppError({
        code: 'GIT_CONNECTION_NOT_FOUND',
        message: 'Git connection not found',
        statusCode: 404,
      });
    }
    requireWorkspaceAdmin(principal, row.workspaceId);

    await app.database.db
      .delete(gitRepositoryConnections)
      .where(eq(gitRepositoryConnections.id, row.id));

    return reply.status(204).send();
  });

  app.post('/api/v1/git-connections/:connectionId/sync', async (request) => {
    const principal = requireAuthenticated(request);
    const params = z.object({ connectionId: z.string().uuid() }).parse(request.params);
    const [row] = await app.database.db
      .select()
      .from(gitRepositoryConnections)
      .where(eq(gitRepositoryConnections.id, params.connectionId))
      .limit(1);
    if (!row) {
      throw new AppError({
        code: 'GIT_CONNECTION_NOT_FOUND',
        message: 'Git connection not found',
        statusCode: 404,
      });
    }
    requireWorkspaceAdmin(principal, row.workspaceId);

    const result = await syncGitRepositoryConnection({
      database: app.database,
      connectionId: row.id,
      trigger: 'manual',
      actorUserId: principal.userId,
    });

    if (result.status === 'failed') {
      throw new AppError({
        code: 'GIT_SYNC_FAILED',
        message: result.errorMessage ?? 'Git sync failed',
        statusCode: 502,
        details: result,
      });
    }

    return { sync: result };
  });

  app.get('/api/v1/git-connections/:connectionId/sync-runs', async (request) => {
    const principal = requireAuthenticated(request);
    const params = z.object({ connectionId: z.string().uuid() }).parse(request.params);
    const [row] = await app.database.db
      .select()
      .from(gitRepositoryConnections)
      .where(eq(gitRepositoryConnections.id, params.connectionId))
      .limit(1);
    if (!row) {
      throw new AppError({
        code: 'GIT_CONNECTION_NOT_FOUND',
        message: 'Git connection not found',
        statusCode: 404,
      });
    }
    requireWorkspaceView(principal, row.workspaceId);

    const runs = await app.database.db
      .select()
      .from(gitSyncRuns)
      .where(eq(gitSyncRuns.connectionId, row.id))
      .orderBy(desc(gitSyncRuns.createdAt))
      .limit(50);

    return { syncRuns: runs.map(toPublicSyncRun) };
  });

  app.post('/api/v1/git/webhooks/github', async (request, reply) => {
    const signature = request.headers['x-hub-signature-256'];
    const event = typeof request.headers['x-github-event'] === 'string'
      ? request.headers['x-github-event']
      : '';
    // Prefer raw body when available (set by content-type parser); fall back to JSON.
    const requestWithRaw = request as unknown as { rawBody?: string; body?: unknown };
    const rawBody =
      typeof requestWithRaw.rawBody === 'string'
        ? requestWithRaw.rawBody
        : typeof request.body === 'string'
          ? request.body
          : JSON.stringify(request.body ?? {});

    const payload = z
      .object({
        repository: z
          .object({
            name: z.string(),
            owner: z.object({ login: z.string() }),
          })
          .optional(),
        ref: z.string().optional(),
      })
      .passthrough()
      .parse(
        typeof request.body === 'string'
          ? JSON.parse(request.body)
          : (request.body ?? {}),
      );

    if (!payload.repository || (event !== 'push' && event !== 'ping')) {
      return reply.status(202).send({ ok: true, ignored: true, event });
    }

    if (event === 'ping') {
      return reply.status(200).send({ ok: true, event: 'ping' });
    }

    const owner = payload.repository.owner.login;
    const repo = payload.repository.name;
    const branchFromRef = payload.ref?.startsWith('refs/heads/')
      ? payload.ref.slice('refs/heads/'.length)
      : undefined;

    const connections = await app.database.db
      .select()
      .from(gitRepositoryConnections)
      .where(
        and(
          eq(gitRepositoryConnections.provider, 'github'),
          eq(gitRepositoryConnections.owner, owner),
          eq(gitRepositoryConnections.repo, repo),
          eq(gitRepositoryConnections.status, 'active'),
        ),
      );

    const matched = connections.filter(
      (connection) => !branchFromRef || connection.branch === branchFromRef,
    );

    let enqueued = 0;
    for (const connection of matched) {
      if (!connection.webhookSecret) {
        continue;
      }
      const ok = verifyGitHubWebhookSignature(
        rawBody,
        typeof signature === 'string' ? signature : undefined,
        connection.webhookSecret,
      );
      if (!ok) {
        continue;
      }

      const queue = createGitSyncQueue(app.env.REDIS_URL);
      try {
        await enqueueGitSyncJob(queue, {
          connectionId: connection.id,
          trigger: 'webhook',
          actorUserId: connection.createdBy,
        });
        enqueued += 1;
      } finally {
        await queue.close();
      }
    }

    return reply.status(202).send({ ok: true, enqueued, event });
  });
}
