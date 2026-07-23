import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  createSessionToken,
  hashPassword,
  hashSessionToken,
  verifyPassword,
} from '@project-knowledge-hub/auth';
import { sessions, users } from '@project-knowledge-hub/database';
import { AppError, appLocaleSchema, passwordSchema } from '@project-knowledge-hub/domain';
import {
  assertMutatingOrigin,
  clearSessionCookie,
  setSessionCookie,
} from '../plugins/auth.js';
import {
  sendEmailConfirmMail,
  sendPasswordResetMail,
} from '../lib/auth-mail.js';
import {
  consumeAuthTokenAndSetPassword,
  consumeEmailConfirmToken,
  issueAuthToken,
  previewAuthToken,
} from '../lib/auth-tokens.js';
import { writeAuditEvent } from '../lib/identity.js';
import { avatarUrlForUser } from '../lib/public-user.js';
import { MemoryRateLimiter } from '../lib/rate-limit.js';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  preferredLocale: appLocaleSchema.optional(),
});

const registerSchema = z.object({
  email: z.string().email().max(320),
  displayName: z.string().min(1).max(160),
  password: passwordSchema,
  preferredLocale: appLocaleSchema.optional(),
});

const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

const resendConfirmationSchema = z.object({
  email: z.string().email(),
});

const confirmEmailSchema = z.object({
  token: z.string().min(1).max(500),
});

const setPasswordSchema = z.object({
  token: z.string().min(1).max(500),
  password: passwordSchema,
});

