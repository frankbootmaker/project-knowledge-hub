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
};

export const SYNC_PROVIDER_CATALOG: readonly SyncProviderDefinition[] = [
  { id: 'github', labelKey: 'provider_github', syncSupported: true },
  { id: 'gitlab', labelKey: 'provider_gitlab', syncSupported: false },
  { id: 'azure_devops', labelKey: 'provider_azure_devops', syncSupported: false },
  { id: 'bitbucket', labelKey: 'provider_bitbucket', syncSupported: false },
  { id: 'forgejo', labelKey: 'provider_forgejo', syncSupported: false },
] as const;

export function getSyncProviderDefinition(
  provider: string,
): SyncProviderDefinition | undefined {
  return SYNC_PROVIDER_CATALOG.find((entry) => entry.id === provider);
}

export function isSyncProviderSupported(provider: string): boolean {
  return getSyncProviderDefinition(provider)?.syncSupported === true;
}
