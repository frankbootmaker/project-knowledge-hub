import type { FastifyInstance } from 'fastify';
import { AppError } from '@project-knowledge-hub/domain';

export async function registerReadyRoutes(app: FastifyInstance): Promise<void> {
  app.get('/ready', async () => {
    const checks: Record<string, 'ok' | 'error'> = {
      postgres: 'error',
      redis: 'error',
    };

    try {
      await app.database.ping();
      checks.postgres = 'ok';
    } catch (error) {
      app.log.error({ err: error }, 'PostgreSQL readiness check failed');
    }

    try {
      const result = await app.redis.ping();
      if (result === 'PONG') {
        checks.redis = 'ok';
      }
    } catch (error) {
      app.log.error({ err: error }, 'Redis readiness check failed');
    }

    const ready = checks.postgres === 'ok' && checks.redis === 'ok';
    if (!ready) {
      throw new AppError({
        code: 'SERVICE_UNAVAILABLE',
        message: 'One or more dependencies are unavailable',
        statusCode: 503,
        details: { checks },
      });
    }

    return {
      status: 'ready',
      checks,
      timestamp: new Date().toISOString(),
    };
  });
}
