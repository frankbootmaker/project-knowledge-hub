import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { registerHealthRoutes } from './health.js';

describe('GET /health (unit)', () => {
  it('returns service health payload', async () => {
    const app = Fastify();
    await registerHealthRoutes(app);
    await app.ready();

    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: 'ok',
      service: 'project-knowledge-hub-api',
    });

    await app.close();
  });
});
