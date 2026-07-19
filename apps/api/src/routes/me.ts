import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { users } from '@project-knowledge-hub/database';
import { AppError } from '@project-knowledge-hub/domain';
import {
  assertMutatingOrigin,
  requireAuthenticated,
} from '../plugins/auth.js';
import { getDefaultOrganization, writeAuditEvent } from '../lib/identity.js';
import { toPublicUser } from '../lib/public-user.js';

const updateMeSchema = z.object({
  displayName: z.string().min(1).max(160).optional(),
  fullName: z.string().max(200).nullable().optional(),
});

export async function registerMeRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/me', async (request) => {
    const principal = requireAuthenticated(request);
    const [user] = await app.database.db
      .select()
      .from(users)
      .where(eq(users.id, principal.userId))
      .limit(1);
    if (!user) {
      throw new AppError({
        code: 'USER_NOT_FOUND',
        message: 'User not found',
        statusCode: 404,
      });
    }
    return { user: toPublicUser(user) };
  });

  app.patch('/api/v1/me', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    const body = updateMeSchema.parse(request.body);

    if (body.displayName === undefined && body.fullName === undefined) {
      throw new AppError({
        code: 'VALIDATION_ERROR',
        message: 'No profile fields to update',
        statusCode: 400,
      });
    }

    const [existing] = await app.database.db
      .select()
      .from(users)
      .where(eq(users.id, principal.userId))
      .limit(1);
    if (!existing) {
      throw new AppError({
        code: 'USER_NOT_FOUND',
        message: 'User not found',
        statusCode: 404,
      });
    }

    const nextFullName =
      body.fullName === undefined
        ? existing.fullName
        : body.fullName?.trim()
          ? body.fullName.trim()
          : null;

    const [updated] = await app.database.db
      .update(users)
      .set({
        displayName: body.displayName?.trim() ?? existing.displayName,
        fullName: nextFullName,
        updatedAt: new Date(),
      })
      .where(eq(users.id, principal.userId))
      .returning();

    const organization = await getDefaultOrganization(app.database);
    await writeAuditEvent(app.database, {
      organizationId: organization?.id ?? null,
      actorType: 'user',
      actorId: principal.userId,
      action: 'user.profile_update',
      entityType: 'user',
      entityId: principal.userId,
      metadata: { fields: Object.keys(body) },
      ipAddress: request.ip,
    });

    return { user: updated ? toPublicUser(updated) : null };
  });
}
