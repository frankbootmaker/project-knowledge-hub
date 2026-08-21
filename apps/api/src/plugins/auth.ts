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

function firstHeaderValue(
  value: string | string[] | undefined,
): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

function originFromUrl(value: string | undefined): string | null {
  if (!value?.trim()) {
    return null;
  }
  try {
    return new URL(value.trim()).origin;
  } catch {
    return null;
  }
}

function forwardedPublicOrigin(request: {
  headers: FastifyRequest['headers'];
}): string | null {
  const host = firstHeaderValue(request.headers['x-forwarded-host'])
    ?.split(',')[0]
    ?.trim();
  if (!host) {
    return null;
  }
  const proto = (
    firstHeaderValue(request.headers['x-forwarded-proto']) ?? 'https'
  )
    .split(',')[0]
    .trim();
  return originFromUrl(`${proto}://${host}`);
}

/** Origins allowed for CSRF + CORS: WEB_URL, API rewrite target, public proxy host. */
export function allowedOriginsForRequest(
  env: { WEB_URL: string; API_URL: string },
  request: { headers: FastifyRequest['headers'] },
): Set<string> {
  const allowed = new Set<string>();
  const web = originFromUrl(env.WEB_URL);
  if (web) {
    allowed.add(web);
  }
  const api = originFromUrl(env.API_URL);
  if (api) {
    allowed.add(api);
  }
  const forwarded = forwardedPublicOrigin(request);
  if (forwarded) {
    allowed.add(forwarded);
  }
  return allowed;
}

export function isAllowedRequestOrigin(
  env: { WEB_URL: string; API_URL: string },
  request: { headers: FastifyRequest['headers'] },
  origin: string,
): boolean {
  return allowedOriginsForRequest(env, request).has(origin);
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

  if (isAllowedRequestOrigin(app.env, request, origin)) {
    return;
  }

  throw new AppError({
    code: 'CSRF_REJECTED',
    message: `Request origin is not allowed (got ${origin}, expected ${allowed})`,
    statusCode: 403,
    details: { origin, expected: allowed },
  });
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
