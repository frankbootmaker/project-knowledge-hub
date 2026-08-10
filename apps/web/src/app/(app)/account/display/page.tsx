import { getTranslations } from 'next-intl/server';
import type { DisplayPrefs } from '@project-knowledge-hub/domain';
import { mergeDisplayPrefs } from '@project-knowledge-hub/domain';
import { DisplayPrefsForm } from '../../../../components/DisplayPrefsForm';
import { PageHeader } from '../../../../components/ui';
import { apiFetch, requireSession } from '../../../../lib/session';

export default async function AccountDisplayPage() {
  await requireSession();
  const t = await getTranslations('account');

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
    <div>
      <PageHeader title={t('display')} description={t('displaySubtitle')} />
      <DisplayPrefsForm
        initialPrefs={mergeDisplayPrefs(user.displayPrefs)}
      />
    </div>
  );
}
