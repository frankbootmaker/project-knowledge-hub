import Link from 'next/link';
import { requireSession } from '../../../lib/session';

export default async function DashboardPage() {
  const session = await requireSession();

  return (
    <main style={{ maxWidth: 880, margin: '0 auto' }}>
      <h1 style={{ marginBottom: '0.35rem' }}>Dashboard</h1>
      <p style={{ opacity: 0.75 }}>
        Signed in as {session.user.email}
        {session.user.isSystemAdmin ? ' (system administrator)' : ''}.
      </p>
      <section
        style={{
          marginTop: '1.5rem',
          padding: '1.25rem',
          background: 'rgba(255,255,255,0.72)',
          border: '1px solid rgba(21,32,43,0.08)',
        }}
      >
        <h2 style={{ marginTop: 0 }}>Get started</h2>
        <ul>
          <li>
            <Link href="/workspaces">Browse workspaces</Link>
          </li>
          {session.user.isSystemAdmin ? (
            <li>
              <Link href="/workspaces/new">Create a workspace</Link>
            </li>
          ) : null}
        </ul>
      </section>
    </main>
  );
}
