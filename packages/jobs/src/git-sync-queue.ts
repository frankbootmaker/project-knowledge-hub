import { Queue } from 'bullmq';
import {
  DEFAULT_GIT_SYNC_SAFETY_INTERVAL_MS,
  GIT_SYNC_JOB,
  GIT_SYNC_QUEUE,
  GIT_SYNC_SAFETY_JOB,
  type GitSyncJobPayload,
  type GitSyncQueueJobData,
} from './queues.js';

export function createGitSyncQueue(redisUrl: string): Queue<GitSyncQueueJobData> {
  return new Queue<GitSyncQueueJobData>(GIT_SYNC_QUEUE, {
    connection: { url: redisUrl, maxRetriesPerRequest: null },
    defaultJobOptions: {
      removeOnComplete: 100,
      removeOnFail: 200,
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
    },
  });
}

export async function enqueueGitSyncJob(
  queue: Queue<GitSyncQueueJobData>,
  payload: GitSyncJobPayload,
): Promise<string> {
  const job = await queue.add(GIT_SYNC_JOB, payload, {
    jobId: `git-sync-${payload.connectionId}-${Date.now()}`,
  });
  return job.id ?? 'unknown';
}

/**
 * Registers (or refreshes) a repeatable safety sweep that enqueues per-connection syncs.
 * Pass intervalMs = 0 to remove the schedule.
 */
export async function ensureGitSyncSafetySchedule(
  queue: Queue<GitSyncQueueJobData>,
  intervalMs: number = DEFAULT_GIT_SYNC_SAFETY_INTERVAL_MS,
): Promise<{ enabled: boolean; intervalMs: number }> {
  const repeatable = await queue.getRepeatableJobs();
  for (const job of repeatable) {
    if (job.name === GIT_SYNC_SAFETY_JOB || job.id === 'git-sync-safety-sweep') {
      await queue.removeRepeatableByKey(job.key);
    }
  }

  if (intervalMs <= 0) {
    return { enabled: false, intervalMs: 0 };
  }

  await queue.add(
    GIT_SYNC_SAFETY_JOB,
    { kind: 'safety-sweep' },
    {
      jobId: 'git-sync-safety-sweep',
      repeat: { every: intervalMs },
      removeOnComplete: true,
      removeOnFail: 50,
      attempts: 1,
    },
  );

  return { enabled: true, intervalMs };
}
