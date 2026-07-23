'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  Badge,
  Button,
  ErrorText,
  Field,
  Input,
  Modal,
  Panel,
  Select,
  useToast,
} from '../ui';

export type MonitoringPayload = {
  overall: 'healthy' | 'degraded';
  generatedAt: string;
  app: {
    env: string;
    apiUrl: string;
    webUrl: string;
    schemaVersion: string;
  };
  health: {
    api: 'ok';
    ready: boolean;
    checks: { postgres: 'ok' | 'error'; redis: 'ok' | 'error' };
  };
  attention: { pendingUsers: number; pendingApiClients: number };
  sessions: { active: number };
  mcp: {
    range: string;
    requestCount: number;
    toolCallCount: number;
    toolErrorCount: number;
    topActions: Array<{ action: string; count: number }>;
  };
  backups: {
    dir: string;
    toolsHint: string;
    lastSuccess: {
      stamp: {
        kind: string;
        at: string;
        artifact: string;
        schemaVersion: string;
        hostname: string;
      } | null;
      ageSeconds: number | null;
    };
    lastImport: {
      stamp: {
        kind: string;
        at: string;
        artifact: string;
        schemaVersion: string;
        hostname: string;
      } | null;
      ageSeconds: number | null;
    };
    artifacts: Array<{ name: string; sizeBytes: number; modifiedAt: string }>;
    totalBytes: number;
    maxUploadBytes: number;
    retention: {
      keepDaily: number;
      keepWeekly: number;
      keepMonthly: number;
      autoRotate: boolean;
      source: 'file' | 'env';
    };
    lastOffsite: {
      stamp: {
        kind: string;
        at: string;
        artifact: string;
        schemaVersion: string;
        hostname: string;
        key: string;
        provider: string;
      } | null;
      ageSeconds: number | null;
    };
    offsite: {
      enabled: boolean;
      provider: string;
      auto: boolean;
    };
  };
};

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

function environmentTone(appEnv: string): 'success' | 'warn' | 'brand' | 'neutral' {
  const normalized = appEnv.toLowerCase();
  if (normalized === 'production' || normalized === 'prod') return 'warn';
  if (normalized === 'staging' || normalized === 'stage') return 'brand';
  if (normalized === 'test') return 'neutral';
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

  return (
    <div className="flex items-center justify-between gap-4 px-5 py-3.5">
      <strong className="text-sm font-medium text-ink">{label}</strong>
      {useBadge ? (
        <Badge tone={badgeTone} className="max-w-[min(100%,20rem)] truncate">
          {value}
        </Badge>
      ) : (
        <span className="max-w-[min(100%,20rem)] truncate text-sm text-ink-muted" title={value}>
          {value}
        </span>
      )}
    </div>
  );
}

