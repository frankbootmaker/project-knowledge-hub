import { Worker } from 'bullmq';
import { and, eq, isNull } from 'drizzle-orm';
import { Redis } from 'ioredis';
import {
  embeddingConfigFromEnv,
  loadEnv,
} from '@project-knowledge-hub/config';
import { syncPendingOffsiteDump } from '@project-knowledge-hub/blob-store';
import {
  createDatabase,
  gitRepositoryConnections,
  knowledgeRecords,
} from '@project-knowledge-hub/database';
import {
  createEmbeddingProvider,
  reindexKnowledgeRecord,
} from '@project-knowledge-hub/embeddings';
import { syncGitRepositoryConnection } from '@project-knowledge-hub/git-connectors';
import {
  createEmbeddingReindexQueue,
  createGitSyncQueue,
  enqueueEmbeddingReindexJob,
  enqueueGitSyncJob,
  ensureGitSyncSafetySchedule,
  EMBEDDING_REINDEX_QUEUE,
  GIT_SYNC_JOB,
  GIT_SYNC_QUEUE,
  GIT_SYNC_SAFETY_JOB,
  isEmbeddingWorkspaceReindexJob,
  isGitSyncSafetyJob,
  type EmbeddingReindexQueueJobData,
  type GitSyncQueueJobData,
} from '@project-knowledge-hub/jobs';
import { createLogger } from '@project-knowledge-hub/observability';
import { resolveWorkerBlobStore } from './resolve-blob.js';
import { resolveWorkerMailConfig } from './resolve-mail.js';
import { escalateStaleSignupApprovals } from './signup-pending-escalate.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const logger = createLogger({
    name: 'worker',
    level: env.LOG_LEVEL,
    pretty: env.NODE_ENV === 'development',
  });

  const database = createDatabase(env.DATABASE_URL);
  const redis = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: true,
  });

  let shuttingDown = false;
  let gitWorker: Worker<GitSyncQueueJobData> | null = null;
  let embeddingWorker: Worker<EmbeddingReindexQueueJobData> | null = null;
  let offsiteTimer: ReturnType<typeof setInterval> | null = null;
  let signupEscalateTimer: ReturnType<typeof setInterval> | null = null;
  const gitSyncQueue = createGitSyncQueue(env.REDIS_URL);
  const embeddingQueue = createEmbeddingReindexQueue(env.REDIS_URL);
  const embeddingConfig = embeddingConfigFromEnv(env);
  const embeddingProvider = createEmbeddingProvider(embeddingConfig);

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down worker');

    try {
      if (offsiteTimer) {
        clearInterval(offsiteTimer);
      }
      if (signupEscalateTimer) {
        clearInterval(signupEscalateTimer);
      }
      if (gitWorker) {
        await gitWorker.close();
      }
      if (embeddingWorker) {
        await embeddingWorker.close();
      }
      await gitSyncQueue.close();
      await embeddingQueue.close();
      await redis.quit();
      await database.close();
      logger.info('Worker shutdown complete');
      process.exit(0);
    } catch (error) {
      logger.error({ err: error }, 'Worker shutdown failed');
      process.exit(1);
    }
  };

  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });

  await redis.connect();
  const ping = await redis.ping();
  if (ping !== 'PONG') {
    throw new Error(`Unexpected Redis ping response: ${ping}`);
  }

  const safetySchedule = await ensureGitSyncSafetySchedule(
    gitSyncQueue,
    env.GIT_SYNC_SAFETY_INTERVAL_MS,
  );

  gitWorker = new Worker<GitSyncQueueJobData>(
    GIT_SYNC_QUEUE,
    async (job) => {
      if (job.name === GIT_SYNC_SAFETY_JOB || isGitSyncSafetyJob(job.data)) {
        const rows = await database.db
          .select({
            id: gitRepositoryConnections.id,
            createdBy: gitRepositoryConnections.createdBy,
            status: gitRepositoryConnections.status,
          })
          .from(gitRepositoryConnections)
          .where(eq(gitRepositoryConnections.status, 'active'));

        let enqueued = 0;
        for (const row of rows) {
          await enqueueGitSyncJob(gitSyncQueue, {
            connectionId: row.id,
            trigger: 'scheduled',
            actorUserId: row.createdBy,
          });
          enqueued += 1;
        }

        logger.info(
          { enqueued, connections: rows.length },
          'Git sync safety sweep enqueued connection syncs',
        );
        return { enqueued };
      }

      if (job.name !== GIT_SYNC_JOB && !('connectionId' in job.data)) {
        logger.warn({ jobName: job.name }, 'Ignoring unknown git-sync job');
        return { ignored: true };
      }

      const payload = job.data;
      if (!('connectionId' in payload)) {
        throw new Error('Invalid git sync job payload');
      }

      logger.info(
        {
          jobId: job.id,
          connectionId: payload.connectionId,
          trigger: payload.trigger,
        },
        'Processing git sync job',
      );
      const result = await syncGitRepositoryConnection({
        database,
        connectionId: payload.connectionId,
        trigger: payload.trigger,
        actorUserId: payload.actorUserId,
      });
      if (result.status === 'failed') {
        throw new Error(result.errorMessage ?? 'Git sync failed');
      }
      return result;
    },
    {
      connection: { url: env.REDIS_URL, maxRetriesPerRequest: null },
      concurrency: 2,
    },
  );

  gitWorker.on('failed', (job, error) => {
    logger.error(
      {
        jobId: job?.id,
        jobName: job?.name,
        err: error,
        connectionId:
          job?.data && 'connectionId' in job.data ? job.data.connectionId : undefined,
      },
      'Git sync job failed',
    );
  });

  embeddingWorker = new Worker<EmbeddingReindexQueueJobData>(
    EMBEDDING_REINDEX_QUEUE,
    async (job) => {
      if (isEmbeddingWorkspaceReindexJob(job.data)) {
        const rows = await database.db
          .select({ id: knowledgeRecords.id })
          .from(knowledgeRecords)
          .where(
            and(
              eq(knowledgeRecords.workspaceId, job.data.workspaceId),
              isNull(knowledgeRecords.archivedAt),
            ),
          );

        let enqueued = 0;
        for (const row of rows) {
          await enqueueEmbeddingReindexJob(embeddingQueue, {
            knowledgeRecordId: row.id,
            force: job.data.force,
          });
          enqueued += 1;
        }
        logger.info(
          { workspaceId: job.data.workspaceId, enqueued },
          'Workspace embedding reindex enqueued records',
        );
        return { enqueued };
      }

      if (!('knowledgeRecordId' in job.data)) {
        logger.warn({ jobName: job.name }, 'Ignoring unknown embedding job');
        return { ignored: true };
      }

      const result = await reindexKnowledgeRecord({
        database,
        provider: embeddingProvider,
        knowledgeRecordId: job.data.knowledgeRecordId,
        force: job.data.force,
      });
      logger.info(result, 'Embedding reindex finished');
      return result;
    },
    {
      connection: { url: env.REDIS_URL, maxRetriesPerRequest: null },
      concurrency: 1,
    },
  );

  embeddingWorker.on('failed', (job, error) => {
    logger.error(
      {
        jobId: job?.id,
        err: error,
        knowledgeRecordId:
          job?.data && 'knowledgeRecordId' in job.data
            ? job.data.knowledgeRecordId
            : undefined,
      },
      'Embedding reindex job failed',
    );
  });

  if (env.BACKUP_OFFSITE_SYNC_INTERVAL_MS > 0) {
    const runOffsiteSync = async () => {
      try {
        const { store, backupOffsite } = await resolveWorkerBlobStore(
          database,
          env,
        );
        if (!backupOffsite || store.provider === 'disabled') {
          return;
        }
        const result = await syncPendingOffsiteDump({
          blobStore: store,
          backupDir: env.BACKUP_DIR,
          schemaVersion: 'worker',
        });
        if (result.uploaded) {
          logger.info(
            { key: result.stamp.key, artifact: result.stamp.artifact },
            'Offsite backup upload completed',
          );
        }
      } catch (error) {
        logger.error({ err: error }, 'Offsite backup sync failed');
      }
    };
    void runOffsiteSync();
    offsiteTimer = setInterval(() => {
      void runOffsiteSync();
    }, env.BACKUP_OFFSITE_SYNC_INTERVAL_MS);
  }

  if (env.SIGNUP_PENDING_ESCALATE_INTERVAL_MS > 0) {
    const runSignupEscalate = async () => {
      try {
        const mailConfig = await resolveWorkerMailConfig(database, env);
        const result = await escalateStaleSignupApprovals({
          database,
          mailConfig,
          webUrl: env.WEB_URL,
          escalateAfterHours: env.SIGNUP_PENDING_ESCALATE_AFTER_HOURS,
        });
        if (result.escalated > 0) {
          logger.info(
            { escalated: result.escalated },
            'Signup pending escalation mailed',
          );
        }
      } catch (error) {
        logger.error({ err: error }, 'Signup pending escalation failed');
      }
    };
    void runSignupEscalate();
    signupEscalateTimer = setInterval(() => {
      void runSignupEscalate();
    }, env.SIGNUP_PENDING_ESCALATE_INTERVAL_MS);
  }

  logger.info(
    {
      appEnv: env.APP_ENV,
      redis: 'connected',
      queues: [GIT_SYNC_QUEUE, EMBEDDING_REINDEX_QUEUE],
      gitSyncSafety: safetySchedule,
      embeddingProvider: embeddingConfig.provider,
      backupOffsiteSyncMs: env.BACKUP_OFFSITE_SYNC_INTERVAL_MS,
      signupPendingEscalateMs: env.SIGNUP_PENDING_ESCALATE_INTERVAL_MS,
      signupPendingEscalateAfterHours: env.SIGNUP_PENDING_ESCALATE_AFTER_HOURS,
      status: 'ready',
    },
    'Worker ready',
  );
}

main().catch((error: unknown) => {
  console.error('Failed to start worker', error);
  process.exit(1);
});
