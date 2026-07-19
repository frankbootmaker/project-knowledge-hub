import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { apiFetch, requireSession } from '../../../lib/session';

type Workspace = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
};

export default async function WorkspacesPage() {
  const session = await requireSession();
  const t = await getTranslations('workspaces');
  const response = await apiFetch('/api/v1/workspaces');
  const payload = response.ok
    ? ((await response.json()) as { workspaces: Workspace[] })
    : { workspaces: [] };

  return (
    <main style={{ maxWidth: 880, margin: '0 auto' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '1rem',
        }}
      >
        <h1 style={{ margin: 0 }}>{t('title')}</h1>
        {session.user.isSystemAdmin ? (
          <Link href="/workspaces/new">{t('new')}</Link>
        ) : null}
      </div>
      <ul style={{ listStyle: 'none', padding: 0, marginTop: '1.5rem', display: 'grid', gap: '0.75rem' }}>
        {payload.workspaces.map((workspace) => (
          <li
            key={workspace.id}
            style={{
              padding: '1rem 1.15rem',
              background: 'rgba(255,255,255,0.72)',
              border: '1px solid rgba(21,32,43,0.08)',
            }}
          >
            <Link href={`/workspaces/${workspace.slug}`}>
              <strong>{workspace.name}</strong>
            </Link>
            <div style={{ opacity: 0.7 }}>{workspace.slug}</div>
            {workspace.description ? <p style={{ marginBottom: 0 }}>{workspace.description}</p> : null}
          </li>
        ))}
        {payload.workspaces.length === 0 ? <li>{t('empty')}</li> : null}
      </ul>
    </main>
  );
}
