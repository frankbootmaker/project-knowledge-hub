import type { FastifyInstance } from 'fastify';
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
} from './monitoring.js';

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
  };
  backups: {
    lastSuccessAgeSeconds: number | null;
    lastImportAgeSeconds: number | null;
    lastOffsiteAgeSeconds: number | null;
    artifactCount: number;
    totalBytes: number;
    offsiteEnabled: boolean;
  };
  mcpLast24h: {
    requestCount: number;
    toolCallCount: number;
    toolErrorCount: number;
  };
  recentAuditErrors: Array<{
    id: string;
    action: string;
    entityType: string;
    entityId: string | null;
    createdAt: string;
  }>;
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
    artifacts,
    recentErrors,
  ] = await Promise.all([
    collectDependencyChecks(app),
    getSchemaVersionLabel(app.database),
    getPendingAttention(app.database),
    getMcpActivitySummary(app.database, since24h),
    readStamp(backupDir, 'last-success.json'),
    readStamp(backupDir, 'last-import.json'),
    readOffsiteStamp(backupDir),
    listDumpArtifacts(backupDir),
    getRecentErrorAuditEvents(app.database, since24h),
  ]);

  const ready = checks.postgres === 'ok' && checks.redis === 'ok';
  const lastSuccessSummary = stampSummary(lastSuccess);
  const lastImportSummary = stampSummary(lastImport);
  const staleAfterHours = app.env.BACKUP_STALE_AFTER_HOURS;
  const staleBackup = isBackupStale(lastSuccessSummary.ageSeconds, staleAfterHours);
  const { store: blobStore, backupOffsite } = await app.getBlobStore();

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
    },
    backups: {
      lastSuccessAgeSeconds: lastSuccessSummary.ageSeconds,
      lastImportAgeSeconds: lastImportSummary.ageSeconds,
      lastOffsiteAgeSeconds: lastOffsite
        ? stampSummary({
            kind: lastOffsite.kind,
            at: lastOffsite.at,
            artifact: lastOffsite.artifact,
            schemaVersion: lastOffsite.schemaVersion,
            hostname: lastOffsite.hostname,
          }).ageSeconds
        : null,
      artifactCount: artifacts.length,
      totalBytes: artifacts.reduce((sum, item) => sum + item.sizeBytes, 0),
      offsiteEnabled: Boolean(backupOffsite && blobStore.provider !== 'disabled'),
    },
    mcpLast24h: {
      requestCount: mcp.requestCount,
      toolCallCount: mcp.toolCallCount,
      toolErrorCount: mcp.toolErrorCount,
    },
    recentAuditErrors: recentErrors,
  };
}
