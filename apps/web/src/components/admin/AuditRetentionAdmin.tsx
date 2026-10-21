'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, ErrorText, Field, Input, useToast } from '../ui';
import {
  requestOpsAlertSettings,
  type OpsAlertAdminView,
} from './AlertsSettingsAdmin';

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

export function AuditRetentionAdmin({
  initial,
}: {
  initial: OpsAlertAdminView | null;
}) {
  const t = useTranslations('admin');
  const { pushToast } = useToast();
  const [view, setView] = useState(initial);
  const [retentionDays, setRetentionDays] = useState(
    initial ? String(initial.audit.retentionDays) : '90',
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function apply(next: OpsAlertAdminView) {
    setView(next);
    setRetentionDays(String(next.audit.retentionDays));
  }

  function formatInterval(ms: number): string {
    if (ms <= 0) return t('alertIntervalOff');
    const hours = Math.round(ms / 3_600_000);
    if (hours < 48) return t('alertIntervalHours', { hours: Math.max(1, hours) });
    return t('alertIntervalDays', { days: Math.max(1, Math.round(hours / 24)) });
  }

  async function save() {
    setPending(true);
    setError(null);
    try {
      apply(await requestOpsAlertSettings({
        method: 'PUT',
        body: JSON.stringify({ auditRetentionDays: Number(retentionDays) }),
      }, t('alertSaveFailed')));
      pushToast(t('alertRetentionSaved'));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('alertSaveFailed'));
    } finally {
      setPending(false);
    }
  }

  async function resetToEnv() {
    setPending(true);
    setError(null);
    try {
      apply(await requestOpsAlertSettings({
        method: 'PUT',
        body: JSON.stringify({ auditRetentionDays: null }),
      }, t('alertSaveFailed')));
      pushToast(t('alertRetentionResetOk'));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('alertSaveFailed'));
    } finally {
      setPending(false);
    }
  }

  if (!view) {
    return (
      <section className="kh-ops-panel">
        <div className="kh-ops-panel-head">
          <h2 className="kh-ops-panel-title">{t('alertAuditTitle')}</h2>
        </div>
        <div className="kh-ops-card-body">
          <ErrorText>{t('alertSettingsLoadFailed')}</ErrorText>
        </div>
      </section>
    );
  }

  const lastPurge = view.audit.lastPurgedAt
    ? new Date(view.audit.lastPurgedAt).toLocaleString()
    : t('alertAuditNever');

  return (
    <section className="kh-ops-panel">
      <div className="kh-ops-panel-head">
        <h2 className="kh-ops-panel-title">{t('alertAuditTitle')}</h2>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div className="kh-ops-card-body">
          <p className="kh-ops-panel-meta mt-0">{t('alertAuditDaysHint')}</p>
          {error ? <ErrorText>{error}</ErrorText> : null}
          <div className="kh-ops-form-grid">
            <Field label={t('alertAuditDays')}>
              <Input
                type="number"
                min={0}
                max={3650}
                step={1}
                value={retentionDays}
                disabled={pending}
                onChange={(event) => setRetentionDays(event.target.value)}
              />
            </Field>
          </div>
        </div>
        <div className="border-t border-line">
          <div className="kh-ops-list-row">
            <div className="kh-ops-list-title">{t('alertAuditCurrent')}</div>
            <div className="kh-ops-list-value">
              {view.audit.retentionDays === 0
                ? t('alertAuditOff')
                : t('alertAuditDaysValue', { days: view.audit.retentionDays })}
              {' · '}
              {view.audit.source === 'override' ? t('alertSourceOverride') : t('alertSourceEnv')}
            </div>
          </div>
          <div className="kh-ops-list-row">
            <div className="kh-ops-list-title">{t('alertAuditInterval')}</div>
            <div className="kh-ops-list-value">{formatInterval(view.audit.intervalMs)}</div>
          </div>
          <div className="kh-ops-list-row">
            <div className="kh-ops-list-title">{t('alertAuditLastPurge')}</div>
            <div className="kh-ops-list-value">{lastPurge}</div>
          </div>
          <div className="kh-ops-list-row">
            <div className="kh-ops-list-title">{t('alertAuditRowsPurged')}</div>
            <div className="kh-ops-list-value">
              {view.audit.rowsPurged == null ? t('alertAuditNever') : view.audit.rowsPurged}
            </div>
          </div>
          <div className="kh-ops-list-row">
            <div className="kh-ops-list-title">{t('alertAuditRowCount')}</div>
            <div className="kh-ops-list-value">{view.audit.rowCount}</div>
          </div>
          <div className="kh-ops-list-row">
            <div className="kh-ops-list-title">{t('alertAuditTableSize')}</div>
            <div className="kh-ops-list-value">{formatBytes(view.audit.tableBytes)}</div>
          </div>
        </div>
        <div className="kh-ops-action-line">
          <span className="kh-ops-panel-meta">
            {view.audit.source === 'override' ? t('alertSourceOverride') : t('alertSourceEnv')}
          </span>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={pending || view.audit.source !== 'override'}
              onClick={() => void resetToEnv()}
            >
              {t('alertReset')}
            </Button>
            <Button type="submit" disabled={pending}>{t('alertRetentionSave')}</Button>
          </div>
        </div>
      </form>
    </section>
  );
}
