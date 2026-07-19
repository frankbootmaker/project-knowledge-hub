import { getTranslations } from 'next-intl/server';
import {
  MembershipsAdmin,
  type PublicMembership,
} from '../../../../components/admin/MembershipsAdmin';
import { PageHeader } from '../../../../components/ui';
import { apiFetch } from '../../../../lib/session';

export default async function AdminMembershipsPage() {
  const t = await getTranslations('admin');

  const [membershipsRes, usersRes, workspacesRes] = await Promise.all([
    apiFetch('/api/v1/memberships'),
    apiFetch('/api/v1/users'),
    apiFetch('/api/v1/workspaces'),
  ]);

  const memberships = membershipsRes.ok
    ? ((await membershipsRes.json()) as { memberships: PublicMembership[] }).memberships
    : [];
  const users = usersRes.ok
    ? ((await usersRes.json()) as {
        users: Array<{ id: string; email: string; displayName: string }>;
      }).users
    : [];
  const workspaces = workspacesRes.ok
    ? ((await workspacesRes.json()) as {
        workspaces: Array<{ id: string; name: string; slug: string }>;
      }).workspaces
    : [];

  return (
    <div>
      <PageHeader title={t('memberships')} description={t('overviewBlurb')} />
      <MembershipsAdmin
        initialMemberships={memberships}
        users={users}
        workspaces={workspaces}
      />
    </div>
  );
}
