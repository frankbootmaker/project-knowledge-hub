import { eq } from 'drizzle-orm';
import {
  blobStoreConfigFromEnv,
  type AppEnv,
} from '@project-knowledge-hub/config';
import { platformSettings, type Database } from '@project-knowledge-hub/database';
import {
  createBlobStore,
  type BlobProviderName,
  type BlobStore,
  type BlobStoreConfig,
} from '@project-knowledge-hub/blob-store';
import { AppError } from '@project-knowledge-hub/domain';

export const BLOB_SETTINGS_KEY = 'blob_store_config';

export type StoredBlobSettings = {
  provider: BlobProviderName;
  backupOffsite: boolean;
  s3Bucket?: string;
  s3Region?: string;
  s3Endpoint?: string;
  s3AccessKeyId?: string;
  s3SecretAccessKey?: string;
  s3ForcePathStyle?: boolean;
  keyPrefix?: string;
};

export type PublicBlobSettings = {
  provider: BlobProviderName;
  backupOffsite: boolean;
  s3Bucket: string;
  s3Region: string;
  s3Endpoint: string;
  s3ForcePathStyle: boolean;
  keyPrefix: string;
  hasAccessKeyId: boolean;
  hasSecretAccessKey: boolean;
  source: 'override' | 'env';
  effectiveProvider: BlobProviderName;
  envProvider: BlobProviderName;
};

function envAsStored(env: AppEnv): StoredBlobSettings {
  return {
    provider: env.BLOB_PROVIDER,
    backupOffsite: env.BACKUP_OFFSITE,
    s3Bucket: env.BLOB_S3_BUCKET,
    s3Region: env.BLOB_S3_REGION,
    s3Endpoint: env.BLOB_S3_ENDPOINT,
    s3AccessKeyId: env.BLOB_S3_ACCESS_KEY_ID,
    s3SecretAccessKey: env.BLOB_S3_SECRET_ACCESS_KEY,
    s3ForcePathStyle: env.BLOB_S3_FORCE_PATH_STYLE,
    keyPrefix: env.BLOB_KEY_PREFIX ?? env.APP_ENV,
  };
}

