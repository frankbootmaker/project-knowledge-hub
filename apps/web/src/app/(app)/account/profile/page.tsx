import { getTranslations } from 'next-intl/server';
import { ProfileForm, type ProfileUser } from '../../../../components/ProfileForm';
import { PageHeader } from '../../../../components/ui';
import { apiFetch, requireSession } from '../../../../lib/session';

export default async function AccountProfilePage() {
  await requireSession();
  const t = await getTranslations('profile');

  const response = await apiFetch('/api/v1/me');
  if (!response.ok) {
    return (
      <div>
        <PageHeader title={t('title')} description={t('subtitle')} />
        <p className="kh-muted">{t('loadFailed')}</p>
      </div>
    );
  }

  const { user } = (await response.json()) as { user: ProfileUser };

  return (
    <div>
      <PageHeader title={t('title')} description={t('subtitle')} />
      <ProfileForm initialUser={user} />
    </div>
  );
}
