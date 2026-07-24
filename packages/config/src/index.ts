import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

/** Load a dotenv file into process.env without overriding existing values. */
export function loadDotEnvFile(filePath: string): void {
  if (!existsSync(filePath)) {
    return;
  }

  for (const line of readFileSync(filePath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const separator = trimmed.indexOf('=');
    if (separator <= 0) {
      continue;
    }
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

export function loadNearestDotEnv(startDir = process.cwd()): void {
  let current = path.resolve(startDir);
  for (let i = 0; i < 6; i += 1) {
    const candidate = path.join(current, '.env');
    if (existsSync(candidate)) {
      loadDotEnvFile(candidate);
      return;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return;
    }
    current = parent;
  }
}

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  WEB_PORT: z.coerce.number().int().positive().default(3100),
  API_PORT: z.coerce.number().int().positive().default(3101),
  WEB_URL: z.string().url().default('http://localhost:3100'),
  API_URL: z.string().url().default('http://localhost:3101'),
  /** Optional public MCP URL for proxies / split DNS (Cursor client config). */
  MCP_PUBLIC_URL: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().url().optional(),
  ),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  SESSION_SECRET: z.string().min(32),
  SESSION_COOKIE_NAME: z.string().min(1).default('kh_session'),
  SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(60 * 60 * 24),
  BOOTSTRAP_ADMIN_EMAIL: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().email().optional(),
  ),
  BOOTSTRAP_ADMIN_PASSWORD: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().min(12).optional(),
  ),
  BOOTSTRAP_ADMIN_DISPLAY_NAME: z.string().min(1).default('Administrator'),
  DEFAULT_ORGANIZATION_NAME: z.string().min(1).default('Default Organization'),
  DEFAULT_ORGANIZATION_SLUG: z.string().min(1).default('default'),
  /** Daily safety re-sync for git connections (worker). Set 0 to disable. */
  GIT_SYNC_SAFETY_INTERVAL_MS: z.coerce
    .number()
    .int()
    .min(0)
    .default(24 * 60 * 60 * 1000),
  MAIL_DRIVER: z.enum(['console', 'smtp', 'resend']).default('console'),
  MAIL_FROM: z.string().min(1).default('Project Knowledge Hub <noreply@localhost.local>'),
  SMTP_HOST: z.string().min(1).optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SECURE: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  AUTH_PASSWORD_RESET_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(60 * 60),
  AUTH_INVITE_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(60 * 60 * 24 * 7),
  AUTH_EMAIL_CONFIRM_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(60 * 60 * 24),
  /** Directory for profile avatar binaries (one file per user id). */
  AVATAR_UPLOAD_DIR: z.string().min(1).default('./data/avatars'),
  AVATAR_MAX_BYTES: z.coerce.number().int().positive().default(1024 * 1024),
  /** Workspace knowledge media (JPEG/PNG/WebP) when BlobStore is disabled. */
  MEDIA_UPLOAD_DIR: z.string().min(1).default('./data/media'),
  MEDIA_MAX_BYTES: z.coerce.number().int().positive().default(5 * 1024 * 1024),
  /** Ops-0/NF-011: Postgres dump directory (Compose mounts volume here on api). */
  BACKUP_DIR: z.string().min(1).default('./backups'),
  /** Max dump upload size for Admin → Monitoring import (default 512 MiB). */
  BACKUP_MAX_UPLOAD_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(512 * 1024 * 1024),
  BACKUP_KEEP_DAILY: z.coerce.number().int().min(1).max(90).default(7),
  BACKUP_KEEP_WEEKLY: z.coerce.number().int().min(0).max(52).default(4),
  BACKUP_KEEP_MONTHLY: z.coerce.number().int().min(0).max(36).default(3),
  BACKUP_AUTO_ROTATE: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  /** Sidecar / Admin schedule defaults (overridable via BACKUP_DIR/schedule.json). */
  BACKUP_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  BACKUP_INTERVAL_SECONDS: z.coerce.number().int().min(60).default(86400),
  /** Hours after last successful dump before Monitoring flags a stale backup (NF-009). */
  BACKUP_STALE_AFTER_HOURS: z.coerce.number().int().min(1).max(168).default(36),
  /**
   * When a signup stays pending_approval longer than this, email all system admins once.
   * Allowed: 4, 12, or 24.
   */
  SIGNUP_PENDING_ESCALATE_AFTER_HOURS: z.coerce
    .number()
    .int()
    .refine((value) => value === 4 || value === 12 || value === 24, {
      message: 'SIGNUP_PENDING_ESCALATE_AFTER_HOURS must be 4, 12, or 24',
    })
    .default(4),
  /** Worker poll for signup escalation (0 = disabled). Default 15 minutes. */
  SIGNUP_PENDING_ESCALATE_INTERVAL_MS: z.coerce
    .number()
    .int()
    .min(0)
    .default(15 * 60 * 1000),
  /**
   * When true (default), successful dumps are uploaded to BlobStore when
   * BLOB_PROVIDER is not disabled.
   */
  BACKUP_OFFSITE: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  /** Worker poll interval to push local dumps that are not yet offsite (0 = off). */
  BACKUP_OFFSITE_SYNC_INTERVAL_MS: z.coerce
    .number()
    .int()
    .min(0)
    .default(5 * 60 * 1000),
  /** Object storage: disabled | s3 (Azure later). */
  BLOB_PROVIDER: z.enum(['disabled', 's3']).default('disabled'),
  BLOB_S3_BUCKET: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().min(1).optional(),
  ),
  BLOB_S3_REGION: z.string().min(1).default('auto'),
  BLOB_S3_ENDPOINT: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().url().optional(),
  ),
  BLOB_S3_ACCESS_KEY_ID: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().min(1).optional(),
  ),
  BLOB_S3_SECRET_ACCESS_KEY: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().min(1).optional(),
  ),
  /** Required for MinIO / some S3-compatible endpoints. */
  BLOB_S3_FORCE_PATH_STYLE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  /** Key root, e.g. `staging` → objects at `staging/backups/…`. Defaults to APP_ENV. */
  BLOB_KEY_PREFIX: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().min(1).optional(),
  ),
  /** Milestone 10: embedding provider (disabled = FTS-only). */
  EMBEDDING_PROVIDER: z
    .enum(['disabled', 'ollama', 'openai_compatible'])
    .default('disabled'),
  EMBEDDING_MODEL: z.string().min(1).default('nomic-embed-text'),
  EMBEDDING_BASE_URL: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().url().optional(),
  ),
  EMBEDDING_API_KEY: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().min(1).optional(),
  ),
  /** Must match pgvector column (vector(768)) and the active model. */
  EMBEDDING_DIMENSIONS: z.coerce.number().int().positive().default(768),
  /** When true and provider is live, hybrid mode may be requested. */
  SEARCH_HYBRID_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
});

