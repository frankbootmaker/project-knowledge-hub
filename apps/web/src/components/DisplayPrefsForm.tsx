'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { DisplayPrefs } from '@project-knowledge-hub/domain';
import {
  DASHBOARD_WIDGET_KEYS,
  REPORT_DIAGRAM_KEYS,
} from '@project-knowledge-hub/domain';
import { ErrorText, Panel, Switch, useToast } from './ui';

type ReportKey = (typeof REPORT_DIAGRAM_KEYS)[number];
type DashboardKey = (typeof DASHBOARD_WIDGET_KEYS)[number];

export function DisplayPrefsForm({
  initialPrefs,
}: {
  initialPrefs: DisplayPrefs;
}) {
  const t = useTranslations('account');
  const router = useRouter();
  const { pushToast } = useToast();
  const [prefs, setPrefs] = useState(initialPrefs);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function updateReportPref(key: ReportKey, checked: boolean) {
    const previous = prefs;
    const next: DisplayPrefs = {
      ...prefs,
      reportDiagrams: { ...prefs.reportDiagrams, [key]: checked },
    };
    setPrefs(next);
    setPendingKey(`reportDiagrams.${key}`);
    setError(null);
    try {
      const response = await fetch('/api/v1/me/display-prefs', {
        method: 'PATCH',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Origin: window.location.origin,
        },
        body: JSON.stringify({ reportDiagrams: { [key]: checked } }),
      });
      const payload = (await response.json()) as {
        error?: { message?: string };
        user?: { displayPrefs?: DisplayPrefs };
      };
      if (!response.ok) {
        throw new Error(payload.error?.message ?? t('displayFailed'));
      }
      if (payload.user?.displayPrefs) {
        setPrefs(payload.user.displayPrefs);
      }
      pushToast(t('displaySaved'));
      router.refresh();
    } catch (err) {
      setPrefs(previous);
      const message = err instanceof Error ? err.message : t('displayFailed');
      setError(message);
      pushToast(message, 'danger');
    } finally {
      setPendingKey(null);
    }
  }

  async function updateDashboardPref(key: DashboardKey, checked: boolean) {
    const previous = prefs;
    const next: DisplayPrefs = {
      ...prefs,
      dashboardWidgets: { ...prefs.dashboardWidgets, [key]: checked },
    };
    setPrefs(next);
    setPendingKey(`dashboardWidgets.${key}`);
    setError(null);
    try {
      const response = await fetch('/api/v1/me/display-prefs', {
        method: 'PATCH',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Origin: window.location.origin,
        },
        body: JSON.stringify({ dashboardWidgets: { [key]: checked } }),
      });
      const payload = (await response.json()) as {
        error?: { message?: string };
        user?: { displayPrefs?: DisplayPrefs };
      };
      if (!response.ok) {
        throw new Error(payload.error?.message ?? t('displayFailed'));
      }
      if (payload.user?.displayPrefs) {
        setPrefs(payload.user.displayPrefs);
      }
      pushToast(t('displaySaved'));
      router.refresh();
    } catch (err) {
      setPrefs(previous);
      const message = err instanceof Error ? err.message : t('displayFailed');
      setError(message);
      pushToast(message, 'danger');
    } finally {
      setPendingKey(null);
    }
  }

  return (
    <div className="grid gap-6">
      <Panel className="grid gap-4">
        <div>
          <h2 className="m-0 text-base font-semibold">{t('displayReportsTitle')}</h2>
          <p className="m-0 mt-1 text-sm text-ink-muted">{t('displayReportsBlurb')}</p>
        </div>
        {REPORT_DIAGRAM_KEYS.map((key) => (
          <div
            key={key}
            className="grid gap-1 border-t border-line pt-3 first:border-t-0 first:pt-0"
          >
            <Switch
              id={`report-${key}`}
              checked={prefs.reportDiagrams[key]}
              disabled={pendingKey !== null}
              label={t(`display_report_${key}`)}
              onCheckedChange={(checked) => void updateReportPref(key, checked)}
            />
            <p className="m-0 text-xs text-ink-muted">
              {t(`display_report_${key}_hint`)}
            </p>
          </div>
        ))}
      </Panel>

      <Panel className="grid gap-4">
        <div>
          <h2 className="m-0 text-base font-semibold">
            {t('displayDashboardTitle')}
          </h2>
          <p className="m-0 mt-1 text-sm text-ink-muted">
            {t('displayDashboardBlurb')}
          </p>
        </div>
        {DASHBOARD_WIDGET_KEYS.map((key) => (
          <div
            key={key}
            className="grid gap-1 border-t border-line pt-3 first:border-t-0 first:pt-0"
          >
            <Switch
              id={`dashboard-${key}`}
              checked={prefs.dashboardWidgets[key]}
              disabled={pendingKey !== null}
              label={t(`display_dashboard_${key}`)}
              onCheckedChange={(checked) =>
                void updateDashboardPref(key, checked)
              }
            />
            <p className="m-0 text-xs text-ink-muted">
              {t(`display_dashboard_${key}_hint`)}
            </p>
          </div>
        ))}
        {error ? <ErrorText>{error}</ErrorText> : null}
      </Panel>
    </div>
  );
}
