import { getTranslations } from 'next-intl/server';
import { OauthGrantsList, type OauthGrantRow } from '../../../../components/admin/OauthGrantsList';
import {
  ApiClientsAdmin,
  type PublicApiClient,
} from '../../../../components/admin/ApiClientsAdmin';
import { PageHeader } from '../../../../components/ui';
import { apiFetch } from '../../../../lib/session';

export default async function AdminApiClientsPage() {
  const t = await getTranslations('admin');

  const [clientsRes, orgsRes, workspacesRes, usersRes, grantsRes] = await Promise.all([
    apiFetch('/api/v1/api-clients'),
    apiFetch('/api/v1/organizations'),
    apiFetch('/api/v1/workspaces'),
    apiFetch('/api/v1/users'),
    apiFetch('/api/v1/oauth/grants'),
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
  const grants = grantsRes.ok
    ? ((await grantsRes.json()) as { grants: OauthGrantRow[] }).grants
    : [];
  const workspaceNames = Object.fromEntries(
    workspaces.map((workspace) => [workspace.id, workspace.name]),
  );

  return (
    <div>
      <PageHeader title={t('apiClients')} description={t('overviewBlurb')} />
      <ApiClientsAdmin
        initialClients={clients}
        organizations={organizations}
        workspaces={workspaces}
        users={users}
      />
      <div className="mt-8">
        <OauthGrantsList
          grants={grants}
          workspaceNames={workspaceNames}
          showUser
          title={t('oauthGrantsTitle')}
          blurb={t('oauthGrantsBlurb')}
          revokeBase="/api/v1/oauth/grants"
        />
      </div>
    </div>
  );
}
