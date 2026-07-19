import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { MarkdownDocument } from '../../../../../../components/MarkdownDocument';
import { RecordLifecycleActions } from '../../../../../../components/RecordLifecycleActions';
import { apiFetch, requireSession } from '../../../../../../lib/session';

type Workspace = { id: string; slug: string; name: string };
type System = { id: string; name: string; slug: string };
type Project = { id: string; name: string; slug: string };

type KnowledgeRecord = {
  id: string;
  title: string;
  slug: string;
  summary: string | null;
  recordType: string;
  lifecycleStatus: string;
  sourceOfTruthMode: string;
  currentVersionNumber: number;
  contentHtml?: string;
  toc?: Array<{ id: string; text: string; depth: number }>;
  projectId: string | null;
  systemId: string | null;
  tags: Array<{ name: string }>;
  verifiedAt: string | null;
  reviewedBy: string | null;
  lastValidatedAt: string | null;
  createdBy: string;
  updatedAt: string;
  source: {
    sourceType: string;
    sourceProvider: string | null;
    sourceReference: string | null;
    sourceTitle: string | null;
    sourceUri: string | null;
    generatedByModel: string | null;
  } | null;
};

function statusStyles(status: string): { background: string; color: string; label: string } {
  if (status === 'verified' || status === 'current') {
    return { background: '#e3f6ec', color: '#145a36', label: status };
  }
  if (status === 'superseded' || status === 'deprecated') {
    return { background: '#fde8e8', color: '#9b1c1c', label: status };
  }
  if (status === 'draft') {
    return { background: '#f3f4f6', color: '#374151', label: status };
  }
  if (status === 'review_required') {
    return { background: '#fff7e6', color: '#8a5a00', label: status };
  }
  return { background: '#eef2f7', color: '#1f4b73', label: status };
}

