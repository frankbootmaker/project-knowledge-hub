import { createDisabledBlobStore } from './disabled.js';
import { createS3BlobStore } from './s3.js';
import {
  BLOB_PROVIDERS,
  type BlobProviderName,
  type BlobStore,
  type BlobStoreConfig,
} from './types.js';

export function createBlobStore(config: BlobStoreConfig): BlobStore {
  if (config.provider === 'disabled') {
    return createDisabledBlobStore();
  }
  if (config.provider === 's3') {
    return createS3BlobStore(config);
  }
  throw new Error(`Unknown blob provider: ${String((config as { provider: string }).provider)}`);
}

export function parseBlobProviderName(
  value: string | undefined,
): BlobProviderName {
  if (value && (BLOB_PROVIDERS as readonly string[]).includes(value)) {
    return value as BlobProviderName;
  }
  return 'disabled';
}

/** Build object key: `{purpose}/{name}` (env prefix applied by S3 store). */
export function blobObjectKey(
  purpose: 'backups' | 'avatars' | 'imports' | 'exports',
  name: string,
): string {
  const safe = name.replace(/^\/+/, '').replace(/\.\./g, '');
  return `${purpose}/${safe}`;
}
