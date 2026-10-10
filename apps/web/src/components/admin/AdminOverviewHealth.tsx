import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Badge, LinkButton } from '../ui';
import type { MonitoringPayload } from './monitoring-types';

function formatAge(seconds: number | null, neverLabel: string): string {
  if (seconds == null) return neverLabel;
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

export async function AdminOverviewHealth({
  monitoring,
}: {
  monitoring: MonitoringPayload | null;
}) {
  const t = await getTranslations('admin');

  if (!monitoring) {
    return (
      <section className="kh-ops-panel">
        <div className="kh-ops-panel-head">
          <div className="min-w-0">
            <h2 className="kh-ops-panel-title">{t('overviewHealthTitle')}</h2>
            <p className="kh-ops-panel-sub">{t('overviewMonitoringUnavailable')}</p>
          </div>
          <LinkButton href="/admin/monitoring" variant="secondary">
            {t('overviewOpenMonitoring')}
          </LinkButton>
        </div>
      </section>
    );
  }

  const backupAge = formatAge(monitoring.backups.lastSuccess.ageSeconds, t('monitoringNever'));

  return (
    <div>
      <section className="kh-ops-health-grid" aria-label={t('overviewHealthTitle')}>
        <div className="kh-ops-health-card">
          <small>{t('monitoringApi')}</small>
          <strong>{monitoring.health.api}</strong>
        </div>
        <div className="kh-ops-health-card">
          <small>{t('monitoringReady')}</small>
          <strong>
            {monitoring.health.ready ? t('monitoringOk') : t('monitoringDegraded')}
          </strong>
        </div>
        <div className="kh-ops-health-card">
          <small>{t('monitoringPostgres')}</small>
          <strong>{monitoring.health.checks.postgres}</strong>
        </div>
        <div className="kh-ops-health-card">
          <small>{t('monitoringRedis')}</small>
          <strong>{monitoring.health.checks.redis}</strong>
        </div>
        <div className="kh-ops-health-card">
          <small>{t('monitoringActiveSessions')}</small>
          <strong>{monitoring.sessions.active}</strong>
        </div>
        <Link href="/admin/backups" className="kh-ops-health-card">
          <small>{t('monitoringBackupAge')}</small>
          <strong>{backupAge}</strong>
        </Link>
      </section>

      <section className="kh-ops-panel overflow-hidden">
        <div className="kh-ops-panel-head">
          <div className="min-w-0">
            <h2 className="kh-ops-panel-title">{t('overviewHealthTitle')}</h2>
            <p className="kh-ops-panel-sub">{t('overviewHealthSub')}</p>
          </div>
          <LinkButton href="/admin/monitoring" variant="secondary">
            {t('overviewOpenMonitoring')}
          </LinkButton>
        </div>
        <div className="kh-ops-usage-stats">
          <div className="kh-ops-stat">
            <p className="kh-ops-stat-label m-0">{t('monitoringMcpRequests')}</p>
            <p className="kh-ops-stat-value">{monitoring.mcp.requestCount}</p>
          </div>
          <div className="kh-ops-stat">
            <p className="kh-ops-stat-label m-0">{t('monitoringMcpToolCalls')}</p>
            <p className="kh-ops-stat-value">{monitoring.mcp.toolCallCount}</p>
          </div>
          <div className="kh-ops-stat">
            <p className="kh-ops-stat-label m-0">{t('monitoringMcpErrors')}</p>
            <p className="kh-ops-stat-value">{monitoring.mcp.toolErrorCount}</p>
          </div>
          <div className="kh-ops-stat">
            <p className="kh-ops-stat-label m-0">{t('monitoringActiveSessions')}</p>
            <p className="kh-ops-stat-value">{monitoring.sessions.active}</p>
          </div>
        </div>
        <div className="kh-ops-attention-row">
          <Badge tone={monitoring.attention.pendingUsers > 0 ? 'warn' : 'neutral'}>
            {t('monitoringPendingUsers', { count: monitoring.attention.pendingUsers })}
          </Badge>
          <Badge tone={monitoring.attention.pendingApiClients > 0 ? 'warn' : 'neutral'}>
            {t('monitoringPendingClients', { count: monitoring.attention.pendingApiClients })}
          </Badge>
          <Badge tone="neutral">
            {t('monitoringActiveOauthGrants', {
              count: monitoring.attention.activeOauthGrants ?? 0,
            })}
          </Badge>
          <Badge tone={monitoring.attention.staleBackup ? 'warn' : 'success'}>
            {monitoring.attention.staleBackup
              ? t('monitoringStaleBackup', { hours: monitoring.attention.staleBackupAfterHours })
              : t('monitoringBackupFresh')}
          </Badge>
        </div>
      </section>
    </div>
  );
}
