export const GIT_SYNC_QUEUE = 'git-sync';
export const GIT_SYNC_JOB = 'sync';
export const GIT_SYNC_SAFETY_JOB = 'safety-sweep';
/** Default: once per day. */
export const DEFAULT_GIT_SYNC_SAFETY_INTERVAL_MS = 24 * 60 * 60 * 1000;

export type GitSyncJobPayload = {
  connectionId: string;
  trigger: 'manual' | 'webhook' | 'scheduled';
  actorUserId: string;
};

export type GitSyncSafetyJobPayload = {
  kind: 'safety-sweep';
};

export type GitSyncQueueJobData = GitSyncJobPayload | GitSyncSafetyJobPayload;

export function isGitSyncSafetyJob(
  data: GitSyncQueueJobData,
): data is GitSyncSafetyJobPayload {
  return 'kind' in data && data.kind === 'safety-sweep';
}
