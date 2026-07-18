import { NextResponse, type NextRequest } from 'next/server';

const publicPaths = ['/login', '/status'];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // API calls are proxied to Fastify; never treat them as page routes.
  if (pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  const isPublic = publicPaths.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );

  const cookieName = process.env.SESSION_COOKIE_NAME ?? 'kh_session';
  const hasSession = Boolean(request.cookies.get(cookieName)?.value);

  if (!isPublic && !hasSession) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (pathname === '/login' && hasSession) {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
