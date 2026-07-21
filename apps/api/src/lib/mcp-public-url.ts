import { eq } from 'drizzle-orm';
import { platformSettings, type Database } from '@project-knowledge-hub/database';
import type { AppEnv } from '@project-knowledge-hub/config';

export const MCP_PUBLIC_URL_SETTING_KEY = 'mcp_public_url';

export function defaultMcpUrlFromApi(apiUrl: string): string {
  return `${apiUrl.replace(/\/$/, '')}/mcp`;
}

/** Public origin for browser/LLM clients (same-origin Next rewrites to the API). */
export function publicOriginFromWebUrl(webUrl: string): string {
  return webUrl.replace(/\/$/, '');
}

/** Ensure a public MCP endpoint URL ends with /mcp when only a host was provided. */
export function normalizeMcpPublicUrl(value: string): string {
  const parsed = new URL(value.trim());
  if (!parsed.pathname || parsed.pathname === '/') {
    parsed.pathname = '/mcp';
  } else if (parsed.pathname.endsWith('/') && parsed.pathname.length > 1) {
    parsed.pathname = parsed.pathname.slice(0, -1);
  }
  return parsed.toString().replace(/\/$/, '');
}

export async function getMcpPublicUrlOverride(
  database: Database,
): Promise<string | null> {
  const [row] = await database.db
    .select()
    .from(platformSettings)
    .where(eq(platformSettings.key, MCP_PUBLIC_URL_SETTING_KEY))
    .limit(1);
  const value = row?.value?.trim();
  return value ? value : null;
}

export type McpPublicUrlSource = 'override' | 'env' | 'web_url' | 'api_url';

/**
 * Public MCP URL for LLM clients. Prefer same-origin WEB_URL (Next rewrites /mcp)
 * over API_URL, which is often an internal Compose hostname (http://api:3101).
 */
export function defaultPublicMcpUrlFromWeb(webUrl: string): string {
  return defaultMcpUrlFromApi(webUrl);
}

export async function resolveMcpPublicUrl(
  database: Database,
  env: AppEnv,
): Promise<{
  mcpUrl: string;
  mcpUrlInternal: string;
  mcpUrlDefault: string;
  mcpUrlOverride: string | null;
  mcpUrlEnv: string | null;
  source: McpPublicUrlSource;
}> {
  const mcpUrlInternal = defaultMcpUrlFromApi(env.API_URL);
  const mcpUrlFromWeb = defaultPublicMcpUrlFromWeb(env.WEB_URL);
  const mcpUrlEnv = env.MCP_PUBLIC_URL
    ? normalizeMcpPublicUrl(env.MCP_PUBLIC_URL)
    : null;
  const mcpUrlOverride = await getMcpPublicUrlOverride(database);
  // Default shown in the wizard when no override: env, else public web origin.
  const mcpUrlDefault = mcpUrlEnv ?? mcpUrlFromWeb;

  if (mcpUrlOverride) {
    return {
      mcpUrl: normalizeMcpPublicUrl(mcpUrlOverride),
      mcpUrlInternal,
      mcpUrlDefault,
      mcpUrlOverride: normalizeMcpPublicUrl(mcpUrlOverride),
      mcpUrlEnv,
      source: 'override',
    };
  }

  if (mcpUrlEnv) {
    return {
      mcpUrl: mcpUrlEnv,
      mcpUrlInternal,
      mcpUrlDefault,
      mcpUrlOverride: null,
      mcpUrlEnv,
      source: 'env',
    };
  }

  return {
    mcpUrl: mcpUrlFromWeb,
    mcpUrlInternal,
    mcpUrlDefault,
    mcpUrlOverride: null,
    mcpUrlEnv: null,
    source: 'web_url',
  };
}

export async function setMcpPublicUrlOverride(
  database: Database,
  value: string | null,
  updatedBy: string | null,
): Promise<string | null> {
  if (!value || !value.trim()) {
    await database.db
      .delete(platformSettings)
      .where(eq(platformSettings.key, MCP_PUBLIC_URL_SETTING_KEY));
    return null;
  }

  const normalized = normalizeMcpPublicUrl(value);
  await database.db
    .insert(platformSettings)
    .values({
      key: MCP_PUBLIC_URL_SETTING_KEY,
      value: normalized,
      updatedBy,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: platformSettings.key,
      set: {
        value: normalized,
        updatedBy,
        updatedAt: new Date(),
      },
    });

  return normalized;
}
