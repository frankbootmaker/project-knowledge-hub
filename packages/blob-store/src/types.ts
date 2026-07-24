export const BLOB_PROVIDERS = ['disabled', 's3'] as const;

export type BlobProviderName = (typeof BLOB_PROVIDERS)[number];

export type BlobPurpose = 'backups' | 'avatars' | 'imports' | 'exports' | 'media';

export type BlobObject = {
  key: string;
  sizeBytes?: number;
  lastModified?: Date;
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
