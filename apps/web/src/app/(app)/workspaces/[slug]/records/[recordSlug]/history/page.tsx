import Link from 'next/link';
import { notFound } from 'next/navigation';
import { VersionRestoreButton } from '../../../../../../../components/VersionRestoreButton';
import { apiFetch, requireSession } from '../../../../../../../lib/session';

type Workspace = { id: string; slug: string; name: string };
type Version = {
  versionNumber: number;
  title: string;
  lifecycleStatus: string;
  changeMessage: string | null;
  createdAt: string;
  createdBy: string;
};

export default async function KnowledgeRecordHistoryPage({
  params,
}: {
  params: Promise<{ slug: string; recordSlug: string }>;
}) {
  const session = await requireSession();
  const { slug, recordSlug } = await params;

  const workspacesResponse = await apiFetch('/api/v1/workspaces');
  if (!workspacesResponse.ok) {
    notFound();
  }
  const workspacesPayload = (await workspacesResponse.json()) as { workspaces: Workspace[] };
  const workspace = workspacesPayload.workspaces.find((item) => item.slug === slug);
  if (!workspace) {
    notFound();
  }

  const listResponse = await apiFetch(
    `/api/v1/knowledge-records?workspaceId=${workspace.id}`,
  );
  if (!listResponse.ok) {
    notFound();
  }
  const listPayload = (await listResponse.json()) as {
    knowledgeRecords: Array<{
      id: string;
      slug: string;
      title: string;
      currentVersionNumber: number;
      lifecycleStatus: string;
    }>;
  };
  const record = listPayload.knowledgeRecords.find((item) => item.slug === recordSlug);
  if (!record) {
    notFound();
  }

  const versionsResponse = await apiFetch(
    `/api/v1/knowledge-records/${record.id}/versions`,
  );
  if (!versionsResponse.ok) {
    notFound();
  }
  const versionsPayload = (await versionsResponse.json()) as {
    versions: Version[];
    currentVersionNumber: number;
  };

  const canMutate =
    session.user.isSystemAdmin ||
    session.memberships.some(
      (membership) =>
        membership.workspaceId === workspace.id &&
        (membership.role === 'workspace_admin' || membership.role === 'maintainer'),
    );

  return (
    <main style={{ maxWidth: 880, margin: '0 auto' }}>
      <p style={{ opacity: 0.7 }}>
        <Link href={`/workspaces/${workspace.slug}`}>{workspace.name}</Link>
        {' / '}
        <Link href={`/workspaces/${workspace.slug}/records/${record.slug}`}>{record.title}</Link>
        {' / history'}
      </p>
      <h1 style={{ marginBottom: '0.35rem' }}>Version history</h1>
      <p style={{ opacity: 0.7, marginTop: 0 }}>
        Current version: {versionsPayload.currentVersionNumber} · status: {record.lifecycleStatus}
      </p>

      <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: '0.75rem', marginTop: '1.25rem' }}>
        {versionsPayload.versions.map((version) => {
          const isCurrent = version.versionNumber === versionsPayload.currentVersionNumber;
          const isHistorical = !isCurrent;
          return (
            <li
              key={version.versionNumber}
              style={{
                padding: '1rem',
                background: 'rgba(255,255,255,0.72)',
                border: '1px solid rgba(21,32,43,0.08)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem' }}>
                <div>
                  <strong>v{version.versionNumber}</strong>{' '}
                  {isCurrent ? (
                    <span style={{ color: '#145a36', fontWeight: 600 }}>current</span>
                  ) : (
                    <span style={{ color: '#8a5a00' }}>historical</span>
                  )}
                  <div style={{ opacity: 0.8, marginTop: '0.35rem' }}>{version.title}</div>
                  <div style={{ opacity: 0.65, fontSize: '0.9rem' }}>
                    {version.lifecycleStatus} · {version.createdAt}
                  </div>
                  {version.changeMessage ? (
                    <div style={{ marginTop: '0.35rem' }}>{version.changeMessage}</div>
                  ) : null}
                  {isHistorical ? (
                    <p
                      style={{
                        margin: '0.65rem 0 0',
                        padding: '0.5rem 0.65rem',
                        background: '#fff7e6',
                        color: '#8a5a00',
                        fontSize: '0.9rem',
                      }}
                    >
                      Historical version — read-only. Restore creates a new version.
                    </p>
                  ) : null}
                </div>
                <div style={{ display: 'grid', gap: '0.5rem', alignContent: 'start' }}>
                  <Link
                    href={`/workspaces/${workspace.slug}/records/${record.slug}/history/${version.versionNumber}`}
                  >
                    View
                  </Link>
                  {canMutate && isHistorical ? (
                    <VersionRestoreButton
                      recordId={record.id}
                      versionNumber={version.versionNumber}
                      workspaceSlug={workspace.slug}
                      recordSlug={record.slug}
                    />
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
