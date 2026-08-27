import type { FastifyInstance } from 'fastify';
import { createSessionToken, hashSessionToken } from '@project-knowledge-hub/auth';
import { oidcConfigFromEnv } from '@project-knowledge-hub/config';
import { sessions } from '@project-knowledge-hub/database';
import { AppError } from '@project-knowledge-hub/domain';
import { setSessionCookie } from '../plugins/auth.js';
import {
  beginOidcAuthorization,
  completeOidcAuthorization,
  oidcStateRedisKey,
  oidcStateTtlSeconds,
  parseOidcPendingState,
  serializeOidcPendingState,
} from '../lib/oidc-client.js';
import { resolveOidcUser } from '../lib/oidc-users.js';
import { writeAuditEvent } from '../lib/identity.js';
import { notifyAdminsOfSsoUserProvisioned } from '../lib/signup-pending-notify.js';

function loginRedirect(app: FastifyInstance, ssoError: string): string {
  const url = new URL('/login', app.env.WEB_URL);
  url.searchParams.set('sso', ssoError);
  return url.toString();
}

function dashboardRedirect(app: FastifyInstance): string {
  return new URL('/dashboard', app.env.WEB_URL).toString();
}

function buildCallbackUrl(app: FastifyInstance, requestUrl: string): URL {
  const oidc = oidcConfigFromEnv(app.env);
  const incoming = new URL(requestUrl, app.env.API_URL);
  // Rebuild against registered redirect_uri origin/path so token exchange matches IdP config.
  const callback = new URL(oidc?.redirectUri ?? incoming.toString());
  callback.search = incoming.search;
  return callback;
}

export async function registerOidcAuthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/auth/oidc/status', async () => {
    const oidc = oidcConfigFromEnv(app.env);
    return {
      enabled: Boolean(oidc),
      buttonLabel: oidc?.buttonLabel ?? 'Sign in with SSO',
    };
  });

  app.get('/api/v1/auth/oidc/start', async (request, reply) => {
    const oidc = oidcConfigFromEnv(app.env);
    if (!oidc) {
      throw new AppError({
        code: 'OIDC_DISABLED',
        message: 'OIDC sign-in is not configured',
        statusCode: 404,
      });
    }

    try {
      const { authorizationUrl, state, pending } = await beginOidcAuthorization(oidc);
      await app.redis.set(
        oidcStateRedisKey(state),
        serializeOidcPendingState(pending),
        'EX',
        oidcStateTtlSeconds(),
      );
      return reply.redirect(authorizationUrl.toString());
    } catch (error) {
      request.log.error({ err: error }, 'OIDC authorization start failed');
      return reply.redirect(loginRedirect(app, 'error'));
    }
  });

  app.get('/api/v1/auth/oidc/callback', async (request, reply) => {
    const oidc = oidcConfigFromEnv(app.env);
    if (!oidc) {
      return reply.redirect(loginRedirect(app, 'error'));
    }

    const query = request.query as Record<string, string | undefined>;
    if (query.error) {
      request.log.warn({ error: query.error, desc: query.error_description }, 'OIDC IdP error');
      return reply.redirect(loginRedirect(app, 'error'));
    }

    const state = typeof query.state === 'string' ? query.state : '';
    if (!state) {
      return reply.redirect(loginRedirect(app, 'error'));
    }

    const stateKey = oidcStateRedisKey(state);
    const rawPending = await app.redis.get(stateKey);
    await app.redis.del(stateKey);
    const pending = rawPending ? parseOidcPendingState(rawPending) : null;
    if (!pending) {
      return reply.redirect(loginRedirect(app, 'error'));
    }

    try {
      const callbackUrl = buildCallbackUrl(app, request.url);
      const claims = await completeOidcAuthorization(oidc, callbackUrl, pending, state);
      const resolved = await resolveOidcUser(app.database, {
        idpSource: oidc.idpSource,
        subject: claims.subject,
        email: claims.email,
        emailVerified: claims.emailVerified,
        displayName: claims.displayName,
        jitProvisioning: oidc.jitProvisioning,
      });

      if (resolved.status === 'unknown' || resolved.status === 'conflict') {
        await writeAuditEvent(app.database, {
          actorType: 'system',
          actorId: null,
          action: 'auth.oidc_rejected',
          entityType: 'user',
          entityId: null,
          metadata: {
            reason: resolved.status,
            idpSource: oidc.idpSource,
            subject: claims.subject,
            email: claims.email,
          },
          ipAddress: request.ip,
        });
        return reply.redirect(
          loginRedirect(app, resolved.status === 'conflict' ? 'conflict' : 'unknown'),
        );
      }

      if (resolved.status === 'inactive') {
        await writeAuditEvent(app.database, {
          actorType: 'system',
          actorId: resolved.userId,
          action: 'auth.oidc_rejected',
          entityType: 'user',
          entityId: resolved.userId,
          metadata: { reason: 'inactive', idpSource: oidc.idpSource },
          ipAddress: request.ip,
        });
        return reply.redirect(loginRedirect(app, 'inactive'));
      }

      const { user, linked, created } = resolved;
      const token = createSessionToken();
      const expiresAt = new Date(Date.now() + app.env.SESSION_TTL_SECONDS * 1000);

      await app.database.db.insert(sessions).values({
        userId: user.id,
        tokenHash: hashSessionToken(token),
        expiresAt,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'] ?? null,
      });

      if (created) {
        await writeAuditEvent(app.database, {
          actorType: 'user',
          actorId: user.id,
          action: 'auth.oidc_provision',
          entityType: 'user',
          entityId: user.id,
          metadata: { idpSource: oidc.idpSource },
          ipAddress: request.ip,
        });
        await notifyAdminsOfSsoUserProvisioned({
          database: app.database,
          mail: app.mail,
          webUrl: app.env.WEB_URL,
          signup: { displayName: user.displayName, email: user.email },
        }).catch((err) => {
          request.log.warn({ err }, 'SSO provision admin notify failed');
        });
      } else {
        await writeAuditEvent(app.database, {
          actorType: 'user',
          actorId: user.id,
          action: linked ? 'auth.oidc_link' : 'auth.oidc_login',
          entityType: 'user',
          entityId: user.id,
          metadata: { idpSource: oidc.idpSource },
          ipAddress: request.ip,
        });
      }

      setSessionCookie(app, reply, token, app.env.SESSION_TTL_SECONDS);
      return reply.redirect(dashboardRedirect(app));
    } catch (error) {
      request.log.error({ err: error }, 'OIDC callback failed');
      return reply.redirect(loginRedirect(app, 'error'));
    }
  });
}
