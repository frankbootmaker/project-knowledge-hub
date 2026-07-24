import { getTranslations } from 'next-intl/server';
import {
  MonitoringDashboard,
  type MonitoringPayload,
} from '../../../../components/admin/MonitoringDashboard';
import { PageHeader } from '../../../../components/ui';
import { apiFetch } from '../../../../lib/session';

const emptyPayload = (loadError: string): MonitoringPayload => ({
  overall: 'degraded',
  generatedAt: new Date().toISOString(),
  loadError,
  app: {
    env: process.env.APP_ENV ?? 'development',
    apiUrl: process.env.API_URL ?? 'http://localhost:3101',
    webUrl: process.env.WEB_URL ?? 'http://localhost:3100',
    schemaVersion: 'unknown',
  },
  health: {
    api: 'unknown',
    ready: false,
    checks: { postgres: 'unknown', redis: 'unknown' },
  },
  attention: {
    pendingUsers: 0,
    pendingApiClients: 0,
    staleBackup: false,
    staleBackupAfterHours: 36,
    onDutyAdmins: [],
  },
  sessions: { active: 0 },
  mcp: {
    range: '24h',
    requestCount: 0,
    toolCallCount: 0,
    toolErrorCount: 0,
    topActions: [],
  },
  clients: { range: '24h', leaderboard: [] },
  catalogue: {
    range: '24h',
    topRecords: [],
    topProjects: [],
    topSystems: [],
  },
  maintenance: {
    embeddingProvider: 'disabled',
    workspaces: [],
    archived: {
      workspaces: 0,
      projects: 0,
      systems: 0,
      knowledgeRecords: 0,
    },
  },
  backups: {
    dir: './backups',
    toolsHint: '',
    lastSuccess: { stamp: null, ageSeconds: null },
    lastImport: { stamp: null, ageSeconds: null },
    lastFailure: { stamp: null, ageSeconds: null },
    artifacts: [],
    totalBytes: 0,
    maxUploadBytes: 512 * 1024 * 1024,
    retention: {
      keepDaily: 7,
      keepWeekly: 4,
      keepMonthly: 3,
      autoRotate: true,
      source: 'env',
    },
    schedule: {
      enabled: true,
      intervalSeconds: 86400,
      source: 'env',
    },
    lastOffsite: { stamp: null, ageSeconds: null },
    offsite: { enabled: false, provider: 'disabled', auto: true },
    staleAfterHours: 36,
  },
});

export default async function AdminMonitoringPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await getTranslations('admin');
  const params = await searchParams;
  const rawRange = typeof params.range === 'string' ? params.range : '24h';
  const range =
    rawRange === '1h' || rawRange === '7d' || rawRange === '24h' ? rawRange : '24h';

  const response = await apiFetch(`/api/v1/admin/monitoring?range=${range}`);
  const payload: MonitoringPayload = response.ok
    ? ((await response.json()) as MonitoringPayload)
    : emptyPayload(
        `Monitoring API returned HTTP ${response.status}. Check web API_URL / NEXT_REWRITE_API_ORIGIN reaches the api service (Dokploy: http://api:3101).`,
      );

  return (
    <div>
      <PageHeader
        title={t('monitoring')}
        description={t('monitoringBlurb')}
      />
      <MonitoringDashboard initial={payload} initialRange={range} />
    </div>
  );
}
