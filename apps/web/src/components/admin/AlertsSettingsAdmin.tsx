'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Badge,
  Button,
  ErrorText,
  Field,
  Input,
  Select,
  useToast,
} from '../ui';

export type OpsAlertType =
  | 'backup.stale'
  | 'backup.fail'
  | 'offsite.stale'
  | 'offsite.error'
  | 'rotation.error'
  | 'api.error_spike'
  | 'disk.low';

const ALERT_TYPES: OpsAlertType[] = [
  'backup.stale',
  'backup.fail',
  'offsite.stale',
  'offsite.error',
  'rotation.error',
  'api.error_spike',
  'disk.low',
];

const TYPE_LABEL: Record<OpsAlertType, string> = {
  'backup.stale': 'alertTypeBackupStale',
  'backup.fail': 'alertTypeBackupFail',
  'offsite.stale': 'alertTypeOffsiteStale',
  'offsite.error': 'alertTypeOffsiteError',
  'rotation.error': 'alertTypeRotationError',
  'api.error_spike': 'alertTypeErrorSpike',
  'disk.low': 'alertTypeDiskLow',
};

export type OpsAlertAdminView = {
  source: 'override' | 'env';
  mail: {
    driver: 'console' | 'smtp' | 'resend';
    source: 'override' | 'env';
    consoleOnly: boolean;
  };
  thresholds: {
    diskFreeRatioMin: number;
    diskFreeGbMin: number;
    staleAfterHours: number;
    offsiteStaleAfterHours: number;
    errorSpikeThreshold: number;
    errorSpikeWindowMinutes: number;
    webhookMode: 'env' | 'custom' | 'disabled';
    webhookUrl: string;
    effectiveWebhookUrl: string | null;
  };
  env: {
    diskFreeRatioMin: number;
    diskFreeGbMin: number;
    staleAfterHours: number;
    offsiteStaleAfterHours: number;
    errorSpikeThreshold: number;
    errorSpikeWindowMinutes: number;
    webhookUrl: string;
    auditRetentionDays: number;
    auditRetentionIntervalMs: number;
  };
  recipients: Record<OpsAlertType, {
    configured: boolean;
    userIds: string[];
    emails: string[];
    source: 'admins' | 'custom';
    effective: Array<{ email: string; displayName: string }>;
    lastSentAt: string | null;
  }>;
  users: Array<{
    id: string;
    displayName: string;
    email: string;
    isSystemAdmin: boolean;
  }>;
  audit: {
    retentionDays: number;
    source: 'override' | 'env';
    intervalMs: number;
    lastPurgedAt: string | null;
    rowsPurged: number | null;
    rowCount: number;
    tableBytes: number;
  };
};

type DraftRecipient = {
  configured: boolean;
  userIds: string[];
  emails: string;
};

function percentLabel(ratio: number): string {
  return String(Math.round(ratio * 1000) / 10);
}

function parseEmails(value: string): string[] {
  return [...new Set(
    value
      .split(/[\s,;]+/)
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean),
  )];
}

function draftsFrom(view: OpsAlertAdminView): Record<OpsAlertType, DraftRecipient> {
  const drafts = {} as Record<OpsAlertType, DraftRecipient>;
  for (const type of ALERT_TYPES) {
    const row = view.recipients[type];
    drafts[type] = {
      configured: row?.configured ?? false,
      userIds: row?.userIds ?? [],
      emails: (row?.emails ?? []).join(', '),
    };
  }
  return drafts;
}

