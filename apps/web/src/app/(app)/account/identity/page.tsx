import { getTranslations } from 'next-intl/server';
import {
  SignInIdentityPanel,
  type IdentityUser,
} from '../../../../components/SignInIdentityPanel';
import { PageHeader } from '../../../../components/ui';
import { apiFetch, requireSession } from '../../../../lib/session';

export default async function AccountIdentityPage() {
  await requireSession();
  const t = await getTranslations('account');

  const response = await apiFetch('/api/v1/me');
  if (!response.ok) {
    return (
      <div>
        <PageHeader title={t('identity')} description={t('identitySubtitle')} />
        <p className="kh-muted">{t('identityLoadFailed')}</p>
      </div>
    );
  }

  const { user } = (await response.json()) as { user: IdentityUser };

  return (
    <div>
      <PageHeader title={t('identity')} description={t('identitySubtitle')} />
      <SignInIdentityPanel user={user} />
    </div>
  );
}