export type AppEnv = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  if (source === process.env) {
    loadNearestDotEnv();
  }
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${details}`);
  }
  const env = parsed.data;
  if (env.MAIL_DRIVER === 'smtp' && !env.SMTP_HOST) {
    throw new Error('Invalid environment configuration: SMTP_HOST is required when MAIL_DRIVER=smtp');
  }
  if (env.MAIL_DRIVER === 'resend' && !env.RESEND_API_KEY) {
    throw new Error(
      'Invalid environment configuration: RESEND_API_KEY is required when MAIL_DRIVER=resend',
    );
  }
  if (env.EMBEDDING_PROVIDER === 'ollama' && !env.EMBEDDING_BASE_URL) {
    // Default local Ollama endpoint when unset
    return {
      ...env,
      EMBEDDING_BASE_URL: 'http://127.0.0.1:11434',
    };
  }
  if (
    env.EMBEDDING_PROVIDER === 'openai_compatible' &&
    !env.EMBEDDING_BASE_URL
  ) {
    throw new Error(
      'Invalid environment configuration: EMBEDDING_BASE_URL is required when EMBEDDING_PROVIDER=openai_compatible',
    );
  }
  if (env.BLOB_PROVIDER === 's3') {
    if (!env.BLOB_S3_BUCKET) {
      throw new Error(
        'Invalid environment configuration: BLOB_S3_BUCKET is required when BLOB_PROVIDER=s3',
      );
    }
    if (!env.BLOB_S3_ACCESS_KEY_ID || !env.BLOB_S3_SECRET_ACCESS_KEY) {
      throw new Error(
        'Invalid environment configuration: BLOB_S3_ACCESS_KEY_ID and BLOB_S3_SECRET_ACCESS_KEY are required when BLOB_PROVIDER=s3',
      );
    }
  }
  return env;
}

export function embeddingConfigFromEnv(env: AppEnv) {
  return {
    provider: env.EMBEDDING_PROVIDER,
    model: env.EMBEDDING_MODEL,
    baseUrl: env.EMBEDDING_BASE_URL,
    apiKey: env.EMBEDDING_API_KEY,
    dimensions: env.EMBEDDING_DIMENSIONS,
    hybridEnabled: env.SEARCH_HYBRID_ENABLED && env.EMBEDDING_PROVIDER !== 'disabled',
  };
}

export function blobStoreConfigFromEnv(env: AppEnv) {
  if (env.BLOB_PROVIDER === 'disabled') {
    return { provider: 'disabled' as const };
  }
  return {
    provider: 's3' as const,
    bucket: env.BLOB_S3_BUCKET!,
    region: env.BLOB_S3_REGION,
    endpoint: env.BLOB_S3_ENDPOINT,
    accessKeyId: env.BLOB_S3_ACCESS_KEY_ID!,
    secretAccessKey: env.BLOB_S3_SECRET_ACCESS_KEY!,
    forcePathStyle: env.BLOB_S3_FORCE_PATH_STYLE,
    keyPrefix: env.BLOB_KEY_PREFIX ?? env.APP_ENV,
  };
}

export function mailConfigFromEnv(env: AppEnv) {
  return {
    driver: env.MAIL_DRIVER,
    from: env.MAIL_FROM,
    webUrl: env.WEB_URL,
    smtp:
      env.MAIL_DRIVER === 'smtp'
        ? {
            host: env.SMTP_HOST!,
            port: env.SMTP_PORT,
            secure: env.SMTP_SECURE ?? false,
            user: env.SMTP_USER,
            pass: env.SMTP_PASS,
          }
        : undefined,
    resendApiKey: env.RESEND_API_KEY,
  };
}