export async function requestOpsAlertSettings(
  init: RequestInit,
  fallback: string,
): Promise<OpsAlertAdminView> {
  const response = await fetch('/api/v1/admin/monitoring/alerts', {
    ...init,
    credentials: 'include',
    headers: {
      Origin: window.location.origin,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });
  const payload = (await response.json()) as {
    settings?: OpsAlertAdminView;
    error?: { message?: string };
  };
  if (!response.ok || !payload.settings) {
    throw new Error(payload.error?.message ?? fallback);
  }
  return payload.settings;
}

export function AlertsSettingsAdmin({
  initial,
}: {
  initial: OpsAlertAdminView | null;
}) {
  const t = useTranslations('admin');
  const { pushToast } = useToast();
  const [view, setView] = useState(initial);
  const [ratioPercent, setRatioPercent] = useState(
    initial ? percentLabel(initial.thresholds.diskFreeRatioMin) : '10',
  );
  const [diskGb, setDiskGb] = useState(
    initial ? String(initial.thresholds.diskFreeGbMin) : '10',
  );
  const [staleHours, setStaleHours] = useState(
    initial ? String(initial.thresholds.staleAfterHours) : '36',
  );
  const [offsiteHours, setOffsiteHours] = useState(
    initial ? String(initial.thresholds.offsiteStaleAfterHours) : '48',
  );
  const [spikeCount, setSpikeCount] = useState(
    initial ? String(initial.thresholds.errorSpikeThreshold) : '50',
  );
  const [spikeWindow, setSpikeWindow] = useState(
    initial ? String(initial.thresholds.errorSpikeWindowMinutes) : '15',
  );
  const [webhookMode, setWebhookMode] = useState(
    initial?.thresholds.webhookMode ?? 'env',
  );
  const [webhookUrl, setWebhookUrl] = useState(initial?.thresholds.webhookUrl ?? '');
  const [drafts, setDrafts] = useState<Record<OpsAlertType, DraftRecipient> | null>(
    initial ? draftsFrom(initial) : null,
  );
  const [testType, setTestType] = useState<OpsAlertType>('disk.low');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function apply(next: OpsAlertAdminView) {
    setView(next);
    setRatioPercent(percentLabel(next.thresholds.diskFreeRatioMin));
    setDiskGb(String(next.thresholds.diskFreeGbMin));
    setStaleHours(String(next.thresholds.staleAfterHours));
    setOffsiteHours(String(next.thresholds.offsiteStaleAfterHours));
    setSpikeCount(String(next.thresholds.errorSpikeThreshold));
    setSpikeWindow(String(next.thresholds.errorSpikeWindowMinutes));
    setWebhookMode(next.thresholds.webhookMode);
    setWebhookUrl(next.thresholds.webhookUrl);
    setDrafts(draftsFrom(next));
  }

  async function save() {
    if (!drafts) return;
    setPending(true);
    setError(null);
    try {
      const recipients = {} as OpsAlertAdminView['recipients'];
      for (const type of ALERT_TYPES) {
        const draft = drafts[type] ?? {
          configured: false,
          userIds: [],
          emails: '',
        };
        recipients[type] = {
          configured: draft.configured,
          userIds: draft.userIds,
          emails: parseEmails(draft.emails),
          source: draft.configured ? 'custom' : 'admins',
          effective: [],
          lastSentAt: null,
        };
      }
      apply(await requestOpsAlertSettings({
        method: 'PUT',
        body: JSON.stringify({
          diskFreeRatioMin: Number(ratioPercent) / 100,
          diskFreeGbMin: Number(diskGb),
          staleAfterHours: Number(staleHours),
          offsiteStaleAfterHours: Number(offsiteHours),
          errorSpikeThreshold: Number(spikeCount),
          errorSpikeWindowMinutes: Number(spikeWindow),
          webhookMode,
          webhookUrl: webhookUrl.trim(),
          recipients,
        }),
      }, t('alertSaveFailed')));
      pushToast(t('alertSaved'));
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
      const current = await requestOpsAlertSettings({ method: 'GET' }, t('alertSaveFailed'));
      const keepDays = current.audit.source === 'override' ? current.audit.retentionDays : null;
      let next = await requestOpsAlertSettings({ method: 'DELETE' }, t('alertSaveFailed'));
      if (keepDays != null) {
        next = await requestOpsAlertSettings({
          method: 'PUT',
          body: JSON.stringify({ auditRetentionDays: keepDays }),
        }, t('alertSaveFailed'));
      }
      apply(next);
      pushToast(t('alertResetOk'));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('alertSaveFailed'));
    } finally {
      setPending(false);
    }
  }

  async function sendTest() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch('/api/v1/admin/monitoring/alerts/test', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Origin: window.location.origin,
        },
        body: JSON.stringify({ type: testType }),
      });
      const payload = (await response.json()) as {
        recipientCount?: number;
        warning?: string;
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(payload.error?.message ?? t('alertTestFailed'));
      }
      pushToast(
        payload.warning
          ?? t('alertTestSent', { count: payload.recipientCount ?? 0 }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : t('alertTestFailed'));
    } finally {
      setPending(false);
    }
  }

  function updateDraft(type: OpsAlertType, patch: Partial<DraftRecipient>) {
    setDrafts((current) => {
      if (!current) return current;
      const existing = current[type];
      if (!existing) return current;
      return { ...current, [type]: { ...existing, ...patch } };
    });
  }

  if (!view || !drafts) {
    return (
      <section id="alerts" className="kh-ops-panel scroll-mt-6">
        <div className="kh-ops-panel-head">
          <h2 className="kh-ops-panel-title">{t('alertSettingsTitle')}</h2>
        </div>
        <div className="kh-ops-card-body">
          <ErrorText>{t('alertSettingsLoadFailed')}</ErrorText>
        </div>
      </section>
    );
  }

  return (
    <form
      id="alerts"
      className="scroll-mt-6"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <section className="kh-ops-panel">
        <div className="kh-ops-panel-head">
          <h2 className="kh-ops-panel-title">{t('alertSettingsTitle')}</h2>
          <Badge tone={view.source === 'override' ? 'brand' : 'neutral'}>
            {view.source === 'override' ? t('alertSourceOverride') : t('alertSourceEnv')}
          </Badge>
        </div>
        <div className="kh-ops-card-body">
          <p className="kh-ops-panel-meta mt-0">{t('alertSettingsBlurb')}</p>
          {view.mail.consoleOnly ? (
            <div className="mb-3 flex flex-wrap items-center gap-2" role="status">
              <Badge tone="warn">{t('alertConsoleBadge')}</Badge>
              <p className="kh-ops-panel-meta m-0">{t('alertConsoleWarning')}</p>
              <a className="kh-text-link" href="/admin/email">{t('alertEmailSettingsLink')}</a>
            </div>
          ) : (
            <p className="kh-ops-panel-meta mt-0">
              {t('alertMailDriver', { driver: view.mail.driver })}
            </p>
          )}
          {error ? <ErrorText>{error}</ErrorText> : null}
          <div className="kh-ops-form-grid">
            <Field label={t('alertDiskPercent')}>
              <Input
                type="number"
                min={0}
                max={100}
                step="0.1"
                value={ratioPercent}
                disabled={pending}
                onChange={(event) => setRatioPercent(event.target.value)}
              />
            </Field>
            <Field label={t('alertDiskGb')}>
              <Input
                type="number"
                min={0}
                max={100000}
                step="0.1"
                value={diskGb}
                disabled={pending}
                onChange={(event) => setDiskGb(event.target.value)}
              />
            </Field>
            <Field label={t('alertStaleHours')}>
              <Input
                type="number"
                min={1}
                max={168}
                step={1}
                value={staleHours}
                disabled={pending}
                onChange={(event) => setStaleHours(event.target.value)}
              />
            </Field>
            <Field label={t('alertOffsiteStaleHours')}>
              <Input
                type="number"
                min={1}
                max={720}
                step={1}
                value={offsiteHours}
                disabled={pending}
                onChange={(event) => setOffsiteHours(event.target.value)}
              />
            </Field>
            <Field label={t('alertErrorSpike')}>
              <Input
                type="number"
                min={0}
                step={1}
                value={spikeCount}
                disabled={pending}
                onChange={(event) => setSpikeCount(event.target.value)}
              />
            </Field>
            <Field label={t('alertErrorSpikeWindow')}>
              <Input
                type="number"
                min={1}
                max={1440}
                step={1}
                value={spikeWindow}
                disabled={pending}
                onChange={(event) => setSpikeWindow(event.target.value)}
              />
            </Field>
            <Field label={t('alertWebhookMode')}>
              <Select
                value={webhookMode}
                disabled={pending}
                onChange={(event) => {
                  setWebhookMode(event.target.value as 'env' | 'custom' | 'disabled');
                }}
              >
                <option value="env">{t('alertWebhookEnv')}</option>
                <option value="custom">{t('alertWebhookCustom')}</option>
                <option value="disabled">{t('alertWebhookDisabled')}</option>
              </Select>
            </Field>
            <Field label={t('alertWebhookUrl')}>
              <Input
                type="url"
                value={webhookUrl}
                disabled={pending || webhookMode !== 'custom'}
                placeholder={view.env.webhookUrl || 'https://'}
                onChange={(event) => setWebhookUrl(event.target.value)}
              />
            </Field>
            <p className="kh-ops-field-span kh-ops-panel-meta m-0">
              {t('alertDiskHint')}
              {' '}
              {t('alertEnvValue', {
                value: `${percentLabel(view.env.diskFreeRatioMin)}% / ${view.env.diskFreeGbMin} GB`,
              })}
            </p>
          </div>
        </div>
      </section>

      <section className="kh-ops-panel">
        <div className="kh-ops-panel-head">
          <h2 className="kh-ops-panel-title">{t('alertRecipientsTitle')}</h2>
        </div>
        <div className="kh-ops-card-body">
          <p className="kh-ops-panel-meta m-0">{t('alertRecipientsBlurb')}</p>
        </div>
        {ALERT_TYPES.map((type) => {
          const draft = drafts[type];
          const saved = view.recipients[type];
          if (!draft || !saved) return null;
          const effective = saved.effective.map((row) => row.email).join(', ');
          return (
            <details key={type} className="kh-ops-disclosure">
              <summary>
                <span>{t(TYPE_LABEL[type])}</span>
                <span className="kh-ops-panel-meta">
                  {draft.configured ? t('alertRecipientModeCustom') : t('alertRecipientModeAdmins')}
                </span>
              </summary>
              <div className="kh-ops-card-body">
                <p className="kh-ops-panel-meta mt-0">
                  {t('alertEffective')}
                  {' '}
                  {effective || t('alertNoRecipients')}
                  {' · '}
                  {t('alertLastSent')}
                  {' '}
                  {saved.lastSentAt
                    ? new Date(saved.lastSentAt).toLocaleString()
                    : t('alertLastSentNever')}
                </p>
                <div className="kh-ops-form-grid">
                  <Field className="kh-ops-field-span" label={t('alertRecipientMode')}>
                    <Select
                      value={draft.configured ? 'custom' : 'admins'}
                      disabled={pending}
                      onChange={(event) => {
                        updateDraft(type, { configured: event.target.value === 'custom' });
                      }}
                    >
                      <option value="admins">{t('alertRecipientModeAdmins')}</option>
                      <option value="custom">{t('alertRecipientModeCustom')}</option>
                    </Select>
                  </Field>
                  {draft.configured ? (
                    <>
                      <div className="kh-ops-field-span max-h-40 overflow-auto">
                        <div className="kh-ops-scope-checks">
                          {view.users.map((user) => (
                            <label key={user.id} className="kh-ops-scope-check">
                              <input
                                type="checkbox"
                                checked={draft.userIds.includes(user.id)}
                                disabled={pending}
                                onChange={(event) => {
                                  const userIds = event.target.checked
                                    ? [...draft.userIds, user.id]
                                    : draft.userIds.filter((id) => id !== user.id);
                                  updateDraft(type, { userIds });
                                }}
                              />
                              <span>
                                {user.displayName}
                                {' '}
                                <span className="text-ink-muted">{user.email}</span>
                                {user.isSystemAdmin ? ` (${t('alertUserAdmin')})` : ''}
                              </span>
                            </label>
                          ))}
                        </div>
                      </div>
                      <Field className="kh-ops-field-span" label={t('alertExtraEmails')}>
                        <Input
                          value={draft.emails}
                          disabled={pending}
                          placeholder={t('alertExtraEmailsHint')}
                          onChange={(event) => updateDraft(type, { emails: event.target.value })}
                        />
                      </Field>
                    </>
                  ) : null}
                </div>
              </div>
            </details>
          );
        })}
        <div className="kh-ops-action-line">
          <span className="kh-ops-panel-meta">
            {view.source === 'override' ? t('alertSourceOverride') : t('alertSourceEnv')}
          </span>
          <div className="flex flex-wrap items-end gap-2">
            <Field label={t('alertTestType')}>
              <Select
                value={testType}
                disabled={pending}
                onChange={(event) => setTestType(event.target.value as OpsAlertType)}
              >
                {ALERT_TYPES.map((type) => (
                  <option key={type} value={type}>{t(TYPE_LABEL[type])}</option>
                ))}
              </Select>
            </Field>
            <Button type="button" variant="secondary" disabled={pending} onClick={() => void sendTest()}>
              {t('alertTest')}
            </Button>
            <Button type="button" variant="secondary" disabled={pending} onClick={() => void resetToEnv()}>
              {t('alertReset')}
            </Button>
            <Button type="submit" disabled={pending}>{t('alertSave')}</Button>
          </div>
        </div>
      </section>
    </form>
  );
}
