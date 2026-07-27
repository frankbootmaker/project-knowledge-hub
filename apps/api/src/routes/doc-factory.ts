import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { workspaces } from '@project-knowledge-hub/database';
import { AppError } from '@project-knowledge-hub/domain';
import { requireWorkspaceView } from '@project-knowledge-hub/permissions';
import { requireAuthenticated } from '../plugins/auth.js';
import {
  blankPublicStylePack,
  listStylePacksForOrganization,
  type PublicStylePack,
} from '../lib/style-packs.js';

export async function registerDocFactoryRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get('/api/v1/doc-factory/style-packs', async (request) => {
    const principal = requireAuthenticated(request);
    const query = z
      .object({ workspaceId: z.string().uuid() })
      .parse(request.query);

    requireWorkspaceView(principal, query.workspaceId);

    const [workspace] = await app.database.db
      .select({
        id: workspaces.id,
        organizationId: workspaces.organizationId,
      })
      .from(workspaces)
      .where(eq(workspaces.id, query.workspaceId))
      .limit(1);

    if (!workspace) {
      throw new AppError({
        code: 'WORKSPACE_NOT_FOUND',
        message: 'Workspace not found',
        statusCode: 404,
      });
    }

    const packs = await listStylePacksForOrganization(
      app.database,
      workspace.organizationId,
      { includeArchived: false },
    );

    return {
      workspaceId: workspace.id,
      organizationId: workspace.organizationId,
      stylePacks: [blankPublicStylePack(), ...packs] satisfies PublicStylePack[],
    };
  });
}
