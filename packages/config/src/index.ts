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
  BOOTSTRAP_ADMIN_EMAIL: z.string().email().optional(),
  BOOTSTRAP_ADMIN_PASSWORD: z.string().min(12).optional(),
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
  return env;
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
