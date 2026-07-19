import { timingSafeEqual } from 'node:crypto';
import { AppError } from '@project-knowledge-hub/domain';
import type {
  GitSyncProvider,
  GitTreeEntry,
  ProviderRepoRef,
  WebhookMatch,
} from './provider.js';
import { normalizeBaseUrl } from './provider.js';

function apiRoot(ref: ProviderRepoRef): string {
  const base = normalizeBaseUrl(ref.baseUrl) ?? 'https://gitlab.com';
  return `${base}/api/v4`;
}

function projectPath(ref: ProviderRepoRef): string {
  return encodeURIComponent(`${ref.owner}/${ref.repo}`);
}

async function gitlabFetch<T>(
  ref: ProviderRepoRef,
  apiPath: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`${apiRoot(ref)}${apiPath}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      'PRIVATE-TOKEN': ref.accessToken,
      'User-Agent': 'project-knowledge-hub',
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new AppError({
      code: 'GITLAB_API_ERROR',
      message: `GitLab API ${response.status}: ${body.slice(0, 300)}`,
      statusCode: response.status === 401 || response.status === 403 ? 400 : 502,
      details: { status: response.status, path: apiPath },
    });
  }
  if (response.status === 204) {
    return undefined as T;
  }
  const text = await response.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

async function resolveBranchCommitSha(ref: ProviderRepoRef): Promise<string> {
  const data = await gitlabFetch<{ commit: { id: string } }>(
    ref,
    `/projects/${projectPath(ref)}/repository/branches/${encodeURIComponent(ref.branch)}`,
  );
  return data.commit.id;
}

async function listRepositoryTree(
  ref: ProviderRepoRef,
  commitSha: string,
): Promise<GitTreeEntry[]> {
  const entries: GitTreeEntry[] = [];
  let page = 1;
  for (;;) {
    const batch = await gitlabFetch<
      Array<{ path: string; id: string; type: string }>
    >(
      ref,
      `/projects/${projectPath(ref)}/repository/tree?ref=${encodeURIComponent(commitSha)}&recursive=true&per_page=100&page=${page}`,
    );
    if (!Array.isArray(batch) || batch.length === 0) break;
    for (const item of batch) {
      if (item.type === 'blob' && item.path) {
        entries.push({ path: item.path, sha: item.id, type: 'blob' });
      }
    }
    if (batch.length < 100) break;
    page += 1;
    if (page > 100) {
      throw new AppError({
        code: 'GITLAB_TREE_TOO_LARGE',
        message: 'Repository tree is too large; narrow include paths',
        statusCode: 400,
      });
    }
  }
  return entries;
}

async function fetchBlobText(ref: ProviderRepoRef, blobSha: string): Promise<string> {
  const response = await fetch(
    `${apiRoot(ref)}/projects/${projectPath(ref)}/repository/blobs/${blobSha}/raw`,
    {
      headers: {
        'PRIVATE-TOKEN': ref.accessToken,
        'User-Agent': 'project-knowledge-hub',
      },
    },
  );
  if (!response.ok) {
    const body = await response.text();
    throw new AppError({
      code: 'GITLAB_API_ERROR',
      message: `GitLab blob ${response.status}: ${body.slice(0, 300)}`,
      statusCode: response.status === 401 || response.status === 403 ? 400 : 502,
    });
  }
  return response.text();
}

function blobUrl(ref: ProviderRepoRef, path: string): string {
  const base = normalizeBaseUrl(ref.baseUrl) ?? 'https://gitlab.com';
  return `${base}/${ref.owner}/${ref.repo}/-/blob/${encodeURIComponent(ref.branch)}/${path
    .split('/')
    .map(encodeURIComponent)
    .join('/')}`;
}

function verifyWebhookSignature(
  _rawBody: Buffer | string,
  headers: Record<string, string | undefined>,
  secret: string,
): boolean {
  const token = headers['x-gitlab-token'];
  if (!token) return false;
  try {
    const a = Buffer.from(token, 'utf8');
    const b = Buffer.from(secret, 'utf8');
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function matchPushWebhook(
  payload: unknown,
  headers: Record<string, string | undefined>,
): WebhookMatch | null {
  const event = headers['x-gitlab-event'];
  if (event && event !== 'Push Hook' && event !== 'push') return null;
  const body = payload as {
    project?: { path_with_namespace?: string };
    ref?: string;
  };
  const full = body.project?.path_with_namespace;
  if (!full || !full.includes('/')) return null;
  const slash = full.lastIndexOf('/');
  const owner = full.slice(0, slash);
  const repo = full.slice(slash + 1);
  const branch = body.ref?.startsWith('refs/heads/')
    ? body.ref.slice('refs/heads/'.length)
    : null;
  return { owner, repo, branch };
}

export const gitlabProvider: GitSyncProvider = {
  id: 'gitlab',
  resolveBranchCommitSha,
  listRepositoryTree,
  fetchBlobText,
  blobUrl,
  verifyWebhookSignature,
  matchPushWebhook,
};
