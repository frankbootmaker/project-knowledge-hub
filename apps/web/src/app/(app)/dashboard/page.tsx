import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { requireSession } from '../../../lib/session';

export default async function DashboardPage() {
  const session = await requireSession();
  const t = await getTranslations('dashboard');

  return (
    <main style={{ maxWidth: 880, margin: '0 auto' }}>
      <h1 style={{ marginBottom: '0.35rem' }}>{t('title')}</h1>
      <p style={{ opacity: 0.75 }}>
        {t('signedInAs', { email: session.user.email })}
        {session.user.isSystemAdmin ? ` ${t('systemAdmin')}` : ''}.
      </p>
      <section
        style={{
          marginTop: '1.5rem',
          padding: '1.25rem',
          background: 'rgba(255,255,255,0.72)',
          border: '1px solid rgba(21,32,43,0.08)',
        }}
      >
        <h2 style={{ marginTop: 0 }}>{t('getStarted')}</h2>
        <ul>
          <li>
            <Link href="/workspaces">{t('browseWorkspaces')}</Link>
          </li>
          {session.user.isSystemAdmin ? (
            <li>
              <Link href="/workspaces/new">{t('createWorkspace')}</Link>
            </li>
          ) : null}
        </ul>
      </section>
    </main>
  );
}
