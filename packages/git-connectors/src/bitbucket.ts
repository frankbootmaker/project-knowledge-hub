import { createHmac, timingSafeEqual } from 'node:crypto';
import { AppError } from '@project-knowledge-hub/domain';
import type {
  GitSyncProvider,
  GitTreeEntry,
  ProviderRepoRef,
  WebhookMatch,
} from './provider.js';

async function bitbucketFetch<T>(
  ref: ProviderRepoRef,
  apiPath: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`https://api.bitbucket.org/2.0${apiPath}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${ref.accessToken}`,
      'User-Agent': 'project-knowledge-hub',
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new AppError({
      code: 'BITBUCKET_API_ERROR',
      message: `Bitbucket API ${response.status}: ${body.slice(0, 300)}`,
      statusCode: response.status === 401 || response.status === 403 ? 400 : 502,
      details: { status: response.status, path: apiPath },
    });
  }
  return (await response.json()) as T;
}

async function resolveBranchCommitSha(ref: ProviderRepoRef): Promise<string> {
  const data = await bitbucketFetch<{ target: { hash: string } }>(
    ref,
    `/repositories/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}/refs/branches/${encodeURIComponent(ref.branch)}`,
  );
  return data.target.hash;
}

async function listRepositoryTree(
  ref: ProviderRepoRef,
  commitSha: string,
): Promise<GitTreeEntry[]> {
  const entries: GitTreeEntry[] = [];
  let url:
    | string
    | null =
    `https://api.bitbucket.org/2.0/repositories/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}/src/${encodeURIComponent(commitSha)}/?max_depth=100&pagelen=100`;

  while (url) {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${ref.accessToken}`,
        'User-Agent': 'project-knowledge-hub',
      },
    });
    if (!response.ok) {
      const body = await response.text();
      throw new AppError({
        code: 'BITBUCKET_API_ERROR',
        message: `Bitbucket tree ${response.status}: ${body.slice(0, 300)}`,
        statusCode: response.status === 401 || response.status === 403 ? 400 : 502,
      });
    }
    const data = (await response.json()) as {
      values?: Array<{
        type?: string;
        path?: string;
        commit?: { hash?: string };
      }>;
      next?: string;
    };
    for (const item of data.values ?? []) {
      if (item.type === 'commit_file' && item.path) {
        entries.push({
          path: item.path,
          sha: item.commit?.hash ?? commitSha,
          type: 'blob',
        });
      }
    }
    url = data.next ?? null;
    if (entries.length > 50_000) {
      throw new AppError({
        code: 'BITBUCKET_TREE_TOO_LARGE',
        message: 'Repository tree is too large; narrow include paths',
        statusCode: 400,
      });
    }
  }
  return entries;
}

async function fetchBlobText(ref: ProviderRepoRef, blobSha: string): Promise<string> {
  // Bitbucket src listing uses path+commit; blobSha here is commit hash from list.
  // Callers pass entry.sha which we set to commit hash — need path.
  // Sync loop calls fetchBlobText(ref, entry.sha) with blob sha from tree.
  // For Bitbucket we need path; we'll encode path into sha field as "commit:path" OR
  // change list to use path as identity and fetch by path.
  // Better: store sha as `${commitSha}:${path}` in listRepositoryTree.
  const sep = blobSha.indexOf(':');
  if (sep <= 0) {
    throw new AppError({
      code: 'BITBUCKET_BLOB_REF',
      message: 'Bitbucket blob reference must include path',
      statusCode: 502,
    });
  }
  const commit = blobSha.slice(0, sep);
  const path = blobSha.slice(sep + 1);
  const response = await fetch(
    `https://api.bitbucket.org/2.0/repositories/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}/src/${encodeURIComponent(commit)}/${path
      .split('/')
      .map(encodeURIComponent)
      .join('/')}`,
    {
      headers: {
        Authorization: `Bearer ${ref.accessToken}`,
        'User-Agent': 'project-knowledge-hub',
      },
    },
  );
  if (!response.ok) {
    const body = await response.text();
    throw new AppError({
      code: 'BITBUCKET_API_ERROR',
      message: `Bitbucket blob ${response.status}: ${body.slice(0, 300)}`,
      statusCode: response.status === 401 || response.status === 403 ? 400 : 502,
    });
  }
  return response.text();
}

function blobUrl(ref: ProviderRepoRef, path: string): string {
  return `https://bitbucket.org/${ref.owner}/${ref.repo}/src/${encodeURIComponent(ref.branch)}/${path
    .split('/')
    .map(encodeURIComponent)
    .join('/')}`;
}

function verifyWebhookSignature(
  rawBody: Buffer | string,
  headers: Record<string, string | undefined>,
  secret: string,
): boolean {
  const provided = headers['x-hub-signature'];
  if (!provided?.startsWith('sha256=')) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const signature = provided.slice('sha256='.length);
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
  const event = headers['x-event-key'];
  if (event && !event.includes('push')) return null;
  const body = payload as {
    repository?: { name?: string; full_name?: string; workspace?: { slug?: string } };
    push?: { changes?: Array<{ new?: { name?: string; type?: string } }> };
  };
  const full = body.repository?.full_name;
  let owner = body.repository?.workspace?.slug;
  let repo = body.repository?.name;
  if (full?.includes('/')) {
    const [ws, name] = full.split('/');
    owner = owner ?? ws;
    repo = repo ?? name;
  }
  if (!owner || !repo) return null;
  const branchChange = body.push?.changes?.find((c) => c.new?.type === 'branch');
  const branch = branchChange?.new?.name ?? null;
  return { owner, repo, branch };
}

async function listRepositoryTreeWithPathSha(
  ref: ProviderRepoRef,
  commitSha: string,
): Promise<GitTreeEntry[]> {
  const listed = await listRepositoryTree(ref, commitSha);
  // Encode path into sha so fetchBlobText can retrieve content by path.
  return listed.map((entry) => ({
    ...entry,
    sha: `${commitSha}:${entry.path}`,
  }));
}

export const bitbucketProvider: GitSyncProvider = {
  id: 'bitbucket',
  resolveBranchCommitSha,
  listRepositoryTree: listRepositoryTreeWithPathSha,
  fetchBlobText,
  blobUrl,
  verifyWebhookSignature,
  matchPushWebhook,
};
