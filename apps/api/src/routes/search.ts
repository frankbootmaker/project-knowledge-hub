import type { FastifyInstance, FastifyRequest } from 'fastify';
import { requireWorkspaceView } from '@project-knowledge-hub/permissions';
import { requireAuthenticated } from '../plugins/auth.js';
import { parseSearchInput, runSearch } from '../lib/search-service.js';

export async function registerSearchRoutes(app: FastifyInstance): Promise<void> {
  const handler = async (request: FastifyRequest) => {
    const principal = requireAuthenticated(request);
    const raw = request.method === 'GET' ? request.query : request.body;
    const input = parseSearchInput(raw);
    requireWorkspaceView(principal, input.workspaceId);
    return runSearch(app, input);
  };

  app.get('/api/v1/search', handler);
  app.post('/api/v1/search', handler);
}
