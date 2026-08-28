import { eq } from 'drizzle-orm';
import {
  oidcConfigFromEnv,
  type AppEnv,
  type OidcEnvConfig,
} from '@project-knowledge-hub/config';
import { platformSettings, type Database } from '@project-knowledge-hub/database';
import { AppError } from '@project-knowledge-hub/domain';

export const OIDC_SETTINGS_KEY = 'oidc_config';

export type StoredOidcSettings = {
  enabled: boolean;
  issuer?: string;
  clientId?: string;
  /** Stored secret — never returned to clients in full. */
  clientSecret?: string;
  buttonLabel?: string;
  idpSource?: string;
  redirectUri?: string;
  jitProvisioning?: boolean;
};

export type PublicOidcSettings = {
  enabled: boolean;
  issuer: string;
  clientId: string;
  buttonLabel: string;
  idpSource: string;
  redirectUri: string;
  defaultRedirectUri: string;
  jitProvisioning: boolean;
  hasClientSecret: boolean;
  source: 'override' | 'env';
  effectiveEnabled: boolean;
  envConfigured: boolean;
};

function defaultRedirectUri(env: AppEnv): string {
  return `${env.WEB_URL.replace(/\/$/, '')}/api/v1/auth/oidc/callback`;
}

function envAsStored(env: AppEnv): StoredOidcSettings {
  const fromEnv = oidcConfigFromEnv(env);
  return {
    enabled: Boolean(fromEnv),
    issuer: env.OIDC_ISSUER,
    clientId: env.OIDC_CLIENT_ID,
    clientSecret: env.OIDC_CLIENT_SECRET,
    buttonLabel: env.OIDC_BUTTON_LABEL,
    idpSource: env.OIDC_IDP_SOURCE,
    redirectUri: env.OIDC_REDIRECT_URI,
    jitProvisioning: env.OIDC_JIT_PROVISIONING,
  };
}

function trimOrUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

