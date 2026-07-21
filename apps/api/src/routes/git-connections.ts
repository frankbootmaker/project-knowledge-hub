import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { and, desc, eq, ne } from 'drizzle-orm';
import { z } from 'zod';
import {
  gitRepositoryConnections,
  gitSyncRuns,
  workspaces,
} from '@project-knowledge-hub/database';
import {
  assessGitSyncHealth,
  connectionToProviderRef,
  DEFAULT_EXCLUDE_PATHS,
  DEFAULT_INCLUDE_PATHS,
  DEFAULT_PATH_MAPPINGS,
  getGitSyncProvider,
  normalizeBaseUrl,
  syncGitRepositoryConnection,
  type GitSyncHealth,
} from '@project-knowledge-hub/git-connectors';
import {
  AppError,
  isSyncProviderSupported,
  providerNeedsBaseUrl,
  recordTypeSchema,
  syncProviderSchema,
  type SyncProvider,
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
  owner: z.string().min(1).max(200),
  repo: z.string().min(1).max(200),
  branch: z.string().min(1).max(200).default('main'),
  baseUrl: z.string().url().max(500).nullable().optional(),
  accessToken: z.string().min(8).max(500),
  includePaths: z.array(z.string().min(1).max(300)).max(50).optional(),
  excludePaths: z.array(z.string().min(1).max(300)).max(50).optional(),
  pathMappings: z.array(pathMappingSchema).max(100).optional(),
  webhookSecret: z.string().min(8).max(200).nullable().optional(),
});

const updateConnectionSchema = z.object({
  projectId: z.string().uuid().nullable().optional(),
  branch: z.string().min(1).max(200).optional(),
  baseUrl: z.string().url().max(500).nullable().optional(),
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
    baseUrl: row.baseUrl ?? null,
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
    ref: connectionToProviderRef(row),
    checkRemote,
  });
}

function headerMap(headers: Record<string, unknown>): Record<string, string | undefined> {
  const mapped: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === 'string') {
      mapped[key.toLowerCase()] = value;
    } else if (Array.isArray(value) && typeof value[0] === 'string') {
      mapped[key.toLowerCase()] = value[0];
    }
  }
  return mapped;
}

function assertBaseUrlForProvider(
  provider: SyncProvider,
  baseUrl: string | null | undefined,
): string | null {
  const normalized = normalizeBaseUrl(baseUrl ?? null);
  if (providerNeedsBaseUrl(provider) && !normalized) {
    throw new AppError({
      code: 'BASE_URL_REQUIRED',
      message: `Provider “${provider}” requires a base URL`,
      statusCode: 400,
    });
  }
  return normalized;
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
        code: 'UNKNOWN_GIT_PROVIDER',
        message: `Unknown git provider “${body.provider}”`,
        statusCode: 400,
      });
    }

    const baseUrl = assertBaseUrlForProvider(body.provider, body.baseUrl);

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
        baseUrl,
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

    const nextBaseUrl =
      body.baseUrl === undefined
        ? row.baseUrl
        : assertBaseUrlForProvider(
            syncProviderSchema.parse(row.provider),
            body.baseUrl,
          );

    const [updated] = await app.database.db
      .update(gitRepositoryConnections)
      .set({
        projectId: body.projectId === undefined ? row.projectId : body.projectId,
        branch: body.branch ?? row.branch,
        baseUrl: nextBaseUrl,
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

  app.delete('/api/v1/git-connections/:connectionId/sync-runs', async (request, reply) => {
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

    // Keep in-flight runs so an active sync can still finish updating its row.
    await app.database.db
      .delete(gitSyncRuns)
      .where(and(eq(gitSyncRuns.connectionId, row.id), ne(gitSyncRuns.status, 'running')));

    return reply.status(204).send();
  });

  async function handleProviderWebhook(
    provider: SyncProvider,
    request: FastifyRequest,
    reply: FastifyReply,
  ) {
    const headers = headerMap(request.headers as Record<string, unknown>);
    const requestWithRaw = request as unknown as { rawBody?: string; body?: unknown };
    const rawBody =
      typeof requestWithRaw.rawBody === 'string'
        ? requestWithRaw.rawBody
        : typeof request.body === 'string'
          ? request.body
          : JSON.stringify(request.body ?? {});
    const payload =
      typeof request.body === 'string'
        ? JSON.parse(request.body)
        : (request.body ?? {});

    // GitHub / Forgejo ping
    const event =
      headers['x-github-event'] ??
      headers['x-gitea-event'] ??
      headers['x-forgejo-event'] ??
      headers['x-gitlab-event'] ??
      headers['x-event-key'] ??
      '';
    if (event === 'ping') {
      return reply.status(200).send({ ok: true, event: 'ping', provider });
    }

    const adapter = getGitSyncProvider(provider);
    const match = adapter.matchPushWebhook?.(payload, headers);
    if (!match) {
      return reply.status(202).send({ ok: true, ignored: true, provider, event });
    }

    const connections = await app.database.db
      .select()
      .from(gitRepositoryConnections)
      .where(
        and(
          eq(gitRepositoryConnections.provider, provider),
          eq(gitRepositoryConnections.repo, match.repo),
          eq(gitRepositoryConnections.status, 'active'),
        ),
      );

    const matched = connections.filter((connection) => {
      if (match.owner && connection.owner !== match.owner) return false;
      if (match.branch && connection.branch !== match.branch) return false;
      return true;
    });

    let enqueued = 0;
    for (const connection of matched) {
      if (!connection.webhookSecret) continue;
      const ok = adapter.verifyWebhookSignature?.(
        rawBody,
        headers,
        connection.webhookSecret,
      );
      if (!ok) continue;

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

    return reply.status(202).send({ ok: true, enqueued, provider, event });
  }

  app.post('/api/v1/git/webhooks/github', async (request, reply) =>
    handleProviderWebhook('github', request, reply),
  );
  app.post('/api/v1/git/webhooks/gitlab', async (request, reply) =>
    handleProviderWebhook('gitlab', request, reply),
  );
  app.post('/api/v1/git/webhooks/azure-devops', async (request, reply) =>
    handleProviderWebhook('azure_devops', request, reply),
  );
  app.post('/api/v1/git/webhooks/bitbucket', async (request, reply) =>
    handleProviderWebhook('bitbucket', request, reply),
  );
  app.post('/api/v1/git/webhooks/forgejo', async (request, reply) =>
    handleProviderWebhook('forgejo', request, reply),
  );
}
