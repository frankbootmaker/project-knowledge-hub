import { describe, expect, it } from 'vitest';
import { forgejoProvider } from './forgejo.js';

describe('forgejoProvider', () => {
  it('requires baseUrl for resolve', async () => {
    await expect(
      forgejoProvider.resolveBranchCommitSha({
        provider: 'forgejo',
        owner: 'acme',
        repo: 'docs',
        branch: 'main',
        accessToken: 'token',
        baseUrl: null,
      }),
    ).rejects.toThrow(/base URL/);
  });
});
