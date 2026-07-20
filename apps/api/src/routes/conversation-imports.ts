import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  createConversationImportInputSchema,
  createDraftFromImportInputSchema,
} from '@project-knowledge-hub/conversation-import';
import {
  requireWorkspaceMaintainer,
  requireWorkspaceView,
} from '@project-knowledge-hub/permissions';
import {
  assertMutatingOrigin,
  requireAuthenticated,
} from '../plugins/auth.js';
import {
  archiveConversationImport,
  createConversationImport,
  createDraftFromConversationImport,
  getConversationImport,
  listConversationImports,
} from '../lib/conversation-import-service.js';

export async function registerConversationImportRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get('/api/v1/conversation-imports', async (request) => {
    const principal = requireAuthenticated(request);
    const query = z
      .object({
        workspaceId: z.string().uuid(),
        includeArchived: z
          .enum(['true', 'false'])
          .optional()
          .transform((value) => value === 'true'),
      })
      .parse(request.query);

    requireWorkspaceView(principal, query.workspaceId);

    const imports = await listConversationImports(app, query.workspaceId, {
      includeArchived: query.includeArchived,
    });
    return { conversationImports: imports };
  });

  app.get('/api/v1/conversation-imports/:id', async (request) => {
    const principal = requireAuthenticated(request);
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const conversationImport = await getConversationImport(app, params.id);
    requireWorkspaceView(principal, conversationImport.workspaceId);
    return { conversationImport };
  });

  app.post('/api/v1/conversation-imports', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    const body = createConversationImportInputSchema.parse(request.body);
    requireWorkspaceMaintainer(principal, body.workspaceId);

    const conversationImport = await createConversationImport(
      app,
      body,
      {
        actorType: 'user',
        actorId: principal.userId,
        userId: principal.userId,
      },
      request.ip,
    );

    return { conversationImport };
  });

  app.post('/api/v1/conversation-imports/:id/records', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = createDraftFromImportInputSchema.parse(request.body);

    const existing = await getConversationImport(app, params.id);
    requireWorkspaceMaintainer(principal, existing.workspaceId);

    const result = await createDraftFromConversationImport(
      app,
      params.id,
      body,
      {
        actorType: 'user',
        actorId: principal.userId,
        userId: principal.userId,
      },
      request.ip,
    );

    return result;
  });

  app.post('/api/v1/conversation-imports/:id/archive', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    const params = z.object({ id: z.string().uuid() }).parse(request.params);

    const existing = await getConversationImport(app, params.id);
    requireWorkspaceMaintainer(principal, existing.workspaceId);

    const conversationImport = await archiveConversationImport(
      app,
      params.id,
      {
        actorType: 'user',
        actorId: principal.userId,
        userId: principal.userId,
      },
      request.ip,
    );

    return { conversationImport };
  });
}
