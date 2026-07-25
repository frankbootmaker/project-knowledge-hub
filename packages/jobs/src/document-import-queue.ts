import { Queue } from 'bullmq';
import {
  DOCUMENT_IMPORT_CONVERT_JOB,
  DOCUMENT_IMPORT_CONVERT_QUEUE,
  type DocumentImportConvertJobPayload,
} from './queues.js';

export function createDocumentImportConvertQueue(
  redisUrl: string,
): Queue<DocumentImportConvertJobPayload> {
  return new Queue<DocumentImportConvertJobPayload>(DOCUMENT_IMPORT_CONVERT_QUEUE, {
    connection: { url: redisUrl, maxRetriesPerRequest: null },
    defaultJobOptions: {
      removeOnComplete: 100,
      removeOnFail: 200,
      attempts: 2,
      backoff: { type: 'exponential', delay: 5000 },
    },
  });
}

export async function enqueueDocumentImportConvertJob(
  queue: Queue<DocumentImportConvertJobPayload>,
  payload: DocumentImportConvertJobPayload,
): Promise<string> {
  const job = await queue.add(DOCUMENT_IMPORT_CONVERT_JOB, payload, {
    jobId: `doc-import-${payload.importId}`,
  });
  return job.id ?? 'unknown';
}
