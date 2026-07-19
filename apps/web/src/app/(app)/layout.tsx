import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';
import { LanguageSwitcher } from '../../components/LanguageSwitcher';
import { getSession } from '../../lib/session';

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

export default async function AppShellLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  if (!session) {
    redirect('/login');
  }

  const t = await getTranslations('nav');
  const tCommon = await getTranslations('common');

  return (
    <div style={{ minHeight: '100vh' }}>
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '1rem',
          padding: '1rem 1.5rem',
          borderBottom: '1px solid rgba(21,32,43,0.1)',
          background: 'rgba(255,255,255,0.7)',
        }}
      >
        <div style={{ display: 'flex', gap: '1.25rem', alignItems: 'center' }}>
          <strong>{tCommon('appName')}</strong>
          <nav style={{ display: 'flex', gap: '0.85rem' }}>
            <Link href="/dashboard">{t('dashboard')}</Link>
            <Link href="/workspaces">{t('workspaces')}</Link>
            <Link href="/search">{t('search')}</Link>
            <Link href="/status">{t('status')}</Link>
          </nav>
        </div>
        <div style={{ display: 'flex', gap: '0.85rem', alignItems: 'center' }}>
          <LanguageSwitcher />
          <span style={{ opacity: 0.8 }}>{session.user.displayName}</span>
          <form action={logoutAction}>
            <button
              type="submit"
              style={{
                border: '1px solid rgba(21,32,43,0.2)',
                background: 'transparent',
                padding: '0.4rem 0.7rem',
                cursor: 'pointer',
              }}
            >
              {t('logOut')}
            </button>
          </form>
        </div>
      </header>
      <div style={{ padding: '1.5rem' }}>{children}</div>
    </div>
  );
}
