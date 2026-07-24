import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { workspaces } from '@project-knowledge-hub/database';
import { AppError } from '@project-knowledge-hub/domain';
import {
  requireWorkspaceMaintainer,
  requireWorkspaceView,
} from '@project-knowledge-hub/permissions';
import {
  assertMutatingOrigin,
  requireAuthenticated,
} from '../plugins/auth.js';
import { writeAuditEvent } from '../lib/identity.js';
import {
  archiveWorkspaceMedia,
  createWorkspaceMedia,
  getWorkspaceMediaById,
  listWorkspaceMedia,
  readMediaBytes,
  toPublicMedia,
  updateWorkspaceMedia,
} from '../lib/workspace-media.js';

async function organizationIdForWorkspace(
  app: FastifyInstance,
  workspaceId: string,
): Promise<string | null> {
  const [row] = await app.database.db
    .select({ organizationId: workspaces.organizationId })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  return row?.organizationId ?? null;
}

export async function registerWorkspaceMediaRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.post('/api/v1/workspaces/:workspaceId/media', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    const params = z
      .object({ workspaceId: z.string().uuid() })
      .parse(request.params);
    requireWorkspaceMaintainer(principal, params.workspaceId);

    const parts = request.parts();
    let uploadBuffer: Buffer | null = null;
    let uploadName: string | undefined;
    let contentType = '';
    let knowledgeRecordId: string | undefined;
    let alt: string | undefined;

    for await (const part of parts) {
      if (part.type === 'file') {
        uploadBuffer = await part.toBuffer();
        uploadName = part.filename;
        contentType = part.mimetype;
      } else if (part.type === 'field') {
        const value = String(part.value ?? '');
        if (part.fieldname === 'knowledgeRecordId' && value) {
          knowledgeRecordId = z.string().uuid().parse(value);
        }
        if (part.fieldname === 'alt' && value) {
          alt = value;
        }
        if (part.fieldname === 'contentType' && value) {
          contentType = value;
        }
      }
    }

    if (!uploadBuffer) {
      throw new AppError({
        code: 'MEDIA_REQUIRED',
        message: 'Media image file is required',
        statusCode: 400,
      });
    }

    const { store: blobStore } = await app.getBlobStore();
    const row = await createWorkspaceMedia(app.database, {
      workspaceId: params.workspaceId,
      knowledgeRecordId: knowledgeRecordId ?? null,
      contentType,
      buffer: uploadBuffer,
      originalFilename: uploadName ?? null,
      altText: alt ?? null,
      createdBy: principal.userId,
      uploadDir: app.env.MEDIA_UPLOAD_DIR,
      maxBytes: app.env.MEDIA_MAX_BYTES,
      blobStore,
    });

    await writeAuditEvent(app.database, {
      organizationId: await organizationIdForWorkspace(app, params.workspaceId),
      actorType: 'user',
      actorId: principal.userId,
      action: 'media.upload',
      entityType: 'workspace_media',
      entityId: row.id,
      metadata: {
        workspaceId: params.workspaceId,
        knowledgeRecordId: row.knowledgeRecordId,
        contentType: row.contentType,
        byteSize: row.byteSize,
      },
      ipAddress: request.ip,
    });

    return { media: toPublicMedia(row) };
  });

  app.get('/api/v1/workspaces/:workspaceId/media', async (request) => {
    const principal = requireAuthenticated(request);
    const params = z
      .object({ workspaceId: z.string().uuid() })
      .parse(request.params);
    requireWorkspaceView(principal, params.workspaceId);

    const query = z
      .object({
        recordId: z.string().uuid().optional(),
        limit: z.coerce.number().int().min(1).max(100).optional(),
      })
      .parse(request.query);

    const rows = await listWorkspaceMedia(app.database, {
      workspaceId: params.workspaceId,
      knowledgeRecordId: query.recordId,
      limit: query.limit,
    });

    return { media: rows.map(toPublicMedia) };
  });

  app.get('/api/v1/media/:mediaId', async (request, reply) => {
    const principal = requireAuthenticated(request);
    const params = z.object({ mediaId: z.string().uuid() }).parse(request.params);

    const row = await getWorkspaceMediaById(app.database, params.mediaId);
    if (!row) {
      throw new AppError({
        code: 'MEDIA_NOT_FOUND',
        message: 'Media not found',
        statusCode: 404,
      });
    }
    requireWorkspaceView(principal, row.workspaceId);

    const { store: blobStore } = await app.getBlobStore();
    const buffer = await readMediaBytes(
      app.env.MEDIA_UPLOAD_DIR,
      row.workspaceId,
      row.id,
      { blobStore },
    );
    if (!buffer) {
      throw new AppError({
        code: 'MEDIA_NOT_FOUND',
        message: 'Media bytes not found',
        statusCode: 404,
      });
    }

    reply.header('Content-Type', row.contentType);
    reply.header('Cache-Control', 'private, max-age=3600');
    if (row.originalFilename) {
      reply.header(
        'Content-Disposition',
        `inline; filename="${row.originalFilename.replace(/"/g, '')}"`,
      );
    }
    return reply.send(buffer);
  });

  app.patch('/api/v1/media/:mediaId', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    const params = z.object({ mediaId: z.string().uuid() }).parse(request.params);
    const body = z
      .object({
        knowledgeRecordId: z.string().uuid().nullable().optional(),
        altText: z.string().max(300).nullable().optional(),
      })
      .parse(request.body ?? {});

    const existing = await getWorkspaceMediaById(app.database, params.mediaId);
    if (!existing) {
      throw new AppError({
        code: 'MEDIA_NOT_FOUND',
        message: 'Media not found',
        statusCode: 404,
      });
    }
    requireWorkspaceMaintainer(principal, existing.workspaceId);

    const updated = await updateWorkspaceMedia(app.database, params.mediaId, body);

    await writeAuditEvent(app.database, {
      organizationId: await organizationIdForWorkspace(app, existing.workspaceId),
      actorType: 'user',
      actorId: principal.userId,
      action: 'media.update',
      entityType: 'workspace_media',
      entityId: updated.id,
      metadata: {
        knowledgeRecordId: updated.knowledgeRecordId,
        altText: updated.altText,
      },
      ipAddress: request.ip,
    });

    return { media: toPublicMedia(updated) };
  });

  app.delete('/api/v1/media/:mediaId', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    const params = z.object({ mediaId: z.string().uuid() }).parse(request.params);

    const existing = await getWorkspaceMediaById(app.database, params.mediaId);
    if (!existing) {
      throw new AppError({
        code: 'MEDIA_NOT_FOUND',
        message: 'Media not found',
        statusCode: 404,
      });
    }
    requireWorkspaceMaintainer(principal, existing.workspaceId);

    const { store: blobStore } = await app.getBlobStore();
    const archived = await archiveWorkspaceMedia(app.database, {
      mediaId: params.mediaId,
      uploadDir: app.env.MEDIA_UPLOAD_DIR,
      blobStore,
    });

    await writeAuditEvent(app.database, {
      organizationId: await organizationIdForWorkspace(app, existing.workspaceId),
      actorType: 'user',
      actorId: principal.userId,
      action: 'media.delete',
      entityType: 'workspace_media',
      entityId: archived.id,
      metadata: { workspaceId: archived.workspaceId },
      ipAddress: request.ip,
    });

    return { media: toPublicMedia(archived) };
  });
}
