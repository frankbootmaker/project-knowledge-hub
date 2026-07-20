import { getTranslations } from 'next-intl/server';
import { UsersAdmin, type PublicUser } from '../../../../components/admin/UsersAdmin';
import { PageHeader } from '../../../../components/ui';
import { apiFetch } from '../../../../lib/session';

export default async function AdminUsersPage() {
  const t = await getTranslations('admin');
  const [usersRes, workspacesRes] = await Promise.all([
    apiFetch('/api/v1/users'),
    apiFetch('/api/v1/workspaces'),
  ]);
  const users = usersRes.ok
    ? ((await usersRes.json()) as { users: PublicUser[] }).users
    : [];
  const workspaces = workspacesRes.ok
    ? ((await workspacesRes.json()) as {
        workspaces: Array<{ id: string; name: string; slug: string }>;
      }).workspaces
    : [];

  return (
    <div>
      <PageHeader title={t('users')} description={t('usersPageBlurb')} />
      <UsersAdmin initialUsers={users} workspaces={workspaces} />
    </div>
  );
}
