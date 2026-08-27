export type AuthMode = 'login' | 'register' | 'forgot-password';

export function authPathForMode(mode: AuthMode): string {
  if (mode === 'register') return '/register';
  if (mode === 'forgot-password') return '/forgot-password';
  return '/login';
}

export function isAuthRoutePath(pathname: string | null): boolean {
  return (
    pathname === '/login'
    || pathname === '/register'
    || pathname === '/forgot-password'
  );
}

/** Desktop auth uses landing modals; below this, dedicated AuthCard pages. */
export const AUTH_DESKTOP_MQ = '(min-width: 768px)';
