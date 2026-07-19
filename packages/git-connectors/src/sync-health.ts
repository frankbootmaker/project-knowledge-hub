import type { ProviderRepoRef } from './provider.js';
import { getGitSyncProvider } from './registry.js';

export type GitSyncHealthStatus =
  | 'healthy'
  | 'needs_sync'
  | 'never_synced'
  | 'error'
  | 'paused'
  | 'check_failed';

export type GitSyncHealth = {
  status: GitSyncHealthStatus;
  remoteCommitSha: string | null;
  lastSyncedCommitSha: string | null;
  lastSyncedAt: string | null;
  message: string;
};

export async function assessGitSyncHealth(input: {
  connectionStatus: string;
  lastError: string | null;
  lastSyncedAt: Date | null;
  lastSyncedCommitSha: string | null;
  ref: ProviderRepoRef;
  /** When false, skip remote call (offline / list optimization). */
  checkRemote?: boolean;
}): Promise<GitSyncHealth> {
  const lastSyncedAt = input.lastSyncedAt?.toISOString() ?? null;
  const lastSyncedCommitSha = input.lastSyncedCommitSha;

  if (input.connectionStatus === 'paused') {
    return {
      status: 'paused',
      remoteCommitSha: null,
      lastSyncedCommitSha,
      lastSyncedAt,
      message: 'Connection is paused',
    };
  }

  if (input.connectionStatus === 'error' || input.lastError) {
    return {
      status: 'error',
      remoteCommitSha: null,
      lastSyncedCommitSha,
      lastSyncedAt,
      message: input.lastError ?? 'Last sync failed',
    };
  }

  if (!lastSyncedAt || !lastSyncedCommitSha) {
    return {
      status: 'never_synced',
      remoteCommitSha: null,
      lastSyncedCommitSha,
      lastSyncedAt,
      message: 'Manual sync needed — never synced',
    };
  }

  if (input.checkRemote === false) {
    return {
      status: 'healthy',
      remoteCommitSha: null,
      lastSyncedCommitSha,
      lastSyncedAt,
      message: 'Last sync succeeded (remote not checked)',
    };
  }

  try {
    const provider = getGitSyncProvider(input.ref.provider);
    const remoteCommitSha = await provider.resolveBranchCommitSha(input.ref);
    if (remoteCommitSha === lastSyncedCommitSha) {
      return {
        status: 'healthy',
        remoteCommitSha,
        lastSyncedCommitSha,
        lastSyncedAt,
        message: 'In sync with remote branch',
      };
    }
    return {
      status: 'needs_sync',
      remoteCommitSha,
      lastSyncedCommitSha,
      lastSyncedAt,
      message: 'Remote branch has new commits — manual sync recommended',
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Remote check failed';
    return {
      status: 'check_failed',
      remoteCommitSha: null,
      lastSyncedCommitSha,
      lastSyncedAt,
      message,
    };
  }
}
