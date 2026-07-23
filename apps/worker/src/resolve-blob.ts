import { eq } from 'drizzle-orm';
import {
  blobStoreConfigFromEnv,
  type AppEnv,
} from '@project-knowledge-hub/config';
import { platformSettings, type Database } from '@project-knowledge-hub/database';
import {
  createBlobStore,
  type BlobStore,
  type BlobStoreConfig,
} from '@project-knowledge-hub/blob-store';

const BLOB_SETTINGS_KEY = 'blob_store_config';

type Stored = {
  provider?: 'disabled' | 's3';
  backupOffsite?: boolean;
  s3Bucket?: string;
  s3Region?: string;
  s3Endpoint?: string;
  s3AccessKeyId?: string;
  s3SecretAccessKey?: string;
  s3ForcePathStyle?: boolean;
  keyPrefix?: string;
};

export async function resolveWorkerBlobStore(
  database: Database,
  env: AppEnv,
): Promise<{ store: BlobStore; backupOffsite: boolean }> {
  const [row] = await database.db
    .select()
    .from(platformSettings)
    .where(eq(platformSettings.key, BLOB_SETTINGS_KEY))
    .limit(1);

  if (!row?.value?.trim()) {
    return {
      store: createBlobStore(blobStoreConfigFromEnv(env)),
      backupOffsite: env.BACKUP_OFFSITE,
    };
  }

  let stored: Stored;
  try {
    stored = JSON.parse(row.value) as Stored;
  } catch {
    return {
      store: createBlobStore(blobStoreConfigFromEnv(env)),
      backupOffsite: env.BACKUP_OFFSITE,
    };
  }

  const backupOffsite =
    typeof stored.backupOffsite === 'boolean'
      ? stored.backupOffsite
      : env.BACKUP_OFFSITE;

  if (!stored.provider || stored.provider === 'disabled') {
    return { store: createBlobStore({ provider: 'disabled' }), backupOffsite };
  }

  const bucket = stored.s3Bucket?.trim() || env.BLOB_S3_BUCKET;
  const accessKeyId = stored.s3AccessKeyId?.trim() || env.BLOB_S3_ACCESS_KEY_ID;
  const secretAccessKey =
    stored.s3SecretAccessKey?.trim() || env.BLOB_S3_SECRET_ACCESS_KEY;
  if (!bucket || !accessKeyId || !secretAccessKey) {
    return {
      store: createBlobStore(blobStoreConfigFromEnv(env)),
      backupOffsite,
    };
  }

  const config: BlobStoreConfig = {
    provider: 's3',
    bucket,
    region: stored.s3Region?.trim() || env.BLOB_S3_REGION || 'auto',
    endpoint: stored.s3Endpoint?.trim() || env.BLOB_S3_ENDPOINT,
    accessKeyId,
    secretAccessKey,
    forcePathStyle:
      stored.s3ForcePathStyle ?? env.BLOB_S3_FORCE_PATH_STYLE ?? false,
    keyPrefix: stored.keyPrefix?.trim() || env.BLOB_KEY_PREFIX || env.APP_ENV,
  };

  return { store: createBlobStore(config), backupOffsite };
}
