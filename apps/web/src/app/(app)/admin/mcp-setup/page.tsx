import { getTranslations } from 'next-intl/server';
import { McpSetupWizard } from '../../../../components/admin/McpSetupWizard';
import {
  OauthResourceCard,
  type OauthMcpSettings,
} from '../../../../components/admin/OauthResourceCard';
import { PageHeader } from '../../../../components/ui';
import { apiFetch } from '../../../../lib/session';

export default async function AdminMcpSetupPage() {
  const t = await getTranslations('admin');

  const empty = {
    organizations: [] as Array<{ id: string; name: string; slug: string }>,
    workspaces: [] as Array<{
      id: string;
      name: string;
      slug: string;
      organizationId: string;
    }>,
    users: [] as Array<{ id: string; email: string; displayName: string }>,
  };

  let organizations = empty.organizations;
  let workspaces = empty.workspaces;
  let users = empty.users;
  let oauthSettings: OauthMcpSettings | null = null;

  try {
    const [orgsRes, workspacesRes, usersRes, oauthRes] = await Promise.all([
      apiFetch('/api/v1/organizations'),
      apiFetch('/api/v1/workspaces'),
      apiFetch('/api/v1/users'),
      apiFetch('/api/v1/admin/oauth-mcp-settings'),
    ]);

    organizations = orgsRes.ok
      ? ((await orgsRes.json()) as { organizations: typeof organizations }).organizations
      : [];
    workspaces = workspacesRes.ok
      ? ((await workspacesRes.json()) as { workspaces: typeof workspaces }).workspaces
      : [];
    users = usersRes.ok
      ? ((await usersRes.json()) as { users: typeof users }).users
      : [];
    oauthSettings = oauthRes.ok ? ((await oauthRes.json()) as OauthMcpSettings) : null;
  } catch {
    // API may be briefly unavailable during reload; wizard preflight will surface it.
  }

  return (
    <div>
      <PageHeader title={t('mcpSetup')} description={t('mcpWizardBlurb')} />
      <OauthResourceCard initial={oauthSettings} />
      <McpSetupWizard
        organizations={organizations}
        workspaces={workspaces}
        users={users}
      />
    </div>
  );
}