const forgotPasswordLimiter = new MemoryRateLimiter(5, 15 * 60 * 1000);
const registerLimiter = new MemoryRateLimiter(5, 15 * 60 * 1000);
const resendConfirmLimiter = new MemoryRateLimiter(5, 15 * 60 * 1000);

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/v1/auth/login', async (request, reply) => {
    assertMutatingOrigin(app, request);
    const body = loginSchema.parse(request.body);

    let [user] = await app.database.db
      .select()
      .from(users)
      .where(eq(users.email, body.email.toLowerCase()))
      .limit(1);

    if (!user || !user.passwordHash || user.status !== 'active') {
      throw new AppError({
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid email or password',
        statusCode: 401,
      });
    }

    const valid = await verifyPassword(body.password, user.passwordHash);
    if (!valid) {
      throw new AppError({
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid email or password',
        statusCode: 401,
      });
    }

    if (body.preferredLocale && body.preferredLocale !== user.preferredLocale) {
      const [updatedLocale] = await app.database.db
        .update(users)
        .set({ preferredLocale: body.preferredLocale, updatedAt: new Date() })
        .where(eq(users.id, user.id))
        .returning();
      if (updatedLocale) {
        user = updatedLocale;
      }
    }

    const token = createSessionToken();
    const expiresAt = new Date(Date.now() + app.env.SESSION_TTL_SECONDS * 1000);

    await app.database.db.insert(sessions).values({
      userId: user.id,
      tokenHash: hashSessionToken(token),
      expiresAt,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'] ?? null,
    });

    await writeAuditEvent(app.database, {
      actorType: 'user',
      actorId: user.id,
      action: 'auth.login',
      entityType: 'user',
      entityId: user.id,
      ipAddress: request.ip,
    });

    setSessionCookie(app, reply, token, app.env.SESSION_TTL_SECONDS);

    return {
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        fullName: user.fullName ?? null,
        isSystemAdmin: user.isSystemAdmin,
        avatarUrl: avatarUrlForUser(
          user.id,
          user.avatarContentType ?? null,
          user.updatedAt,
        ),
      },
    };
  });

  app.post('/api/v1/auth/logout', async (request, reply) => {
    assertMutatingOrigin(app, request);
    const principal = request.principal;

    const cookieHeader = request.headers.cookie;
    const cookieName = app.env.SESSION_COOKIE_NAME;
    const token = cookieHeader
      ?.split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${cookieName}=`))
      ?.slice(cookieName.length + 1);

    if (token) {
      const tokenHash = hashSessionToken(decodeURIComponent(token));
      await app.database.db
        .update(sessions)
        .set({ revokedAt: new Date() })
        .where(eq(sessions.tokenHash, tokenHash));
    }

    if (principal) {
      await writeAuditEvent(app.database, {
        actorType: 'user',
        actorId: principal.userId,
        action: 'auth.logout',
        entityType: 'user',
        entityId: principal.userId,
        ipAddress: request.ip,
      });
    }

    clearSessionCookie(app, reply);
    return { status: 'ok' };
  });

  app.get('/api/v1/auth/session', async (request) => {
    if (!request.principal) {
      return { user: null, memberships: [] };
    }
    const principal = request.principal;
    const [user] = await app.database.db
      .select({
        fullName: users.fullName,
        avatarContentType: users.avatarContentType,
        updatedAt: users.updatedAt,
      })
      .from(users)
      .where(eq(users.id, principal.userId))
      .limit(1);

    return {
      user: {
        id: principal.userId,
        email: principal.email,
        displayName: principal.displayName,
        fullName: user?.fullName ?? null,
        isSystemAdmin: principal.isSystemAdmin,
        avatarUrl: avatarUrlForUser(
          principal.userId,
          user?.avatarContentType ?? null,
          user?.updatedAt,
        ),
      },
      memberships: principal.memberships,
    };
  });

  app.post('/api/v1/auth/register', async (request, reply) => {
    assertMutatingOrigin(app, request);
    const body = registerSchema.parse(request.body);
    const email = body.email.toLowerCase();
    const rateKey = `${request.ip}:${email}`;

    if (!registerLimiter.allow(rateKey)) {
      throw new AppError({
        code: 'RATE_LIMITED',
        message: 'Too many registration attempts. Try again later.',
        statusCode: 429,
      });
    }

    const [existing] = await app.database.db
      .select({ id: users.id })
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
        displayName: body.displayName.trim(),
        passwordHash: await hashPassword(body.password),
        status: 'pending_email',
        isSystemAdmin: false,
        preferredLocale: body.preferredLocale ?? 'en',
      })
      .returning();

    if (!created) {
      throw new AppError({
        code: 'USER_CREATE_FAILED',
        message: 'Failed to create user',
        statusCode: 500,
      });
    }

    const rawToken = await issueAuthToken(app.database, {
      userId: created.id,
      purpose: 'email_confirm',
      ttlSeconds: app.env.AUTH_EMAIL_CONFIRM_TTL_SECONDS,
    });

    await sendEmailConfirmMail(app.mail, {
      webUrl: app.env.WEB_URL,
      to: created.email,
      displayName: created.displayName,
      rawToken,
      locale: created.preferredLocale,
    });

    await writeAuditEvent(app.database, {
      actorType: 'user',
      actorId: created.id,
      action: 'auth.register',
      entityType: 'user',
      entityId: created.id,
      metadata: { status: 'pending_email' },
      ipAddress: request.ip,
    });

    return reply.status(202).send({
      status: 'ok',
      message:
        'Check your email to confirm your address. An administrator must approve access before you can sign in.',
    });
  });

  app.get('/api/v1/auth/confirm-email/preview', async (request) => {
    const query = z
      .object({ token: z.string().min(1).max(500) })
      .parse(request.query);
    const preview = await previewAuthToken(app.database, query.token);
    if (preview.purpose && preview.purpose !== 'email_confirm') {
      return { status: 'invalid' as const, purpose: null, email: null };
    }
    return {
      status: preview.status,
      purpose: preview.purpose === 'email_confirm' ? preview.purpose : null,
      email:
        preview.status === 'valid' && preview.purpose === 'email_confirm'
          ? preview.email ?? null
          : null,
    };
  });

  app.post('/api/v1/auth/confirm-email', async (request) => {
    assertMutatingOrigin(app, request);
    const body = confirmEmailSchema.parse(request.body);
    const result = await consumeEmailConfirmToken(app.database, body.token);

    await writeAuditEvent(app.database, {
      actorType: 'user',
      actorId: result.userId,
      action: 'auth.email_confirm',
      entityType: 'user',
      entityId: result.userId,
      ipAddress: request.ip,
    });

    return {
      status: 'ok',
      message:
        'Email confirmed. An administrator must approve your access before you can sign in.',
      email: result.email,
    };
  });

  app.post('/api/v1/auth/resend-confirmation', async (request, reply) => {
    assertMutatingOrigin(app, request);
    const body = resendConfirmationSchema.parse(request.body);
    const email = body.email.toLowerCase();
    const rateKey = `${request.ip}:${email}`;

    if (!resendConfirmLimiter.allow(rateKey)) {
      throw new AppError({
        code: 'RATE_LIMITED',
        message: 'Too many confirmation requests. Try again later.',
        statusCode: 429,
      });
    }

    const [user] = await app.database.db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (user && user.status === 'pending_email') {
      const rawToken = await issueAuthToken(app.database, {
        userId: user.id,
        purpose: 'email_confirm',
        ttlSeconds: app.env.AUTH_EMAIL_CONFIRM_TTL_SECONDS,
      });

      await sendEmailConfirmMail(app.mail, {
        webUrl: app.env.WEB_URL,
        to: user.email,
        displayName: user.displayName,
        rawToken,
        locale: user.preferredLocale,
      });

      await writeAuditEvent(app.database, {
        actorType: 'user',
        actorId: user.id,
        action: 'auth.resend_confirmation',
        entityType: 'user',
        entityId: user.id,
        ipAddress: request.ip,
      });
    }

    return reply.status(202).send({
      status: 'ok',
      message:
        'If that email is awaiting confirmation, a new link was sent.',
    });
  });

  app.post('/api/v1/auth/forgot-password', async (request, reply) => {
    assertMutatingOrigin(app, request);
    const body = forgotPasswordSchema.parse(request.body);
    const email = body.email.toLowerCase();
    const rateKey = `${request.ip}:${email}`;

    if (!forgotPasswordLimiter.allow(rateKey)) {
      throw new AppError({
        code: 'RATE_LIMITED',
        message: 'Too many password reset requests. Try again later.',
        statusCode: 429,
      });
    }

    const [user] = await app.database.db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (user && user.status === 'active') {
      const rawToken = await issueAuthToken(app.database, {
        userId: user.id,
        purpose: 'password_reset',
        ttlSeconds: app.env.AUTH_PASSWORD_RESET_TTL_SECONDS,
      });

      await sendPasswordResetMail(app.mail, {
        webUrl: app.env.WEB_URL,
        to: user.email,
        displayName: user.displayName,
        rawToken,
        locale: user.preferredLocale,
      });

      await writeAuditEvent(app.database, {
        actorType: 'user',
        actorId: user.id,
        action: 'auth.forgot_password',
        entityType: 'user',
        entityId: user.id,
        ipAddress: request.ip,
      });
    }

    return reply.status(202).send({
      status: 'ok',
      message:
        'If an account exists for that email, password reset instructions were sent.',
    });
  });

  app.get('/api/v1/auth/set-password/preview', async (request) => {
    const query = z
      .object({ token: z.string().min(1).max(500) })
      .parse(request.query);
    const preview = await previewAuthToken(app.database, query.token);
    return {
      status: preview.status,
      purpose: preview.purpose ?? null,
      email: preview.status === 'valid' ? preview.email ?? null : null,
    };
  });

  app.post('/api/v1/auth/set-password', async (request) => {
    assertMutatingOrigin(app, request);
    const body = setPasswordSchema.parse(request.body);
    const result = await consumeAuthTokenAndSetPassword(app.database, {
      rawToken: body.token,
      password: body.password,
    });

    await writeAuditEvent(app.database, {
      actorType: 'user',
      actorId: result.userId,
      action: 'auth.password_set',
      entityType: 'user',
      entityId: result.userId,
      metadata: { purpose: result.purpose },
      ipAddress: request.ip,
    });

    return { status: 'ok' };
  });
}
