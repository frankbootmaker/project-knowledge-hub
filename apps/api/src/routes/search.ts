import type { FastifyInstance, FastifyRequest } from 'fastify';
import { requireWorkspaceView } from '@project-knowledge-hub/permissions';
import { requireAuthenticated } from '../plugins/auth.js';
import { parseSearchInput, runSearch } from '../lib/search-service.js';
import {
  auditKnowledgeSearch,
  resolveWorkspaceOrganizationId,
} from '../lib/telemetry-audit.js';

export async function registerSearchRoutes(app: FastifyInstance): Promise<void> {
  const handler = async (request: FastifyRequest) => {
    const principal = requireAuthenticated(request);
    const raw = request.method === 'GET' ? request.query : request.body;
    const input = parseSearchInput(raw);
    requireWorkspaceView(principal, input.workspaceId);
    const result = await runSearch(app, input);
    const organizationId = await resolveWorkspaceOrganizationId(
      app.database,
      input.workspaceId,
    );
    await auditKnowledgeSearch({
      database: app.database,
      organizationId,
      actorType: 'user',
      actorId: principal.userId,
      workspaceId: input.workspaceId,
      query: input.query,
      mode: result.mode,
      resultCount: result.total,
      projectId: input.projectId,
      systemId: input.systemId,
      via: 'session',
      ipAddress: request.ip,
    });
    return result;
  };

  app.get('/api/v1/search', handler);
  app.post('/api/v1/search', handler);
}
