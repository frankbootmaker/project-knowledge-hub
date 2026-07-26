import { eq } from 'drizzle-orm';
import { mailConfigFromEnv, type AppEnv } from '@project-knowledge-hub/config';
import { platformSettings, type Database } from '@project-knowledge-hub/database';
import type { MailConfig, MailDriver } from '@project-knowledge-hub/mail';

const MAIL_SETTINGS_KEY = 'mail_config';

type StoredMailSettings = {
  driver: MailDriver;
  from: string;
  smtpHost?: string;
  smtpPort?: number;
  smtpSecure?: boolean;
  smtpUser?: string;
  smtpPass?: string;
  resendApiKey?: string;
};

export async function resolveWorkerMailConfig(
  database: Database,
  env: AppEnv,
): Promise<MailConfig> {
  const [row] = await database.db
    .select()
    .from(platformSettings)
    .where(eq(platformSettings.key, MAIL_SETTINGS_KEY))
    .limit(1);

  if (!row?.value?.trim()) {
    return mailConfigFromEnv(env);
  }

  try {
    const stored = JSON.parse(row.value) as StoredMailSettings;
    if (!stored?.driver) {
      return mailConfigFromEnv(env);
    }
    return {
      driver: stored.driver,
      from: stored.from?.trim() || env.MAIL_FROM,
      webUrl: env.WEB_URL,
      smtp:
        stored.driver === 'smtp'
          ? {
              host: stored.smtpHost?.trim() || env.SMTP_HOST || '',
              port: stored.smtpPort ?? env.SMTP_PORT,
              secure: stored.smtpSecure ?? false,
              user: stored.smtpUser?.trim() || env.SMTP_USER || undefined,
              pass: stored.smtpPass?.trim() || env.SMTP_PASS || undefined,
            }
          : undefined,
      resendApiKey:
        stored.driver === 'resend'
          ? stored.resendApiKey?.trim() || env.RESEND_API_KEY || undefined
          : undefined,
    };
  } catch {
    return mailConfigFromEnv(env);
  }
}
