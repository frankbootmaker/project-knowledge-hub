'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  Badge,
  Button,
  ErrorText,
  PageHeader,
  Select,
  useToast,
} from '../ui';
import type { MonitoringPayload } from './monitoring-types';

export type { MonitoringPayload } from './monitoring-types';

function formatAge(seconds: number | null, neverLabel: string): string {
  if (seconds == null) return neverLabel;
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

function environmentTone(appEnv: string): 'success' | 'warn' | 'brand' | 'neutral' {
  const normalized = appEnv.toLowerCase();
  if (normalized === 'production' || normalized === 'prod') return 'warn';
  if (normalized === 'staging' || normalized === 'stage') return 'brand';
  if (normalized === 'test') return 'neutral';
  return 'success';
}

export function MonitoringDashboard({
  title,
  description,
  initial,
  initialRange,
}: {
  title: string;
  description: string;
  initial: MonitoringPayload;
  initialRange: '1h' | '24h' | '7d';
}) {
  const t = useTranslations('admin');
  const router = useRouter();
  const { pushToast } = useToast();
  const [data, setData] = useState(initial);
  const [range, setRange] = useState(initialRange);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reindexWorkspaceId, setReindexWorkspaceId] = useState('');

  useEffect(() => {
    const hash = window.location.hash.replace(/^#/, '');
    if (hash === 'backups') {
      router.replace('/admin/backups');
      return;
    }
    const scrollToHash = () => {
      const id = window.location.hash.replace(/^#/, '');
      if (!id || id === 'backups') {
        return;
      }
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    const timer = window.setTimeout(scrollToHash, 0);
    window.addEventListener('hashchange', scrollToHash);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('hashchange', scrollToHash);
    };
  }, [router]);

  const overallOk = data.overall === 'healthy';
  const backupAge = formatAge(
    data.backups.lastSuccess.ageSeconds,
    t('monitoringNever'),
  );

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
    } catch (err) {
      setError(err instanceof Error ? err.message : t('monitoringRefreshFailed'));
    } finally {
      setPending(false);
    }
  }

  async function runReindex() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch('/api/v1/admin/monitoring/embeddings/reindex', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId: reindexWorkspaceId || undefined,
          force: true,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: { message?: string };
        enqueued?: boolean;
        reason?: string;
        jobs?: unknown[];
      };
      if (!response.ok) {
        throw new Error(body.error?.message ?? `HTTP ${response.status}`);
      }
      if (!body.enqueued) {
        pushToast(t('monitoringReindexDisabled'));
      } else {
        pushToast(
          t('monitoringReindexOk', { count: body.jobs?.length ?? 0 }),
        );
      }
      await refresh();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('monitoringReindexFailed'));
    } finally {
      setPending(false);
    }
  }

  async function downloadJsonAttachment(
    path: string,
    fallbackName: string,
    okMessage: string,
    failMessage: string,
  ) {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(path, {
        credentials: 'include',
        cache: 'no-store',
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          error?: { message?: string };
        };
        throw new Error(body.error?.message ?? `HTTP ${response.status}`);
      }
      const blob = await response.blob();
      const disposition = response.headers.get('Content-Disposition') ?? '';
      const match = /filename="([^"]+)"/.exec(disposition);
      const filename = match?.[1] ?? fallbackName;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL(url);
      pushToast(okMessage);
    } catch (err) {
      setError(err instanceof Error ? err.message : failMessage);
    } finally {
      setPending(false);
    }
  }

  async function downloadSupportDump() {
    await downloadJsonAttachment(
      '/api/v1/admin/monitoring/support-dump',
      `knowhub-support-${Date.now()}.json`,
      t('monitoringSupportDumpOk'),
      t('monitoringSupportDumpFailed'),
    );
  }

  async function downloadOpsLogExport() {
    await downloadJsonAttachment(
      '/api/v1/admin/monitoring/ops-log-export?days=7',
      `knowhub-ops-log-7d-${Date.now()}.json`,
      t('monitoringOpsLogExportOk'),
      t('monitoringOpsLogExportFailed'),
    );
  }

  return (
    <div className="grid gap-3">
      <PageHeader
        eyebrow={t('monitoringEyebrow')}
        title={title}
        description={description}
        actions={
          <>
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
            <Button
              type="button"
              variant="secondary"
              disabled={pending}
              onClick={() => void downloadSupportDump()}
            >
              {t('monitoringSupportDump')}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={pending}
              onClick={() => void downloadOpsLogExport()}
            >
              {t('monitoringOpsLogExport')}
            </Button>
          </>
        }
      />

      {error ? <ErrorText>{error}</ErrorText> : null}
      {data.loadError ? (
        <div className="kh-ops-status-row" role="alert">
          <p className="m-0 text-sm font-medium text-ink">{t('monitoringLoadErrorTitle')}</p>
          <p className="mt-1 mb-0 text-sm text-ink-muted">{data.loadError}</p>
          <p className="mt-2 mb-0 text-xs text-ink-muted">{t('monitoringLoadErrorHint')}</p>
        </div>
      ) : null}

      <section id="health" className="kh-ops-health-grid scroll-mt-6">
        <div className="kh-ops-health-card">
          <small>{t('monitoringApi')}</small>
          <strong>{data.health.api}</strong>
        </div>
        <div className="kh-ops-health-card">
          <small>{t('monitoringReady')}</small>
          <strong>
            {data.loadError
              ? t('monitoringUnknown')
              : data.health.ready
                ? t('monitoringOk')
                : t('monitoringDegraded')}
          </strong>
        </div>
        <div className="kh-ops-health-card">
          <small>{t('monitoringPostgres')}</small>
          <strong>{data.health.checks.postgres}</strong>
        </div>
        <div className="kh-ops-health-card">
          <small>{t('monitoringRedis')}</small>
          <strong>{data.health.checks.redis}</strong>
        </div>
        <div className="kh-ops-health-card">
          <small>{t('monitoringActiveSessions')}</small>
          <strong>{data.sessions.active}</strong>
        </div>
        <a className="kh-ops-health-card" href="/admin/backups">
          <small>{t('monitoringBackupAge')}</small>
          <strong>{backupAge}</strong>
          <span className="mt-1 block truncate text-[10px] text-ink-muted">
            {data.attention.staleBackup
              ? t('monitoringStaleBackup', {
                  hours: data.attention.staleBackupAfterHours,
                })
              : t('monitoringBackupsLink')}
          </span>
        </a>
      </section>

      <div className="kh-ops-admin-workspace">
        <div className="kh-ops-admin-stack">
          <section id="usage" className="kh-ops-panel scroll-mt-6 overflow-hidden">
            <div className="kh-ops-panel-head">
              <div className="min-w-0">
                <h2 className="kh-ops-panel-title">{t('monitoringUsageTitle')}</h2>
                <p className="kh-ops-panel-sub">{t('monitoringUsageSub')}</p>
              </div>
              <Select
                className="kh-ops-inline-control"
                aria-label={t('monitoringRange')}
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
            </div>
            <div className="kh-ops-usage-stats">
              <div className="kh-ops-stat">
                <p className="kh-ops-stat-label m-0">{t('monitoringActiveSessions')}</p>
                <p className="kh-ops-stat-value">{data.sessions.active}</p>
              </div>
              <div className="kh-ops-stat">
                <p className="kh-ops-stat-label m-0">{t('monitoringMcpRequests')}</p>
                <p className="kh-ops-stat-value">{data.mcp.requestCount}</p>
              </div>
              <div className="kh-ops-stat">
                <p className="kh-ops-stat-label m-0">{t('monitoringMcpToolCalls')}</p>
                <p className="kh-ops-stat-value">{data.mcp.toolCallCount}</p>
              </div>
              <div className="kh-ops-stat">
                <p className="kh-ops-stat-label m-0">{t('monitoringMcpErrors')}</p>
                <p className="kh-ops-stat-value">{data.mcp.toolErrorCount}</p>
              </div>
            </div>
            <div className="kh-ops-attention-row">
              <Badge tone={data.attention.pendingUsers > 0 ? 'warn' : 'neutral'}>
                {t('monitoringPendingUsers', { count: data.attention.pendingUsers })}
              </Badge>
              <Badge tone={data.attention.pendingApiClients > 0 ? 'warn' : 'neutral'}>
                {t('monitoringPendingClients', { count: data.attention.pendingApiClients })}
              </Badge>
              <Badge tone={data.attention.staleBackup ? 'warn' : 'success'}>
                {data.attention.staleBackup
                  ? t('monitoringStaleBackup', {
                      hours: data.attention.staleBackupAfterHours,
                    })
                  : t('monitoringBackupFresh')}
              </Badge>
              <Badge
                tone={
                  data.attention.onDutyAdmins.length === 0
                  && data.attention.pendingUsers > 0
                    ? 'warn'
                    : 'neutral'
                }
              >
                {data.attention.onDutyAdmins.length === 0
                  ? t('monitoringOnDutyNone')
                  : t('monitoringOnDuty', {
                      names: data.attention.onDutyAdmins
                        .map((admin) => admin.displayName)
                        .join(', '),
                    })}
              </Badge>
            </div>
          </section>

          <div className="kh-ops-telemetry-grid">
            <section className="kh-ops-panel overflow-hidden">
              <div className="kh-ops-panel-head">
                <div className="min-w-0">
                  <h2 className="kh-ops-panel-title">{t('monitoringTopTools')}</h2>
                  <p className="kh-ops-panel-sub">{t('monitoringTopToolsSub')}</p>
                </div>
                <span className="kh-ops-panel-meta">{range}</span>
              </div>
              {(data.mcp.topTools?.length ?? 0) === 0 ? (
                <p className="kh-ops-empty">{t('monitoringMcpEmpty')}</p>
              ) : (
                (data.mcp.topTools ?? []).map((row) => (
                  <div key={`${row.via}:${row.toolName}`} className="kh-ops-list-row">
                    <div className="min-w-0">
                      <div className="kh-ops-list-title font-mono">
                        {row.via}
                        {' · '}
                        {row.toolName}
                      </div>
                    </div>
                    <div className="kh-ops-list-value">
                      {row.errorCount > 0
                        ? t('monitoringToolCountsWithErrors', {
                            calls: row.callCount,
                            errors: row.errorCount,
                          })
                        : row.callCount}
                    </div>
                  </div>
                ))
              )}
            </section>

            <section className="kh-ops-panel overflow-hidden">
              <div className="kh-ops-panel-head">
                <div className="min-w-0">
                  <h2 className="kh-ops-panel-title">{t('monitoringTopActions')}</h2>
                  <p className="kh-ops-panel-sub">{t('monitoringTopActionsSub')}</p>
                </div>
                <span className="kh-ops-panel-meta">{range}</span>
              </div>
              {data.mcp.topActions.length === 0 ? (
                <p className="kh-ops-empty">{t('monitoringMcpEmpty')}</p>
              ) : (
                data.mcp.topActions.map((row) => (
                  <div key={row.action} className="kh-ops-list-row">
                    <div className="kh-ops-list-title font-mono">{row.action}</div>
                    <div className="kh-ops-list-value">{row.count}</div>
                  </div>
                ))
              )}
            </section>

            <section className="kh-ops-panel overflow-hidden">
              <div className="kh-ops-panel-head">
                <div className="min-w-0">
                  <h2 className="kh-ops-panel-title">{t('monitoringSearchTitle')}</h2>
                  <p className="kh-ops-panel-sub">{t('monitoringSearchSub')}</p>
                </div>
                <span className="kh-ops-panel-meta">
                  {t('monitoringSearchCount', {
                    count: data.catalogue.search?.searchCount ?? 0,
                  })}
                </span>
              </div>
              {(data.catalogue.search?.topQueryHashes?.length ?? 0) === 0 ? (
                <p className="kh-ops-empty">{t('monitoringCatalogueEmpty')}</p>
              ) : (
                (data.catalogue.search?.topQueryHashes ?? []).map((row) => (
                  <div key={row.queryHash} className="kh-ops-list-row">
                    <div className="min-w-0">
                      <div className="kh-ops-list-title font-mono">
                        {row.queryHash.slice(0, 12)}
                        …
                      </div>
                      {row.queryLength != null ? (
                        <div className="kh-ops-list-note">
                          {t('monitoringSearchQueryLen', { length: row.queryLength })}
                        </div>
                      ) : null}
                    </div>
                    <div className="kh-ops-list-value">{row.count}</div>
                  </div>
                ))
              )}
            </section>
          </div>

          <section className="kh-ops-panel overflow-hidden">
            <div className="kh-ops-panel-head">
              <div className="min-w-0">
                <h2 className="kh-ops-panel-title">{t('monitoringClientsTitle')}</h2>
                <p className="kh-ops-panel-sub">{t('monitoringClientsSub')}</p>
              </div>
              <span className="kh-ops-panel-meta">{t('monitoringClientsMeta')}</span>
            </div>
            {data.clients.leaderboard.length === 0 ? (
              <p className="kh-ops-empty">{t('monitoringClientsEmpty')}</p>
            ) : (
              <div className="kh-ops-table-wrap">
                <table className="kh-ops-data-table">
                  <thead>
                    <tr>
                      <th>{t('monitoringClientsColClient')}</th>
                      <th className="kh-ops-num">{t('monitoringClientsColRequests')}</th>
                      <th className="kh-ops-num">{t('monitoringClientsColTools')}</th>
                      <th className="kh-ops-num">{t('monitoringClientsColErrors')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.clients.leaderboard.map((row) => (
                      <tr key={row.actorId}>
                        <td className="kh-ops-primary-cell">
                          {row.clientName ?? row.actorId}
                        </td>
                        <td className="kh-ops-num">{row.requestCount}</td>
                        <td className="kh-ops-num">{row.toolCallCount}</td>
                        <td className="kh-ops-num">{row.toolErrorCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="kh-ops-panel overflow-hidden">
            <div className="kh-ops-panel-head">
              <div className="min-w-0">
                <h2 className="kh-ops-panel-title">{t('monitoringCatalogueTitle')}</h2>
                <p className="kh-ops-panel-sub">{t('monitoringCatalogueSub')}</p>
              </div>
            </div>
            <div className="kh-ops-table-wrap">
              <table className="kh-ops-data-table">
                <thead>
                  <tr>
                    <th>{t('monitoringCatalogueColCategory')}</th>
                    <th>{t('monitoringCatalogueColTop')}</th>
                    <th className="kh-ops-num">{t('monitoringCatalogueColEvents')}</th>
                    <th>{t('monitoringCatalogueColNext')}</th>
                  </tr>
                </thead>
                <tbody>
                  <CatalogueSummaryRow
                    category={t('monitoringTopViewed')}
                    rows={data.catalogue.topViewedRecords ?? []}
                    empty={t('monitoringCatalogueEmpty')}
                  />
                  <CatalogueSummaryRow
                    category={t('monitoringTopRecords')}
                    rows={data.catalogue.topRecords}
                    empty={t('monitoringCatalogueEmpty')}
                  />
                  <CatalogueSummaryRow
                    category={t('monitoringTopProjects')}
                    rows={data.catalogue.topProjects}
                    empty={t('monitoringCatalogueEmpty')}
                  />
                  <CatalogueSummaryRow
                    category={t('monitoringTopSystems')}
                    rows={data.catalogue.topSystems}
                    empty={t('monitoringCatalogueEmpty')}
                  />
                </tbody>
              </table>
            </div>
          </section>

          <section id="maintenance" className="kh-ops-panel scroll-mt-6 overflow-hidden">
            <div className="kh-ops-panel-head">
              <div className="min-w-0">
                <h2 className="kh-ops-panel-title">{t('monitoringMaintenanceTitle')}</h2>
                <p className="kh-ops-panel-sub">
                  {t('monitoringEmbeddingProvider', {
                    provider: data.maintenance.embeddingProvider,
                  })}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-3">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-ink">{t('monitoringReindexRun')}</div>
                <p className="m-0 mt-1 text-xs text-ink-muted">
                  {t('monitoringMaintenanceBlurb')}
                </p>
              </div>
              <div className="kh-ops-maintenance-controls">
                <Select
                  className="kh-ops-inline-control"
                  aria-label={t('monitoringReindexWorkspace')}
                  value={reindexWorkspaceId}
                  disabled={pending}
                  onChange={(event) => setReindexWorkspaceId(event.target.value)}
                >
                  <option value="">{t('monitoringReindexAll')}</option>
                  {data.maintenance.workspaces.map((workspace) => (
                    <option key={workspace.id} value={workspace.id}>
                      {workspace.name}
                    </option>
                  ))}
                </Select>
                <Button
                  type="button"
                  disabled={pending}
                  onClick={() => void runReindex()}
                >
                  {t('monitoringReindexRun')}
                </Button>
              </div>
            </div>
            <p className="m-0 border-t border-line px-3 py-3 text-sm text-ink-muted">
              {t('monitoringPurgeHint')}
              {' '}
              <a className="text-brand no-underline hover:underline" href="/admin/archive">
                {t('monitoringArchiveLink')}
              </a>
            </p>
          </section>
        </div>

        <aside>
          <section className="kh-ops-panel overflow-hidden">
            <div className="kh-ops-panel-head">
              <div className="min-w-0">
                <h2 className="kh-ops-panel-title">{t('monitoringPlatformDetails')}</h2>
                <p className="kh-ops-panel-sub">{t('monitoringPlatformDetailsSub')}</p>
              </div>
            </div>
            <div className="kh-ops-list-row">
              <div className="kh-ops-list-title">{t('monitoringEnvironment')}</div>
              <Badge tone={environmentTone(data.app.env)}>{data.app.env}</Badge>
            </div>
            <div className="kh-ops-list-row">
              <div className="kh-ops-list-title">{t('monitoringSchema')}</div>
              <div className="kh-ops-list-value">{data.app.schemaVersion}</div>
            </div>
            <div className="kh-ops-list-row kh-ops-list-row--stacked">
              <div className="kh-ops-list-title">{t('monitoringApiUrl')}</div>
              <div className="kh-ops-list-value kh-ops-list-value--wrap" title={data.app.apiUrl}>
                {data.app.apiUrl}
              </div>
            </div>
            <div className="kh-ops-list-row kh-ops-list-row--stacked">
              <div className="kh-ops-list-title">{t('monitoringWebUrl')}</div>
              <div className="kh-ops-list-value kh-ops-list-value--wrap" title={data.app.webUrl}>
                {data.app.webUrl}
              </div>
            </div>
          </section>

          <section className="kh-ops-panel overflow-hidden">
            <div className="kh-ops-panel-head">
              <div className="min-w-0">
                <h2 className="kh-ops-panel-title">{t('monitoringAttention')}</h2>
                <p className="kh-ops-panel-sub">{t('monitoringAttentionSub')}</p>
              </div>
            </div>
            <div className="kh-ops-list-row">
              <div className="kh-ops-list-title">{t('monitoringPendingLabel')}</div>
              <div className="kh-ops-list-value">{data.attention.pendingUsers}</div>
            </div>
            <div className="kh-ops-list-row">
              <div className="kh-ops-list-title">{t('monitoringPendingClientsLabel')}</div>
              <div className="kh-ops-list-value">{data.attention.pendingApiClients}</div>
            </div>
            <div className="border-t border-line px-3 py-3">
              <p className="mt-0 mb-2 text-[10px] font-semibold tracking-[0.08em] text-ink-muted uppercase">
                {t('monitoringOnDutyTitle')}
              </p>
              {data.attention.onDutyAdmins.length === 0 ? (
                <p className="m-0 text-sm text-ink-muted">{t('monitoringOnDutyNone')}</p>
              ) : (
                data.attention.onDutyAdmins.map((admin) => (
                  <div key={admin.id} className="kh-ops-connection-row">
                    <span className="kh-ops-code-box" aria-hidden>
                      {admin.displayName.slice(0, 2).toUpperCase()}
                    </span>
                    <div className="min-w-0">
                      <b className="block truncate text-sm">{admin.displayName}</b>
                      <small className="block truncate text-[10px] text-ink-muted">
                        {admin.email}
                      </small>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="kh-ops-panel overflow-hidden">
            <div className="kh-ops-panel-head">
              <div className="min-w-0">
                <h2 className="kh-ops-panel-title">{t('monitoringArchivedTitle')}</h2>
                <p className="kh-ops-panel-sub">{t('monitoringArchivedSub')}</p>
              </div>
              <span className="kh-ops-panel-meta">
                {data.maintenance.archived.workspaces
                  + data.maintenance.archived.projects
                  + data.maintenance.archived.systems
                  + data.maintenance.archived.knowledgeRecords}
              </span>
            </div>
            <div className="kh-ops-list-row">
              <div className="kh-ops-list-title">{t('monitoringArchivedWorkspacesLabel')}</div>
              <div className="kh-ops-list-value">{data.maintenance.archived.workspaces}</div>
            </div>
            <div className="kh-ops-list-row">
              <div className="kh-ops-list-title">{t('monitoringArchivedProjectsLabel')}</div>
              <div className="kh-ops-list-value">{data.maintenance.archived.projects}</div>
            </div>
            <div className="kh-ops-list-row">
              <div className="kh-ops-list-title">{t('monitoringArchivedSystemsLabel')}</div>
              <div className="kh-ops-list-value">{data.maintenance.archived.systems}</div>
            </div>
            <div className="kh-ops-list-row">
              <div className="kh-ops-list-title">{t('monitoringArchivedRecordsLabel')}</div>
              <div className="kh-ops-list-value">
                {data.maintenance.archived.knowledgeRecords}
              </div>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

function CatalogueSummaryRow(props: {
  category: string;
  empty: string;
  rows: Array<{ entityId: string; label: string | null; count: number }>;
}) {
  const top = props.rows[0];
  const next = props.rows[1];
  return (
    <tr>
      <td className="kh-ops-primary-cell">{props.category}</td>
      <td>{top ? (top.label ?? top.entityId) : props.empty}</td>
      <td className="kh-ops-num">{top?.count ?? 0}</td>
      <td className="text-ink-muted">
        {next ? (next.label ?? next.entityId) : '—'}
      </td>
    </tr>
  );
}
