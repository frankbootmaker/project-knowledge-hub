import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { LanguageSwitcher } from './LanguageSwitcher';
import { Button } from './ui';
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

const navLink =
  'rounded-md px-2.5 py-1.5 text-sm font-medium text-ink-muted transition hover:bg-brand-soft hover:text-ink';

export async function AppHeader({ session }: { session: SessionPayload | null }) {
  const t = await getTranslations('nav');
  const tCommon = await getTranslations('common');
  const tLogin = await getTranslations('login');

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-panel/90 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-5">
          <Link
            href={session ? '/dashboard' : '/status'}
            className="shrink-0 text-base font-semibold tracking-tight text-ink no-underline"
          >
            {tCommon('appName')}
          </Link>
          <nav className="hidden items-center gap-1 sm:flex">
            {session ? (
              <>
                <Link href="/dashboard" className={navLink}>
                  {t('dashboard')}
                </Link>
                <Link href="/workspaces" className={navLink}>
                  {t('workspaces')}
                </Link>
                <Link href="/search" className={navLink}>
                  {t('search')}
                </Link>
                {session.user.isSystemAdmin ? (
                  <Link href="/admin" className={navLink}>
                    {t('admin')}
                  </Link>
                ) : null}
              </>
            ) : null}
            <Link href="/status" className={navLink}>
              {t('status')}
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <LanguageSwitcher />
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
            <Link
              href="/login"
              className="inline-flex rounded-md border border-line-strong bg-panel-solid px-3.5 py-2 text-sm font-medium text-ink no-underline transition hover:bg-brand-soft"
            >
              {tLogin('signIn')}
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
