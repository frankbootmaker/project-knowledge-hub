import {
  AppError,
  syncProviderSchema,
  type SyncProvider,
} from '@project-knowledge-hub/domain';
import { azureDevopsProvider } from './azure-devops.js';
import { bitbucketProvider } from './bitbucket.js';
import { forgejoProvider } from './forgejo.js';
import { githubProvider } from './github.js';
import { gitlabProvider } from './gitlab.js';
import type { GitSyncProvider, ProviderRepoRef } from './provider.js';

const providers: Record<SyncProvider, GitSyncProvider> = {
  github: githubProvider,
  gitlab: gitlabProvider,
  azure_devops: azureDevopsProvider,
  bitbucket: bitbucketProvider,
  forgejo: forgejoProvider,
};

export function getGitSyncProvider(provider: string): GitSyncProvider {
  const parsed = syncProviderSchema.safeParse(provider);
  if (!parsed.success) {
    throw new AppError({
      code: 'UNKNOWN_GIT_PROVIDER',
      message: `Unknown git provider “${provider}”`,
      statusCode: 400,
    });
  }
  return providers[parsed.data];
}

export function connectionToProviderRef(row: {
  provider: string;
  owner: string;
  repo: string;
  branch: string;
  accessToken: string;
  baseUrl?: string | null;
}): ProviderRepoRef {
  const provider = syncProviderSchema.parse(row.provider);
  return {
    provider,
    owner: row.owner,
    repo: row.repo,
    branch: row.branch,
    accessToken: row.accessToken,
    baseUrl: row.baseUrl ?? null,
  };
}

export function listGitSyncProviders(): GitSyncProvider[] {
  return Object.values(providers);
}
