import { createReadStream, promises as fs } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '@project-knowledge-hub/domain';
import { requireSystemAdmin } from '@project-knowledge-hub/permissions';
import {
  assertMutatingOrigin,
  requireAuthenticated,
} from '../plugins/auth.js';
import { getDefaultOrganization, writeAuditEvent } from '../lib/identity.js';
import {
  deleteDumpArtifact,
  dumpFilePath,
  exportDatabaseDump,
  importDatabaseDump,
  isSchedulerHeartbeatFresh,
  listDumpArtifacts,
  readSchedulerHeartbeat,
  readStamp,
  rotateDumpArtifacts,
  saveUploadedDump,
  stampSummary,
} from '../lib/backups.js';
import {
  envRetentionDefaults,
  readRetentionPolicy,
  writeRetentionPolicy,
} from '../lib/backup-retention.js';
import {
  SCHEDULE_INTERVAL_PRESETS,
  envScheduleDefaults,
  readSchedulePolicy,
  writeSchedulePolicy,
} from '../lib/backup-schedule.js';
import {
  readOffsiteStamp,
  syncPendingOffsiteDump,
  uploadDumpOffsiteOrThrow,
} from '../lib/backup-offsite.js';
import {
  countErrorAuditEvents,
  getActiveSessionCount,
  getArchivedEntityCounts,
  getCatalogueUsageSummary,
  getClientLeaderboard,
  getMcpActivitySummary,
  getPendingAttention,
  getRecentErrorAuditEvents,
  getSchemaVersionLabel,
  isBackupStale,
  listActiveWorkspacesForMonitoring,
} from '../lib/monitoring.js';
import { enqueueWorkspaceEmbeddingReindex } from '../lib/embedding-jobs.js';
import { listOnDutyAdmins } from '../lib/signup-pending-notify.js';
import { buildSupportDump } from '../lib/support-dump.js';

const rangeSchema = z.enum(['1h', '24h', '7d']).default('24h');
const opsLogExportQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(7),
});
const OPS_LOG_EXPORT_MAX_ROWS = 5_000;
const retentionBodySchema = z.object({
  keepDaily: z.coerce.number().int().min(1).max(90),
  keepWeekly: z.coerce.number().int().min(0).max(52),
  keepMonthly: z.coerce.number().int().min(0).max(36),
  autoRotate: z.boolean(),
  runNow: z.boolean().optional(),
});
const scheduleBodySchema = z.object({
  enabled: z.boolean(),
  intervalSeconds: z.coerce
    .number()
    .int()
    .refine(
      (value) => (SCHEDULE_INTERVAL_PRESETS as readonly number[]).includes(value),
      { message: 'intervalSeconds must be a supported preset' },
    ),
});

function sinceForRange(range: '1h' | '24h' | '7d'): Date {
  const now = Date.now();
  const ms =
    range === '1h'
      ? 60 * 60 * 1000
      : range === '7d'
        ? 7 * 24 * 60 * 60 * 1000
        : 24 * 60 * 60 * 1000;
  return new Date(now - ms);
}

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
    app.log.error({ err: error }, 'Monitoring postgres check failed');
  }
  try {
    if ((await app.redis.ping()) === 'PONG') {
      checks.redis = 'ok';
    }
  } catch (error) {
    app.log.error({ err: error }, 'Monitoring redis check failed');
  }
  return checks;
}

