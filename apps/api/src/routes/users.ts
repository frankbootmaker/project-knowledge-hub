import type { FastifyInstance } from 'fastify';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { hashPassword } from '@project-knowledge-hub/auth';
import { memberships, users, workspaces } from '@project-knowledge-hub/database';
import { AppError, passwordSchema, userStatusSchema } from '@project-knowledge-hub/domain';
import { requireSystemAdmin } from '@project-knowledge-hub/permissions';
import {
  assertMutatingOrigin,
  requireAuthenticated,
} from '../plugins/auth.js';
import {
  mailDeliveryMeta,
  sendAccountApprovedMail,
  sendAccountClosedMail,
  sendInviteMail,
  sendSignupRejectedMail,
} from '../lib/auth-mail.js';
import { issueAuthToken } from '../lib/auth-tokens.js';
import { closeUserAccount, purgeUserAccount } from '../lib/close-user.js';
import { getDefaultOrganization, writeAuditEvent } from '../lib/identity.js';
import { toPublicUser } from '../lib/public-user.js';

const assignableRoleSchema = z.enum(['workspace_admin', 'maintainer', 'reader']);

const approveUserSchema = z.object({
  memberships: z
    .array(
      z.object({
        workspaceId: z.string().uuid(),
        role: assignableRoleSchema,
      }),
    )
    .min(1),
});

const createUserSchema = z
  .object({
    email: z.string().email().max(320),
    displayName: z.string().min(1).max(160),
    fullName: z.string().max(200).nullable().optional(),
    password: passwordSchema.optional(),
    sendInvite: z.boolean().optional(),
    status: userStatusSchema.optional(),
    isSystemAdmin: z.boolean().optional(),
    idpSource: z.string().min(1).max(64).nullable().optional(),
    idpSubject: z.string().min(1).max(320).nullable().optional(),
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
    const hasSource = Boolean(value.idpSource?.trim());
    const hasSubject = Boolean(value.idpSubject?.trim());
    if (hasSource !== hasSubject) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'IdP source and subject must be set together',
        path: ['idpSource'],
      });
    }
  });

