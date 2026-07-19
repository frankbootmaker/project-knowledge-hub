import type { FastifyInstance } from 'fastify';
import { organizations } from '@project-knowledge-hub/database';
import { requireSystemAdmin } from '@project-knowledge-hub/permissions';
import { requireAuthenticated } from '../plugins/auth.js';

export async function registerOrganizationRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/organizations', async (request) => {
    const principal = requireAuthenticated(request);
    requireSystemAdmin(principal);

    const rows = await app.database.db.select().from(organizations);
    return {
      organizations: rows.map((org) => ({
        id: org.id,
        name: org.name,
        slug: org.slug,
        createdAt: org.createdAt.toISOString(),
        updatedAt: org.updatedAt.toISOString(),
      })),
    };
  });
}
