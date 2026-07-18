import { Redis } from 'ioredis';
import { loadEnv } from '@project-knowledge-hub/config';
import { createLogger } from '@project-knowledge-hub/observability';

async function main(): Promise<void> {
  const env = loadEnv();
  const logger = createLogger({
    name: 'worker',
    level: env.LOG_LEVEL,
    pretty: env.NODE_ENV === 'development',
  });

  const redis = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: 1,
    enableReadyCheck: true,
    lazyConnect: true,
  });

  let shuttingDown = false;

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down worker');

    try {
      await redis.quit();
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

  logger.info(
    {
      appEnv: env.APP_ENV,
      redis: 'connected',
      status: 'ready',
    },
    'Worker ready',
  );

  // Milestone 0: keep process alive without processing jobs yet.
  setInterval(() => {
    logger.debug('Worker heartbeat');
  }, 60_000).unref();
}

main().catch((error: unknown) => {
  console.error('Failed to start worker', error);
  process.exit(1);
});
