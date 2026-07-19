import Fastify, {
  type FastifyInstance,
  type FastifyError,
  type FastifyReply,
  type FastifyRequest,
} from 'fastify';
import { Redis } from 'ioredis';
import { ZodError } from 'zod';
import { loadEnv, type AppEnv } from '@project-knowledge-hub/config';
import { createDatabase, type Database } from '@project-knowledge-hub/database';
import { AppError } from '@project-knowledge-hub/domain';
import type { MailTransport } from '@project-knowledge-hub/mail';
import { registerAuthHooks } from './plugins/auth.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerApiClientRoutes } from './routes/api-clients.js';
import { registerAuditRoutes } from './routes/audit.js';
import { registerKnowledgeRecordRoutes } from './routes/knowledge-records.js';
import { registerLlmOpenApiRoutes } from './routes/llm-openapi.js';
import { registerMailSettingsRoutes } from './routes/mail-settings.js';
import { registerMcpRoutes } from './routes/mcp.js';
import { registerMcpSetupRoutes } from './routes/mcp-setup.js';
import { registerMembershipRoutes } from './routes/memberships.js';
import { registerOrganizationRoutes } from './routes/organizations.js';
import { registerProjectRoutes } from './routes/projects.js';
import { registerReadyRoutes } from './routes/ready.js';
import { registerRootRoutes } from './routes/root.js';
import { registerSearchRoutes } from './routes/search.js';
import { registerSystemRoutes } from './routes/systems.js';
import { registerUserRoutes } from './routes/users.js';
import { registerGitConnectionRoutes } from './routes/git-connections.js';
import { registerWorkspaceRoutes } from './routes/workspaces.js';
import {
  createResolvingMailTransport,
  resolveMailConfig,
} from './lib/mail-settings.js';

export type ApiDependencies = {
  env: AppEnv;
  database: Database;
  redis: Redis;
  mail?: MailTransport;
};

export async function buildApp(deps: ApiDependencies): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: deps.env.LOG_LEVEL,
      timestamp: () => `,"time":"${new Date().toISOString()}"`,
      redact: {
        paths: [
          'password',
          'token',
          'authorization',
          'DATABASE_URL',
          'REDIS_URL',
          'BOOTSTRAP_ADMIN_PASSWORD',
          'SESSION_SECRET',
          'SMTP_PASS',
          'RESEND_API_KEY',
          'req.headers.authorization',
          'req.headers.cookie',
        ],
        censor: '[Redacted]',
      },
    },
  });

  const mail =
    deps.mail ??
    createResolvingMailTransport(async () => {
      const resolved = await resolveMailConfig(deps.database, deps.env);
      return resolved.config;
    });

  app.decorate('env', deps.env);
  app.decorate('database', deps.database);
  app.decorate('redis', deps.redis);
  app.decorate('mail', mail);

  app.addHook('onRequest', async (request, reply) => {
    const origin = request.headers.origin;
    if (origin && origin === new URL(deps.env.WEB_URL).origin) {
      reply.header('Access-Control-Allow-Origin', origin);
      reply.header('Access-Control-Allow-Credentials', 'true');
      reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, MCP-Protocol-Version, MCP-Session-Id');
      reply.header('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
      reply.header('Vary', 'Origin');
    }

    if (request.method === 'OPTIONS') {
      return reply.status(204).send();
    }
  });

  app.setErrorHandler((error: FastifyError | Error, request: FastifyRequest, reply: FastifyReply) => {
    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed',
          details: error.flatten(),
        },
      });
    }

    if (error instanceof AppError) {
      request.log.warn({ err: error, code: error.code }, error.message);
      return reply.status(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          details: error.details ?? null,
        },
      });
    }

    const statusCode =
      'statusCode' in error && typeof error.statusCode === 'number' ? error.statusCode : 500;

    request.log.error({ err: error }, 'Unhandled API error');
    return reply.status(statusCode).send({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: statusCode >= 500 ? 'Internal server error' : error.message,
        details: null,
      },
    });
  });

  // Preserve raw JSON for GitHub webhook HMAC verification.
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (request, body, done) => {
      const text = typeof body === 'string' ? body : body.toString('utf8');
      (request as { rawBody?: string }).rawBody = text;
      try {
        done(null, text.length ? JSON.parse(text) : {});
      } catch (error) {
        done(error as Error, undefined);
      }
    },
  );

  await registerAuthHooks(app);
  await registerRootRoutes(app);
  await registerHealthRoutes(app);
  await registerReadyRoutes(app);
  await registerAuthRoutes(app);
  await registerWorkspaceRoutes(app);
  await registerProjectRoutes(app);
  await registerSystemRoutes(app);
  await registerKnowledgeRecordRoutes(app);
  await registerSearchRoutes(app);
  await registerGitConnectionRoutes(app);
  await registerOrganizationRoutes(app);
  await registerUserRoutes(app);
  await registerMailSettingsRoutes(app);
  await registerMembershipRoutes(app);
  await registerApiClientRoutes(app);
  await registerAuditRoutes(app);
  await registerMcpSetupRoutes(app);
  await registerLlmOpenApiRoutes(app);
  await registerMcpRoutes(app);

  return app;
}

export async function createRuntime(): Promise<{
  app: FastifyInstance;
  env: AppEnv;
  database: Database;
  redis: Redis;
}> {
  const env = loadEnv();
  const database = createDatabase(env.DATABASE_URL);
  const redis = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: 1,
    enableReadyCheck: true,
    lazyConnect: true,
  });

  await redis.connect();

  const app = await buildApp({ env, database, redis });
  return { app, env, database, redis };
}

declare module 'fastify' {
  interface FastifyInstance {
    env: AppEnv;
    database: Database;
    redis: Redis;
    mail: MailTransport;
  }
}
