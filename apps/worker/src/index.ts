import { Worker } from 'bullmq';
import { eq } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { loadEnv } from '@project-knowledge-hub/config';
import {
  createDatabase,
  gitRepositoryConnections,
} from '@project-knowledge-hub/database';
import { syncGitRepositoryConnection } from '@project-knowledge-hub/git-connectors';
import {
  createGitSyncQueue,
  enqueueGitSyncJob,
  ensureGitSyncSafetySchedule,
  GIT_SYNC_JOB,
  GIT_SYNC_QUEUE,
  GIT_SYNC_SAFETY_JOB,
  isGitSyncSafetyJob,
  type GitSyncQueueJobData,
} from '@project-knowledge-hub/jobs';
import { createLogger } from '@project-knowledge-hub/observability';

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
  const gitSyncQueue = createGitSyncQueue(env.REDIS_URL);

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down worker');

    try {
      if (gitWorker) {
        await gitWorker.close();
      }
      await gitSyncQueue.close();
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

  logger.info(
    {
      appEnv: env.APP_ENV,
      redis: 'connected',
      queues: [GIT_SYNC_QUEUE],
      gitSyncSafety: safetySchedule,
      status: 'ready',
    },
    'Worker ready',
  );
}

main().catch((error: unknown) => {
  console.error('Failed to start worker', error);
  process.exit(1);
});
