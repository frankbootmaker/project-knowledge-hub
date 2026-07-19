import { describe, expect, it } from 'vitest';
import {
  isSyncProviderSupported,
  providerNeedsBaseUrl,
  SYNC_PROVIDER_CATALOG,
  syncProviderSchema,
} from './sync-providers.js';

describe('sync providers', () => {
  it('lists expected providers with sync supported for all', () => {
    expect(SYNC_PROVIDER_CATALOG.map((entry) => entry.id)).toEqual([
      'github',
      'gitlab',
      'azure_devops',
      'bitbucket',
      'forgejo',
    ]);
    for (const entry of SYNC_PROVIDER_CATALOG) {
      expect(isSyncProviderSupported(entry.id)).toBe(true);
    }
    expect(providerNeedsBaseUrl('forgejo')).toBe(true);
    expect(providerNeedsBaseUrl('github')).toBe(false);
  });

  it('parses provider enum', () => {
    expect(syncProviderSchema.parse('forgejo')).toBe('forgejo');
    expect(syncProviderSchema.safeParse('svn').success).toBe(false);
  });
});
