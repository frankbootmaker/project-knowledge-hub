import { getTranslations } from 'next-intl/server';
import {
  StorageSettingsAdmin,
  type PublicBlobSettings,
} from '../../../../components/admin/StorageSettingsAdmin';
import { PageHeader } from '../../../../components/ui';
import { apiFetch } from '../../../../lib/session';

export default async function AdminStoragePage() {
  const t = await getTranslations('admin');
  const response = await apiFetch('/api/v1/admin/storage-settings');
  const settings: PublicBlobSettings = response.ok
    ? ((await response.json()) as { settings: PublicBlobSettings }).settings
    : {
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
      <StorageSettingsAdmin initialSettings={settings} />
    </div>
  );
}
