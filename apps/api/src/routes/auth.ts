import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  createSessionToken,
  hashSessionToken,
  verifyPassword,
} from '@project-knowledge-hub/auth';
import { sessions, users } from '@project-knowledge-hub/database';
import { AppError } from '@project-knowledge-hub/domain';
import {
  assertMutatingOrigin,
  clearSessionCookie,
  requireAuthenticated,
  setSessionCookie,
} from '../plugins/auth.js';
import { writeAuditEvent } from '../lib/identity.js';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/v1/auth/login', async (request, reply) => {
    assertMutatingOrigin(app, request);
    const body = loginSchema.parse(request.body);

    const [user] = await app.database.db
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
        isSystemAdmin: user.isSystemAdmin,
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
    const principal = requireAuthenticated(request);
    return {
      user: {
        id: principal.userId,
        email: principal.email,
        displayName: principal.displayName,
        isSystemAdmin: principal.isSystemAdmin,
      },
      memberships: principal.memberships,
    };
  });
}
