import type { SyncProvider } from '@project-knowledge-hub/domain';

export type GitTreeEntry = {
  path: string;
  sha: string;
  type: 'blob' | 'tree' | string;
  size?: number;
};

export type ProviderRepoRef = {
  provider: SyncProvider;
  owner: string;
  repo: string;
  branch: string;
  accessToken: string;
  baseUrl?: string | null;
};

export type WebhookMatch = {
  owner: string;
  repo: string;
  branch: string | null;
};

export type GitSyncProvider = {
  id: SyncProvider;
  resolveBranchCommitSha(ref: ProviderRepoRef): Promise<string>;
  listRepositoryTree(ref: ProviderRepoRef, commitSha: string): Promise<GitTreeEntry[]>;
  fetchBlobText(ref: ProviderRepoRef, blobSha: string): Promise<string>;
  blobUrl(ref: ProviderRepoRef, path: string): string;
  verifyWebhookSignature?(
    rawBody: Buffer | string,
    headers: Record<string, string | undefined>,
    secret: string,
  ): boolean;
  matchPushWebhook?(
    payload: unknown,
    headers: Record<string, string | undefined>,
  ): WebhookMatch | null;
};

export function normalizeBaseUrl(baseUrl: string | null | undefined): string | null {
  if (!baseUrl?.trim()) return null;
  return baseUrl.trim().replace(/\/+$/, '');
}
