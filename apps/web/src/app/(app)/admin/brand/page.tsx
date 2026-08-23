import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import {
  BrandSettingsAdmin,
  type PlatformBrandSettings,
} from '../../../../components/admin/BrandSettingsAdmin';
import { PageHeader } from '../../../../components/ui';
import { isBrandId } from '../../../../lib/brand';
import { apiFetch, requireSession } from '../../../../lib/session';

export default async function AdminBrandPage() {
  const session = await requireSession();
  if (!session.user.isSystemAdmin) {
    redirect('/dashboard');
  }
  const t = await getTranslations('admin');
  const response = await apiFetch('/api/v1/admin/brand-settings');
  let initial: PlatformBrandSettings = { defaultBrand: 'knowhub', locked: false };
  if (response.ok) {
    const payload = (await response.json()) as {
      settings?: { defaultBrand?: string; locked?: boolean };
    };
    initial = {
      defaultBrand: isBrandId(payload.settings?.defaultBrand)
        ? payload.settings.defaultBrand
        : 'knowhub',
      locked: Boolean(payload.settings?.locked),
    };
  }

  return (
    <div>
      <PageHeader
        title={t('brandAdminPageTitle')}
        description={t('brandAdminPageBlurb')}
      />
      <BrandSettingsAdmin initialSettings={initial} />
    </div>
  );
}
