import { getTranslations } from 'next-intl/server';
import {
  BackupAdminTabs,
  parseBackupAdminTab,
} from '../../../../components/admin/BackupAdminTabs';
import { BackupsAdmin } from '../../../../components/admin/BackupsAdmin';
import {
  StorageSettingsAdmin,
  type BlobUsageSummary,
  type PublicBlobSettings,
} from '../../../../components/admin/StorageSettingsAdmin';
import { type MonitoringPayload } from '../../../../components/admin/monitoring-types';
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

export default async function AdminBackupsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await getTranslations('admin');
  const params = await searchParams;
  const tab = parseBackupAdminTab(params.tab);

  return (
    <div>
      <PageHeader title={t('backupsPageTitle')} description={t('backupsHubBlurb')} />
      <BackupAdminTabs
        active={tab}
        label={t('backupsTabsLabel')}
        labels={{
          backups: t('backupsTabBackups'),
          storage: t('storage'),
        }}
      />
      {tab === 'storage' ? (
        <StoragePane />
      ) : (
        <BackupsPane title={t('backupsPageTitle')} description={t('backupsPageBlurb')} />
      )}
    </div>
  );
}

async function BackupsPane({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  const response = await apiFetch('/api/v1/admin/monitoring?range=24h');
  let payload: MonitoringPayload;
  if (response.ok) {
    payload = (await response.json()) as MonitoringPayload;
  } else {
    const body = (await response.json().catch(() => null)) as {
      error?: { message?: string; code?: string };
    } | null;
    const detail = body?.error?.message
      ? ` ${body.error.code ? `[${body.error.code}] ` : ''}${body.error.message}`
      : '';
    payload = emptyPayload(
      `Monitoring API returned HTTP ${response.status}.${detail}`,
    );
  }

  return (
    <BackupsAdmin
      showHeader={false}
      title={title}
      description={description}
      initial={payload}
    />
  );
}

const emptyStorageSettings: PublicBlobSettings = {
  provider: 'disabled',
  backupOffsite: true,
  s3Bucket: '',
  s3Region: 'auto',
  s3Endpoint: '',
  s3ForcePathStyle: false,
  keyPrefix: 'development',
  hasAccessKeyId: false,
  hasSecretAccessKey: false,
  source: 'env',
  effectiveProvider: 'disabled',
  envProvider: 'disabled',
};

async function StoragePane() {
  const t = await getTranslations('admin');
  const response = await apiFetch('/api/v1/admin/storage-settings');
  const payload = response.ok
    ? ((await response.json()) as {
        settings: PublicBlobSettings;
        usage?: BlobUsageSummary;
      })
    : null;

  return (
    <div className="grid gap-4">
      <p className="m-0 text-sm text-ink-muted">{t('storageSettingsPageBlurb')}</p>
      <StorageSettingsAdmin
        initialSettings={payload?.settings ?? emptyStorageSettings}
        initialUsage={payload?.usage ?? null}
      />
    </div>
  );
}
