'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { EmailNotificationPrefs } from '@project-knowledge-hub/domain';
import { ErrorText, Panel, Switch, useToast } from './ui';

const BASE_TOGGLE_KEYS = [
  'passwordChanged',
  'aiConnectionPending',
  'aiConnectionApproved',
  'aiConnectionRejected',
] as const;

const ADMIN_TOGGLE_KEYS = ['signupPendingApproval'] as const;

type ToggleKey =
  | (typeof BASE_TOGGLE_KEYS)[number]
  | (typeof ADMIN_TOGGLE_KEYS)[number];

export function NotificationPrefsForm({
  initialPrefs,
  isSystemAdmin = false,
}: {
  initialPrefs: EmailNotificationPrefs;
  isSystemAdmin?: boolean;
}) {
  const t = useTranslations('account');
  const router = useRouter();
  const { pushToast } = useToast();
  const [prefs, setPrefs] = useState(initialPrefs);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const toggleKeys: ToggleKey[] = isSystemAdmin
    ? [...BASE_TOGGLE_KEYS, ...ADMIN_TOGGLE_KEYS]
    : [...BASE_TOGGLE_KEYS];

  async function updatePref(key: ToggleKey, checked: boolean) {
    const previous = prefs;
    const next = { ...prefs, [key]: checked };
    setPrefs(next);
    setPendingKey(key);
    setError(null);
    try {
      const response = await fetch('/api/v1/me/notification-prefs', {
        method: 'PATCH',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Origin: window.location.origin,
        },
        body: JSON.stringify({ [key]: checked }),
      });
      const payload = (await response.json()) as {
        error?: { message?: string };
        user?: { emailNotificationPrefs?: EmailNotificationPrefs };
      };
      if (!response.ok) {
        throw new Error(payload.error?.message ?? t('notificationsFailed'));
      }
      if (payload.user?.emailNotificationPrefs) {
        setPrefs(payload.user.emailNotificationPrefs);
      }
      pushToast(t('notificationsSaved'));
      router.refresh();
    } catch (err) {
      setPrefs(previous);
      const message =
        err instanceof Error ? err.message : t('notificationsFailed');
      setError(message);
      pushToast(message, 'danger');
    } finally {
      setPendingKey(null);
    }
  }

  return (
    <div className="grid gap-6">
      <Panel className="grid gap-4">
        <p className="m-0 text-sm text-ink-muted">{t('notificationsBlurb')}</p>
        {toggleKeys.map((key) => (
          <div
            key={key}
            className="grid gap-1 border-t border-line pt-3 first:border-t-0 first:pt-0"
          >
            <Switch
              id={`notify-${key}`}
              checked={prefs[key]}
              disabled={pendingKey !== null}
              label={t(`notify_${key}`)}
              onCheckedChange={(checked) => void updatePref(key, checked)}
            />
            <p className="m-0 text-xs text-ink-muted">{t(`notify_${key}_hint`)}</p>
          </div>
        ))}
        {error ? <ErrorText>{error}</ErrorText> : null}
      </Panel>

      <Panel className="grid gap-2">
        <h2 className="m-0 text-base font-semibold">{t('notificationsAlwaysTitle')}</h2>
        <p className="m-0 text-sm text-ink-muted">{t('notificationsAlwaysBlurb')}</p>
        <ul className="m-0 list-disc pl-5 text-sm text-ink-muted">
          <li>{t('notificationsAlwaysReset')}</li>
          <li>{t('notificationsAlwaysInvite')}</li>
          <li>{t('notificationsAlwaysConfirm')}</li>
          <li>{t('notificationsAlwaysApproved')}</li>
          <li>{t('notificationsAlwaysRejected')}</li>
          <li>{t('notificationsAlwaysClosed')}</li>
        </ul>
      </Panel>
    </div>
  );
}