export async function getStoredBlobSettings(
  database: Database,
): Promise<StoredBlobSettings | null> {
  const [row] = await database.db
    .select()
    .from(platformSettings)
    .where(eq(platformSettings.key, BLOB_SETTINGS_KEY))
    .limit(1);
  if (!row?.value?.trim()) {
    return null;
  }
  try {
    const parsed = JSON.parse(row.value) as StoredBlobSettings;
    if (!parsed || typeof parsed !== 'object' || !parsed.provider) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function resolveBlobStoreConfig(
  database: Database,
  env: AppEnv,
): Promise<{ config: BlobStoreConfig; backupOffsite: boolean; source: 'override' | 'env' }> {
  const stored = await getStoredBlobSettings(database);
  if (!stored) {
    return {
      config: blobStoreConfigFromEnv(env),
      backupOffsite: env.BACKUP_OFFSITE,
      source: 'env',
    };
  }

  if (stored.provider === 'disabled') {
    return {
      config: { provider: 'disabled' },
      backupOffsite: Boolean(stored.backupOffsite),
      source: 'override',
    };
  }

  const bucket = stored.s3Bucket?.trim() || env.BLOB_S3_BUCKET;
  const accessKeyId = stored.s3AccessKeyId?.trim() || env.BLOB_S3_ACCESS_KEY_ID;
  const secretAccessKey =
    stored.s3SecretAccessKey?.trim() || env.BLOB_S3_SECRET_ACCESS_KEY;
  if (!bucket || !accessKeyId || !secretAccessKey) {
    throw new AppError({
      code: 'BLOB_CONFIG_INCOMPLETE',
      message:
        'S3 storage requires bucket, access key, and secret (set in Admin or env)',
      statusCode: 503,
    });
  }

  return {
    config: {
      provider: 's3',
      bucket,
      region: stored.s3Region?.trim() || env.BLOB_S3_REGION || 'auto',
      endpoint: stored.s3Endpoint?.trim() || env.BLOB_S3_ENDPOINT,
      accessKeyId,
      secretAccessKey,
      forcePathStyle:
        stored.s3ForcePathStyle ?? env.BLOB_S3_FORCE_PATH_STYLE ?? false,
      keyPrefix:
        stored.keyPrefix?.trim() || env.BLOB_KEY_PREFIX || env.APP_ENV,
    },
    backupOffsite: Boolean(stored.backupOffsite),
    source: 'override',
  };
}

export async function resolveBlobStore(
  database: Database,
  env: AppEnv,
): Promise<{ store: BlobStore; backupOffsite: boolean; source: 'override' | 'env' }> {
  const resolved = await resolveBlobStoreConfig(database, env);
  return {
    store: createBlobStore(resolved.config),
    backupOffsite: resolved.backupOffsite,
    source: resolved.source,
  };
}

export async function getPublicBlobSettings(
  database: Database,
  env: AppEnv,
): Promise<PublicBlobSettings> {
  const stored = await getStoredBlobSettings(database);
  const envStored = envAsStored(env);
  const effective = stored ?? envStored;
  let effectiveProvider: BlobProviderName = effective.provider;
  try {
    const resolved = await resolveBlobStoreConfig(database, env);
    effectiveProvider = resolved.config.provider;
  } catch {
    effectiveProvider = effective.provider;
  }

  return {
    provider: effective.provider,
    backupOffsite: effective.backupOffsite ?? env.BACKUP_OFFSITE,
    s3Bucket: effective.s3Bucket ?? '',
    s3Region: effective.s3Region ?? env.BLOB_S3_REGION,
    s3Endpoint: effective.s3Endpoint ?? '',
    s3ForcePathStyle: effective.s3ForcePathStyle ?? env.BLOB_S3_FORCE_PATH_STYLE,
    keyPrefix: effective.keyPrefix ?? env.BLOB_KEY_PREFIX ?? env.APP_ENV,
    hasAccessKeyId: Boolean(effective.s3AccessKeyId?.trim()),
    hasSecretAccessKey: Boolean(effective.s3SecretAccessKey?.trim()),
    source: stored ? 'override' : 'env',
    effectiveProvider,
    envProvider: env.BLOB_PROVIDER,
  };
}

export async function setStoredBlobSettings(
  database: Database,
  env: AppEnv,
  input: {
    provider: BlobProviderName;
    backupOffsite: boolean;
    s3Bucket?: string;
    s3Region?: string;
    s3Endpoint?: string;
    s3AccessKeyId?: string | null;
    s3SecretAccessKey?: string | null;
    s3ForcePathStyle?: boolean;
    keyPrefix?: string;
  },
  updatedBy: string,
): Promise<PublicBlobSettings> {
  const existing = (await getStoredBlobSettings(database)) ?? envAsStored(env);

  const next: StoredBlobSettings = {
    provider: input.provider,
    backupOffsite: input.backupOffsite,
    s3Bucket: input.s3Bucket?.trim() || existing.s3Bucket,
    s3Region: input.s3Region?.trim() || existing.s3Region || env.BLOB_S3_REGION,
    s3Endpoint:
      input.s3Endpoint === undefined
        ? existing.s3Endpoint
        : input.s3Endpoint.trim() || undefined,
    s3ForcePathStyle: input.s3ForcePathStyle ?? existing.s3ForcePathStyle,
    keyPrefix:
      input.keyPrefix === undefined
        ? existing.keyPrefix
        : input.keyPrefix.trim() || undefined,
    s3AccessKeyId: existing.s3AccessKeyId,
    s3SecretAccessKey: existing.s3SecretAccessKey,
  };

  if (input.s3AccessKeyId === null) {
    next.s3AccessKeyId = undefined;
  } else if (typeof input.s3AccessKeyId === 'string' && input.s3AccessKeyId.trim()) {
    next.s3AccessKeyId = input.s3AccessKeyId.trim();
  }

  if (input.s3SecretAccessKey === null) {
    next.s3SecretAccessKey = undefined;
  } else if (
    typeof input.s3SecretAccessKey === 'string' &&
    input.s3SecretAccessKey.trim()
  ) {
    next.s3SecretAccessKey = input.s3SecretAccessKey.trim();
  }

  if (next.provider === 's3') {
    const bucket = next.s3Bucket?.trim();
    const key = next.s3AccessKeyId?.trim() || env.BLOB_S3_ACCESS_KEY_ID;
    const secret = next.s3SecretAccessKey?.trim() || env.BLOB_S3_SECRET_ACCESS_KEY;
    if (!bucket || !key || !secret) {
      throw new AppError({
        code: 'BLOB_CONFIG_INCOMPLETE',
        message: 'S3 requires bucket plus access key and secret (or env fallbacks)',
        statusCode: 400,
      });
    }
  }

  await database.db
    .insert(platformSettings)
    .values({
      key: BLOB_SETTINGS_KEY,
      value: JSON.stringify(next),
      updatedBy,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: platformSettings.key,
      set: {
        value: JSON.stringify(next),
        updatedBy,
        updatedAt: new Date(),
      },
    });

  return getPublicBlobSettings(database, env);
}

export async function clearStoredBlobSettings(
  database: Database,
): Promise<void> {
  await database.db
    .delete(platformSettings)
    .where(eq(platformSettings.key, BLOB_SETTINGS_KEY));
}

export async function testBlobConnection(
  database: Database,
  env: AppEnv,
): Promise<{ ok: true; provider: BlobProviderName; key: string }> {
  const { store } = await resolveBlobStore(database, env);
  if (store.provider === 'disabled') {
    throw new AppError({
      code: 'BLOB_DISABLED',
      message: 'Storage provider is disabled',
      statusCode: 400,
    });
  }

  const key = `backups/.connection-test-${Date.now()}`;
  const body = Buffer.from(`knowhub-connection-test ${new Date().toISOString()}\n`);
  await store.put({ key, body, contentType: 'text/plain' });
  const roundTrip = await store.get(key);
  await store.delete(key);
  if (!roundTrip || roundTrip.toString('utf8') !== body.toString('utf8')) {
    throw new AppError({
      code: 'BLOB_TEST_FAILED',
      message: 'Wrote test object but could not read it back',
      statusCode: 502,
    });
  }
  return { ok: true, provider: store.provider, key };
}
