'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  Badge,
  Button,
  ErrorText,
  Field,
  FilePicker,
  Input,
  Modal,
  PageHeader,
  Select,
  useToast,
} from '../ui';
import { cn } from '../../lib/cn';
import type { MonitoringPayload } from './monitoring-types';

export type { MonitoringPayload } from './monitoring-types';

function formatAge(seconds: number | null, neverLabel: string): string {
  if (seconds == null) return neverLabel;
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

const SCHEDULE_INTERVAL_PRESETS = [3600, 21600, 43200, 86400, 604800] as const;

function nearestSchedulePreset(seconds: number): number {
  let best: number = SCHEDULE_INTERVAL_PRESETS[3];
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const preset of SCHEDULE_INTERVAL_PRESETS) {
    const delta = Math.abs(preset - seconds);
    if (delta < bestDelta) {
      best = preset;
      bestDelta = delta;
    }
  }
  return best;
}

function scheduleIntervalLabel(
  seconds: number,
  labels: Record<(typeof SCHEDULE_INTERVAL_PRESETS)[number], string>,
): string {
  return labels[nearestSchedulePreset(seconds) as (typeof SCHEDULE_INTERVAL_PRESETS)[number]];
}

type BackupRunStatus = 'success' | 'failure' | 'notice';

function resolveBackupRunStatus(input: {
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  staleBackup: boolean;
}): BackupRunStatus {
  const { lastSuccessAt, lastFailureAt, staleBackup } = input;
  if (lastFailureAt && (!lastSuccessAt || lastFailureAt > lastSuccessAt)) {
    return 'failure';
  }
  if (!lastSuccessAt) {
    return 'notice';
  }
  if (staleBackup) {
    return 'notice';
  }
  return 'success';
}

function StatusRow({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  tone?: 'neutral' | 'ok' | 'error' | 'brand' | 'success' | 'warn';
}) {
  const badgeTone =
    tone === 'ok' || tone === 'success'
      ? 'success'
      : tone === 'error'
        ? 'danger'
        : tone === 'brand'
          ? 'brand'
          : tone === 'warn'
            ? 'warn'
            : 'neutral';
  const useBadge = tone !== 'neutral' || value.length <= 28;
  const stackValue = !useBadge;

  return (
    <div
      className={cn('kh-ops-setting-row', stackValue && 'kh-ops-setting-row--stacked')}
    >
      <strong className="text-sm font-medium text-ink">{label}</strong>
      {useBadge ? (
        <Badge tone={badgeTone} className="max-w-[min(100%,20rem)] truncate">
          {value}
        </Badge>
      ) : (
        <span
          className="kh-ops-setting-value text-sm text-ink-muted"
          title={value}
        >
          {value}
        </span>
      )}
    </div>
  );
}

