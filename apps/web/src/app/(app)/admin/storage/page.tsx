import { getTranslations } from 'next-intl/server';
import {
  StorageSettingsAdmin,
  type BlobUsageSummary,
  type PublicBlobSettings,
} from '../../../../components/admin/StorageSettingsAdmin';
import { PageHeader } from '../../../../components/ui';
import { apiFetch } from '../../../../lib/session';

export default async function AdminStoragePage() {
  const t = await getTranslations('admin');
  const response = await apiFetch('/api/v1/admin/storage-settings');
  const payload = response.ok
    ? ((await response.json()) as {
        settings: PublicBlobSettings;
        usage?: BlobUsageSummary;
      })
    : null;
  const settings: PublicBlobSettings = payload?.settings ?? {
    provider: 'disabled',
    backupOffsite: true,
    s3Bucket: '',
    s3Region: 'auto',
    s3Endpoint: '',
    s3ForcePathStyle: false,
    keyPrefix: 'development',
    hasAccessKeyId: false,
    hasSecretAccessKey: false,
    source: 'env',
    effectiveProvider: 'disabled',
    envProvider: 'disabled',
  };

  return (
    <div>
      <PageHeader
        title={t('storage')}
        description={t('storageSettingsPageBlurb')}
      />
      <StorageSettingsAdmin
        initialSettings={settings}
        initialUsage={payload?.usage ?? null}
      />
    </div>
  );
}
