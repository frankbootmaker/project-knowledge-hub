import type { FastifyInstance } from 'fastify';

export async function registerRootRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', async () => {
    return {
      service: 'project-knowledge-hub-api',
      message: 'API root. Use the web UI on WEB_URL, or the endpoints below.',
      webUrl: app.env.WEB_URL,
      endpoints: {
        health: '/health',
        ready: '/ready',
        auth: {
          login: 'POST /api/v1/auth/login',
          logout: 'POST /api/v1/auth/logout',
          session: 'GET /api/v1/auth/session',
        },
        workspaces: '/api/v1/workspaces',
        projects: '/api/v1/projects',
        systems: '/api/v1/systems',
        knowledgeRecords: '/api/v1/knowledge-records',
        knowledgeRecordVersions: '/api/v1/knowledge-records/:recordId/versions',
        knowledgeRecordVerify: 'POST /api/v1/knowledge-records/:recordId/verify',
        knowledgeRecordMarkCurrent: 'POST /api/v1/knowledge-records/:recordId/mark-current',
        search: '/api/v1/search',
        apiClients: '/api/v1/api-clients',
        mcp: '/mcp',
      },
    };
  });
}