const updateUserSchema = z
  .object({
    displayName: z.string().min(1).max(160).optional(),
    fullName: z.string().max(200).nullable().optional(),
    status: userStatusSchema.optional(),
    isSystemAdmin: z.boolean().optional(),
    password: passwordSchema.optional(),
    idpSource: z.string().min(1).max(64).nullable().optional(),
    idpSubject: z.string().min(1).max(320).nullable().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.idpSource !== undefined || value.idpSubject !== undefined) {
      const source = value.idpSource;
      const subject = value.idpSubject;
      const clearing =
        (source === null || source === '') &&
        (subject === null || subject === '');
      const bothSet =
        typeof source === 'string' &&
        source.trim().length > 0 &&
        typeof subject === 'string' &&
        subject.trim().length > 0;
      if (!clearing && !bothSet && (source !== undefined || subject !== undefined)) {
        // Allow partial omit (undefined) when only one field is in the patch
        // if the other is also provided as null to clear, or both set.
        if (
          (source === null && subject !== null && subject !== undefined) ||
          (subject === null && source !== null && source !== undefined)
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'IdP source and subject must be cleared or set together',
            path: ['idpSource'],
          });
        }
      }
    }
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

    const idpSource = body.idpSource?.trim() || null;
    const idpSubject = body.idpSubject?.trim() || null;

    const [created] = await app.database.db
      .insert(users)
      .values({
        email,
        displayName: body.displayName,
        fullName: body.fullName?.trim() ? body.fullName.trim() : null,
        passwordHash: inviteMode
          ? null
          : await hashPassword(body.password!),
        status: inviteMode ? 'invited' : (body.status ?? 'active'),
        isSystemAdmin: body.isSystemAdmin ?? false,
        idpSource,
        idpSubject,
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
        locale: created.preferredLocale,
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
      locale: existing.preferredLocale,
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

    let nextIdpSource = existing.idpSource;
    let nextIdpSubject = existing.idpSubject;
    if (body.idpSource !== undefined || body.idpSubject !== undefined) {
      const source =
        body.idpSource === undefined
          ? existing.idpSource
          : body.idpSource?.trim() || null;
      const subject =
        body.idpSubject === undefined
          ? existing.idpSubject
          : body.idpSubject?.trim() || null;
      if (Boolean(source) !== Boolean(subject)) {
        throw new AppError({
          code: 'IDP_FIELDS_INCOMPLETE',
          message: 'IdP source and subject must be set or cleared together',
          statusCode: 400,
        });
      }
      nextIdpSource = source;
      nextIdpSubject = subject;
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
        displayName: body.displayName ?? existing.displayName,
        fullName: nextFullName,
        status: body.status ?? existing.status,
        isSystemAdmin: body.isSystemAdmin ?? existing.isSystemAdmin,
        passwordHash: body.password
          ? await hashPassword(body.password)
          : existing.passwordHash,
        idpSource: nextIdpSource,
        idpSubject: nextIdpSubject,
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

  app.post('/api/v1/users/:userId/approve', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    requireSystemAdmin(principal);
    const params = z.object({ userId: z.string().uuid() }).parse(request.params);
    const body = approveUserSchema.parse(request.body);

    const workspaceIds = [...new Set(body.memberships.map((m) => m.workspaceId))];
    if (workspaceIds.length !== body.memberships.length) {
      throw new AppError({
        code: 'MEMBERSHIP_DUPLICATE_WORKSPACE',
        message: 'Each workspace may only appear once in the approval memberships',
        statusCode: 400,
      });
    }

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

    if (existing.status !== 'pending_approval') {
      throw new AppError({
        code: 'USER_NOT_PENDING_APPROVAL',
        message: 'Only email-confirmed users awaiting approval can be approved',
        statusCode: 400,
      });
    }

    const workspaceRows = await app.database.db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(and(inArray(workspaces.id, workspaceIds), isNull(workspaces.archivedAt)));

    if (workspaceRows.length !== workspaceIds.length) {
      throw new AppError({
        code: 'WORKSPACE_NOT_FOUND',
        message: 'One or more workspaces were not found or are archived',
        statusCode: 404,
      });
    }

    await app.database.db.transaction(async (tx) => {
      await tx.insert(memberships).values(
        body.memberships.map((item) => ({
          userId: existing.id,
          workspaceId: item.workspaceId,
          role: item.role,
        })),
      );

      await tx
        .update(users)
        .set({
          status: 'active',
          updatedAt: new Date(),
        })
        .where(eq(users.id, existing.id));
    });

    const [updated] = await app.database.db
      .select()
      .from(users)
      .where(eq(users.id, existing.id))
      .limit(1);

    const organization = await getDefaultOrganization(app.database);
    await writeAuditEvent(app.database, {
      organizationId: organization?.id ?? null,
      actorType: 'user',
      actorId: principal.userId,
      action: 'user.approve',
      entityType: 'user',
      entityId: existing.id,
      metadata: {
        memberships: body.memberships,
      },
      ipAddress: request.ip,
    });

    const mailResult = await sendAccountApprovedMail(app.mail, {
      webUrl: app.env.WEB_URL,
      to: existing.email,
      displayName: existing.displayName,
      locale: existing.preferredLocale,
    });

    return {
      user: updated ? toPublicUser(updated) : null,
      mail: mailDeliveryMeta(mailResult),
    };
  });

  app.post('/api/v1/users/:userId/reject', async (request) => {
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

    if (
      existing.status !== 'pending_approval' &&
      existing.status !== 'pending_email'
    ) {
      throw new AppError({
        code: 'USER_NOT_PENDING',
        message: 'Only pending signup users can be rejected',
        statusCode: 400,
      });
    }

    const [updated] = await app.database.db
      .update(users)
      .set({
        status: 'disabled',
        updatedAt: new Date(),
      })
      .where(eq(users.id, existing.id))
      .returning();

    const organization = await getDefaultOrganization(app.database);
    await writeAuditEvent(app.database, {
      organizationId: organization?.id ?? null,
      actorType: 'user',
      actorId: principal.userId,
      action: 'user.reject',
      entityType: 'user',
      entityId: existing.id,
      metadata: { previousStatus: existing.status },
      ipAddress: request.ip,
    });

    await sendSignupRejectedMail(app.mail, {
      to: existing.email,
      displayName: existing.displayName,
      locale: existing.preferredLocale,
    });

    return { user: updated ? toPublicUser(updated) : null };
  });

  app.delete('/api/v1/users/:userId', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    requireSystemAdmin(principal);
    const params = z.object({ userId: z.string().uuid() }).parse(request.params);
    const query = z
      .object({
        hard: z
          .union([z.literal('1'), z.literal('true'), z.literal('0'), z.literal('false')])
          .optional(),
      })
      .parse(request.query);
    const hardDelete = query.hard === '1' || query.hard === 'true';

    if (params.userId === principal.userId) {
      throw new AppError({
        code: 'CANNOT_REMOVE_SELF',
        message: 'Use account settings to close your own account',
        statusCode: 400,
      });
    }

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

    const organization = await getDefaultOrganization(app.database);

    if (hardDelete) {
      const purged = await purgeUserAccount(app.database, {
        userId: params.userId,
        avatarUploadDir: app.env.AVATAR_UPLOAD_DIR,
        appEnv: app.env.APP_ENV,
      });

      await writeAuditEvent(app.database, {
        organizationId: organization?.id ?? null,
        actorType: 'user',
        actorId: principal.userId,
        action: 'user.purge',
        entityType: 'user',
        entityId: params.userId,
        metadata: {
          previousEmail: existing.email,
          previousStatus: existing.status,
          hard: true,
          appEnv: app.env.APP_ENV,
        },
        ipAddress: request.ip,
      });

      return { status: 'purged', user: purged };
    }

    await sendAccountClosedMail(app.mail, {
      to: existing.email,
      displayName: existing.displayName,
      locale: existing.preferredLocale,
    });

    const closed = await closeUserAccount(app.database, {
      userId: params.userId,
      avatarUploadDir: app.env.AVATAR_UPLOAD_DIR,
    });

    await writeAuditEvent(app.database, {
      organizationId: organization?.id ?? null,
      actorType: 'user',
      actorId: principal.userId,
      action: 'user.remove',
      entityType: 'user',
      entityId: params.userId,
      metadata: {
        previousEmail: existing.email,
        previousStatus: existing.status,
        hard: false,
      },
      ipAddress: request.ip,
    });

    return { user: toPublicUser(closed) };
  });
}
