import { describe, expect, it } from 'vitest';
import { connectionToProviderRef, getGitSyncProvider, listGitSyncProviders } from './registry.js';

describe('git sync registry', () => {
  it('returns all catalog providers', () => {
    const ids = listGitSyncProviders().map((provider) => provider.id).sort();
    expect(ids).toEqual([
      'azure_devops',
      'bitbucket',
      'forgejo',
      'github',
      'gitlab',
    ]);
  });

  it('builds provider refs with baseUrl', () => {
    const ref = connectionToProviderRef({
      provider: 'forgejo',
      owner: 'acme',
      repo: 'docs',
      branch: 'main',
      accessToken: 'token',
      baseUrl: 'https://git.example.com/',
    });
    expect(ref.provider).toBe('forgejo');
    expect(ref.baseUrl).toBe('https://git.example.com/');
    expect(getGitSyncProvider('forgejo').id).toBe('forgejo');
  });

  it('rejects unknown providers', () => {
    expect(() => getGitSyncProvider('svn')).toThrow(/Unknown git provider/);
  });
});
