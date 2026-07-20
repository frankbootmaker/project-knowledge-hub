import { getTranslations } from 'next-intl/server';
import { ChangePasswordForm } from '../../../../components/ChangePasswordForm';
import { PageHeader } from '../../../../components/ui';
import { apiFetch, requireSession } from '../../../../lib/session';

export default async function AccountPasswordPage() {
  await requireSession();
  const t = await getTranslations('account');

  const response = await apiFetch('/api/v1/me');
  const hasPassword = response.ok
    ? Boolean(
        ((await response.json()) as { user: { hasPassword?: boolean } }).user
          .hasPassword,
      )
    : false;

  return (
    <div>
      <PageHeader title={t('password')} description={t('passwordSubtitle')} />
      <ChangePasswordForm hasPassword={hasPassword} />
    </div>
  );
}
