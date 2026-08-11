import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { BrandMark } from './BrandMark';
import { LanguageSwitcher } from './LanguageSwitcher';
import { headerControlSquareClassName, themeIconClassName } from './header-control';
import { shellClassName } from './shell';
import { ThemeSwitcher } from './ThemeSwitcher';
import { UserAvatar } from './UserAvatar';
import { Button, LinkButton, MobileNav, NavLink, type MobileNavItem } from './ui';
import { getThemePreference } from '../lib/theme-actions';
import type { SessionPayload } from '../lib/session';
import { cn } from '../lib/cn';

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

function LogOutIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={themeIconClassName} fill="none">
      <path
        d="M10 4.5H6.5A2 2 0 0 0 4.5 6.5v11A2 2 0 0 0 6.5 19.5H10"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
      <path
        d="M10.5 12h9M16.5 8.5 20 12l-3.5 3.5"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function LogInIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={themeIconClassName} fill="none">
      <path
        d="M14 4.5h3.5A2 2 0 0 1 19.5 6.5v11a2 2 0 0 1-2 2H14"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
      <path
        d="M13.5 12h-9M7.5 8.5 4 12l3.5 3.5"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
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
          { href: '/archived', label: t('archive') },
          { href: '/account/profile', label: t('profile') },
          { href: '/account/display', label: t('display') },
          ...(session.user.isSystemAdmin
            ? [{ href: '/admin', label: t('admin') }]
            : []),
        ]
      : []),
  ];

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-panel/90 backdrop-blur-md">
      <div
        className={`${shellClassName} flex items-center justify-between gap-2 py-3 sm:gap-4`}
      >
        <div className="flex min-w-0 items-center gap-3 md:gap-5">
          <Link
            href={session ? '/dashboard' : '/login'}
            className="inline-flex shrink-0 items-center gap-2 text-base font-semibold tracking-tight text-ink no-underline"
          >
            <BrandMark className="size-8 shrink-0" />
            <span className="hidden md:inline">{tCommon('appName')}</span>
            <span className="sr-only md:hidden">{tCommon('appName')}</span>
          </Link>
          <nav className="hidden items-center gap-1 md:flex">
            {session ? (
              <>
                <NavLink href="/dashboard">{t('dashboard')}</NavLink>
                <NavLink href="/workspaces">{t('workspaces')}</NavLink>
                <NavLink href="/search">{t('search')}</NavLink>
                <NavLink href="/archived">{t('archive')}</NavLink>
                {session.user.isSystemAdmin ? (
                  <NavLink href="/admin">{t('admin')}</NavLink>
                ) : null}
              </>
            ) : null}
          </nav>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-3">
          <div className="flex items-center -space-x-0.5">
            <ThemeSwitcher initialTheme={theme} />
            <LanguageSwitcher />
          </div>
          {session ? (
            <>
              <Link
                href="/account/profile"
                className="hidden items-center gap-2 text-sm text-ink-muted no-underline hover:text-ink md:inline-flex"
                title={t('profile')}
              >
                <UserAvatar
                  displayName={session.user.displayName}
                  fullName={session.user.fullName}
                  avatarUrl={session.user.avatarUrl}
                  size="sm"
                />
                <span>{session.user.displayName}</span>
              </Link>
              <form action={logoutAction}>
                <Button
                  type="submit"
                  variant="ghost"
                  className={cn(headerControlSquareClassName, 'shrink-0 p-0')}
                  aria-label={t('logOut')}
                  title={t('logOut')}
                >
                  <LogOutIcon />
                </Button>
              </form>
            </>
          ) : (
            <LinkButton
              href="/login"
              variant="ghost"
              className={cn(headerControlSquareClassName, 'shrink-0 p-0')}
              aria-label={tLogin('signIn')}
              title={tLogin('signIn')}
            >
              <LogInIcon />
            </LinkButton>
          )}
          <MobileNav items={navItems} />
        </div>
      </div>
    </header>
  );
}
