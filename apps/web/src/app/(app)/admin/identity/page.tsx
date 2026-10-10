import { getTranslations } from 'next-intl/server';
import {
  IdentityAdminTabs,
  parseIdentityAdminTab,
} from '../../../../components/admin/IdentityAdminTabs';
import {
  OidcSettingsAdmin,
  type PublicOidcSettings,
} from '../../../../components/admin/OidcSettingsAdmin';
import {
  OrganizationsAdmin,
  type PublicOrganization,
} from '../../../../components/admin/OrganizationsAdmin';
import { UsersAdmin, type PublicUser } from '../../../../components/admin/UsersAdmin';
import { PageHeader } from '../../../../components/ui';
import { apiFetch, requireSession } from '../../../../lib/session';

const fallbackOidcSettings: PublicOidcSettings = {
  enabled: false,
  issuer: '',
  clientId: '',
  buttonLabel: 'Sign in with SSO',
  idpSource: 'oidc',
  redirectUri: '',
  defaultRedirectUri: '',
  jitProvisioning: false,
  hasClientSecret: false,
  source: 'env',
  effectiveEnabled: false,
  envConfigured: false,
};

export default async function AdminIdentityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await getTranslations('admin');
  const params = await searchParams;
  const tab = parseIdentityAdminTab(params.tab);

  return (
    <div>
      <PageHeader title={t('identity')} description={t('identityHubBlurb')} />
      <IdentityAdminTabs
        active={tab}
        label={t('identityTabsLabel')}
        labels={{
          organizations: t('organizations'),
          users: t('users'),
          sso: t('sso'),
        }}
      />
      {tab === 'users' ? <UsersPane /> : null}
      {tab === 'sso' ? <SsoPane /> : null}
      {tab === 'organizations' ? <OrganizationsPane /> : null}
    </div>
  );
}

async function OrganizationsPane() {
  const t = await getTranslations('admin');
  const response = await apiFetch('/api/v1/organizations');
  const organizations = response.ok
    ? ((await response.json()) as { organizations: PublicOrganization[] }).organizations
    : [];

  return (
    <div className="grid gap-4">
      <p className="m-0 text-sm text-ink-muted">{t('organizationsBlurb')}</p>
      <OrganizationsAdmin initialOrganizations={organizations} />
    </div>
  );
}

async function UsersPane() {
  const t = await getTranslations('admin');
  const session = await requireSession();
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
    <div className="grid gap-4">
      <p className="m-0 text-sm text-ink-muted">{t('usersPageBlurb')}</p>
      <UsersAdmin
        initialUsers={users}
        workspaces={workspaces}
        currentUserId={session.user.id}
        allowHardDelete={
          process.env.APP_ENV === 'development' || process.env.APP_ENV === 'test'
        }
      />
    </div>
  );
}

async function SsoPane() {
  const t = await getTranslations('admin');
  const response = await apiFetch('/api/v1/admin/oidc-settings');
  const settings: PublicOidcSettings = response.ok
    ? ((await response.json()) as { settings: PublicOidcSettings }).settings
    : fallbackOidcSettings;

  return (
    <div className="grid gap-4">
      <p className="m-0 text-sm text-ink-muted">{t('ssoSettingsPageBlurb')}</p>
      <OidcSettingsAdmin initialSettings={settings} />
    </div>
  );
}
