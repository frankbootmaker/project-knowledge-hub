import { eq } from 'drizzle-orm';
import type { AppEnv } from '@project-knowledge-hub/config';
import { platformSettings, type Database } from '@project-knowledge-hub/database';
import { AppError } from '@project-knowledge-hub/domain';
import { DEFAULT_MCP_SCOPES, MCP_SCOPES, type McpScope } from '@project-knowledge-hub/mcp';
import { readOauthSigningKey } from './oauth-jwt.js';

export const OAUTH_MCP_SETTINGS_KEY = 'oauth_mcp_config';

export const DEFAULT_OAUTH_REDIRECT_URIS = [
  'https://chatgpt.com/connector_platform_oauth_redirect',
];

export const DEFAULT_OAUTH_CLIENT_PREFIXES = ['https://chatgpt.com/oauth/'];

export const DEFAULT_OAUTH_SCOPE_CEILING: McpScope[] = [
  ...DEFAULT_MCP_SCOPES,
  'knowledge:write',
  'pm:read',
  'pm:write',
];

export type StoredOauthMcpSettings = {
  enabled: boolean;
  redirectUris: string[];
  clientIdPrefixes: string[];
  scopeCeiling: string[];
};

export type PublicOauthMcpSettings = StoredOauthMcpSettings & {
  effectiveEnabled: boolean;
  signingKeyConfigured: boolean;
  signingKeyFingerprint: string | null;
  resourceUrl: string;
  issuer: string;
  metadataUrl: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
};

function uniqueHttps(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    const url = new URL(trimmed);
    if (url.protocol !== 'https:') {
      throw new AppError({
        code: 'VALIDATION_ERROR',
        message: 'OAuth URLs must use https',
        statusCode: 400,
      });
    }
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

export function defaultOauthMcpSettings(): StoredOauthMcpSettings {
  return {
    enabled: false,
    redirectUris: [...DEFAULT_OAUTH_REDIRECT_URIS],
    clientIdPrefixes: [...DEFAULT_OAUTH_CLIENT_PREFIXES],
    scopeCeiling: [...DEFAULT_OAUTH_SCOPE_CEILING],
  };
}

function parseStored(value: string): StoredOauthMcpSettings | null {
  try {
    const parsed = JSON.parse(value) as Partial<StoredOauthMcpSettings>;
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    const ceiling = Array.isArray(parsed.scopeCeiling)
      ? parsed.scopeCeiling.filter(
          (scope): scope is McpScope =>
            typeof scope === 'string' && (MCP_SCOPES as readonly string[]).includes(scope),
        )
      : [];
    return {
      enabled: parsed.enabled === true,
      redirectUris: Array.isArray(parsed.redirectUris)
        ? parsed.redirectUris.filter((item): item is string => typeof item === 'string')
        : [...DEFAULT_OAUTH_REDIRECT_URIS],
      clientIdPrefixes: Array.isArray(parsed.clientIdPrefixes)
        ? parsed.clientIdPrefixes.filter((item): item is string => typeof item === 'string')
        : [...DEFAULT_OAUTH_CLIENT_PREFIXES],
      scopeCeiling: ceiling.length > 0 ? ceiling : [...DEFAULT_OAUTH_SCOPE_CEILING],
    };
  } catch {
    return null;
  }
}

export async function getStoredOauthMcpSettings(
  database: Database,
): Promise<StoredOauthMcpSettings> {
  const [row] = await database.db
    .select()
    .from(platformSettings)
    .where(eq(platformSettings.key, OAUTH_MCP_SETTINGS_KEY))
    .limit(1);
  if (!row?.value) {
    return defaultOauthMcpSettings();
  }
  return parseStored(row.value) ?? defaultOauthMcpSettings();
}

export function signingStatus(env: AppEnv): {
  configured: boolean;
  fingerprint: string | null;
} {
  const material = readOauthSigningKey(env.OAUTH_JWT_PRIVATE_KEY);
  return {
    configured: Boolean(material),
    fingerprint: material?.fingerprint ?? null,
  };
}

export function isOauthMcpEffectivelyEnabled(
  stored: StoredOauthMcpSettings,
  env: AppEnv,
): boolean {
  return stored.enabled && signingStatus(env).configured;
}

export async function saveOauthMcpSettings(
  database: Database,
  input: StoredOauthMcpSettings,
  updatedBy: string,
): Promise<StoredOauthMcpSettings> {
  const redirectUris = uniqueHttps(input.redirectUris);
  const clientIdPrefixes = uniqueHttps(input.clientIdPrefixes);
  const scopeCeiling = input.scopeCeiling.filter((scope) =>
    (MCP_SCOPES as readonly string[]).includes(scope),
  );
  if (redirectUris.length === 0 || clientIdPrefixes.length === 0 || scopeCeiling.length === 0) {
    throw new AppError({
      code: 'VALIDATION_ERROR',
      message: 'Redirect URIs, client prefixes, and at least one scope are required',
      statusCode: 400,
    });
  }
  const stored: StoredOauthMcpSettings = {
    enabled: input.enabled,
    redirectUris,
    clientIdPrefixes,
    scopeCeiling,
  };
  await database.db
    .insert(platformSettings)
    .values({
      key: OAUTH_MCP_SETTINGS_KEY,
      value: JSON.stringify(stored),
      updatedBy,
    })
    .onConflictDoUpdate({
      target: platformSettings.key,
      set: {
        value: JSON.stringify(stored),
        updatedBy,
        updatedAt: new Date(),
      },
    });
  return stored;
}
