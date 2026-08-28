import { getTranslations } from 'next-intl/server';
import {
  OidcSettingsAdmin,
  type PublicOidcSettings,
} from '../../../../components/admin/OidcSettingsAdmin';
import { PageHeader } from '../../../../components/ui';
import { apiFetch } from '../../../../lib/session';

const fallbackSettings: PublicOidcSettings = {
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

export default async function AdminSsoPage() {
  const t = await getTranslations('admin');
  const response = await apiFetch('/api/v1/admin/oidc-settings');
  const settings: PublicOidcSettings = response.ok
    ? ((await response.json()) as { settings: PublicOidcSettings }).settings
    : fallbackSettings;

  return (
    <div>
      <PageHeader title={t('sso')} description={t('ssoSettingsPageBlurb')} />
      <OidcSettingsAdmin initialSettings={settings} />
    </div>
  );
}
