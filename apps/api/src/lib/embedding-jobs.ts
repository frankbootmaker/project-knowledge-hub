import type { FastifyInstance } from 'fastify';
import {
  createEmbeddingReindexQueue,
  enqueueEmbeddingReindexJob,
  enqueueEmbeddingWorkspaceReindexJob,
} from '@project-knowledge-hub/jobs';

/** Fire-and-forget reindex enqueue when embeddings are enabled. */
export async function maybeEnqueueEmbeddingReindex(
  app: FastifyInstance,
  knowledgeRecordId: string,
  options?: { force?: boolean },
): Promise<void> {
  if (app.env.EMBEDDING_PROVIDER === 'disabled') {
    return;
  }
  const queue = createEmbeddingReindexQueue(app.env.REDIS_URL);
  try {
    await enqueueEmbeddingReindexJob(queue, {
      knowledgeRecordId,
      force: options?.force,
    });
  } finally {
    await queue.close();
  }
}

export async function enqueueWorkspaceEmbeddingReindex(
  app: FastifyInstance,
  workspaceId: string,
  options?: { force?: boolean },
): Promise<string> {
  const queue = createEmbeddingReindexQueue(app.env.REDIS_URL);
  try {
    return await enqueueEmbeddingWorkspaceReindexJob(queue, {
      kind: 'workspace',
      workspaceId,
      force: options?.force,
    });
  } finally {
    await queue.close();
  }
}
