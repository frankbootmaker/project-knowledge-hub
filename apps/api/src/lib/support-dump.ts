import type { FastifyInstance } from 'fastify';
import {
  readOffsiteErrorStamp,
  readRotationStamp,
  type OffsiteErrorStamp,
  type RotationStamp,
} from '@project-knowledge-hub/blob-store';
import {
  loadEffectiveAlertSettings,
  readAuditRetentionSnapshot,
} from '@project-knowledge-hub/database';
import type { RecentMcpAuditError } from '@project-knowledge-hub/mcp';
import {
  listDumpArtifacts,
  readStamp,
  stampSummary,
} from './backups.js';
import { readOffsiteStamp } from './backup-offsite.js';
import {
  getMcpActivitySummary,
  getPendingAttention,
  getRecentErrorAuditEvents,
  getSchemaVersionLabel,
  isBackupStale,
  isOffsiteStale,
} from './monitoring.js';

type RotationSummary = {
  at: string;
  kept: number | null;
  deleted: number | null;
  error: string | null;
};

function rotationSummary(stamp: RotationStamp | null): RotationSummary | null {
  if (!stamp) return null;
  return {
    at: stamp.at,
    kept: stamp.kept,
    deleted: stamp.deleted,
    error: stamp.error,
  };
}

function offsiteErrorSummary(
  stamp: OffsiteErrorStamp | null,
): { at: string; message: string } | null {
  if (!stamp) return null;
  return { at: stamp.at, message: stamp.message };
}

export type SupportDump = {
  generatedAt: string;
  app: {
    env: string;
    schemaVersion: string;
    embeddingProvider: string;
    blobProvider: string;
  };
  health: {
    ready: boolean;
    checks: { postgres: 'ok' | 'error'; redis: 'ok' | 'error' };
  };
  attention: {
    pendingUsers: number;
    pendingApiClients: number;
    staleBackup: boolean;
    staleBackupAfterHours: number;
    staleOffsite: boolean;
    staleOffsiteAfterHours: number;
  };
  backups: {
    lastSuccessAgeSeconds: number | null;
    lastImportAgeSeconds: number | null;
    lastOffsiteAgeSeconds: number | null;
    lastOffsiteError: { at: string; message: string } | null;
    lastLocalRotation: RotationSummary | null;
    lastS3Rotation: RotationSummary | null;
    artifactCount: number;
    totalBytes: number;
    offsiteEnabled: boolean;
    staleOffsite: boolean;
    staleOffsiteAfterHours: number;
  };
  mcpLast24h: {
    requestCount: number;
    toolCallCount: number;
    toolErrorCount: number;
  };
  recentAuditErrors: RecentMcpAuditError[];
  auditRetention: {
    retentionDays: number;
    source: 'override' | 'env';
    intervalMs: number;
    lastPurgedAt: string | null;
    rowsPurged: number | null;
    rowCount: number;
    tableBytes: number;
  };
};

async function collectDependencyChecks(app: FastifyInstance): Promise<{
  postgres: 'ok' | 'error';
  redis: 'ok' | 'error';
}> {
  const checks: { postgres: 'ok' | 'error'; redis: 'ok' | 'error' } = {
    postgres: 'error',
    redis: 'error',
  };
  try {
    await app.database.ping();
    checks.postgres = 'ok';
  } catch (error) {
    app.log.error({ err: error }, 'Support dump postgres check failed');
  }
  try {
    if ((await app.redis.ping()) === 'PONG') {
      checks.redis = 'ok';
    }
  } catch (error) {
    app.log.error({ err: error }, 'Support dump redis check failed');
  }
  return checks;
}

