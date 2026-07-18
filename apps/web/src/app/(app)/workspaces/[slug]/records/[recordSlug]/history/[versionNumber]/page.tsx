import Link from 'next/link';
import { notFound } from 'next/navigation';
import { MarkdownDocument } from '../../../../../../../../components/MarkdownDocument';
import { VersionRestoreButton } from '../../../../../../../../components/VersionRestoreButton';
import { apiFetch, requireSession } from '../../../../../../../../lib/session';

type Workspace = { id: string; slug: string; name: string };

export default async function KnowledgeVersionDetailPage({
  params,
}: {
  params: Promise<{ slug: string; recordSlug: string; versionNumber: string }>;
}) {
  const session = await requireSession();
  const { slug, recordSlug, versionNumber } = await params;
  const versionNum = Number(versionNumber);
  if (!Number.isInteger(versionNum) || versionNum < 1) {
    notFound();
  }

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
    knowledgeRecords: Array<{ id: string; slug: string; title: string }>;
  };
  const record = listPayload.knowledgeRecords.find((item) => item.slug === recordSlug);
  if (!record) {
    notFound();
  }

  const versionResponse = await apiFetch(
    `/api/v1/knowledge-records/${record.id}/versions/${versionNum}`,
  );
  if (!versionResponse.ok) {
    notFound();
  }
  const versionPayload = (await versionResponse.json()) as {
    version: {
      versionNumber: number;
      title: string;
      lifecycleStatus: string;
      changeMessage: string | null;
      contentHtml?: string;
      toc?: Array<{ id: string; text: string; depth: number }>;
      isCurrent: boolean;
      isHistorical: boolean;
      createdAt: string;
    };
  };
  const version = versionPayload.version;

  const canMutate =
    session.user.isSystemAdmin ||
    session.memberships.some(
      (membership) =>
        membership.workspaceId === workspace.id &&
        (membership.role === 'workspace_admin' || membership.role === 'maintainer'),
    );

  return (
    <main style={{ maxWidth: 1000, margin: '0 auto' }}>
      <p style={{ opacity: 0.7 }}>
        <Link href={`/workspaces/${workspace.slug}/records/${record.slug}/history`}>
          Version history
        </Link>
        {` / v${version.versionNumber}`}
      </p>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem' }}>
        <div>
          <h1 style={{ marginBottom: '0.35rem' }}>
            {version.title}{' '}
            <span style={{ fontSize: '1rem', opacity: 0.7 }}>v{version.versionNumber}</span>
          </h1>
          <p style={{ opacity: 0.7, marginTop: 0 }}>
            {version.lifecycleStatus} · {version.createdAt}
          </p>
        </div>
        {canMutate && version.isHistorical ? (
          <VersionRestoreButton
            recordId={record.id}
            versionNumber={version.versionNumber}
            workspaceSlug={workspace.slug}
            recordSlug={record.slug}
          />
        ) : null}
      </div>

      {version.isHistorical ? (
        <p
          style={{
            padding: '0.75rem 1rem',
            background: '#fff7e6',
            color: '#8a5a00',
            border: '1px solid rgba(138,90,0,0.2)',
          }}
        >
          You are viewing a historical version. It is read-only; restoring creates a new version.
        </p>
      ) : null}

      {version.changeMessage ? (
        <p style={{ opacity: 0.8 }}>Change message: {version.changeMessage}</p>
      ) : null}

      <section
        style={{
          marginTop: '1.25rem',
          padding: '1.25rem',
          background: 'rgba(255,255,255,0.8)',
          border: '1px solid rgba(21,32,43,0.08)',
        }}
      >
        <MarkdownDocument html={version.contentHtml ?? ''} toc={version.toc ?? []} />
      </section>
    </main>
  );
}
