export const BLOB_PROVIDERS = ['disabled', 's3'] as const;

export type BlobProviderName = (typeof BLOB_PROVIDERS)[number];

export type BlobPurpose = 'backups' | 'avatars' | 'imports' | 'exports' | 'media' | 'doc-templates';

export type BlobObject = {
  key: string;
  sizeBytes?: number;
  lastModified?: Date;
};

/** Head result used to verify a copy. ETag is normalized with surrounding quotes removed. */
export type BlobHead = {
  sizeBytes: number;
  etag: string | null;
};

export type BlobPutInput = {
  key: string;
  body: Buffer | Uint8Array;
  contentType?: string;
};

export type BlobStore = {
  readonly provider: BlobProviderName;
  put(input: BlobPutInput): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
  list(prefix: string): Promise<BlobObject[]>;
  /** Null when the object is missing. Credential and transport errors reject. */
  head(key: string): Promise<BlobHead | null>;
  /**
   * Server-side copy into `toKey`. The destination prefix is the key's parent.
   * Does not delete `fromKey`.
   */
  copy(fromKey: string, toKey: string): Promise<void>;
};

export type BlobStoreConfig =
  | { provider: 'disabled' }
  | {
      provider: 's3';
      bucket: string;
      region: string;
      endpoint?: string;
      accessKeyId: string;
      secretAccessKey: string;
      forcePathStyle: boolean;
      /** Key prefix without trailing slash, e.g. `staging` or `prod/kh`. */
      keyPrefix: string;
    };

export class BlobStoreDisabledError extends Error {
  constructor(message = 'Blob storage is disabled') {
    super(message);
    this.name = 'BlobStoreDisabledError';
  }
}
