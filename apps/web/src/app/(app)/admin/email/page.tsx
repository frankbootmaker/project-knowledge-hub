import { getTranslations } from 'next-intl/server';
import {
  MailSettingsAdmin,
  type PublicMailSettings,
} from '../../../../components/admin/MailSettingsAdmin';
import { PageHeader } from '../../../../components/ui';
import { apiFetch } from '../../../../lib/session';

export default async function AdminEmailPage() {
  const t = await getTranslations('admin');
  const response = await apiFetch('/api/v1/admin/mail-settings');
  const settings: PublicMailSettings = response.ok
    ? ((await response.json()) as { settings: PublicMailSettings }).settings
    : {
        driver: 'console',
        from: 'Project Knowledge Hub <noreply@localhost.local>',
        smtpHost: '',
        smtpPort: 587,
        smtpSecure: false,
        smtpUser: '',
        hasSmtpPass: false,
        hasResendApiKey: false,
        source: 'env',
        effectiveDriver: 'console',
        envDriver: 'console',
      };

  return (
    <div>
      <PageHeader title={t('email')} description={t('mailSettingsPageBlurb')} />
      <MailSettingsAdmin initialSettings={settings} />
    </div>
  );
}
