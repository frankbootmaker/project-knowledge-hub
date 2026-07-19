import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { LanguageSwitcher } from './LanguageSwitcher';
import { shellClassName } from './shell';
import { ThemeSwitcher } from './ThemeSwitcher';
import { Button, LinkButton, MobileNav, NavLink, type MobileNavItem } from './ui';
import { getThemePreference } from '../lib/theme-actions';
import type { SessionPayload } from '../lib/session';

const apiUrl = process.env.API_URL ?? 'http://localhost:3101';
const cookieName = process.env.SESSION_COOKIE_NAME ?? 'kh_session';

async function logoutAction() {
  'use server';
  const cookieStore = await cookies();
  const token = cookieStore.get(cookieName)?.value;
  if (token) {
    await fetch(`${apiUrl}/api/v1/auth/logout`, {
      method: 'POST',
      headers: {
        Cookie: `${cookieName}=${token}`,
        Origin: process.env.WEB_URL ?? 'http://localhost:3100',
      },
    });
  }
  cookieStore.delete(cookieName);
  redirect('/login');
}

export async function AppHeader({ session }: { session: SessionPayload | null }) {
  const t = await getTranslations('nav');
  const tCommon = await getTranslations('common');
  const tLogin = await getTranslations('login');
  const theme = await getThemePreference();

  const navItems: MobileNavItem[] = [
    ...(session
      ? [
          { href: '/dashboard', label: t('dashboard') },
          { href: '/workspaces', label: t('workspaces') },
          { href: '/search', label: t('search') },
          ...(session.user.isSystemAdmin
            ? [{ href: '/admin', label: t('admin') }]
            : []),
        ]
      : []),
    { href: '/status', label: t('status') },
  ];

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-panel/90 backdrop-blur-md">
      <div className={`${shellClassName} flex items-center justify-between gap-4 py-3`}>
        <div className="flex min-w-0 items-center gap-3 sm:gap-5">
          <MobileNav items={navItems} />
          <Link
            href={session ? '/dashboard' : '/status'}
            className="shrink-0 text-base font-semibold tracking-tight text-ink no-underline"
          >
            {tCommon('appName')}
          </Link>
          <nav className="hidden items-center gap-1 sm:flex">
            {session ? (
              <>
                <NavLink href="/dashboard">{t('dashboard')}</NavLink>
                <NavLink href="/workspaces">{t('workspaces')}</NavLink>
                <NavLink href="/search">{t('search')}</NavLink>
                {session.user.isSystemAdmin ? (
                  <NavLink href="/admin">{t('admin')}</NavLink>
                ) : null}
              </>
            ) : null}
            <NavLink href="/status">{t('status')}</NavLink>
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center -space-x-0.5">
            <ThemeSwitcher initialTheme={theme} />
            <LanguageSwitcher />
          </div>
          {session ? (
            <>
              <span className="hidden text-sm text-ink-muted md:inline">
                {session.user.displayName}
              </span>
              <form action={logoutAction}>
                <Button type="submit" variant="secondary">
                  {t('logOut')}
                </Button>
              </form>
            </>
          ) : (
            <LinkButton href="/login" variant="secondary">
              {tLogin('signIn')}
            </LinkButton>
          )}
        </div>
      </div>
    </header>
  );
}
