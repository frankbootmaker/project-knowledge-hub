import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '@project-knowledge-hub/domain';
import type { AuthPrincipal } from '@project-knowledge-hub/permissions';
import { hashSessionToken } from '@project-knowledge-hub/auth';
import { loadPrincipalBySessionToken } from '../lib/identity.js';

declare module 'fastify' {
  interface FastifyRequest {
    principal: AuthPrincipal | null;
  }
}

function getCookieValue(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) {
    return null;
  }

  for (const part of cookieHeader.split(';')) {
    const [rawKey, ...rawValue] = part.trim().split('=');
    if (rawKey === name) {
      return decodeURIComponent(rawValue.join('='));
    }
  }

  return null;
}

export async function registerAuthHooks(app: FastifyInstance): Promise<void> {
  app.decorateRequest('principal', null);

  app.addHook('preHandler', async (request) => {
    request.principal = null;
    const token = getCookieValue(request.headers.cookie, app.env.SESSION_COOKIE_NAME);
    if (!token) {
      return;
    }

    const principal = await loadPrincipalBySessionToken(
      app.database,
      hashSessionToken(token),
    );
    request.principal = principal;
  });
}

export function requireAuthenticated(request: FastifyRequest): AuthPrincipal {
  if (!request.principal) {
    throw new AppError({
      code: 'UNAUTHENTICATED',
      message: 'Authentication is required',
      statusCode: 401,
    });
  }
  return request.principal;
}

export function assertMutatingOrigin(app: FastifyInstance, request: FastifyRequest): void {
  const method = request.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    return;
  }

  const origin = request.headers.origin;
  const allowed = new URL(app.env.WEB_URL).origin;

  if (!origin) {
    // Non-browser clients (tests/curl) may omit Origin; allow when no Origin is present.
    return;
  }

  if (origin !== allowed) {
    throw new AppError({
      code: 'CSRF_REJECTED',
      message: 'Request origin is not allowed',
      statusCode: 403,
    });
  }
}

export function setSessionCookie(
  app: FastifyInstance,
  reply: FastifyReply,
  token: string,
  maxAgeSeconds: number,
): void {
  const secure = app.env.NODE_ENV === 'production';
  const parts = [
    `${app.env.SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (secure) {
    parts.push('Secure');
  }
  reply.header('Set-Cookie', parts.join('; '));
}

export function clearSessionCookie(app: FastifyInstance, reply: FastifyReply): void {
  const secure = app.env.NODE_ENV === 'production';
  const parts = [
    `${app.env.SESSION_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
  ];
  if (secure) {
    parts.push('Secure');
  }
  reply.header('Set-Cookie', parts.join('; '));
}
