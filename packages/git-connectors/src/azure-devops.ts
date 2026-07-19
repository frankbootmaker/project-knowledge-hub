import { createHmac, timingSafeEqual } from 'node:crypto';
import { AppError } from '@project-knowledge-hub/domain';
import type {
  GitSyncProvider,
  GitTreeEntry,
  ProviderRepoRef,
  WebhookMatch,
} from './provider.js';
import { normalizeBaseUrl } from './provider.js';

export function parseAzureRepo(repo: string): { project: string; repoName: string } {
  const idx = repo.indexOf('/');
  if (idx <= 0 || idx === repo.length - 1) {
    throw new AppError({
      code: 'AZURE_REPO_FORMAT',
      message: 'Azure DevOps repo must be “project/repo” (e.g. MyProject/docs)',
      statusCode: 400,
    });
  }
  return {
    project: repo.slice(0, idx),
    repoName: repo.slice(idx + 1),
  };
}

function orgRoot(ref: ProviderRepoRef): string {
  const base = normalizeBaseUrl(ref.baseUrl) ?? 'https://dev.azure.com';
  return `${base}/${encodeURIComponent(ref.owner)}`;
}

function authHeader(token: string): string {
  return `Basic ${Buffer.from(`:${token}`).toString('base64')}`;
}

async function adoFetch<T>(ref: ProviderRepoRef, url: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      Authorization: authHeader(ref.accessToken),
      'User-Agent': 'project-knowledge-hub',
    },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new AppError({
      code: 'AZURE_DEVOPS_API_ERROR',
      message: `Azure DevOps API ${response.status}: ${body.slice(0, 300)}`,
      statusCode: response.status === 401 || response.status === 403 ? 400 : 502,
      details: { status: response.status, url },
    });
  }
  return (await response.json()) as T;
}

async function resolveBranchCommitSha(ref: ProviderRepoRef): Promise<string> {
  const { project, repoName } = parseAzureRepo(ref.repo);
  const data = await adoFetch<{ value: Array<{ objectId: string; name: string }> }>(
    ref,
    `${orgRoot(ref)}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repoName)}/refs?filter=heads/${encodeURIComponent(ref.branch)}&api-version=7.1`,
  );
  const match = data.value?.find(
    (item) =>
      item.name === `refs/heads/${ref.branch}` || item.name.endsWith(`/${ref.branch}`),
  );
  if (!match?.objectId) {
    throw new AppError({
      code: 'AZURE_BRANCH_NOT_FOUND',
      message: `Branch “${ref.branch}” not found in ${ref.owner}/${ref.repo}`,
      statusCode: 400,
    });
  }
  return match.objectId;
}

async function listRepositoryTree(
  ref: ProviderRepoRef,
  commitSha: string,
): Promise<GitTreeEntry[]> {
  const { project, repoName } = parseAzureRepo(ref.repo);
  const data = await adoFetch<{
    value?: Array<{
      path?: string;
      gitObjectType?: string;
      objectId?: string;
      isFolder?: boolean;
    }>;
  }>(
    ref,
    `${orgRoot(ref)}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repoName)}/items?recursionLevel=Full&versionDescriptor.version=${encodeURIComponent(commitSha)}&versionDescriptor.versionType=commit&api-version=7.1`,
  );
  const entries: GitTreeEntry[] = [];
  for (const item of data.value ?? []) {
    if (!item.path || item.isFolder || item.gitObjectType === 'tree') continue;
    const path = item.path.replace(/^\//, '');
    if (!path || !item.objectId) continue;
    entries.push({ path, sha: item.objectId, type: 'blob' });
  }
  return entries;
}

async function fetchBlobText(ref: ProviderRepoRef, blobSha: string): Promise<string> {
  const { project, repoName } = parseAzureRepo(ref.repo);
  const response = await fetch(
    `${orgRoot(ref)}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repoName)}/blobs/${blobSha}?api-version=7.1`,
    {
      headers: {
        Accept: 'application/octet-stream',
        Authorization: authHeader(ref.accessToken),
        'User-Agent': 'project-knowledge-hub',
      },
    },
  );
  if (!response.ok) {
    const body = await response.text();
    throw new AppError({
      code: 'AZURE_DEVOPS_API_ERROR',
      message: `Azure DevOps blob ${response.status}: ${body.slice(0, 300)}`,
      statusCode: response.status === 401 || response.status === 403 ? 400 : 502,
    });
  }
  return response.text();
}

function blobUrl(ref: ProviderRepoRef, path: string): string {
  const { project, repoName } = parseAzureRepo(ref.repo);
  const base = normalizeBaseUrl(ref.baseUrl) ?? 'https://dev.azure.com';
  return `${base}/${ref.owner}/${encodeURIComponent(project)}/_git/${encodeURIComponent(repoName)}?path=${encodeURIComponent(`/${path}`)}&version=GB${encodeURIComponent(ref.branch)}`;
}

function verifyWebhookSignature(
  rawBody: Buffer | string,
  headers: Record<string, string | undefined>,
  secret: string,
): boolean {
  const provided =
    headers['x-hub-signature-256'] ??
    headers['x-ado-signature'] ??
    headers['x-vss-signature'];
  if (!provided) {
    // Azure DevOps classic service hooks often use a shared secret query/basic auth;
    // accept exact token header match when present.
    const token = headers['x-webhook-secret'] ?? headers['authorization'];
    if (!token) return false;
    try {
      const a = Buffer.from(token.replace(/^Basic\s+/i, ''), 'utf8');
      const b = Buffer.from(secret, 'utf8');
      return a.length === b.length && timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }
  const signature = provided.startsWith('sha256=') ? provided.slice(7) : provided;
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  try {
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(signature, 'utf8');
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function matchPushWebhook(payload: unknown): WebhookMatch | null {
  const body = payload as {
    eventType?: string;
    resource?: {
      refUpdates?: Array<{ name?: string }>;
      repository?: {
        name?: string;
        project?: { name?: string };
        remoteUrl?: string;
      };
    };
  };
  if (body.eventType && !body.eventType.toLowerCase().includes('push')) {
    return null;
  }
  const project = body.resource?.repository?.project?.name;
  const repoName = body.resource?.repository?.name;
  if (!project || !repoName) return null;
  const refName = body.resource?.refUpdates?.[0]?.name;
  const branch = refName?.startsWith('refs/heads/')
    ? refName.slice('refs/heads/'.length)
    : null;
  // owner is organization — matched separately from connection rows; webhook may omit it.
  // Use empty owner sentinel; API matcher will compare repo as project/repo only when owner empty.
  return {
    owner: '',
    repo: `${project}/${repoName}`,
    branch,
  };
}

export const azureDevopsProvider: GitSyncProvider = {
  id: 'azure_devops',
  resolveBranchCommitSha,
  listRepositoryTree,
  fetchBlobText,
  blobUrl,
  verifyWebhookSignature,
  matchPushWebhook,
};
