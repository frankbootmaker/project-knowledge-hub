import { getTranslations } from 'next-intl/server';
import type { EmailNotificationPrefs } from '@project-knowledge-hub/domain';
import { NotificationPrefsForm } from '../../../../components/NotificationPrefsForm';
import { PageHeader } from '../../../../components/ui';
import { apiFetch, requireSession } from '../../../../lib/session';

export default async function AccountNotificationsPage() {
  await requireSession();
  const t = await getTranslations('account');

  const response = await apiFetch('/api/v1/me');
  if (!response.ok) {
    return (
      <div>
        <PageHeader
          title={t('notifications')}
          description={t('notificationsSubtitle')}
        />
        <p className="kh-muted">{t('notificationsLoadFailed')}</p>
      </div>
    );
  }

  const { user } = (await response.json()) as {
    user: {
      emailNotificationPrefs: EmailNotificationPrefs;
      isSystemAdmin?: boolean;
    };
  };

  return (
    <div>
      <PageHeader
        title={t('notifications')}
        description={t('notificationsSubtitle')}
      />
      <NotificationPrefsForm
        initialPrefs={user.emailNotificationPrefs}
        isSystemAdmin={Boolean(user.isSystemAdmin)}
      />
    </div>
  );
}