export function BackupsAdmin({
  title,
  description,
  initial,
}: {
  title: string;
  description: string;
  initial: MonitoringPayload;
}) {
  const t = useTranslations('admin');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const { pushToast } = useToast();
  const [data, setData] = useState(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [confirmPhrase, setConfirmPhrase] = useState('');
  const [selectedArtifact, setSelectedArtifact] = useState(
    initial.backups.artifacts[0]?.name ?? '',
  );
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [keepDaily, setKeepDaily] = useState(String(initial.backups.retention.keepDaily));
  const [keepWeekly, setKeepWeekly] = useState(String(initial.backups.retention.keepWeekly));
  const [keepMonthly, setKeepMonthly] = useState(String(initial.backups.retention.keepMonthly));
  const [autoRotate, setAutoRotate] = useState(initial.backups.retention.autoRotate);
  const [scheduleEnabled, setScheduleEnabled] = useState(initial.backups.schedule.enabled);
  const [scheduleInterval, setScheduleInterval] = useState(
    String(nearestSchedulePreset(initial.backups.schedule.intervalSeconds)),
  );
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const backupAgeTone = useMemo(() => {
    if (data.attention.staleBackup) return 'warn' as const;
    const age = data.backups.lastSuccess.ageSeconds;
    if (age == null) return 'warn' as const;
    return 'success' as const;
  }, [data.attention.staleBackup, data.backups.lastSuccess.ageSeconds]);

  async function refresh() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch('/api/v1/admin/monitoring?range=24h', {
        credentials: 'include',
        cache: 'no-store',
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const payload = (await response.json()) as MonitoringPayload;
      setData(payload);
      setKeepDaily(String(payload.backups.retention.keepDaily));
      setKeepWeekly(String(payload.backups.retention.keepWeekly));
      setKeepMonthly(String(payload.backups.retention.keepMonthly));
      setAutoRotate(payload.backups.retention.autoRotate);
      setScheduleEnabled(payload.backups.schedule.enabled);
      setScheduleInterval(
        String(nearestSchedulePreset(payload.backups.schedule.intervalSeconds)),
      );
      if (!selectedArtifact && payload.backups.artifacts[0]) {
        setSelectedArtifact(payload.backups.artifacts[0].name);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('monitoringRefreshFailed'));
    } finally {
      setPending(false);
    }
  }

  async function runExport() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch('/api/v1/admin/monitoring/backups/export', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: { message?: string };
        artifact?: { name: string };
        offsiteError?: string | null;
      };
      if (!response.ok) {
        throw new Error(body.error?.message ?? `HTTP ${response.status}`);
      }
      if (body.offsiteError) {
        pushToast(
          t('monitoringExportOkOffsiteFailed', {
            name: body.artifact?.name ?? '',
            error: body.offsiteError,
          }),
        );
      } else {
        pushToast(t('monitoringExportOk', { name: body.artifact?.name ?? '' }));
      }
      await refresh();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('monitoringExportFailed'));
    } finally {
      setPending(false);
    }
  }

  async function runDelete(name: string) {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/v1/admin/monitoring/backups/${encodeURIComponent(name)}`,
        { method: 'DELETE', credentials: 'include' },
      );
      const body = (await response.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(body.error?.message ?? `HTTP ${response.status}`);
      }
      pushToast(t('monitoringDeleteOk', { name }));
      setDeleteConfirm(null);
      await refresh();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('monitoringDeleteFailed'));
    } finally {
      setPending(false);
    }
  }

  async function saveSchedule() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch('/api/v1/admin/monitoring/backups/schedule', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: scheduleEnabled,
          intervalSeconds: Number(scheduleInterval),
        }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(body.error?.message ?? `HTTP ${response.status}`);
      }
      pushToast(t('monitoringScheduleSaved'));
      await refresh();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('monitoringScheduleFailed'));
    } finally {
      setPending(false);
    }
  }

  async function saveRetention(runNow: boolean) {
    setPending(true);
    setError(null);
    try {
      const response = await fetch('/api/v1/admin/monitoring/backups/retention', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keepDaily: Number(keepDaily),
          keepWeekly: Number(keepWeekly),
          keepMonthly: Number(keepMonthly),
          autoRotate,
          runNow,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: { message?: string };
        rotation?: { deleted?: string[] };
      };
      if (!response.ok) {
        throw new Error(body.error?.message ?? `HTTP ${response.status}`);
      }
      const deleted = body.rotation?.deleted?.length ?? 0;
      pushToast(
        runNow
          ? t('monitoringRetentionSavedRotated', { deleted })
          : t('monitoringRetentionSaved'),
      );
      await refresh();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('monitoringRetentionFailed'));
    } finally {
      setPending(false);
    }
  }

  async function runRotateOnly() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch('/api/v1/admin/monitoring/backups/rotate', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: { message?: string };
        rotation?: { deleted?: string[] };
      };
      if (!response.ok) {
        throw new Error(body.error?.message ?? `HTTP ${response.status}`);
      }
      pushToast(
        t('monitoringRotateOk', { deleted: body.rotation?.deleted?.length ?? 0 }),
      );
      await refresh();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('monitoringRotateFailed'));
    } finally {
      setPending(false);
    }
  }

  async function runOffsite(name: string) {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/v1/admin/monitoring/backups/${encodeURIComponent(name)}/offsite`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        },
      );
      const body = (await response.json().catch(() => ({}))) as {
        error?: { message?: string };
        key?: string;
      };
      if (!response.ok) {
        throw new Error(body.error?.message ?? `HTTP ${response.status}`);
      }
      pushToast(t('monitoringOffsiteOk', { key: body.key ?? name }));
      await refresh();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('monitoringOffsiteFailed'));
    } finally {
      setPending(false);
    }
  }

  async function runImport() {
    if (confirmPhrase !== 'REPLACE') {
      setError(t('monitoringImportConfirmHint'));
      return;
    }
    setPending(true);
    setError(null);
    try {
      let response: Response;
      if (uploadFile) {
        const form = new FormData();
        form.set('confirmPhrase', 'REPLACE');
        form.set('file', uploadFile);
        response = await fetch('/api/v1/admin/monitoring/backups/import', {
          method: 'POST',
          credentials: 'include',
          body: form,
        });
      } else {
        if (!selectedArtifact) {
          throw new Error(t('monitoringImportNeedArtifact'));
        }
        response = await fetch('/api/v1/admin/monitoring/backups/import', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            confirmPhrase: 'REPLACE',
            artifact: selectedArtifact,
          }),
        });
      }
      const body = (await response.json().catch(() => ({}))) as {
        error?: { message?: string };
        warning?: string;
        restartRequired?: boolean;
      };
      if (!response.ok) {
        throw new Error(body.error?.message ?? `HTTP ${response.status}`);
      }
      pushToast(
        body.warning
          ? `${t('monitoringImportOk')} ${body.warning}`
          : t('monitoringImportOk'),
      );
      setImportOpen(false);
      setConfirmPhrase('');
      setUploadFile(null);
      if (body.restartRequired) {
        // API process exits after import; give it a moment then reload.
        setTimeout(() => {
          window.location.assign('/login');
        }, 2500);
        return;
      }
      await refresh();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('monitoringImportFailed'));
    } finally {
      setPending(false);
    }
  }

  const lastSuccessAt = data.backups.lastSuccess.stamp?.at ?? null;
  const lastFailureAt = data.backups.lastFailure.stamp?.at ?? null;
  const runStatus = resolveBackupRunStatus({
    lastSuccessAt,
    lastFailureAt,
    staleBackup: data.attention.staleBackup,
  });
  const retentionSummary = `${data.backups.retention.keepDaily} / ${data.backups.retention.keepWeekly} / ${data.backups.retention.keepMonthly}`;
  const scheduleIntervalLabels = {
    3600: t('monitoringSchedule1h'),
    21600: t('monitoringSchedule6h'),
    43200: t('monitoringSchedule12h'),
    86400: t('monitoringSchedule24h'),
    604800: t('monitoringSchedule7d'),
  } as const;

  return (
    <div className="grid gap-3">
      <PageHeader
        eyebrow={t('backupsEyebrow')}
        title={title}
        description={description}
        actions={
          <>
            <Button
              type="button"
              variant="secondary"
              disabled={pending}
              onClick={() => void refresh()}
            >
              {t('monitoringRefresh')}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={pending}
              onClick={() => void runExport()}
            >
              {t('monitoringExportNow')}
            </Button>
            <Button
              type="button"
              disabled={pending}
              onClick={() => setImportOpen(true)}
            >
              {t('monitoringImportOpen')}
            </Button>
          </>
        }
      />

      {data.loadError ? (
        <div className="kh-ops-status-row" role="alert">
          <p className="m-0 text-sm text-ink-muted">{data.loadError}</p>
        </div>
      ) : null}

      {error ? <ErrorText>{error}</ErrorText> : null}

      <section id="health" className="kh-ops-health-grid scroll-mt-6">
        <div className="kh-ops-health-card">
          <small>{t('monitoringLastBackup')}</small>
          <strong>
            {formatAge(data.backups.lastSuccess.ageSeconds, t('monitoringNever'))}
          </strong>
          <span className="mt-1 block truncate text-[10px] text-ink-muted">
            {runStatus === 'success'
              ? t('monitoringScheduleStatusSuccess')
              : runStatus === 'failure'
                ? t('monitoringScheduleStatusFailure')
                : t('monitoringScheduleStatusNotice')}
            {data.backups.lastSuccess.stamp
              ? ` · ${formatBytes(data.backups.totalBytes)}`
              : ''}
          </span>
        </div>
        <div className="kh-ops-health-card">
          <small>{t('monitoringBackupAge')}</small>
          <strong>
            {formatAge(data.backups.lastSuccess.ageSeconds, t('monitoringNever'))}
          </strong>
          <span className="mt-1 block truncate text-[10px] text-ink-muted">
            {data.attention.staleBackup
              ? t('monitoringStaleBackup', {
                  hours: data.attention.staleBackupAfterHours,
                })
              : t('monitoringBackupFresh')}
          </span>
        </div>
        <div className="kh-ops-health-card">
          <small>{t('monitoringRetentionHealthLabel')}</small>
          <strong>{retentionSummary}</strong>
          <span className="mt-1 block truncate text-[10px] text-ink-muted">
            {t('monitoringRetentionHealthNote')}
          </span>
        </div>
        <div className="kh-ops-health-card">
          <small>{t('monitoringOffsiteHealthLabel')}</small>
          <strong>
            {data.backups.lastOffsite.stamp
              ? formatAge(data.backups.lastOffsite.ageSeconds, t('monitoringNever'))
              : data.backups.offsite.enabled
                ? '—'
                : t('monitoringOffsiteDisabledShort')}
          </strong>
          <span className="mt-1 block truncate text-[10px] text-ink-muted">
            {data.backups.offsite.enabled
              ? data.backups.offsite.provider
              : 'BLOB_PROVIDER'}
          </span>
        </div>
        <div className="kh-ops-health-card">
          <small>{t('monitoringSchedulerHealthLabel')}</small>
          <strong>
            {data.backups.schedule.enabled
              ? scheduleIntervalLabel(
                  data.backups.schedule.intervalSeconds,
                  scheduleIntervalLabels,
                )
              : t('monitoringScheduleActiveOff')}
          </strong>
          <span className="mt-1 block truncate text-[10px] text-ink-muted">
            {data.backups.scheduler?.alive
              ? t('monitoringSchedulerAlive')
              : t('monitoringSchedulerMissing')}
          </span>
        </div>
        <div className="kh-ops-health-card">
          <small>{t('monitoringBackupDir')}</small>
          <strong>{formatBytes(data.backups.totalBytes)}</strong>
          <span
            className="kh-ops-health-note mt-1 block"
            title={data.backups.dir}
          >
            {data.backups.dir}
          </span>
        </div>
      </section>

      <div id="backups" className="kh-ops-admin-workspace scroll-mt-6">
        <div className="kh-ops-admin-stack">
        <section id="schedule" className="kh-ops-panel overflow-hidden">
          <div className="kh-ops-panel-head">
            <div className="min-w-0">
              <h2 className="kh-ops-panel-title">{t('monitoringScheduleTitle')}</h2>
              <p className="kh-ops-panel-sub">
                {t('monitoringScheduleLastRun', {
                  when: lastSuccessAt
                    ? `${formatAge(data.backups.lastSuccess.ageSeconds, t('monitoringNever'))} · ${lastSuccessAt}`
                    : t('monitoringNever'),
                })}
                {' · '}
                {t('monitoringScheduleNextDue', {
                  when: data.backups.scheduler?.heartbeat.stamp?.nextDueAt
                    ? data.backups.scheduler.heartbeat.stamp.nextDueAt
                    : t('monitoringNever'),
                })}
              </p>
            </div>
            <Badge tone={data.backups.scheduler?.alive ? 'success' : 'warn'}>
              {data.backups.scheduler?.alive
                ? t('monitoringSchedulerAlive')
                : t('monitoringSchedulerMissing')}
            </Badge>
          </div>
          <div className="kh-ops-card-body grid gap-4">
          <p className="m-0 text-xs text-ink-muted">
            {t('monitoringScheduleSource', {
              source: data.backups.schedule.source,
            })}
          </p>
          <label className="kh-ops-scope-check">
            <input
              type="checkbox"
              checked={scheduleEnabled}
              disabled={pending}
              onChange={(event) => setScheduleEnabled(event.target.checked)}
            />
            {t('monitoringScheduleEnabled')}
          </label>
          <div className="kh-ops-form-grid">
            <Field label={t('monitoringScheduleInterval')}>
              <Select
                value={scheduleInterval}
                disabled={pending || !scheduleEnabled}
                onChange={(event) => setScheduleInterval(event.target.value)}
              >
                <option value="3600">{t('monitoringSchedule1h')}</option>
                <option value="21600">{t('monitoringSchedule6h')}</option>
                <option value="43200">{t('monitoringSchedule12h')}</option>
                <option value="86400">{t('monitoringSchedule24h')}</option>
                <option value="604800">{t('monitoringSchedule7d')}</option>
              </Select>
            </Field>
            <div className="kh-ops-inset grid gap-2 text-sm">
              {(() => {
                const saved = data.backups.schedule;
                const statusTone =
                  runStatus === 'success'
                    ? 'success'
                    : runStatus === 'failure'
                      ? 'danger'
                      : 'warn';
                const lastAt =
                  runStatus === 'failure' && lastFailureAt
                    ? lastFailureAt
                    : lastSuccessAt;
                const lastAge =
                  runStatus === 'failure'
                    ? data.backups.lastFailure.ageSeconds
                    : data.backups.lastSuccess.ageSeconds;
                return (
                  <>
                    <p className="m-0 text-xs font-semibold tracking-[0.12em] text-ink-muted uppercase">
                      {t('monitoringScheduleStatusTitle')}
                    </p>
                    <p className="m-0 text-ink">
                      {saved.enabled
                        ? t('monitoringScheduleActiveOn', {
                            interval: scheduleIntervalLabel(
                              saved.intervalSeconds,
                              scheduleIntervalLabels,
                            ),
                          })
                        : t('monitoringScheduleActiveOff')}
                    </p>
                    <p className="m-0 text-ink-muted">
                      {t('monitoringScheduleLastRun', {
                        when: lastAt
                          ? `${formatAge(lastAge, t('monitoringNever'))} · ${lastAt}`
                          : t('monitoringNever'),
                      })}
                    </p>
                    <p className="m-0 text-ink-muted">
                      {t('monitoringScheduleNextDue', {
                        when: data.backups.scheduler?.heartbeat.stamp?.nextDueAt
                          ? data.backups.scheduler.heartbeat.stamp.nextDueAt
                          : t('monitoringNever'),
                      })}
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-ink-muted">{t('monitoringScheduleRunStatus')}</span>
                      <Badge tone={statusTone}>
                        {runStatus === 'success'
                          ? t('monitoringScheduleStatusSuccess')
                          : runStatus === 'failure'
                            ? t('monitoringScheduleStatusFailure')
                            : t('monitoringScheduleStatusNotice')}
                      </Badge>
                      <Badge tone={data.backups.scheduler?.alive ? 'success' : 'warn'}>
                        {data.backups.scheduler?.alive
                          ? t('monitoringSchedulerAlive')
                          : t('monitoringSchedulerMissing')}
                      </Badge>
                    </div>
                    {!data.backups.scheduler?.alive && saved.enabled ? (
                      <p className="m-0 text-xs text-ink-muted">
                        {t('monitoringSchedulerMissingHint')}
                      </p>
                    ) : null}
                    {runStatus === 'notice' && data.attention.staleBackup ? (
                      <p className="m-0 text-xs text-ink-muted">
                        {t('monitoringStaleBackup', {
                          hours: data.attention.staleBackupAfterHours,
                        })}
                      </p>
                    ) : null}
                    {runStatus === 'notice' && !lastSuccessAt ? (
                      <p className="m-0 text-xs text-ink-muted">
                        {t('monitoringScheduleStatusNeverHint')}
                      </p>
                    ) : null}
                  </>
                );
              })()}
            </div>
          </div>
          <div>
            <Button type="button" disabled={pending} onClick={() => void saveSchedule()}>
              {t('monitoringScheduleSave')}
            </Button>
          </div>
        </div>
        </section>

        <section id="retention" className="kh-ops-panel overflow-hidden">
          <div className="kh-ops-panel-head">
            <div className="min-w-0">
              <h2 className="kh-ops-panel-title">{t('monitoringRetentionTitle')}</h2>
              <p className="kh-ops-panel-sub">
                {t('monitoringRetentionSource', {
                  source: data.backups.retention.source,
                  total: formatBytes(data.backups.totalBytes),
                })}
              </p>
            </div>
            <Badge tone="success">{t('monitoringRetentionActive')}</Badge>
          </div>
          <div className="kh-ops-card-body grid gap-4">
          <p className="m-0 text-xs text-ink-muted">
            {t('monitoringRetentionBlurb')}
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label={t('monitoringKeepDaily')}>
              <Input
                type="number"
                min={1}
                max={90}
                value={keepDaily}
                disabled={pending}
                onChange={(event) => setKeepDaily(event.target.value)}
              />
            </Field>
            <Field label={t('monitoringKeepWeekly')}>
              <Input
                type="number"
                min={0}
                max={52}
                value={keepWeekly}
                disabled={pending}
                onChange={(event) => setKeepWeekly(event.target.value)}
              />
            </Field>
            <Field label={t('monitoringKeepMonthly')}>
              <Input
                type="number"
                min={0}
                max={36}
                value={keepMonthly}
                disabled={pending}
                onChange={(event) => setKeepMonthly(event.target.value)}
              />
            </Field>
          </div>
          <label className="kh-ops-scope-check">
            <input
              type="checkbox"
              checked={autoRotate}
              disabled={pending}
              onChange={(event) => setAutoRotate(event.target.checked)}
            />
            {t('monitoringAutoRotate')}
          </label>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={pending}
              onClick={() => void saveRetention(false)}
            >
              {t('monitoringRetentionSave')}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={pending}
              onClick={() => void saveRetention(true)}
            >
              {t('monitoringRetentionSaveRun')}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={pending}
              onClick={() => void runRotateOnly()}
            >
              {t('monitoringRotateNow')}
            </Button>
          </div>
        </div>
        </section>

        <section id="artifacts" className="kh-ops-panel overflow-hidden">
          <div className="kh-ops-panel-head">
            <h2 className="kh-ops-panel-title">{t('monitoringArtifacts')}</h2>
            <span className="kh-ops-panel-meta">
              {formatBytes(data.backups.totalBytes)}
            </span>
          </div>
          {data.backups.artifacts.length === 0 ? (
            <p className="kh-ops-empty">{t('monitoringArtifactsEmpty')}</p>
          ) : (
            <ul className="m-0 grid list-none gap-0 divide-y divide-line p-0">
              {data.backups.artifacts.map((artifact) => (
                <li
                  key={artifact.name}
                  className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
                >
                  <div className="min-w-0">
                    <p className="m-0 truncate font-mono text-sm text-ink">{artifact.name}</p>
                    <p className="m-0 text-xs text-ink-muted">
                      {formatBytes(artifact.sizeBytes)} · {artifact.modifiedAt}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <a
                      className="text-sm font-medium text-brand no-underline hover:text-brand-hover"
                      href={`/api/v1/admin/monitoring/backups/${encodeURIComponent(artifact.name)}/download`}
                    >
                      {t('monitoringDownload')}
                    </a>
                    {data.backups.offsite.enabled ? (
                      <button
                        type="button"
                        className="border-0 bg-transparent p-0 text-sm font-medium text-brand hover:underline"
                        disabled={pending}
                        onClick={() => void runOffsite(artifact.name)}
                      >
                        {t('monitoringPushOffsite')}
                      </button>
                    ) : null}
                    {deleteConfirm === artifact.name ? (
                      <>
                        <Button
                          type="button"
                          variant="danger"
                          disabled={pending}
                          onClick={() => void runDelete(artifact.name)}
                        >
                          {t('monitoringDeleteConfirm')}
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          disabled={pending}
                          onClick={() => setDeleteConfirm(null)}
                        >
                          {tCommon('cancel')}
                        </Button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="border-0 bg-transparent p-0 text-sm font-medium text-danger hover:underline"
                        disabled={pending}
                        onClick={() => setDeleteConfirm(artifact.name)}
                      >
                        {t('monitoringDelete')}
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {data.backups.toolsHint ? (
            <p className="m-0 border-t border-line px-5 py-3 text-xs text-ink-muted">
              {data.backups.toolsHint}
            </p>
          ) : null}
        </section>
        </div>

        <aside>
          <section className="kh-ops-panel overflow-hidden">
            <div className="kh-ops-panel-head">
              <h2 className="kh-ops-panel-title">{t('monitoringRecoveryStamps')}</h2>
            </div>
            <StatusRow
              label={t('monitoringLastBackup')}
              value={
                data.backups.lastSuccess.stamp
                  ? `${formatAge(data.backups.lastSuccess.ageSeconds, t('monitoringNever'))} · ${data.backups.lastSuccess.stamp.at}`
                  : t('monitoringNever')
              }
              tone={backupAgeTone}
            />
            <StatusRow
              label={t('monitoringLastImport')}
              value={
                data.backups.lastImport.stamp
                  ? `${formatAge(data.backups.lastImport.ageSeconds, t('monitoringNever'))} · ${data.backups.lastImport.stamp.at}`
                  : t('monitoringNever')
              }
              tone="neutral"
            />
            <StatusRow
              label={t('monitoringBackupDir')}
              value={data.backups.dir}
              tone="neutral"
            />
          </section>

          <section className="kh-ops-panel overflow-hidden">
            <div className="kh-ops-panel-head">
              <h2 className="kh-ops-panel-title">{t('monitoringOffsiteTitle')}</h2>
            </div>
            <StatusRow
              label={t('monitoringLastOffsite')}
              value={
                data.backups.lastOffsite.stamp
                  ? `${formatAge(data.backups.lastOffsite.ageSeconds, t('monitoringNever'))} · ${data.backups.lastOffsite.stamp.provider} · ${data.backups.lastOffsite.stamp.key}`
                  : data.backups.offsite.enabled
                    ? t('monitoringOffsitePending')
                    : t('monitoringOffsiteDisabled')
              }
              tone={
                data.backups.lastOffsite.stamp
                  ? 'success'
                  : data.backups.offsite.enabled
                    ? 'warn'
                    : 'neutral'
              }
            />
            {!data.backups.offsite.enabled ? (
              <p className="m-0 px-5 py-3 text-xs text-ink-muted">
                {t('monitoringOffsiteHint')}
              </p>
            ) : null}
          </section>
        </aside>
      </div>

      <Modal
        open={importOpen}
        onClose={() => {
          if (!pending) setImportOpen(false);
        }}
        title={t('monitoringImportTitle')}
        size="md"
      >
        <div className="grid gap-4">
          <p className="m-0 text-sm text-ink-muted">{t('monitoringImportWarning')}</p>
          <Field label={t('monitoringImportArtifact')}>
            <Select
              value={selectedArtifact}
              disabled={pending || Boolean(uploadFile)}
              onChange={(event) => setSelectedArtifact(event.target.value)}
            >
              <option value="">{t('monitoringImportPick')}</option>
              {data.backups.artifacts.map((artifact) => (
                <option key={artifact.name} value={artifact.name}>
                  {artifact.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('monitoringImportUpload')}>
            <FilePicker
              accept=".dump,application/octet-stream"
              disabled={pending}
              fileName={uploadFile?.name}
              onFileChange={setUploadFile}
            />
          </Field>
          <p className="m-0 -mt-2 text-xs text-ink-muted">
            {t('monitoringImportMaxUpload', {
              size: formatBytes(data.backups.maxUploadBytes),
            })}
          </p>
          <Field label={t('monitoringImportConfirm')}>
            <Input
              value={confirmPhrase}
              disabled={pending}
              placeholder="REPLACE"
              onChange={(event) => setConfirmPhrase(event.target.value)}
              autoComplete="off"
            />
          </Field>
          {error ? <ErrorText>{error}</ErrorText> : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={pending}
              onClick={() => setImportOpen(false)}
            >
              {tCommon('cancel')}
            </Button>
            <Button
              type="button"
              variant="danger"
              disabled={pending || confirmPhrase !== 'REPLACE'}
              onClick={() => void runImport()}
            >
              {t('monitoringImportRun')}
            </Button>
          </div>
        </div>
      </Modal>

    </div>
  );
}