/** Redacted ops snapshot for Admin support dump and NF-014 external status. */
export async function buildSupportDump(app: FastifyInstance): Promise<SupportDump> {
  const backupDir = app.env.BACKUP_DIR;
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [
    checks,
    schemaVersion,
    pending,
    mcp,
    lastSuccess,
    lastImport,
    lastOffsite,
    lastOffsiteError,
    lastLocalRotation,
    lastS3Rotation,
    artifacts,
    recentErrors,
    alertSettings,
    auditRetention,
  ] = await Promise.all([
    collectDependencyChecks(app),
    getSchemaVersionLabel(app.database),
    getPendingAttention(app.database),
    getMcpActivitySummary(app.database, since24h),
    readStamp(backupDir, 'last-success.json'),
    readStamp(backupDir, 'last-import.json'),
    readOffsiteStamp(backupDir),
    readOffsiteErrorStamp(backupDir),
    readRotationStamp(backupDir, 'local'),
    readRotationStamp(backupDir, 's3'),
    listDumpArtifacts(backupDir),
    getRecentErrorAuditEvents(app.database, since24h),
    loadEffectiveAlertSettings(app.database, app.env),
    readAuditRetentionSnapshot(app.database),
  ]);

  const ready = checks.postgres === 'ok' && checks.redis === 'ok';
  const lastSuccessSummary = stampSummary(lastSuccess);
  const lastImportSummary = stampSummary(lastImport);
  const staleAfterHours = app.env.BACKUP_STALE_AFTER_HOURS;
  const staleBackup = isBackupStale(lastSuccessSummary.ageSeconds, staleAfterHours);
  const { store: blobStore, backupOffsite } = await app.getBlobStore();
  const offsiteEnabled = Boolean(backupOffsite && blobStore.provider !== 'disabled');
  const lastOffsiteAgeSeconds = lastOffsite
    ? stampSummary({
        kind: lastOffsite.kind,
        at: lastOffsite.at,
        artifact: lastOffsite.artifact,
        schemaVersion: lastOffsite.schemaVersion,
        hostname: lastOffsite.hostname,
      }).ageSeconds
    : null;
  const staleOffsiteAfterHours = app.env.BACKUP_OFFSITE_STALE_AFTER_HOURS;
  const staleOffsite = isOffsiteStale(
    lastOffsiteAgeSeconds,
    staleOffsiteAfterHours,
    offsiteEnabled,
  );

  return {
    generatedAt: new Date().toISOString(),
    app: {
      env: app.env.APP_ENV,
      schemaVersion,
      embeddingProvider: app.env.EMBEDDING_PROVIDER,
      blobProvider: blobStore.provider,
    },
    health: {
      ready,
      checks,
    },
    attention: {
      ...pending,
      staleBackup,
      staleBackupAfterHours: staleAfterHours,
      staleOffsite,
      staleOffsiteAfterHours,
    },
    backups: {
      lastSuccessAgeSeconds: lastSuccessSummary.ageSeconds,
      lastImportAgeSeconds: lastImportSummary.ageSeconds,
      lastOffsiteAgeSeconds,
      lastOffsiteError: offsiteErrorSummary(lastOffsiteError),
      lastLocalRotation: rotationSummary(lastLocalRotation),
      lastS3Rotation: rotationSummary(lastS3Rotation),
      artifactCount: artifacts.length,
      totalBytes: artifacts.reduce((sum, item) => sum + item.sizeBytes, 0),
      offsiteEnabled,
      staleOffsite,
      staleOffsiteAfterHours,
    },
    mcpLast24h: {
      requestCount: mcp.requestCount,
      toolCallCount: mcp.toolCallCount,
      toolErrorCount: mcp.toolErrorCount,
    },
    recentAuditErrors: recentErrors,
    auditRetention: {
      retentionDays: alertSettings.effective.auditRetentionDays,
      source: alertSettings.effective.auditRetentionSource,
      intervalMs: alertSettings.effective.auditRetentionIntervalMs,
      lastPurgedAt: auditRetention.lastPurgedAt,
      rowsPurged: auditRetention.rowsPurged,
      rowCount: auditRetention.rowCount,
      tableBytes: auditRetention.tableBytes,
    },
  };
}
