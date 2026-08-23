import { getTranslations } from 'next-intl/server';
import type { DisplayPrefs } from '@project-knowledge-hub/domain';
import { mergeDisplayPrefs } from '@project-knowledge-hub/domain';
import { BrandPicker } from '../../../../components/BrandPicker';
import { DisplayPrefsForm } from '../../../../components/DisplayPrefsForm';
import { PageHeader } from '../../../../components/ui';
import {
  getPersonalBrandCookie,
  loadPlatformBrandSettings,
} from '../../../../lib/brand-actions';
import { resolveEffectiveBrand } from '../../../../lib/brand';
import { apiFetch, requireSession } from '../../../../lib/session';

export default async function AccountDisplayPage() {
  await requireSession();
  const t = await getTranslations('account');
  const brandSettings = await loadPlatformBrandSettings();
  const personalBrand = await getPersonalBrandCookie();
  const brand = resolveEffectiveBrand(brandSettings, personalBrand);

  const response = await apiFetch('/api/v1/me');
  if (!response.ok) {
    return (
      <div>
        <PageHeader title={t('display')} description={t('displaySubtitle')} />
        <p className="kh-muted">{t('displayLoadFailed')}</p>
      </div>
    );
  }

  const { user } = (await response.json()) as {
    user: { displayPrefs?: DisplayPrefs };
  };

  return (
    <div className="grid gap-6">
      <PageHeader title={t('display')} description={t('displaySubtitle')} />
      <BrandPicker
        initialBrand={brand}
        defaultBrand={brandSettings.defaultBrand}
        locked={brandSettings.locked}
        personalOverride={Boolean(personalBrand)}
      />
      <DisplayPrefsForm
        initialPrefs={mergeDisplayPrefs(user.displayPrefs)}
      />
    </div>
  );
}
