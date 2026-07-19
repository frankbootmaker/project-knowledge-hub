import { describe, expect, it } from 'vitest';
import {
  isSyncProviderSupported,
  SYNC_PROVIDER_CATALOG,
  syncProviderSchema,
} from './sync-providers.js';

describe('sync providers', () => {
  it('lists expected providers with only GitHub supported', () => {
    expect(SYNC_PROVIDER_CATALOG.map((entry) => entry.id)).toEqual([
      'github',
      'gitlab',
      'azure_devops',
      'bitbucket',
      'forgejo',
    ]);
    expect(isSyncProviderSupported('github')).toBe(true);
    expect(isSyncProviderSupported('gitlab')).toBe(false);
  });

  it('parses provider enum', () => {
    expect(syncProviderSchema.parse('forgejo')).toBe('forgejo');
    expect(syncProviderSchema.safeParse('svn').success).toBe(false);
  });
});
