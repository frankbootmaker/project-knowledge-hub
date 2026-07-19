import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { MarkdownDocument } from '../../../../../../components/MarkdownDocument';
import { RecordLifecycleActions } from '../../../../../../components/RecordLifecycleActions';
import {
  Badge,
  Page,
  PageHeader,
  Panel,
  lifecycleTone,
} from '../../../../../../components/ui';
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

  const dash = tCommon('emDash');
  const linkClass = 'text-sm font-medium text-brand no-underline hover:text-brand-hover';

  return (
    <Page wide>
      <PageHeader
        eyebrow={
          <>
            <Link
              href={`/workspaces/${workspace.slug}`}
              className="text-brand no-underline hover:text-brand-hover"
            >
              {workspace.name}
            </Link>
            {' / '}
            {tCommon('knowledge')}
          </>
        }
        title={record.title}
        description={`${record.slug} · ${record.recordType}`}
        actions={
          <>
            <Link
              href={`/workspaces/${workspace.slug}/records/${record.slug}/history`}
              className={linkClass}
            >
              {t('history')}
            </Link>
            {canMutate ? (
              <Link
                href={`/workspaces/${workspace.slug}/records/${record.slug}/edit`}
                className={linkClass}
              >
                {tCommon('edit')}
              </Link>
            ) : null}
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Badge tone={lifecycleTone(record.lifecycleStatus)}>
          {record.lifecycleStatus}
        </Badge>
        <Badge tone="brand">{record.sourceOfTruthMode}</Badge>
        <span className="text-sm text-ink-muted">v{record.currentVersionNumber}</span>
        {canMutate ? (
          <RecordLifecycleActions
            recordId={record.id}
            lifecycleStatus={record.lifecycleStatus}
          />
        ) : null}
      </div>

      {record.lifecycleStatus === 'superseded' ? (
        <p className="mb-4 rounded-md border border-danger/20 bg-danger-soft px-4 py-3 text-danger">
          {t('supersededWarning')}
        </p>
      ) : null}

      <Panel className="mb-4 grid gap-2">
        <p className="m-0">{record.summary || tCommon('noSummary')}</p>
        {project ? (
          <p className="m-0 text-sm text-ink-muted">
            {tCommon('project')}:{' '}
            <Link
              href={`/workspaces/${workspace.slug}/projects/${project.slug}`}
              className="text-brand no-underline hover:text-brand-hover"
            >
              {project.name}
            </Link>
          </p>
        ) : null}
        {system ? (
          <p className="m-0 text-sm text-ink-muted">
            {tCommon('system')}:{' '}
            <Link
              href={`/workspaces/${workspace.slug}/systems/${system.slug}`}
              className="text-brand no-underline hover:text-brand-hover"
            >
              {system.name}
            </Link>
          </p>
        ) : null}
        {record.tags.length > 0 ? (
          <p className="m-0 text-xs text-ink-muted">
            {tCommon('tagsList', { tags: record.tags.map((tag) => tag.name).join(', ') })}
          </p>
        ) : null}
      </Panel>

      <Panel className="mb-6">
        <h2 className="mt-0 mb-3 text-base font-semibold">{t('sourceAndVerification')}</h2>
        <dl className="m-0 grid grid-cols-[160px_1fr] gap-x-3 gap-y-1.5">
          <dt className="text-ink-muted">{t('sourceType')}</dt>
          <dd className="m-0">{record.source?.sourceType ?? dash}</dd>
          <dt className="text-ink-muted">{t('sourceTitle')}</dt>
          <dd className="m-0">{record.source?.sourceTitle ?? dash}</dd>
          <dt className="text-ink-muted">{t('provider')}</dt>
          <dd className="m-0">{record.source?.sourceProvider ?? dash}</dd>
          <dt className="text-ink-muted">{t('reference')}</dt>
          <dd className="m-0">{record.source?.sourceReference ?? dash}</dd>
          <dt className="text-ink-muted">{t('uri')}</dt>
          <dd className="m-0">
            {record.source?.sourceUri ? (
              <a href={record.source.sourceUri}>{record.source.sourceUri}</a>
            ) : (
              dash
            )}
          </dd>
          <dt className="text-ink-muted">{t('model')}</dt>
          <dd className="m-0">{record.source?.generatedByModel ?? dash}</dd>
          <dt className="text-ink-muted">{t('verifiedAt')}</dt>
          <dd className="m-0">{record.verifiedAt ?? dash}</dd>
          <dt className="text-ink-muted">{t('reviewedBy')}</dt>
          <dd className="m-0">{record.reviewedBy ?? dash}</dd>
          <dt className="text-ink-muted">{t('lastValidated')}</dt>
          <dd className="m-0">{record.lastValidatedAt ?? dash}</dd>
          <dt className="text-ink-muted">{tCommon('updated')}</dt>
          <dd className="m-0">{record.updatedAt}</dd>
        </dl>
      </Panel>

      <Panel>
        <MarkdownDocument html={record.contentHtml ?? ''} toc={record.toc ?? []} />
      </Panel>
    </Page>
  );
}
