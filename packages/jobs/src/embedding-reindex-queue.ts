import { Queue } from 'bullmq';
import {
  EMBEDDING_REINDEX_JOB,
  EMBEDDING_REINDEX_QUEUE,
  type EmbeddingReindexJobPayload,
  type EmbeddingReindexQueueJobData,
  type EmbeddingReindexWorkspaceJobPayload,
} from './queues.js';

export function createEmbeddingReindexQueue(
  redisUrl: string,
): Queue<EmbeddingReindexQueueJobData> {
  return new Queue<EmbeddingReindexQueueJobData>(EMBEDDING_REINDEX_QUEUE, {
    connection: { url: redisUrl, maxRetriesPerRequest: null },
    defaultJobOptions: {
      removeOnComplete: 100,
      removeOnFail: 200,
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
    },
  });
}

export async function enqueueEmbeddingReindexJob(
  queue: Queue<EmbeddingReindexQueueJobData>,
  payload: EmbeddingReindexJobPayload,
): Promise<string> {
  const job = await queue.add(EMBEDDING_REINDEX_JOB, payload, {
    jobId: `embed-${payload.knowledgeRecordId}-${payload.force ? 'force-' : ''}${Date.now()}`,
  });
  return job.id ?? 'unknown';
}

export async function enqueueEmbeddingWorkspaceReindexJob(
  queue: Queue<EmbeddingReindexQueueJobData>,
  payload: EmbeddingReindexWorkspaceJobPayload,
): Promise<string> {
  const job = await queue.add(EMBEDDING_REINDEX_JOB, payload, {
    jobId: `embed-ws-${payload.workspaceId}-${Date.now()}`,
  });
  return job.id ?? 'unknown';
}
