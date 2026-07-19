import { createHmac, timingSafeEqual } from 'node:crypto';
import { AppError } from '@project-knowledge-hub/domain';

export type GitTreeEntry = {
  path: string;
  sha: string;
  type: 'blob' | 'tree' | string;
  size?: number;
};

export type GitHubRepoRef = {
  owner: string;
  repo: string;
  branch: string;
  accessToken: string;
};

async function githubFetch<T>(
  ref: GitHubRepoRef,
  apiPath: string,
): Promise<T> {
  const response = await fetch(`https://api.github.com${apiPath}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${ref.accessToken}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'project-knowledge-hub',
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new AppError({
      code: 'GITHUB_API_ERROR',
      message: `GitHub API ${response.status}: ${body.slice(0, 300)}`,
      statusCode: response.status === 401 || response.status === 403 ? 400 : 502,
      details: { status: response.status, path: apiPath },
    });
  }

  return (await response.json()) as T;
}

export async function resolveBranchCommitSha(ref: GitHubRepoRef): Promise<string> {
  const data = await githubFetch<{ object: { sha: string } }>(
    ref,
    `/repos/${ref.owner}/${ref.repo}/git/ref/heads/${encodeURIComponent(ref.branch)}`,
  );
  return data.object.sha;
}

export async function listRepositoryTree(
  ref: GitHubRepoRef,
  commitSha: string,
): Promise<GitTreeEntry[]> {
  const data = await githubFetch<{
    tree: GitTreeEntry[];
    truncated: boolean;
  }>(
    ref,
    `/repos/${ref.owner}/${ref.repo}/git/trees/${commitSha}?recursive=1`,
  );
  if (data.truncated) {
    throw new AppError({
      code: 'GITHUB_TREE_TRUNCATED',
      message: 'Repository tree is too large; narrow include paths or sync a smaller branch',
      statusCode: 400,
    });
  }
  return data.tree.filter((entry) => entry.type === 'blob' && entry.path);
}

export async function fetchBlobText(
  ref: GitHubRepoRef,
  blobSha: string,
): Promise<string> {
  const data = await githubFetch<{ content?: string; encoding?: string }>(
    ref,
    `/repos/${ref.owner}/${ref.repo}/git/blobs/${blobSha}`,
  );
  if (data.encoding === 'base64' && data.content) {
    return Buffer.from(data.content.replace(/\n/g, ''), 'base64').toString('utf8');
  }
  throw new AppError({
    code: 'GITHUB_BLOB_UNSUPPORTED',
    message: `Unsupported blob encoding for ${blobSha}`,
    statusCode: 502,
  });
}

export function githubBlobUrl(
  owner: string,
  repo: string,
  branch: string,
  path: string,
): string {
  return `https://github.com/${owner}/${repo}/blob/${encodeURIComponent(branch)}/${path
    .split('/')
    .map(encodeURIComponent)
    .join('/')}`;
}

export function verifyGitHubWebhookSignature(
  rawBody: string | Buffer,
  signatureHeader: string | undefined,
  secret: string,
): boolean {
  if (!signatureHeader?.startsWith('sha256=')) {
    return false;
  }
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const provided = signatureHeader.slice('sha256='.length);
  try {
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(provided, 'utf8');
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
