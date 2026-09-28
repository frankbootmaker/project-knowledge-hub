import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireSystemAdmin } from '@project-knowledge-hub/permissions';
import {
  assertMutatingOrigin,
  requireAuthenticated,
} from '../plugins/auth.js';
import {
  assertPurgeProject,
  assertPurgeTargetUser,
  loadPurgeProjectContext,
  loadPurgeUser,
  runSystemUserPurge,
} from '../lib/system-user-purge.js';
import { deleteMediaBytes } from '../lib/workspace-media.js';

const bodySchema = z.object({
  projectId: z.string().uuid(),
  dryRun: z.boolean().optional().default(false),
});

export async function registerSystemUserPurgeRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.post(
    '/api/v1/admin/system-users/:userId/purge',
    async (request) => {
      assertMutatingOrigin(app, request);
      const principal = requireAuthenticated(request);
      requireSystemAdmin(principal);
      const params = z
        .object({ userId: z.string().uuid() })
        .parse(request.params);
      const body = bodySchema.parse(request.body ?? {});

      const user = await loadPurgeUser(app.database, params.userId);
      assertPurgeTargetUser(user);
      const project = await loadPurgeProjectContext(
        app.database,
        body.projectId,
      );
      assertPurgeProject(project);

      const { store } = await app.getBlobStore();
      return runSystemUserPurge(app.database, {
        systemUserId: user.id,
        projectId: project.id,
        workspaceId: project.workspaceId,
        organizationId: project.organizationId,
        dryRun: body.dryRun,
        actorUserId: principal.userId,
        ipAddress: request.ip,
        log: request.log,
        deleteMedia: async (media) => {
          await deleteMediaBytes(
            app.env.MEDIA_UPLOAD_DIR,
            media.workspaceId,
            media.id,
            {
              blobStore: store,
              onError: (error, where) => {
                request.log.error(
                  { err: error, mediaId: media.id, where },
                  'Purge media storage delete failed',
                );
              },
            },
          );
        },
      });
    },
  );
}
