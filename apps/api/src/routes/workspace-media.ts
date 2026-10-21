import type { FastifyInstance, FastifyReply } from 'fastify';
import { eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { users, workspaces } from '@project-knowledge-hub/database';
import { AppError, itemMediaEntityTypeSchema } from '@project-knowledge-hub/domain';
import {
  requireWorkspaceMaintainer,
  requireWorkspaceView,
} from '@project-knowledge-hub/permissions';
import {
  assertMutatingOrigin,
  requireAuthenticated,
} from '../plugins/auth.js';
import { writeAuditEvent } from '../lib/identity.js';
import { getEffectiveMediaMaxBytes } from '../lib/media-max-bytes.js';
import { verifyMediaRead } from '../lib/media-signed-url.js';
import { appendMediaLink, mediaUsedBy } from '../lib/project-item-media.js';
import {
  archiveWorkspaceMedia,
  createWorkspaceMedia,
  getWorkspaceMediaById,
  listWorkspaceMedia,
  mediaByteLocation,
  readMediaBytes,
  toPublicMedia,
  updateWorkspaceMedia,
  type WorkspaceMediaRow,
} from '../lib/workspace-media.js';

async function displayNamesByUserId(
  app: FastifyInstance,
  userIds: Array<string | null>,
): Promise<Map<string, string>> {
  const ids = [...new Set(userIds.filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return new Map();
  const rows = await app.database.db
    .select({ id: users.id, displayName: users.displayName })
    .from(users)
    .where(inArray(users.id, ids));
  return new Map(rows.map((row) => [row.id, row.displayName]));
}

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

async function sendMediaBytes(
  app: FastifyInstance,
  reply: FastifyReply,
  row: WorkspaceMediaRow,
  signed: boolean,
) {
  const { store: blobStore } = await app.getBlobStore();
  const location = mediaByteLocation(row);
  const buffer = await readMediaBytes(
    app.env.MEDIA_UPLOAD_DIR,
    location.workspaceId,
    location.mediaId,
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
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('Cache-Control', signed ? 'private, no-store' : 'private, max-age=3600');
  if (row.originalFilename) {
    reply.header(
      'Content-Disposition',
      `inline; filename="${row.originalFilename.replace(/"/g, '')}"`,
    );
  }
  return reply.send(buffer);
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
    let entityType: z.infer<typeof itemMediaEntityTypeSchema> | undefined;
    let entityId: string | undefined;

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
        if (part.fieldname === 'entityType' && value) {
          entityType = itemMediaEntityTypeSchema.parse(value);
        }
        if (part.fieldname === 'entityId' && value) {
          entityId = z.string().uuid().parse(value);
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
    if (Boolean(entityType) !== Boolean(entityId)) {
      throw new AppError({
        code: 'VALIDATION_ERROR',
        message: 'entityType and entityId must be sent together',
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
      maxBytes: await getEffectiveMediaMaxBytes(
        app.database,
        app.env.MEDIA_MAX_BYTES,
      ),
      blobStore,
    });
    if (entityType && entityId) {
      await appendMediaLink(app.database, {
        workspaceId: params.workspaceId,
        mediaId: row.id,
        entityType,
        entityId,
        createdBy: principal.userId,
      });
    }

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
        q: z.string().max(200).optional(),
        entityType: itemMediaEntityTypeSchema.optional(),
        entityId: z.string().uuid().optional(),
        limit: z.coerce.number().int().min(1).max(100).optional(),
      })
      .parse(request.query);
    if (Boolean(query.entityType) !== Boolean(query.entityId)) {
      throw new AppError({
        code: 'VALIDATION_ERROR',
        message: 'entityType and entityId must be sent together',
        statusCode: 400,
      });
    }

    const rows = await listWorkspaceMedia(app.database, {
      workspaceId: params.workspaceId,
      knowledgeRecordId: query.recordId,
      query: query.q,
      entityType: query.entityType,
      entityId: query.entityId,
      limit: query.limit,
    });
    const [usedBy, uploaderNames] = await Promise.all([
      mediaUsedBy(
        app.database,
        rows.map((row) => row.id),
      ),
      displayNamesByUserId(
        app,
        rows.map((row) => row.createdBy),
      ),
    ]);

    return {
      media: rows.map((row) => ({
        ...toPublicMedia(row),
        createdByName: row.createdBy
          ? (uploaderNames.get(row.createdBy) ?? null)
          : null,
        usedBy: usedBy.get(row.id) ?? [],
      })),
    };
  });

  app.get('/api/v1/media/:mediaId', async (request, reply) => {
    const params = z.object({ mediaId: z.string().uuid() }).parse(request.params);
    const query = z
      .object({
        exp: z.string().max(16).optional(),
        sig: z.string().max(200).optional(),
      })
      .parse(request.query ?? {});
    const hasSignature = Boolean(query.exp || query.sig);

    if (!hasSignature) {
      const principal = requireAuthenticated(request);
      const row = await getWorkspaceMediaById(app.database, params.mediaId);
      if (!row) {
        throw new AppError({
          code: 'MEDIA_NOT_FOUND',
          message: 'Media not found',
          statusCode: 404,
        });
      }
      requireWorkspaceView(principal, row.workspaceId);
      return sendMediaBytes(app, reply, row, false);
    }

    const row = await getWorkspaceMediaById(app.database, params.mediaId);
    if (!row) {
      if (!request.principal) {
        throw new AppError({
          code: 'UNAUTHENTICATED',
          message: 'Authentication is required',
          statusCode: 401,
        });
      }
      throw new AppError({
        code: 'MEDIA_NOT_FOUND',
        message: 'Media not found',
        statusCode: 404,
      });
    }

    const signatureOk = query.exp && query.sig
      ? verifyMediaRead({
          secret: app.env.SESSION_SECRET,
          mediaId: row.id,
          workspaceId: row.workspaceId,
          exp: query.exp,
          sig: query.sig,
        }) === 'ok'
      : false;
    if (!signatureOk) {
      const principal = requireAuthenticated(request);
      requireWorkspaceView(principal, row.workspaceId);
    }
    return sendMediaBytes(app, reply, row, signatureOk);
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
