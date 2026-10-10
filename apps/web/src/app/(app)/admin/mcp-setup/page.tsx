import { getTranslations } from 'next-intl/server';
import {
  AiProvidersAdmin,
  type PublicLlmBinding,
  type PublicLlmProvider,
} from '../../../../components/admin/AiProvidersAdmin';
import {
  ApiClientsAdmin,
  type PublicApiClient,
} from '../../../../components/admin/ApiClientsAdmin';
import {
  MembershipsAdmin,
  type PublicMembership,
} from '../../../../components/admin/MembershipsAdmin';
import {
  McpAdminTabs,
  parseMcpAdminTab,
  type McpAdminTab,
} from '../../../../components/admin/McpAdminTabs';
import { McpSetupWizard } from '../../../../components/admin/McpSetupWizard';
import {
  OauthGrantsList,
  type OauthGrantRow,
} from '../../../../components/admin/OauthGrantsList';
import {
  OauthResourceCard,
  type OauthMcpSettings,
} from '../../../../components/admin/OauthResourceCard';
import { PageHeader } from '../../../../components/ui';
import { apiFetch } from '../../../../lib/session';

type OrganizationRow = { id: string; name: string; slug: string };
type WorkspaceRow = OrganizationRow & { organizationId: string };
type UserRow = { id: string; email: string; displayName: string };

async function loadDirectory(): Promise<{
  organizations: OrganizationRow[];
  workspaces: WorkspaceRow[];
  users: UserRow[];
}> {
  const empty = {
    organizations: [] as OrganizationRow[],
    workspaces: [] as WorkspaceRow[],
    users: [] as UserRow[],
  };
  try {
    const [orgsRes, workspacesRes, usersRes] = await Promise.all([
      apiFetch('/api/v1/organizations'),
      apiFetch('/api/v1/workspaces'),
      apiFetch('/api/v1/users'),
    ]);
    return {
      organizations: orgsRes.ok
        ? ((await orgsRes.json()) as { organizations: OrganizationRow[] }).organizations
        : [],
      workspaces: workspacesRes.ok
        ? ((await workspacesRes.json()) as { workspaces: WorkspaceRow[] }).workspaces
        : [],
      users: usersRes.ok ? ((await usersRes.json()) as { users: UserRow[] }).users : [],
    };
  } catch {
    return empty;
  }
}

export default async function AdminMcpSetupPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await getTranslations('admin');
  const params = await searchParams;
  const tab = parseMcpAdminTab(params.tab);

  return (
    <div>
      <PageHeader title={t('mcpSetup')} description={t('mcpHubBlurb')} />
      <McpAdminTabs
        active={tab}
        label={t('mcpTabsLabel')}
        labels={{
          bearer: t('mcpTabBearer'),
          oauth: t('mcpTabOauth'),
          clients: t('apiClients'),
          memberships: t('memberships'),
          providers: t('aiProviders'),
        }}
      />
      <McpAdminPane tab={tab} />
    </div>
  );
}

async function McpAdminPane({ tab }: { tab: McpAdminTab }) {
  const t = await getTranslations('admin');

  if (tab === 'oauth') {
    const [oauthRes, grantsRes, workspacesRes] = await Promise.all([
      apiFetch('/api/v1/admin/oauth-mcp-settings'),
      apiFetch('/api/v1/oauth/grants'),
      apiFetch('/api/v1/workspaces'),
    ]);
    const oauthSettings = oauthRes.ok ? ((await oauthRes.json()) as OauthMcpSettings) : null;
    const grants = grantsRes.ok
      ? ((await grantsRes.json()) as { grants: OauthGrantRow[] }).grants
      : [];
    const workspaces = workspacesRes.ok
      ? ((await workspacesRes.json()) as { workspaces: WorkspaceRow[] }).workspaces
      : [];
    const workspaceNames = Object.fromEntries(
      workspaces.map((workspace) => [workspace.id, workspace.name]),
    );
    return (
      <div className="grid gap-8">
        <OauthResourceCard initial={oauthSettings} />
        <OauthGrantsList
          grants={grants}
          workspaceNames={workspaceNames}
          showUser
          title={t('oauthGrantsTitle')}
          blurb={t('oauthGrantsBlurb')}
          revokeBase="/api/v1/oauth/grants"
        />
      </div>
    );
  }

  if (tab === 'clients') {
    const [clientsRes, directory] = await Promise.all([
      apiFetch('/api/v1/api-clients'),
      loadDirectory(),
    ]);
    const clients = clientsRes.ok
      ? ((await clientsRes.json()) as { apiClients: PublicApiClient[] }).apiClients
      : [];
    return (
      <div className="grid gap-4">
        <p className="m-0 text-sm text-ink-muted">{t('mcpClientsBlurb')}</p>
        <ApiClientsAdmin
          initialClients={clients}
          organizations={directory.organizations}
          workspaces={directory.workspaces}
          users={directory.users}
        />
      </div>
    );
  }

  if (tab === 'memberships') {
    const [membershipsRes, usersRes, workspacesRes] = await Promise.all([
      apiFetch('/api/v1/memberships'),
      apiFetch('/api/v1/users'),
      apiFetch('/api/v1/workspaces'),
    ]);
    const memberships = membershipsRes.ok
      ? ((await membershipsRes.json()) as { memberships: PublicMembership[] }).memberships
      : [];
    const users = usersRes.ok
      ? ((await usersRes.json()) as { users: UserRow[] }).users
      : [];
    const workspaces = workspacesRes.ok
      ? ((await workspacesRes.json()) as { workspaces: WorkspaceRow[] }).workspaces
      : [];
    return (
      <div className="grid gap-4">
        <p className="m-0 text-sm text-ink-muted">{t('mcpMembershipsBlurb')}</p>
        <MembershipsAdmin
          initialMemberships={memberships}
          users={users}
          workspaces={workspaces}
        />
      </div>
    );
  }

  if (tab === 'providers') {
    const response = await apiFetch('/api/v1/admin/llm-providers');
    const body = response.ok
      ? ((await response.json()) as {
          providers: PublicLlmProvider[];
          bindings: PublicLlmBinding[];
        })
      : { providers: [], bindings: [] };
    return (
      <AiProvidersAdmin initialProviders={body.providers} initialBindings={body.bindings} />
    );
  }

  const directory = await loadDirectory();
  return (
    <div className="grid gap-4">
      <p className="m-0 text-sm text-ink-muted">{t('mcpBearerBlurb')}</p>
      <McpSetupWizard
        organizations={directory.organizations}
        workspaces={directory.workspaces}
        users={directory.users}
      />
    </div>
  );
}
