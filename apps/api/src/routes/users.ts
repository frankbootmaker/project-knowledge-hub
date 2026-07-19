import type { FastifyInstance } from 'fastify';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { hashPassword } from '@project-knowledge-hub/auth';
import { users } from '@project-knowledge-hub/database';
import { AppError, userStatusSchema } from '@project-knowledge-hub/domain';
import { requireSystemAdmin } from '@project-knowledge-hub/permissions';
import {
  assertMutatingOrigin,
  requireAuthenticated,
} from '../plugins/auth.js';
import { mailDeliveryMeta, sendInviteMail } from '../lib/auth-mail.js';
import { issueAuthToken } from '../lib/auth-tokens.js';
import { getDefaultOrganization, writeAuditEvent } from '../lib/identity.js';

function toPublicUser(user: typeof users.$inferSelect) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    status: user.status,
    isSystemAdmin: user.isSystemAdmin,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

const createUserSchema = z
  .object({
    email: z.string().email().max(320),
    displayName: z.string().min(1).max(160),
    password: z.string().min(12).max(200).optional(),
    sendInvite: z.boolean().optional(),
    status: userStatusSchema.optional(),
    isSystemAdmin: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    // Password required when explicitly not inviting.
    if (value.sendInvite === false && !value.password) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Password is required unless sending an invite',
        path: ['password'],
      });
    }
  });

const updateUserSchema = z.object({
  displayName: z.string().min(1).max(160).optional(),
  status: userStatusSchema.optional(),
  isSystemAdmin: z.boolean().optional(),
  password: z.string().min(12).max(200).optional(),
});

export async function registerUserRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/users', async (request) => {
    const principal = requireAuthenticated(request);
    requireSystemAdmin(principal);

    const rows = await app.database.db
      .select()
      .from(users)
      .orderBy(desc(users.createdAt));
    return { users: rows.map(toPublicUser) };
  });

  app.post('/api/v1/users', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    requireSystemAdmin(principal);
    const body = createUserSchema.parse(request.body);
    const email = body.email.toLowerCase();
    const inviteMode = body.sendInvite === true || !body.password;

    const [existing] = await app.database.db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    if (existing) {
      throw new AppError({
        code: 'USER_EMAIL_CONFLICT',
        message: 'A user with this email already exists',
        statusCode: 409,
      });
    }

    const [created] = await app.database.db
      .insert(users)
      .values({
        email,
        displayName: body.displayName,
        passwordHash: inviteMode
          ? null
          : await hashPassword(body.password!),
        status: inviteMode ? 'invited' : (body.status ?? 'active'),
        isSystemAdmin: body.isSystemAdmin ?? false,
      })
      .returning();

    if (!created) {
      throw new AppError({
        code: 'USER_CREATE_FAILED',
        message: 'Failed to create user',
        statusCode: 500,
      });
    }

    const organization = await getDefaultOrganization(app.database);
    await writeAuditEvent(app.database, {
      organizationId: organization?.id ?? null,
      actorType: 'user',
      actorId: principal.userId,
      action: inviteMode ? 'user.invite' : 'user.create',
      entityType: 'user',
      entityId: created.id,
      metadata: {
        email: created.email,
        isSystemAdmin: created.isSystemAdmin,
        invited: inviteMode,
      },
      ipAddress: request.ip,
    });

    let mail:
      | { sent: boolean; driver: string; warning?: string }
      | undefined;

    if (inviteMode) {
      const rawToken = await issueAuthToken(app.database, {
        userId: created.id,
        purpose: 'invite',
        ttlSeconds: app.env.AUTH_INVITE_TTL_SECONDS,
      });
      const result = await sendInviteMail(app.mail, {
        webUrl: app.env.WEB_URL,
        to: created.email,
        displayName: created.displayName,
        rawToken,
      });
      mail = mailDeliveryMeta(result);
    }

    return { user: toPublicUser(created), mail };
  });

  app.post('/api/v1/users/:userId/resend-invite', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    requireSystemAdmin(principal);
    const params = z.object({ userId: z.string().uuid() }).parse(request.params);

    const [existing] = await app.database.db
      .select()
      .from(users)
      .where(eq(users.id, params.userId))
      .limit(1);
    if (!existing) {
      throw new AppError({
        code: 'USER_NOT_FOUND',
        message: 'User not found',
        statusCode: 404,
      });
    }
    if (existing.status !== 'invited') {
      throw new AppError({
        code: 'USER_NOT_INVITED',
        message: 'Only invited users can receive a new invite email',
        statusCode: 400,
      });
    }

    const rawToken = await issueAuthToken(app.database, {
      userId: existing.id,
      purpose: 'invite',
      ttlSeconds: app.env.AUTH_INVITE_TTL_SECONDS,
    });
    const result = await sendInviteMail(app.mail, {
      webUrl: app.env.WEB_URL,
      to: existing.email,
      displayName: existing.displayName,
      rawToken,
    });

    const organization = await getDefaultOrganization(app.database);
    await writeAuditEvent(app.database, {
      organizationId: organization?.id ?? null,
      actorType: 'user',
      actorId: principal.userId,
      action: 'user.invite',
      entityType: 'user',
      entityId: existing.id,
      metadata: { resent: true, email: existing.email },
      ipAddress: request.ip,
    });

    return {
      user: toPublicUser(existing),
      mail: mailDeliveryMeta(result),
    };
  });

  app.patch('/api/v1/users/:userId', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    requireSystemAdmin(principal);
    const params = z.object({ userId: z.string().uuid() }).parse(request.params);
    const body = updateUserSchema.parse(request.body);

    const [existing] = await app.database.db
      .select()
      .from(users)
      .where(eq(users.id, params.userId))
      .limit(1);
    if (!existing) {
      throw new AppError({
        code: 'USER_NOT_FOUND',
        message: 'User not found',
        statusCode: 404,
      });
    }

    if (
      existing.id === principal.userId &&
      body.isSystemAdmin === false
    ) {
      throw new AppError({
        code: 'CANNOT_DEMOTE_SELF',
        message: 'You cannot remove your own system administrator role',
        statusCode: 400,
      });
    }

    if (
      existing.id === principal.userId &&
      body.status &&
      body.status !== 'active'
    ) {
      throw new AppError({
        code: 'CANNOT_DISABLE_SELF',
        message: 'You cannot disable your own account',
        statusCode: 400,
      });
    }

    const [updated] = await app.database.db
      .update(users)
      .set({
        displayName: body.displayName ?? existing.displayName,
        status: body.status ?? existing.status,
        isSystemAdmin: body.isSystemAdmin ?? existing.isSystemAdmin,
        passwordHash: body.password
          ? await hashPassword(body.password)
          : existing.passwordHash,
        updatedAt: new Date(),
      })
      .where(eq(users.id, params.userId))
      .returning();

    const organization = await getDefaultOrganization(app.database);
    await writeAuditEvent(app.database, {
      organizationId: organization?.id ?? null,
      actorType: 'user',
      actorId: principal.userId,
      action: 'user.update',
      entityType: 'user',
      entityId: params.userId,
      metadata: {
        fields: Object.keys(body),
        passwordChanged: Boolean(body.password),
      },
      ipAddress: request.ip,
    });

    return { user: updated ? toPublicUser(updated) : null };
  });
}