export function MonitoringDashboard({
  initial,
  initialRange,
}: {
  initial: MonitoringPayload;
  initialRange: '1h' | '24h' | '7d';
}) {
  const t = useTranslations('admin');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const { pushToast } = useToast();
  const [data, setData] = useState(initial);
  const [range, setRange] = useState(initialRange);
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
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const overallOk = data.overall === 'healthy';

  const backupAgeTone = useMemo(() => {
    const age = data.backups.lastSuccess.ageSeconds;
    if (age == null) return 'warn' as const;
    if (age > 48 * 3600) return 'warn' as const;
    return 'success' as const;
  }, [data.backups.lastSuccess.ageSeconds]);

  async function refresh(nextRange = range) {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/v1/admin/monitoring?range=${encodeURIComponent(nextRange)}`,
        { credentials: 'include', cache: 'no-store' },
      );
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const payload = (await response.json()) as MonitoringPayload;
      setData(payload);
      setRange(nextRange);
      setKeepDaily(String(payload.backups.retention.keepDaily));
      setKeepWeekly(String(payload.backups.retention.keepWeekly));
      setKeepMonthly(String(payload.backups.retention.keepMonthly));
      setAutoRotate(payload.backups.retention.autoRotate);
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
      await refresh();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('monitoringImportFailed'));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid gap-8">
      <div className="flex flex-wrap items-center gap-3">
        <Badge tone={overallOk ? 'success' : 'danger'}>
          {overallOk ? t('monitoringHealthy') : t('monitoringDegraded')}
        </Badge>
        <Button
          type="button"
          variant="secondary"
          disabled={pending}
          onClick={() => void refresh()}
        >
          {t('monitoringRefresh')}
        </Button>
      </div>

      {error ? <ErrorText>{error}</ErrorText> : null}

      <section className="grid gap-3">
        <h2 className="m-0 text-lg font-semibold text-ink">{t('monitoringHealthTitle')}</h2>
        <Panel className="grid gap-0 divide-y divide-line overflow-hidden p-0">
          <StatusRow label={t('monitoringApi')} value={t('monitoringOk')} tone="ok" />
          <StatusRow
            label={t('monitoringReady')}
            value={data.health.ready ? t('monitoringOk') : t('monitoringDegraded')}
            tone={data.health.ready ? 'ok' : 'error'}
          />
          <StatusRow
            label={t('monitoringPostgres')}
            value={data.health.checks.postgres}
            tone={data.health.checks.postgres === 'ok' ? 'ok' : 'error'}
          />
          <StatusRow
            label={t('monitoringRedis')}
            value={data.health.checks.redis}
            tone={data.health.checks.redis === 'ok' ? 'ok' : 'error'}
          />
          <StatusRow
            label={t('monitoringEnvironment')}
            value={data.app.env}
            tone={environmentTone(data.app.env)}
          />
          <StatusRow
            label={t('monitoringSchema')}
            value={data.app.schemaVersion}
            tone="neutral"
          />
          <StatusRow label={t('monitoringApiUrl')} value={data.app.apiUrl} tone="neutral" />
          <StatusRow label={t('monitoringWebUrl')} value={data.app.webUrl} tone="neutral" />
        </Panel>
      </section>

      <section className="grid gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="m-0 text-lg font-semibold text-ink">{t('monitoringUsageTitle')}</h2>
          <Field label={t('monitoringRange')} className="min-w-[10rem]">
            <Select
              value={range}
              disabled={pending}
              onChange={(event) => {
                const next = event.target.value as '1h' | '24h' | '7d';
                void refresh(next);
              }}
            >
              <option value="1h">{t('monitoringRange1h')}</option>
              <option value="24h">{t('monitoringRange24h')}</option>
              <option value="7d">{t('monitoringRange7d')}</option>
            </Select>
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Panel className="p-4">
            <p className="m-0 text-xs font-semibold tracking-[0.12em] text-ink-muted uppercase">
              {t('monitoringActiveSessions')}
            </p>
            <p className="mt-2 mb-0 text-2xl font-semibold tabular-nums">
              {data.sessions.active}
            </p>
          </Panel>
          <Panel className="p-4">
            <p className="m-0 text-xs font-semibold tracking-[0.12em] text-ink-muted uppercase">
              {t('monitoringMcpRequests')}
            </p>
            <p className="mt-2 mb-0 text-2xl font-semibold tabular-nums">
              {data.mcp.requestCount}
            </p>
          </Panel>
          <Panel className="p-4">
            <p className="m-0 text-xs font-semibold tracking-[0.12em] text-ink-muted uppercase">
              {t('monitoringMcpToolCalls')}
            </p>
            <p className="mt-2 mb-0 text-2xl font-semibold tabular-nums">
              {data.mcp.toolCallCount}
            </p>
          </Panel>
          <Panel className="p-4">
            <p className="m-0 text-xs font-semibold tracking-[0.12em] text-ink-muted uppercase">
              {t('monitoringMcpErrors')}
            </p>
            <p className="mt-2 mb-0 text-2xl font-semibold tabular-nums">
              {data.mcp.toolErrorCount}
            </p>
          </Panel>
        </div>
        <Panel className="p-4">
          <p className="mt-0 mb-2 text-sm font-medium text-ink">{t('monitoringAttention')}</p>
          <div className="flex flex-wrap gap-2">
            <Badge tone={data.attention.pendingUsers > 0 ? 'warn' : 'neutral'}>
              {t('monitoringPendingUsers', { count: data.attention.pendingUsers })}
            </Badge>
            <Badge tone={data.attention.pendingApiClients > 0 ? 'warn' : 'neutral'}>
              {t('monitoringPendingClients', { count: data.attention.pendingApiClients })}
            </Badge>
          </div>
          {data.mcp.topActions.length > 0 ? (
            <ul className="mt-4 mb-0 grid gap-1 pl-0 list-none">
              {data.mcp.topActions.map((row) => (
                <li
                  key={row.action}
                  className="flex justify-between gap-3 text-sm text-ink-muted"
                >
                  <span className="truncate font-mono text-ink">{row.action}</span>
                  <span className="tabular-nums">{row.count}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 mb-0 text-sm text-ink-muted">{t('monitoringMcpEmpty')}</p>
          )}
        </Panel>
      </section>

      <section className="grid gap-3">
        <h2 className="m-0 text-lg font-semibold text-ink">{t('monitoringBackupsTitle')}</h2>
        <p className="m-0 text-sm text-ink-muted">{t('monitoringBackupsBlurb')}</p>
        <Panel className="grid gap-0 divide-y divide-line overflow-hidden p-0">
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
          <StatusRow
            label={t('monitoringBackupDir')}
            value={data.backups.dir}
            tone="neutral"
          />
        </Panel>

        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={pending} onClick={() => void runExport()}>
            {t('monitoringExportNow')}
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={pending}
            onClick={() => setImportOpen(true)}
          >
            {t('monitoringImportOpen')}
          </Button>
        </div>

        <Panel className="grid gap-4 p-5">
          <div>
            <strong className="text-sm font-medium text-ink">
              {t('monitoringRetentionTitle')}
            </strong>
            <p className="mt-1 mb-0 text-sm text-ink-muted">
              {t('monitoringRetentionBlurb')}
            </p>
            <p className="mt-1 mb-0 text-xs text-ink-muted">
              {t('monitoringRetentionSource', {
                source: data.backups.retention.source,
                total: formatBytes(data.backups.totalBytes),
              })}
            </p>
          </div>
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
          <label className="flex items-center gap-2 text-sm text-ink">
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
        </Panel>

        <Panel className="overflow-hidden p-0">
          <div className="border-b border-line px-5 py-3">
            <strong className="text-sm font-medium text-ink">
              {t('monitoringArtifacts')}
            </strong>
          </div>
          {data.backups.artifacts.length === 0 ? (
            <p className="m-0 px-5 py-4 text-sm text-ink-muted">{t('monitoringArtifactsEmpty')}</p>
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
        </Panel>
        <p className="m-0 text-xs text-ink-muted">{data.backups.toolsHint}</p>
      </section>

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
            <Input
              type="file"
              accept=".dump,application/octet-stream"
              disabled={pending}
              onChange={(event) => {
                const file = event.target.files?.[0] ?? null;
                setUploadFile(file);
              }}
            />
          </Field>
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
