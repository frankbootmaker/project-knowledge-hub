import { eq } from 'drizzle-orm';
import { mailConfigFromEnv, type AppEnv } from '@project-knowledge-hub/config';
import { platformSettings, type Database } from '@project-knowledge-hub/database';
import {
  createMailTransport,
  type MailConfig,
  type MailDriver,
  type MailTransport,
} from '@project-knowledge-hub/mail';
import { AppError } from '@project-knowledge-hub/domain';

export const MAIL_SETTINGS_KEY = 'mail_config';

export type StoredMailSettings = {
  driver: MailDriver;
  from: string;
  smtpHost?: string;
  smtpPort?: number;
  smtpSecure?: boolean;
  smtpUser?: string;
  /** Stored secret — never returned to clients in full. */
  smtpPass?: string;
  /** Stored secret — never returned to clients in full. */
  resendApiKey?: string;
};

export type PublicMailSettings = {
  driver: MailDriver;
  from: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  hasSmtpPass: boolean;
  hasResendApiKey: boolean;
  source: 'override' | 'env';
  effectiveDriver: MailDriver;
  envDriver: MailDriver;
};

function envAsStored(env: AppEnv): StoredMailSettings {
  return {
    driver: env.MAIL_DRIVER,
    from: env.MAIL_FROM,
    smtpHost: env.SMTP_HOST,
    smtpPort: env.SMTP_PORT,
    smtpSecure: env.SMTP_SECURE ?? false,
    smtpUser: env.SMTP_USER,
    smtpPass: env.SMTP_PASS,
    resendApiKey: env.RESEND_API_KEY,
  };
}

export async function getStoredMailSettings(
  database: Database,
): Promise<StoredMailSettings | null> {
  const [row] = await database.db
    .select()
    .from(platformSettings)
    .where(eq(platformSettings.key, MAIL_SETTINGS_KEY))
    .limit(1);
  if (!row?.value?.trim()) {
    return null;
  }
  try {
    const parsed = JSON.parse(row.value) as StoredMailSettings;
    if (!parsed || typeof parsed !== 'object' || !parsed.driver) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function resolveMailConfig(
  database: Database,
  env: AppEnv,
): Promise<{ config: MailConfig; source: 'override' | 'env' }> {
  const stored = await getStoredMailSettings(database);
  if (!stored) {
    return { config: mailConfigFromEnv(env), source: 'env' };
  }

  const config: MailConfig = {
    driver: stored.driver,
    from: stored.from?.trim() || env.MAIL_FROM,
    webUrl: env.WEB_URL,
    smtp:
      stored.driver === 'smtp'
        ? {
            host: stored.smtpHost?.trim() || '',
            port: stored.smtpPort ?? env.SMTP_PORT,
            secure: stored.smtpSecure ?? false,
            user: stored.smtpUser,
            pass: stored.smtpPass,
          }
        : undefined,
    resendApiKey: stored.driver === 'resend' ? stored.resendApiKey : undefined,
  };

  return { config, source: 'override' };
}

export async function getPublicMailSettings(
  database: Database,
  env: AppEnv,
): Promise<PublicMailSettings> {
  const stored = await getStoredMailSettings(database);
  const envStored = envAsStored(env);
  const effective = stored ?? envStored;
  const { config, source } = await resolveMailConfig(database, env);

  return {
    driver: effective.driver,
    from: effective.from || env.MAIL_FROM,
    smtpHost: effective.smtpHost ?? '',
    smtpPort: effective.smtpPort ?? env.SMTP_PORT,
    smtpSecure: effective.smtpSecure ?? false,
    smtpUser: effective.smtpUser ?? '',
    hasSmtpPass: Boolean(effective.smtpPass),
    hasResendApiKey: Boolean(effective.resendApiKey),
    source,
    effectiveDriver: config.driver,
    envDriver: env.MAIL_DRIVER,
  };
}

export type MailSettingsUpdate = {
  driver: MailDriver;
  from: string;
  smtpHost?: string;
  smtpPort?: number;
  smtpSecure?: boolean;
  smtpUser?: string;
  /** Omit / undefined = keep existing; null = clear; string = set. */
  smtpPass?: string | null;
  resendApiKey?: string | null;
};

export async function setStoredMailSettings(
  database: Database,
  env: AppEnv,
  update: MailSettingsUpdate,
  updatedBy: string | null,
): Promise<PublicMailSettings> {
  const existing = await getStoredMailSettings(database);

  let smtpPass = existing?.smtpPass;
  if (update.smtpPass === null) {
    smtpPass = undefined;
  } else if (typeof update.smtpPass === 'string' && update.smtpPass.length > 0) {
    smtpPass = update.smtpPass;
  }

  let resendApiKey = existing?.resendApiKey;
  if (update.resendApiKey === null) {
    resendApiKey = undefined;
  } else if (
    typeof update.resendApiKey === 'string' &&
    update.resendApiKey.length > 0
  ) {
    resendApiKey = update.resendApiKey;
  }

  const next: StoredMailSettings = {
    driver: update.driver,
    from: update.from.trim(),
    smtpHost: update.smtpHost?.trim() || undefined,
    smtpPort: update.smtpPort,
    smtpSecure: update.smtpSecure,
    smtpUser: update.smtpUser?.trim() || undefined,
    smtpPass,
    resendApiKey,
  };

  if (!next.from) {
    throw new AppError({
      code: 'MAIL_FROM_REQUIRED',
      message: 'From address is required',
      statusCode: 400,
    });
  }

  if (next.driver === 'smtp' && !next.smtpHost) {
    throw new AppError({
      code: 'SMTP_HOST_REQUIRED',
      message: 'SMTP host is required for the SMTP driver',
      statusCode: 400,
    });
  }

  if (next.driver === 'resend' && !next.resendApiKey) {
    throw new AppError({
      code: 'RESEND_API_KEY_REQUIRED',
      message: 'Resend API key is required for the Resend driver',
      statusCode: 400,
    });
  }

  // Validate transport can be constructed (does not send).
  createMailTransport({
    driver: next.driver,
    from: next.from,
    webUrl: 'http://localhost',
    smtp:
      next.driver === 'smtp'
        ? {
            host: next.smtpHost!,
            port: next.smtpPort ?? 587,
            secure: next.smtpSecure ?? false,
            user: next.smtpUser,
            pass: next.smtpPass,
          }
        : undefined,
    resendApiKey: next.resendApiKey,
  });

  await database.db
    .insert(platformSettings)
    .values({
      key: MAIL_SETTINGS_KEY,
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

  return getPublicMailSettings(database, env);
}

export async function clearStoredMailSettings(database: Database): Promise<void> {
  await database.db
    .delete(platformSettings)
    .where(eq(platformSettings.key, MAIL_SETTINGS_KEY));
}

export function createResolvingMailTransport(
  getConfig: () => Promise<MailConfig>,
): MailTransport {
  let cache: { key: string; transport: MailTransport } | null = null;

  return {
    get driver() {
      return cache?.transport.driver ?? 'console';
    },
    async send(message) {
      const config = await getConfig();
      const key = JSON.stringify({
        driver: config.driver,
        from: config.from,
        webUrl: config.webUrl,
        smtp: config.smtp
          ? {
              host: config.smtp.host,
              port: config.smtp.port,
              secure: config.smtp.secure,
              user: config.smtp.user,
              pass: config.smtp.pass ? '[set]' : '',
            }
          : null,
        resendApiKey: config.resendApiKey ? '[set]' : '',
      });
      if (!cache || cache.key !== key) {
        cache = { key, transport: createMailTransport(config) };
      }
      return cache.transport.send(message);
    },
  };
}
