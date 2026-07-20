import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { embeddingConfigFromEnv } from '@project-knowledge-hub/config';
import { requireWorkspaceMaintainer } from '@project-knowledge-hub/permissions';
import {
  assertMutatingOrigin,
  requireAuthenticated,
} from '../plugins/auth.js';
import { enqueueWorkspaceEmbeddingReindex } from '../lib/embedding-jobs.js';

export async function registerEmbeddingRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/search/capabilities', async (request) => {
    requireAuthenticated(request);
    const config = embeddingConfigFromEnv(app.env);
    return {
      fts: true,
      hybridAvailable: config.hybridEnabled,
      embeddingProvider: config.provider,
      embeddingModel: config.model,
      embeddingDimensions: config.dimensions,
    };
  });

  app.post('/api/v1/workspaces/:workspaceId/embeddings/reindex', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    const params = z
      .object({ workspaceId: z.string().uuid() })
      .parse(request.params);
    const body = z
      .object({ force: z.boolean().optional() })
      .parse(request.body ?? {});

    requireWorkspaceMaintainer(principal, params.workspaceId);

    if (app.env.EMBEDDING_PROVIDER === 'disabled') {
      return {
        enqueued: false,
        reason: 'provider_disabled',
      };
    }

    const jobId = await enqueueWorkspaceEmbeddingReindex(
      app,
      params.workspaceId,
      { force: body.force },
    );

    return {
      enqueued: true,
      jobId,
    };
  });
}