export default async function KnowledgeRecordDetailPage({
  params,
}: {
  params: Promise<{ slug: string; recordSlug: string }>;
}) {
  const session = await requireSession();
  const t = await getTranslations('records');
  const tCommon = await getTranslations('common');
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
    knowledgeRecords: Array<{ id: string; slug: string }>;
  };
  const summary = listPayload.knowledgeRecords.find((item) => item.slug === recordSlug);
  if (!summary) {
    notFound();
  }

  const detailResponse = await apiFetch(`/api/v1/knowledge-records/${summary.id}`);
  if (!detailResponse.ok) {
    notFound();
  }
  const detailPayload = (await detailResponse.json()) as { knowledgeRecord: KnowledgeRecord };
  const record = detailPayload.knowledgeRecord;

  const [projectsResponse, systemsResponse] = await Promise.all([
    apiFetch(`/api/v1/projects?workspaceId=${workspace.id}`),
    apiFetch(`/api/v1/systems?workspaceId=${workspace.id}`),
  ]);
  const projects = projectsResponse.ok
    ? ((await projectsResponse.json()) as { projects: Project[] }).projects
    : [];
  const systems = systemsResponse.ok
    ? ((await systemsResponse.json()) as { systems: System[] }).systems
    : [];
  const project = projects.find((item) => item.id === record.projectId);
  const system = systems.find((item) => item.id === record.systemId);

  const canMutate =
    session.user.isSystemAdmin ||
    session.memberships.some(
      (membership) =>
        membership.workspaceId === workspace.id &&
        (membership.role === 'workspace_admin' || membership.role === 'maintainer'),
    );

  const status = statusStyles(record.lifecycleStatus);
  const dash = tCommon('emDash');

  return (
    <main style={{ maxWidth: 1000, margin: '0 auto' }}>
      <p style={{ opacity: 0.7 }}>
        <Link href={`/workspaces/${workspace.slug}`}>{workspace.name}</Link> / {tCommon('knowledge')}
      </p>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'start' }}>
        <div>
          <h1 style={{ marginBottom: '0.35rem' }}>{record.title}</h1>
          <p style={{ opacity: 0.7, marginTop: 0 }}>
            {record.slug} · {record.recordType}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.85rem', alignItems: 'center' }}>
          <Link href={`/workspaces/${workspace.slug}/records/${record.slug}/history`}>
            {t('history')}
          </Link>
          {canMutate ? (
            <Link href={`/workspaces/${workspace.slug}/records/${record.slug}/edit`}>
              {tCommon('edit')}
            </Link>
          ) : null}
        </div>
      </div>

      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.75rem', alignItems: 'center' }}>
        <span
          style={{
            display: 'inline-block',
            padding: '0.25rem 0.55rem',
            background: status.background,
            color: status.color,
            fontWeight: 600,
            fontSize: '0.85rem',
          }}
        >
          {status.label}
        </span>
        <span
          style={{
            display: 'inline-block',
            padding: '0.25rem 0.55rem',
            background: '#eef2f7',
            color: '#1f4b73',
            fontSize: '0.85rem',
          }}
        >
          {record.sourceOfTruthMode}
        </span>
        <span style={{ opacity: 0.7, fontSize: '0.85rem' }}>
          v{record.currentVersionNumber}
        </span>
        {canMutate ? (
          <RecordLifecycleActions
            recordId={record.id}
            lifecycleStatus={record.lifecycleStatus}
          />
        ) : null}
      </div>

      {record.lifecycleStatus === 'superseded' ? (
        <p
          style={{
            marginTop: '1rem',
            padding: '0.75rem 1rem',
            background: '#fde8e8',
            color: '#9b1c1c',
            border: '1px solid rgba(155,28,28,0.2)',
          }}
        >
          {t('supersededWarning')}
        </p>
      ) : null}

      <section
        style={{
          marginTop: '1.25rem',
          padding: '1.1rem',
          background: 'rgba(255,255,255,0.72)',
          border: '1px solid rgba(21,32,43,0.08)',
          display: 'grid',
          gap: '0.35rem',
        }}
      >
        <p style={{ margin: 0 }}>{record.summary || tCommon('noSummary')}</p>
        {project ? (
          <p style={{ margin: 0, opacity: 0.8 }}>
            {tCommon('project')}:{' '}
            <Link href={`/workspaces/${workspace.slug}/projects/${project.slug}`}>
              {project.name}
            </Link>
          </p>
        ) : null}
        {system ? (
          <p style={{ margin: 0, opacity: 0.8 }}>
            {tCommon('system')}:{' '}
            <Link href={`/workspaces/${workspace.slug}/systems/${system.slug}`}>
              {system.name}
            </Link>
          </p>
        ) : null}
        {record.tags.length > 0 ? (
          <p style={{ margin: 0, opacity: 0.75 }}>
            {tCommon('tagsList', { tags: record.tags.map((tag) => tag.name).join(', ') })}
          </p>
        ) : null}
      </section>

      <section
        style={{
          marginTop: '1rem',
          padding: '1.1rem',
          background: 'rgba(255,255,255,0.72)',
          border: '1px solid rgba(21,32,43,0.08)',
        }}
      >
        <h2 style={{ marginTop: 0, fontSize: '1.05rem' }}>{t('sourceAndVerification')}</h2>
        <dl
          style={{
            display: 'grid',
            gridTemplateColumns: '160px 1fr',
            gap: '0.35rem 0.75rem',
            margin: 0,
          }}
        >
          <dt style={{ opacity: 0.7 }}>{t('sourceType')}</dt>
          <dd style={{ margin: 0 }}>{record.source?.sourceType ?? dash}</dd>
          <dt style={{ opacity: 0.7 }}>{t('sourceTitle')}</dt>
          <dd style={{ margin: 0 }}>{record.source?.sourceTitle ?? dash}</dd>
          <dt style={{ opacity: 0.7 }}>{t('provider')}</dt>
          <dd style={{ margin: 0 }}>{record.source?.sourceProvider ?? dash}</dd>
          <dt style={{ opacity: 0.7 }}>{t('reference')}</dt>
          <dd style={{ margin: 0 }}>{record.source?.sourceReference ?? dash}</dd>
          <dt style={{ opacity: 0.7 }}>{t('uri')}</dt>
          <dd style={{ margin: 0 }}>
            {record.source?.sourceUri ? (
              <a href={record.source.sourceUri}>{record.source.sourceUri}</a>
            ) : (
              dash
            )}
          </dd>
          <dt style={{ opacity: 0.7 }}>{t('model')}</dt>
          <dd style={{ margin: 0 }}>{record.source?.generatedByModel ?? dash}</dd>
          <dt style={{ opacity: 0.7 }}>{t('verifiedAt')}</dt>
          <dd style={{ margin: 0 }}>{record.verifiedAt ?? dash}</dd>
          <dt style={{ opacity: 0.7 }}>{t('reviewedBy')}</dt>
          <dd style={{ margin: 0 }}>{record.reviewedBy ?? dash}</dd>
          <dt style={{ opacity: 0.7 }}>{t('lastValidated')}</dt>
          <dd style={{ margin: 0 }}>{record.lastValidatedAt ?? dash}</dd>
          <dt style={{ opacity: 0.7 }}>{tCommon('updated')}</dt>
          <dd style={{ margin: 0 }}>{record.updatedAt}</dd>
        </dl>
      </section>

      <section
        style={{
          marginTop: '1.5rem',
          padding: '1.25rem',
          background: 'rgba(255,255,255,0.8)',
          border: '1px solid rgba(21,32,43,0.08)',
        }}
      >
        <MarkdownDocument html={record.contentHtml ?? ''} toc={record.toc ?? []} />
      </section>
    </main>
  );
}
