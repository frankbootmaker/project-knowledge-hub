import { describe, expect, it } from 'vitest';
import type { BlobStore } from '@project-knowledge-hub/blob-store';
import { countMediaStorageFailures } from './workspace-media.js';

describe('countMediaStorageFailures', () => {
  it('counts blob failures reported through onError', async () => {
    const store = {
      provider: 's3',
      put: async () => undefined,
      get: async () => null,
      delete: async () => {
        throw new Error('blob down');
      },
      list: async () => [],
    } as BlobStore;

    const failures = await countMediaStorageFailures(
      '/tmp/media-missing',
      'workspace-1',
      'media-1',
      store,
    );
    expect(failures).toBe(1);
  });
});