import { getTranslations } from 'next-intl/server';
import { UsersAdmin, type PublicUser } from '../../../../components/admin/UsersAdmin';
import { PageHeader } from '../../../../components/ui';
import { apiFetch } from '../../../../lib/session';

export default async function AdminUsersPage() {
  const t = await getTranslations('admin');
  const response = await apiFetch('/api/v1/users');
  const users = response.ok
    ? ((await response.json()) as { users: PublicUser[] }).users
    : [];

  return (
    <div>
      <PageHeader title={t('users')} description={t('overviewBlurb')} />
      <UsersAdmin initialUsers={users} />
    </div>
  );
}
