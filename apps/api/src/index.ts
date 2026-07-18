import { createRuntime } from './app.js';

async function main(): Promise<void> {
  const { app, env, database, redis } = await createRuntime();

  let shuttingDown = false;

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    app.log.info({ signal }, 'Shutting down API');

    try {
      await app.close();
      await redis.quit();
      await database.close();
      app.log.info('API shutdown complete');
      process.exit(0);
    } catch (error) {
      app.log.error({ err: error }, 'API shutdown failed');
      process.exit(1);
    }
  };

  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });

  await app.listen({ port: env.API_PORT, host: '0.0.0.0' });
  app.log.info(
    {
      port: env.API_PORT,
      appEnv: env.APP_ENV,
    },
    'API listening',
  );
}

main().catch((error: unknown) => {
  console.error('Failed to start API', error);
  process.exit(1);
});
