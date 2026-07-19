import { z } from 'zod';

export const SYNC_PROVIDERS = [
  'github',
  'gitlab',
  'azure_devops',
  'bitbucket',
  'forgejo',
] as const;

export type SyncProvider = (typeof SYNC_PROVIDERS)[number];

export const syncProviderSchema = z.enum(SYNC_PROVIDERS);

export type SyncProviderDefinition = {
  id: SyncProvider;
  /** i18n key under gitSync.provider_* */
  labelKey: `provider_${SyncProvider}`;
  syncSupported: boolean;
  /** When true, create/update must supply baseUrl. */
  requiresBaseUrl: boolean;
  /** Show optional baseUrl field in UI (self-hosted / override). */
  showsBaseUrl: boolean;
};

export const SYNC_PROVIDER_CATALOG: readonly SyncProviderDefinition[] = [
  {
    id: 'github',
    labelKey: 'provider_github',
    syncSupported: true,
    requiresBaseUrl: false,
    showsBaseUrl: false,
  },
  {
    id: 'gitlab',
    labelKey: 'provider_gitlab',
    syncSupported: true,
    requiresBaseUrl: false,
    showsBaseUrl: true,
  },
  {
    id: 'azure_devops',
    labelKey: 'provider_azure_devops',
    syncSupported: true,
    requiresBaseUrl: false,
    showsBaseUrl: true,
  },
  {
    id: 'bitbucket',
    labelKey: 'provider_bitbucket',
    syncSupported: true,
    requiresBaseUrl: false,
    showsBaseUrl: false,
  },
  {
    id: 'forgejo',
    labelKey: 'provider_forgejo',
    syncSupported: true,
    requiresBaseUrl: true,
    showsBaseUrl: true,
  },
] as const;

export function getSyncProviderDefinition(
  provider: string,
): SyncProviderDefinition | undefined {
  return SYNC_PROVIDER_CATALOG.find((entry) => entry.id === provider);
}

export function isSyncProviderSupported(provider: string): boolean {
  return getSyncProviderDefinition(provider)?.syncSupported === true;
}

export function providerNeedsBaseUrl(provider: string): boolean {
  return getSyncProviderDefinition(provider)?.requiresBaseUrl === true;
}

export function providerShowsBaseUrl(provider: string): boolean {
  return getSyncProviderDefinition(provider)?.showsBaseUrl === true;
}
