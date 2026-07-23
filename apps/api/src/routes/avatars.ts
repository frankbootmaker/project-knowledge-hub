import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { users } from '@project-knowledge-hub/database';
import { AppError } from '@project-knowledge-hub/domain';
import {
  assertMutatingOrigin,
  requireAuthenticated,
} from '../plugins/auth.js';
import {
  deleteAvatarFile,
  isAllowedAvatarContentType,
  readAvatarFile,
  writeAvatarFile,
} from '../lib/avatars.js';
import { getDefaultOrganization, writeAuditEvent } from '../lib/identity.js';
import { toPublicUser } from '../lib/public-user.js';

export async function registerAvatarRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/avatars/:userId', async (request, reply) => {
    requireAuthenticated(request);
    const params = z.object({ userId: z.string().uuid() }).parse(request.params);

    const [user] = await app.database.db
      .select({
        id: users.id,
        avatarContentType: users.avatarContentType,
      })
      .from(users)
      .where(eq(users.id, params.userId))
      .limit(1);

    if (!user?.avatarContentType) {
      throw new AppError({
        code: 'AVATAR_NOT_FOUND',
        message: 'Avatar not found',
        statusCode: 404,
      });
    }

    const { store: blobStore } = await app.getBlobStore();
    const buffer = await readAvatarFile(app.env.AVATAR_UPLOAD_DIR, user.id, {
      blobStore,
    });
    if (!buffer) {
      throw new AppError({
        code: 'AVATAR_NOT_FOUND',
        message: 'Avatar not found',
        statusCode: 404,
      });
    }

    reply.header('Content-Type', user.avatarContentType);
    reply.header('Cache-Control', 'private, max-age=3600');
    return reply.send(buffer);
  });

  app.post('/api/v1/me/avatar', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);

    const file = await request.file();
    if (!file) {
      throw new AppError({
        code: 'AVATAR_REQUIRED',
        message: 'Avatar image file is required',
        statusCode: 400,
      });
    }

    const contentType = file.mimetype;
    if (!isAllowedAvatarContentType(contentType)) {
      throw new AppError({
        code: 'AVATAR_TYPE_UNSUPPORTED',
        message: 'Avatar must be JPEG, PNG, or WebP',
        statusCode: 400,
      });
    }

    const buffer = await file.toBuffer();
    if (buffer.byteLength === 0 || buffer.byteLength > app.env.AVATAR_MAX_BYTES) {
      throw new AppError({
        code: 'AVATAR_TOO_LARGE',
        message: `Avatar must be between 1 byte and ${app.env.AVATAR_MAX_BYTES} bytes`,
        statusCode: 400,
      });
    }

    await writeAvatarFile(app.env.AVATAR_UPLOAD_DIR, principal.userId, buffer, {
      blobStore: (await app.getBlobStore()).store,
      contentType,
    });

    const [updated] = await app.database.db
      .update(users)
      .set({
        avatarContentType: contentType,
        updatedAt: new Date(),
      })
      .where(eq(users.id, principal.userId))
      .returning();

    const organization = await getDefaultOrganization(app.database);
    await writeAuditEvent(app.database, {
      organizationId: organization?.id ?? null,
      actorType: 'user',
      actorId: principal.userId,
      action: 'user.avatar_update',
      entityType: 'user',
      entityId: principal.userId,
      metadata: { contentType, bytes: buffer.byteLength },
      ipAddress: request.ip,
    });

    if (!updated) {
      throw new AppError({
        code: 'USER_NOT_FOUND',
        message: 'User not found',
        statusCode: 404,
      });
    }

    return { user: toPublicUser(updated) };
  });

  app.delete('/api/v1/me/avatar', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);

    await deleteAvatarFile(app.env.AVATAR_UPLOAD_DIR, principal.userId, {
      blobStore: (await app.getBlobStore()).store,
    });

    const [updated] = await app.database.db
      .update(users)
      .set({
        avatarContentType: null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, principal.userId))
      .returning();

    const organization = await getDefaultOrganization(app.database);
    await writeAuditEvent(app.database, {
      organizationId: organization?.id ?? null,
      actorType: 'user',
      actorId: principal.userId,
      action: 'user.avatar_clear',
      entityType: 'user',
      entityId: principal.userId,
      ipAddress: request.ip,
    });

    if (!updated) {
      throw new AppError({
        code: 'USER_NOT_FOUND',
        message: 'User not found',
        statusCode: 404,
      });
    }

    return { user: toPublicUser(updated) };
  });
}
