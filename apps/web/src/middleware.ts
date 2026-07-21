import { NextResponse, type NextRequest } from 'next/server';
import { defaultLocale, isAppLocale, localeCookieName } from './i18n/config';

const publicPaths = [
  '/login',
  '/register',
  '/confirm-email',
  '/forgot-password',
  '/set-password',
  '/status',
  '/ai-discover',
];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // OAuth discovery probes (mcp-remote, Claude, etc.) must not get a login HTML
  // redirect — that yields "Unexpected token '<'" during initialize.
  if (pathname.startsWith('/.well-known/')) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  // API and MCP are proxied to Fastify; never treat them as page routes.
  // Without this, unauthenticated POST /mcp gets a 307 to /login and MCP clients
  // (Cursor, Antigravity, etc.) fail with "initialize" EOF.
  if (pathname.startsWith('/api/') || pathname === '/mcp' || pathname.startsWith('/mcp/')) {
    return NextResponse.next();
  }

  const isPublic = publicPaths.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );

  const cookieName = process.env.SESSION_COOKIE_NAME ?? 'kh_session';
  const hasSession = Boolean(request.cookies.get(cookieName)?.value);

  let response: NextResponse;

  if (!isPublic && !hasSession) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('next', pathname);
    response = NextResponse.redirect(loginUrl);
  } else if (
    (pathname === '/login' || pathname === '/register') &&
    hasSession
  ) {
    response = NextResponse.redirect(new URL('/dashboard', request.url));
  } else {
    response = NextResponse.next();
  }

  const existingLocale = request.cookies.get(localeCookieName)?.value;
  if (!isAppLocale(existingLocale)) {
    const accepted = request.headers.get('accept-language') ?? '';
    const preferred = accepted
      .split(',')
      .map((part) => part.trim().split(';')[0]?.toLowerCase())
      .find((code) => code === 'en' || code === 'de' || code === 'hu' || code?.startsWith('en-') || code?.startsWith('de-') || code?.startsWith('hu-'));

    const locale =
      preferred?.startsWith('de')
        ? 'de'
        : preferred?.startsWith('hu')
          ? 'hu'
          : preferred?.startsWith('en')
            ? 'en'
            : defaultLocale;

    response.cookies.set(localeCookieName, locale, {
      path: '/',
      maxAge: 60 * 60 * 24 * 365,
      sameSite: 'lax',
    });
  }

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
