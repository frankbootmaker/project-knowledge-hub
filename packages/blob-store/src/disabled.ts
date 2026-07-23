import { BlobStoreDisabledError, type BlobStore } from './types.js';

export function createDisabledBlobStore(): BlobStore {
  return {
    provider: 'disabled',
    async put() {
      throw new BlobStoreDisabledError();
    },
    async get() {
      return null;
    },
    async delete() {
      /* no-op */
    },
    async list() {
      return [];
    },
  };
}