export async function registerMonitoringRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/admin/monitoring', async (request) => {
    const principal = requireAuthenticated(request);
    requireSystemAdmin(principal);

    const query = z
      .object({ range: rangeSchema.optional() })
      .parse(request.query);
    const range = query.range ?? '24h';
    const backupDir = app.env.BACKUP_DIR;

    const emptyCatalogue = {
      topRecords: [],
      topViewedRecords: [],
      topProjects: [],
      topSystems: [],
      search: { searchCount: 0, topQueryHashes: [] },
    };

    const [
      checks,
      schemaVersion,
      activeSessions,
      pending,
      mcp,
      clients,
      catalogue,
      lastSuccess,
      lastImport,
      lastFailure,
      lastOffsite,
      artifacts,
      retention,
      schedule,
      schedulerHeartbeat,
      archived,
      workspaceOptions,
      onDutyAdmins,
    ] = await Promise.all([
        collectDependencyChecks(app),
        getSchemaVersionLabel(app.database),
        getActiveSessionCount(app.database),
        getPendingAttention(app.database),
        getMcpActivitySummary(app.database, sinceForRange(range)),
        getClientLeaderboard(app.database, sinceForRange(range)).catch((error) => {
          app.log.error({ err: error }, 'Monitoring client leaderboard failed');
          return [];
        }),
        getCatalogueUsageSummary(app.database, sinceForRange(range)).catch((error) => {
          app.log.error({ err: error }, 'Monitoring catalogue summary failed');
          return emptyCatalogue;
        }),
        readStamp(backupDir, 'last-success.json'),
        readStamp(backupDir, 'last-import.json'),
        readStamp(backupDir, 'last-failure.json'),
        readOffsiteStamp(backupDir),
        listDumpArtifacts(backupDir),
        readRetentionPolicy(backupDir, envRetentionDefaults(app.env)),
        readSchedulePolicy(backupDir, envScheduleDefaults(app.env)),
        readSchedulerHeartbeat(backupDir),
        getArchivedEntityCounts(app.database),
        listActiveWorkspacesForMonitoring(app.database),
        listOnDutyAdmins(app.database),
      ]);

    const ready = checks.postgres === 'ok' && checks.redis === 'ok';
    const overall = ready ? 'healthy' : 'degraded';
    const totalBytes = artifacts.reduce((sum, item) => sum + item.sizeBytes, 0);
    let blobProvider: string = 'disabled';
    let backupOffsite = false;
    let offsiteEnabled = false;
    try {
      const resolved = await app.getBlobStore();
      blobProvider = resolved.store.provider;
      backupOffsite = Boolean(resolved.backupOffsite);
      offsiteEnabled = Boolean(
        resolved.backupOffsite && resolved.store.provider !== 'disabled',
      );
    } catch (error) {
      app.log.error({ err: error }, 'Monitoring blob store resolve failed');
    }
    const lastSuccessSummary = stampSummary(lastSuccess);
    const staleAfterHours = app.env.BACKUP_STALE_AFTER_HOURS;
    const staleBackup = isBackupStale(lastSuccessSummary.ageSeconds, staleAfterHours);
    const schedulerHeartbeatSummary = schedulerHeartbeat
      ? {
          stamp: schedulerHeartbeat,
          ageSeconds: stampSummary({
            kind: schedulerHeartbeat.kind,
            at: schedulerHeartbeat.at,
            artifact: '',
            schemaVersion: 'n/a',
            hostname: schedulerHeartbeat.hostname,
          }).ageSeconds,
        }
      : { stamp: null, ageSeconds: null as number | null };
    const schedulerAlive = isSchedulerHeartbeatFresh(
      schedulerHeartbeatSummary.ageSeconds,
    );

    return {
      overall,
      generatedAt: new Date().toISOString(),
      app: {
        env: app.env.APP_ENV,
        apiUrl: app.env.API_URL,
        webUrl: app.env.WEB_URL,
        schemaVersion,
      },
      health: {
        api: 'ok' as const,
        ready,
        checks,
      },
      attention: {
        ...pending,
        staleBackup,
        staleBackupAfterHours: staleAfterHours,
        onDutyAdmins,
      },
      sessions: { active: activeSessions },
      mcp: {
        range,
        ...mcp,
      },
      clients: {
        range,
        leaderboard: clients,
      },
      catalogue: {
        range,
        ...catalogue,
      },
      maintenance: {
        embeddingProvider: app.env.EMBEDDING_PROVIDER,
        workspaces: workspaceOptions,
        archived,
      },
      backups: {
        dir: backupDir,
        toolsHint:
          'Export/import use postgresql-client-16 on the API image (matches Dokploy Postgres 16). Locally, Docker Postgres is used as a fallback when clients are missing.',
        lastSuccess: lastSuccessSummary,
        lastImport: stampSummary(lastImport),
        lastFailure: stampSummary(lastFailure),
        lastOffsite: lastOffsite
          ? {
              stamp: lastOffsite,
              ageSeconds: stampSummary({
                kind: lastOffsite.kind,
                at: lastOffsite.at,
                artifact: lastOffsite.artifact,
                schemaVersion: lastOffsite.schemaVersion,
                hostname: lastOffsite.hostname,
              }).ageSeconds,
            }
          : { stamp: null, ageSeconds: null },
        artifacts,
        totalBytes,
        maxUploadBytes: app.env.BACKUP_MAX_UPLOAD_BYTES,
        retention: {
          ...retention.policy,
          source: retention.source,
        },
        schedule: {
          ...schedule.policy,
          source: schedule.source,
        },
        scheduler: {
          alive: schedulerAlive,
          heartbeat: schedulerHeartbeatSummary,
        },
        offsite: {
          enabled: offsiteEnabled,
          provider: blobProvider,
          auto: backupOffsite,
        },
        staleAfterHours,
      },
    };
  });

  app.post('/api/v1/admin/monitoring/backups/export', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    requireSystemAdmin(principal);

    const schemaVersion = await getSchemaVersionLabel(app.database);
    const result = await exportDatabaseDump({
      backupDir: app.env.BACKUP_DIR,
      databaseUrl: app.env.DATABASE_URL,
      schemaVersion,
    });

    let offsite: { key: string; stamp: { at: string; key: string } } | null = null;
    let offsiteError: string | null = null;
    const { store: blobStore, backupOffsite } = await app.getBlobStore();
    if (backupOffsite && blobStore.provider !== 'disabled') {
      try {
        const uploaded = await uploadDumpOffsiteOrThrow({
          blobStore,
          backupDir: app.env.BACKUP_DIR,
          name: result.artifact.name,
          schemaVersion,
        });
        offsite = { key: uploaded.key, stamp: uploaded.stamp };
      } catch (error) {
        offsiteError =
          error instanceof Error ? error.message : 'Offsite upload failed';
        request.log.warn(
          { err: error, artifact: result.artifact.name },
          'Local dump succeeded; offsite upload failed',
        );
      }
    }

    const { policy } = await readRetentionPolicy(
      app.env.BACKUP_DIR,
      envRetentionDefaults(app.env),
    );
    let rotation: { kept: number; deleted: string[] } | null = null;
    if (policy.autoRotate) {
      rotation = await rotateDumpArtifacts(app.env.BACKUP_DIR, policy);
    }

    const organization = await getDefaultOrganization(app.database);
    await writeAuditEvent(app.database, {
      organizationId: organization?.id ?? null,
      actorType: 'user',
      actorId: principal.userId,
      action: 'backup.export',
      entityType: 'database_backup',
      entityId: result.artifact.name,
      metadata: {
        sizeBytes: result.artifact.sizeBytes,
        schemaVersion,
        rotation,
        offsite,
        offsiteError,
      },
      ipAddress: request.ip,
    });

    return {
      artifact: result.artifact,
      stamp: result.stamp,
      rotation,
      offsite,
      offsiteError,
    };
  });

  app.put('/api/v1/admin/monitoring/backups/retention', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    requireSystemAdmin(principal);
    const body = retentionBodySchema.parse(request.body);

    const policy = await writeRetentionPolicy(app.env.BACKUP_DIR, {
      keepDaily: body.keepDaily,
      keepWeekly: body.keepWeekly,
      keepMonthly: body.keepMonthly,
      autoRotate: body.autoRotate,
    });

    let rotation: { kept: number; deleted: string[] } | null = null;
    if (body.runNow) {
      rotation = await rotateDumpArtifacts(app.env.BACKUP_DIR, policy);
    }

    const organization = await getDefaultOrganization(app.database);
    await writeAuditEvent(app.database, {
      organizationId: organization?.id ?? null,
      actorType: 'user',
      actorId: principal.userId,
      action: 'backup.retention_update',
      entityType: 'database_backup',
      entityId: 'retention',
      metadata: { policy, rotation },
      ipAddress: request.ip,
    });

    return { retention: { ...policy, source: 'file' as const }, rotation };
  });

  app.put('/api/v1/admin/monitoring/backups/schedule', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    requireSystemAdmin(principal);
    const body = scheduleBodySchema.parse(request.body);

    const policy = await writeSchedulePolicy(app.env.BACKUP_DIR, {
      enabled: body.enabled,
      intervalSeconds: body.intervalSeconds,
    });

    const organization = await getDefaultOrganization(app.database);
    await writeAuditEvent(app.database, {
      organizationId: organization?.id ?? null,
      actorType: 'user',
      actorId: principal.userId,
      action: 'backup.schedule_update',
      entityType: 'database_backup',
      entityId: 'schedule',
      metadata: { ...policy },
      ipAddress: request.ip,
    });

    return { schedule: { ...policy, source: 'file' as const } };
  });

  app.post('/api/v1/admin/monitoring/backups/rotate', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    requireSystemAdmin(principal);

    const { policy } = await readRetentionPolicy(
      app.env.BACKUP_DIR,
      envRetentionDefaults(app.env),
    );
    const rotation = await rotateDumpArtifacts(app.env.BACKUP_DIR, policy);

    const organization = await getDefaultOrganization(app.database);
    await writeAuditEvent(app.database, {
      organizationId: organization?.id ?? null,
      actorType: 'user',
      actorId: principal.userId,
      action: 'backup.rotate',
      entityType: 'database_backup',
      entityId: 'retention',
      metadata: { policy, rotation },
      ipAddress: request.ip,
    });

    return { retention: { ...policy }, rotation };
  });

  app.post('/api/v1/admin/monitoring/backups/:name/offsite', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    requireSystemAdmin(principal);
    const params = z.object({ name: z.string().min(1).max(200) }).parse(request.params);
    const schemaVersion = await getSchemaVersionLabel(app.database);
    const { store: blobStore } = await app.getBlobStore();

    const uploaded = await uploadDumpOffsiteOrThrow({
      blobStore,
      backupDir: app.env.BACKUP_DIR,
      name: params.name,
      schemaVersion,
    });

    const organization = await getDefaultOrganization(app.database);
    await writeAuditEvent(app.database, {
      organizationId: organization?.id ?? null,
      actorType: 'user',
      actorId: principal.userId,
      action: 'backup.offsite',
      entityType: 'database_backup',
      entityId: params.name,
      metadata: { key: uploaded.key, provider: uploaded.stamp.provider },
      ipAddress: request.ip,
    });

    return { key: uploaded.key, stamp: uploaded.stamp };
  });

  app.post('/api/v1/admin/monitoring/backups/offsite-sync', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    requireSystemAdmin(principal);
    const schemaVersion = await getSchemaVersionLabel(app.database);
    const { store: blobStore } = await app.getBlobStore();
    const result = await syncPendingOffsiteDump({
      blobStore,
      backupDir: app.env.BACKUP_DIR,
      schemaVersion,
    });
    return result;
  });

  app.get('/api/v1/admin/monitoring/backups/:name/download', async (request, reply) => {
    const principal = requireAuthenticated(request);
    requireSystemAdmin(principal);
    const params = z.object({ name: z.string().min(1).max(200) }).parse(request.params);
    const filePath = dumpFilePath(app.env.BACKUP_DIR, params.name);

    try {
      await fs.access(filePath);
    } catch {
      throw new AppError({
        code: 'BACKUP_NOT_FOUND',
        message: 'Dump artifact not found',
        statusCode: 404,
      });
    }

    const organization = await getDefaultOrganization(app.database);
    await writeAuditEvent(app.database, {
      organizationId: organization?.id ?? null,
      actorType: 'user',
      actorId: principal.userId,
      action: 'backup.download',
      entityType: 'database_backup',
      entityId: params.name,
      metadata: {},
      ipAddress: request.ip,
    });

    reply.header('Content-Type', 'application/octet-stream');
    reply.header('Content-Disposition', `attachment; filename="${params.name}"`);
    return reply.send(createReadStream(filePath));
  });

  app.delete('/api/v1/admin/monitoring/backups/:name', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    requireSystemAdmin(principal);
    const params = z.object({ name: z.string().min(1).max(200) }).parse(request.params);

    await deleteDumpArtifact(app.env.BACKUP_DIR, params.name);

    const organization = await getDefaultOrganization(app.database);
    await writeAuditEvent(app.database, {
      organizationId: organization?.id ?? null,
      actorType: 'user',
      actorId: principal.userId,
      action: 'backup.delete',
      entityType: 'database_backup',
      entityId: params.name,
      metadata: {},
      ipAddress: request.ip,
    });

    return { deleted: params.name };
  });

  app.post('/api/v1/admin/monitoring/backups/import', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    requireSystemAdmin(principal);

    const contentType = request.headers['content-type'] ?? '';
    let confirmPhrase = '';
    let artifactName = '';

    if (contentType.includes('multipart/form-data')) {
      const parts = request.parts();
      let uploadBuffer: Buffer | null = null;
      let uploadName: string | undefined;
      for await (const part of parts) {
        if (part.type === 'file') {
          uploadBuffer = await part.toBuffer();
          uploadName = part.filename;
        } else if (part.type === 'field') {
          const value = String(part.value ?? '');
          if (part.fieldname === 'confirmPhrase') confirmPhrase = value;
          if (part.fieldname === 'artifact') artifactName = value;
        }
      }
      if (confirmPhrase !== 'REPLACE') {
        throw new AppError({
          code: 'BACKUP_CONFIRM_REQUIRED',
          message: 'Set confirmPhrase to REPLACE for full-database import',
          statusCode: 400,
        });
      }
      if (uploadBuffer) {
        if (uploadBuffer.byteLength === 0) {
          throw new AppError({
            code: 'BACKUP_UPLOAD_EMPTY',
            message: 'Uploaded dump is empty',
            statusCode: 400,
          });
        }
        if (uploadBuffer.byteLength > app.env.BACKUP_MAX_UPLOAD_BYTES) {
          throw new AppError({
            code: 'BACKUP_UPLOAD_TOO_LARGE',
            message: `Dump exceeds BACKUP_MAX_UPLOAD_BYTES (${app.env.BACKUP_MAX_UPLOAD_BYTES})`,
            statusCode: 400,
          });
        }
        artifactName = await saveUploadedDump(
          app.env.BACKUP_DIR,
          uploadBuffer,
          uploadName,
        );
      }
    } else {
      const body = z
        .object({
          confirmPhrase: z.literal('REPLACE'),
          artifact: z.string().min(1).max(200),
        })
        .parse(request.body);
      confirmPhrase = body.confirmPhrase;
      artifactName = body.artifact;
    }

    if (confirmPhrase !== 'REPLACE' || !artifactName) {
      throw new AppError({
        code: 'BACKUP_CONFIRM_REQUIRED',
        message: 'Import requires confirmPhrase=REPLACE and an artifact name or upload',
        statusCode: 400,
      });
    }

    const dumpPath = dumpFilePath(app.env.BACKUP_DIR, artifactName);
    try {
      await fs.access(dumpPath);
    } catch {
      throw new AppError({
        code: 'BACKUP_NOT_FOUND',
        message: 'Dump artifact not found',
        statusCode: 404,
      });
    }

    const schemaVersion = await getSchemaVersionLabel(app.database);
    const result = await importDatabaseDump({
      backupDir: app.env.BACKUP_DIR,
      databaseUrl: app.env.DATABASE_URL,
      dumpPath,
      schemaVersion,
    });

    try {
      const organization = await getDefaultOrganization(app.database);
      await writeAuditEvent(app.database, {
        organizationId: organization?.id ?? null,
        actorType: 'user',
        actorId: principal.userId,
        action: 'backup.import',
        entityType: 'database_backup',
        entityId: artifactName,
        metadata: { schemaVersion: result.stamp.schemaVersion },
        ipAddress: request.ip,
      });
    } catch (error) {
      request.log.warn(
        { err: error },
        'Import succeeded but audit write failed (expected if connections were reset)',
      );
    }

    // Fresh pools after --clean replace; Docker restarts this process (unless-stopped).
    setTimeout(() => {
      void app.database
        .close()
        .catch(() => undefined)
        .finally(() => {
          process.exit(0);
        });
    }, 750);

    const restartHint =
      'Import finished. API is restarting; restart worker (and web if needed) in Dokploy, then log in with users from the imported dump.';
    return {
      artifact: artifactName,
      stamp: result.stamp,
      restartRequired: true,
      warning: result.journalWarning
        ? `${restartHint} ${result.journalWarning}`
        : restartHint,
    };
  });

  app.post('/api/v1/admin/monitoring/embeddings/reindex', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    requireSystemAdmin(principal);
    const body = z
      .object({
        workspaceId: z.string().uuid().optional(),
        force: z.boolean().optional(),
      })
      .parse(request.body ?? {});

    if (app.env.EMBEDDING_PROVIDER === 'disabled') {
      return { enqueued: false as const, reason: 'provider_disabled' as const, jobs: [] };
    }

    const targets = body.workspaceId
      ? [{ id: body.workspaceId }]
      : await listActiveWorkspacesForMonitoring(app.database);

    const jobs: Array<{ workspaceId: string; jobId: string }> = [];
    for (const workspace of targets) {
      const jobId = await enqueueWorkspaceEmbeddingReindex(app, workspace.id, {
        force: body.force,
      });
      jobs.push({ workspaceId: workspace.id, jobId });
    }

    const organization = await getDefaultOrganization(app.database);
    await writeAuditEvent(app.database, {
      organizationId: organization?.id ?? null,
      actorType: 'user',
      actorId: principal.userId,
      action: 'monitoring.embeddings_reindex',
      entityType: 'embeddings',
      entityId: body.workspaceId ?? 'all',
      metadata: { jobCount: jobs.length, force: Boolean(body.force) },
      ipAddress: request.ip,
    });

    return { enqueued: true as const, reason: null, jobs };
  });

  app.get('/api/v1/admin/monitoring/support-dump', async (request, reply) => {
    const principal = requireAuthenticated(request);
    requireSystemAdmin(principal);

    const dump = await buildSupportDump(app);

    const organization = await getDefaultOrganization(app.database);
    await writeAuditEvent(app.database, {
      organizationId: organization?.id ?? null,
      actorType: 'user',
      actorId: principal.userId,
      action: 'monitoring.support_dump',
      entityType: 'monitoring',
      entityId: 'support-dump',
      metadata: { byteLength: JSON.stringify(dump).length },
      ipAddress: request.ip,
    });

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    reply.header(
      'Content-Disposition',
      `attachment; filename="knowhub-support-${stamp}.json"`,
    );
    return dump;
  });

  /**
   * NF-009 — downloadable ops log package (support dump + error-like audits).
   * Not container stdout; use Dokploy for raw process logs. Full audit CSV/JSON
   * remains on Admin → Audit.
   */
  app.get('/api/v1/admin/monitoring/ops-log-export', async (request, reply) => {
    const principal = requireAuthenticated(request);
    requireSystemAdmin(principal);
    const query = opsLogExportQuerySchema.parse(request.query);
    const since = new Date(Date.now() - query.days * 24 * 60 * 60 * 1000);

    const [support, totalMatching, auditErrors] = await Promise.all([
      buildSupportDump(app),
      countErrorAuditEvents(app.database, since),
      getRecentErrorAuditEvents(
        app.database,
        since,
        OPS_LOG_EXPORT_MAX_ROWS,
      ),
    ]);

    const payload = {
      generatedAt: new Date().toISOString(),
      kind: 'knowhub-ops-log-export' as const,
      window: {
        days: query.days,
        since: since.toISOString(),
      },
      retention: {
        auditRetentionDays: app.env.AUDIT_RETENTION_DAYS,
      },
      support,
      auditErrors: {
        totalMatching,
        exportedCount: auditErrors.length,
        truncated: totalMatching > auditErrors.length,
        maxRows: OPS_LOG_EXPORT_MAX_ROWS,
        events: auditErrors,
      },
    };

    const organization = await getDefaultOrganization(app.database);
    await writeAuditEvent(app.database, {
      organizationId: organization?.id ?? null,
      actorType: 'user',
      actorId: principal.userId,
      action: 'monitoring.ops_log_export',
      entityType: 'monitoring',
      entityId: 'ops-log-export',
      metadata: {
        days: query.days,
        exportedCount: auditErrors.length,
        totalMatching,
        truncated: totalMatching > auditErrors.length,
      },
      ipAddress: request.ip,
    });

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    reply.header(
      'Content-Disposition',
      `attachment; filename="knowhub-ops-log-${query.days}d-${stamp}.json"`,
    );
    return payload;
  });
}