export async function getStoredOidcSettings(
  database: Database,
): Promise<StoredOidcSettings | null> {
  const [row] = await database.db
    .select()
    .from(platformSettings)
    .where(eq(platformSettings.key, OIDC_SETTINGS_KEY))
    .limit(1);
  if (!row?.value?.trim()) {
    return null;
  }
  try {
    const parsed = JSON.parse(row.value) as StoredOidcSettings;
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function resolveOidcConfig(
  database: Database,
  env: AppEnv,
): Promise<{ config: OidcEnvConfig | null; source: 'override' | 'env' }> {
  const stored = await getStoredOidcSettings(database);
  const envConfig = oidcConfigFromEnv(env);
  if (!stored) {
    return { config: envConfig, source: 'env' };
  }

  const issuer = trimOrUndefined(stored.issuer) || env.OIDC_ISSUER;
  const clientId = trimOrUndefined(stored.clientId) || env.OIDC_CLIENT_ID;
  const clientSecret =
    trimOrUndefined(stored.clientSecret) || env.OIDC_CLIENT_SECRET;
  const enabled = stored.enabled !== false;
  if (!enabled || !issuer || !clientId || !clientSecret) {
    return { config: null, source: 'override' };
  }

  return {
    source: 'override',
    config: {
      issuer,
      clientId,
      clientSecret,
      buttonLabel:
        trimOrUndefined(stored.buttonLabel) || env.OIDC_BUTTON_LABEL,
      idpSource: trimOrUndefined(stored.idpSource) || env.OIDC_IDP_SOURCE,
      redirectUri:
        trimOrUndefined(stored.redirectUri)
        || env.OIDC_REDIRECT_URI
        || defaultRedirectUri(env),
      jitProvisioning: asBoolean(
        stored.jitProvisioning,
        env.OIDC_JIT_PROVISIONING,
      ),
    },
  };
}

export async function getPublicOidcSettings(
  database: Database,
  env: AppEnv,
): Promise<PublicOidcSettings> {
  const stored = await getStoredOidcSettings(database);
  const envStored = envAsStored(env);
  const effective = stored ?? envStored;
  const { config, source } = await resolveOidcConfig(database, env);

  return {
    enabled: stored ? stored.enabled !== false : Boolean(oidcConfigFromEnv(env)),
    issuer: trimOrUndefined(effective.issuer) || env.OIDC_ISSUER || '',
    clientId: trimOrUndefined(effective.clientId) || env.OIDC_CLIENT_ID || '',
    buttonLabel:
      trimOrUndefined(effective.buttonLabel) || env.OIDC_BUTTON_LABEL,
    idpSource: trimOrUndefined(effective.idpSource) || env.OIDC_IDP_SOURCE,
    redirectUri: trimOrUndefined(effective.redirectUri) || '',
    defaultRedirectUri: defaultRedirectUri(env),
    jitProvisioning: asBoolean(
      effective.jitProvisioning,
      env.OIDC_JIT_PROVISIONING,
    ),
    hasClientSecret: Boolean(
      stored?.clientSecret?.trim() || env.OIDC_CLIENT_SECRET,
    ),
    source,
    effectiveEnabled: Boolean(config),
    envConfigured: Boolean(oidcConfigFromEnv(env)),
  };
}

export type OidcSettingsUpdate = {
  enabled: boolean;
  issuer?: string;
  clientId?: string;
  /** Omit / undefined = keep existing; null or empty string = clear; string = set. */
  clientSecret?: string | null;
  buttonLabel?: string;
  idpSource?: string;
  redirectUri?: string | null;
  jitProvisioning?: boolean;
};

export async function setStoredOidcSettings(
  database: Database,
  env: AppEnv,
  update: OidcSettingsUpdate,
  updatedBy: string | null,
): Promise<PublicOidcSettings> {
  const existing = await getStoredOidcSettings(database);

  let clientSecret = existing?.clientSecret;
  if (update.clientSecret === null || update.clientSecret === '') {
    clientSecret = undefined;
  } else if (typeof update.clientSecret === 'string') {
    clientSecret = update.clientSecret;
  }

  let redirectUri = existing?.redirectUri;
  if (update.redirectUri === null) {
    redirectUri = undefined;
  } else if (typeof update.redirectUri === 'string') {
    redirectUri = trimOrUndefined(update.redirectUri);
  }

  const next: StoredOidcSettings = {
    enabled: update.enabled,
    issuer: trimOrUndefined(update.issuer),
    clientId: trimOrUndefined(update.clientId),
    clientSecret,
    buttonLabel: trimOrUndefined(update.buttonLabel),
    idpSource: trimOrUndefined(update.idpSource),
    redirectUri,
    jitProvisioning: asBoolean(
      update.jitProvisioning,
      asBoolean(existing?.jitProvisioning, env.OIDC_JIT_PROVISIONING),
    ),
  };

  if (next.enabled) {
    const issuer = next.issuer || env.OIDC_ISSUER;
    const clientId = next.clientId || env.OIDC_CLIENT_ID;
    const secret = next.clientSecret?.trim() || env.OIDC_CLIENT_SECRET;
    if (!issuer || !clientId || !secret) {
      throw new AppError({
        code: 'OIDC_INCOMPLETE',
        message:
          'Issuer, client id, and client secret are required to enable SSO (save them here or set OIDC_* env)',
        statusCode: 400,
      });
    }
    try {
      new URL(issuer);
    } catch {
      throw new AppError({
        code: 'OIDC_ISSUER_INVALID',
        message: 'Issuer must be a valid URL',
        statusCode: 400,
      });
    }
    if (next.redirectUri) {
      try {
        new URL(next.redirectUri);
      } catch {
        throw new AppError({
          code: 'OIDC_REDIRECT_INVALID',
          message: 'Redirect URI must be a valid URL',
          statusCode: 400,
        });
      }
    }
  }

  await database.db
    .insert(platformSettings)
    .values({
      key: OIDC_SETTINGS_KEY,
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

  return getPublicOidcSettings(database, env);
}

export async function clearStoredOidcSettings(database: Database): Promise<void> {
  await database.db
    .delete(platformSettings)
    .where(eq(platformSettings.key, OIDC_SETTINGS_KEY));
}
