import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireSystemAdmin } from '@project-knowledge-hub/permissions';
import {
  assertMutatingOrigin,
  requireAuthenticated,
} from '../plugins/auth.js';
import { getDefaultOrganization, writeAuditEvent } from '../lib/identity.js';
import { migrateLocalBlobsToS3 } from '../lib/blob-migrate.js';
import { summarizeLocalBlobUsage } from '../lib/blob-usage.js';
import {
  BLOB_SETTINGS_KEY,
  clearStoredBlobSettings,
  getPublicBlobSettings,
  resolveBlobStore,
  setStoredBlobSettings,
  testBlobConnection,
} from '../lib/blob-settings.js';

const providerSchema = z.enum(['disabled', 's3']);

const updateBlobSettingsSchema = z.object({
  provider: providerSchema,
  backupOffsite: z.boolean(),
  s3Bucket: z.string().max(320).optional(),
  s3Region: z.string().max(120).optional(),
  s3Endpoint: z.string().max(500).optional(),
  s3ForcePathStyle: z.boolean().optional(),
  keyPrefix: z.string().max(200).optional(),
  /** Omit to keep; empty ignored; null clears. */
  s3AccessKeyId: z.string().max(500).nullable().optional(),
  s3SecretAccessKey: z.string().max(500).nullable().optional(),
});

export async function registerBlobSettingsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/admin/storage-settings', async (request) => {
    const principal = requireAuthenticated(request);
    requireSystemAdmin(principal);
    const settings = await getPublicBlobSettings(app.database, app.env);
    const usage = await summarizeLocalBlobUsage({
      avatarUploadDir: app.env.AVATAR_UPLOAD_DIR,
      mediaUploadDir: app.env.MEDIA_UPLOAD_DIR,
      documentImportDir: app.env.DOCUMENT_IMPORT_DIR,
      stylePackUploadDir: app.env.STYLE_PACK_UPLOAD_DIR,
    });
    return { settings, usage };
  });

  app.put('/api/v1/admin/storage-settings', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    requireSystemAdmin(principal);
    const body = updateBlobSettingsSchema.parse(request.body);

    const settings = await setStoredBlobSettings(
      app.database,
      app.env,
      {
        provider: body.provider,
        backupOffsite: body.backupOffsite,
        s3Bucket: body.s3Bucket,
        s3Region: body.s3Region,
        s3Endpoint: body.s3Endpoint,
        s3ForcePathStyle: body.s3ForcePathStyle,
        keyPrefix: body.keyPrefix,
        s3AccessKeyId: body.s3AccessKeyId,
        s3SecretAccessKey: body.s3SecretAccessKey,
      },
      principal.userId,
    );

    const organization = await getDefaultOrganization(app.database);
    await writeAuditEvent(app.database, {
      organizationId: organization?.id ?? null,
      actorType: 'user',
      actorId: principal.userId,
      action: 'storage.settings_update',
      entityType: 'platform_settings',
      entityId: BLOB_SETTINGS_KEY,
      metadata: {
        provider: settings.provider,
        backupOffsite: settings.backupOffsite,
        s3Bucket: settings.s3Bucket || null,
        s3Endpoint: settings.s3Endpoint || null,
        source: settings.source,
      },
      ipAddress: request.ip,
    });

    return { settings };
  });

  app.delete('/api/v1/admin/storage-settings', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    requireSystemAdmin(principal);
    await clearStoredBlobSettings(app.database);

    const organization = await getDefaultOrganization(app.database);
    await writeAuditEvent(app.database, {
      organizationId: organization?.id ?? null,
      actorType: 'user',
      actorId: principal.userId,
      action: 'storage.settings_reset',
      entityType: 'platform_settings',
      entityId: BLOB_SETTINGS_KEY,
      metadata: {},
      ipAddress: request.ip,
    });

    const settings = await getPublicBlobSettings(app.database, app.env);
    return { settings };
  });

  app.post('/api/v1/admin/storage-settings/test', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    requireSystemAdmin(principal);
    const result = await testBlobConnection(app.database, app.env);

    const organization = await getDefaultOrganization(app.database);
    await writeAuditEvent(app.database, {
      organizationId: organization?.id ?? null,
      actorType: 'user',
      actorId: principal.userId,
      action: 'storage.connection_test',
      entityType: 'platform_settings',
      entityId: BLOB_SETTINGS_KEY,
      metadata: { provider: result.provider, key: result.key },
      ipAddress: request.ip,
    });

    return result;
  });

  app.post('/api/v1/admin/storage-settings/migrate-local', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    requireSystemAdmin(principal);

    const { store } = await resolveBlobStore(app.database, app.env);
    const result = await migrateLocalBlobsToS3(store, {
      avatarUploadDir: app.env.AVATAR_UPLOAD_DIR,
      mediaUploadDir: app.env.MEDIA_UPLOAD_DIR,
      documentImportDir: app.env.DOCUMENT_IMPORT_DIR,
      stylePackUploadDir: app.env.STYLE_PACK_UPLOAD_DIR,
    });

    const organization = await getDefaultOrganization(app.database);
    await writeAuditEvent(app.database, {
      organizationId: organization?.id ?? null,
      actorType: 'user',
      actorId: principal.userId,
      action: 'storage.migrate_local',
      entityType: 'platform_settings',
      entityId: BLOB_SETTINGS_KEY,
      metadata: {
        uploaded: result.uploaded,
        skipped: result.skipped,
        failed: result.failed,
        errorCount: result.errors.length,
      },
      ipAddress: request.ip,
    });

    return { result };
  });
}
