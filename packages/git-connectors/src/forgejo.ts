import { createHmac, timingSafeEqual } from 'node:crypto';
import { AppError } from '@project-knowledge-hub/domain';
import type {
  GitSyncProvider,
  GitTreeEntry,
  ProviderRepoRef,
  WebhookMatch,
} from './provider.js';
import { normalizeBaseUrl } from './provider.js';

function requireBaseUrl(ref: ProviderRepoRef): string {
  const base = normalizeBaseUrl(ref.baseUrl);
  if (!base) {
    throw new AppError({
      code: 'FORGEJO_BASE_URL_REQUIRED',
      message: 'Forgejo connections require a base URL (instance root)',
      statusCode: 400,
    });
  }
  return base;
}

function apiRoot(ref: ProviderRepoRef): string {
  return `${requireBaseUrl(ref)}/api/v1`;
}

async function forgejoFetch<T>(ref: ProviderRepoRef, apiPath: string): Promise<T> {
  const response = await fetch(`${apiRoot(ref)}${apiPath}`, {
    headers: {
      Accept: 'application/json',
      Authorization: `token ${ref.accessToken}`,
      'User-Agent': 'project-knowledge-hub',
    },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new AppError({
      code: 'FORGEJO_API_ERROR',
      message: `Forgejo API ${response.status}: ${body.slice(0, 300)}`,
      statusCode: response.status === 401 || response.status === 403 ? 400 : 502,
      details: { status: response.status, path: apiPath },
    });
  }
  return (await response.json()) as T;
}

async function resolveBranchCommitSha(ref: ProviderRepoRef): Promise<string> {
  const data = await forgejoFetch<{ commit?: { id?: string }; id?: string }>(
    ref,
    `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}/branches/${encodeURIComponent(ref.branch)}`,
  );
  const sha = data.commit?.id ?? data.id;
  if (!sha) {
    throw new AppError({
      code: 'FORGEJO_BRANCH_NOT_FOUND',
      message: `Branch “${ref.branch}” not found`,
      statusCode: 400,
    });
  }
  return sha;
}

async function listRepositoryTree(
  ref: ProviderRepoRef,
  commitSha: string,
): Promise<GitTreeEntry[]> {
  type TreeNode = { path?: string; sha?: string; type?: string; size?: number };
  const data = await forgejoFetch<{ tree?: TreeNode[]; truncated?: boolean } | TreeNode[]>(
    ref,
    `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}/git/trees/${commitSha}?recursive=true`,
  );
  const tree = Array.isArray(data) ? data : (data.tree ?? []);
  if (!Array.isArray(data) && data.truncated) {
    throw new AppError({
      code: 'FORGEJO_TREE_TRUNCATED',
      message: 'Repository tree is too large; narrow include paths',
      statusCode: 400,
    });
  }
  return tree
    .filter((entry) => entry.type === 'blob' && entry.path && entry.sha)
    .map((entry) => ({
      path: entry.path!,
      sha: entry.sha!,
      type: 'blob' as const,
      size: entry.size,
    }));
}

async function fetchBlobText(ref: ProviderRepoRef, blobSha: string): Promise<string> {
  const data = await forgejoFetch<{ content?: string; encoding?: string }>(
    ref,
    `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}/git/blobs/${blobSha}`,
  );
  if (data.encoding === 'base64' && data.content) {
    return Buffer.from(data.content.replace(/\n/g, ''), 'base64').toString('utf8');
  }
  // Some Forgejo versions return raw via contents API when encoding missing
  if (typeof data.content === 'string' && !data.encoding) {
    return data.content;
  }
  throw new AppError({
    code: 'FORGEJO_BLOB_UNSUPPORTED',
    message: `Unsupported blob encoding for ${blobSha}`,
    statusCode: 502,
  });
}

function blobUrl(ref: ProviderRepoRef, path: string): string {
  const base = requireBaseUrl(ref);
  return `${base}/${ref.owner}/${ref.repo}/src/branch/${encodeURIComponent(ref.branch)}/${path
    .split('/')
    .map(encodeURIComponent)
    .join('/')}`;
}

function verifyWebhookSignature(
  rawBody: Buffer | string,
  headers: Record<string, string | undefined>,
  secret: string,
): boolean {
  const provided = headers['x-hub-signature-256'] ?? headers['x-gitea-signature'];
  if (!provided) return false;
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

function matchPushWebhook(
  payload: unknown,
  headers: Record<string, string | undefined>,
): WebhookMatch | null {
  const event = headers['x-forgejo-event'] ?? headers['x-gitea-event'] ?? headers['x-github-event'];
  if (event && event !== 'push') return null;
  const body = payload as {
    repository?: { name?: string; owner?: { login?: string; username?: string } };
    ref?: string;
  };
  const owner = body.repository?.owner?.login ?? body.repository?.owner?.username;
  const repo = body.repository?.name;
  if (!owner || !repo) return null;
  const branch = body.ref?.startsWith('refs/heads/')
    ? body.ref.slice('refs/heads/'.length)
    : null;
  return { owner, repo, branch };
}

export const forgejoProvider: GitSyncProvider = {
  id: 'forgejo',
  resolveBranchCommitSha,
  listRepositoryTree,
  fetchBlobText,
  blobUrl,
  verifyWebhookSignature,
  matchPushWebhook,
};
