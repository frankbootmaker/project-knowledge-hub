import { getTranslations } from 'next-intl/server';
import {
  ApiClientsAdmin,
  type PublicApiClient,
} from '../../../../components/admin/ApiClientsAdmin';
import { PageHeader } from '../../../../components/ui';
import { apiFetch } from '../../../../lib/session';

export default async function AdminApiClientsPage() {
  const t = await getTranslations('admin');

  const [clientsRes, orgsRes, workspacesRes, usersRes] = await Promise.all([
    apiFetch('/api/v1/api-clients'),
    apiFetch('/api/v1/organizations'),
    apiFetch('/api/v1/workspaces'),
    apiFetch('/api/v1/users'),
  ]);

  const clients = clientsRes.ok
    ? ((await clientsRes.json()) as { apiClients: PublicApiClient[] }).apiClients
    : [];
  const organizations = orgsRes.ok
    ? ((await orgsRes.json()) as {
        organizations: Array<{ id: string; name: string; slug: string }>;
      }).organizations
    : [];
  const workspaces = workspacesRes.ok
    ? ((await workspacesRes.json()) as {
        workspaces: Array<{
          id: string;
          name: string;
          slug: string;
          organizationId: string;
        }>;
      }).workspaces
    : [];
  const users = usersRes.ok
    ? ((await usersRes.json()) as {
        users: Array<{ id: string; email: string; displayName: string }>;
      }).users
    : [];

  return (
    <div>
      <PageHeader title={t('apiClients')} description={t('overviewBlurb')} />
      <ApiClientsAdmin
        initialClients={clients}
        organizations={organizations}
        workspaces={workspaces}
        users={users}
      />
    </div>
  );
}
