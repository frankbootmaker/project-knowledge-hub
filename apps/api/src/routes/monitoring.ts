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
  listDumpArtifacts,
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
  readOffsiteStamp,
  syncPendingOffsiteDump,
  uploadDumpOffsiteOrThrow,
} from '../lib/backup-offsite.js';
import {
  getActiveSessionCount,
  getMcpActivitySummary,
  getPendingAttention,
  getSchemaVersionLabel,
} from '../lib/monitoring.js';

const rangeSchema = z.enum(['1h', '24h', '7d']).default('24h');
const retentionBodySchema = z.object({
  keepDaily: z.coerce.number().int().min(1).max(90),
  keepWeekly: z.coerce.number().int().min(0).max(52),
  keepMonthly: z.coerce.number().int().min(0).max(36),
  autoRotate: z.boolean(),
  runNow: z.boolean().optional(),
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

    const [
      checks,
      schemaVersion,
      activeSessions,
      pending,
      mcp,
      lastSuccess,
      lastImport,
      lastOffsite,
      artifacts,
      retention,
    ] = await Promise.all([
        collectDependencyChecks(app),
        getSchemaVersionLabel(app.database),
        getActiveSessionCount(app.database),
        getPendingAttention(app.database),
        getMcpActivitySummary(app.database, sinceForRange(range)),
        readStamp(backupDir, 'last-success.json'),
        readStamp(backupDir, 'last-import.json'),
        readOffsiteStamp(backupDir),
        listDumpArtifacts(backupDir),
        readRetentionPolicy(backupDir, envRetentionDefaults(app.env)),
      ]);

    const ready = checks.postgres === 'ok' && checks.redis === 'ok';
    const overall = ready ? 'healthy' : 'degraded';
    const totalBytes = artifacts.reduce((sum, item) => sum + item.sizeBytes, 0);
    const { store: blobStore, backupOffsite } = await app.getBlobStore();
    const offsiteEnabled = backupOffsite && blobStore.provider !== 'disabled';

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
      attention: pending,
      sessions: { active: activeSessions },
      mcp: {
        range,
        ...mcp,
      },
      backups: {
        dir: backupDir,
        toolsHint:
          'Export/import use pg_dump/pg_restore on the API host (Dokploy api image includes postgresql-client). Locally, Docker Postgres is used as a fallback when clients are missing.',
        lastSuccess: stampSummary(lastSuccess),
        lastImport: stampSummary(lastImport),
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
        offsite: {
          enabled: offsiteEnabled,
          provider: blobStore.provider,
          auto: backupOffsite,
        },
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
    const { store: blobStore, backupOffsite } = await app.getBlobStore();
    if (backupOffsite && blobStore.provider !== 'disabled') {
      const uploaded = await uploadDumpOffsiteOrThrow({
        blobStore,
        backupDir: app.env.BACKUP_DIR,
        name: result.artifact.name,
        schemaVersion,
      });
      offsite = { key: uploaded.key, stamp: uploaded.stamp };
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
      },
      ipAddress: request.ip,
    });

    return { artifact: result.artifact, stamp: result.stamp, rotation, offsite };
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

    return {
      artifact: artifactName,
      stamp: result.stamp,
      warning:
        'Full replace import completed. Re-check WEB_URL/secrets, run migrate if needed, then smoke-test login.',
    };
  });
}
