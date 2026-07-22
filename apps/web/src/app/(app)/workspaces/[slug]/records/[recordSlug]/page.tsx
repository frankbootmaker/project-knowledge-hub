import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { KnowledgeRecordDetailActions } from '../../../../../../components/KnowledgeRecordDetailActions';
import { KnowledgeRecordMoreDetails } from '../../../../../../components/KnowledgeRecordMoreDetails';
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
  contentMarkdown: string;
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
  archivedAt: string | null;
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
  const tArchive = await getTranslations('archive');
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
    `/api/v1/knowledge-records?workspaceId=${workspace.id}&includeArchived=true`,
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
  const isArchived = Boolean(record.archivedAt);

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
  const canPurge =
    session.user.isSystemAdmin ||
    session.memberships.some(
      (membership) =>
        membership.workspaceId === workspace.id &&
        membership.role === 'workspace_admin',
    );
  const gitManaged = record.sourceOfTruthMode === 'git_managed';

  const dash = tCommon('emDash');

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
          <KnowledgeRecordDetailActions
            workspaceSlug={workspace.slug}
            workspaceId={workspace.id}
            record={{
              id: record.id,
              title: record.title,
              slug: record.slug,
              summary: record.summary,
              recordType: record.recordType,
              lifecycleStatus: record.lifecycleStatus,
              sourceOfTruthMode: record.sourceOfTruthMode,
              currentVersionNumber: record.currentVersionNumber,
              updatedAt: record.updatedAt,
              archivedAt: record.archivedAt,
              tags: record.tags,
              projectName: project?.name ?? null,
              systemName: system?.name ?? null,
              verifiedAt: record.verifiedAt,
              reviewedBy: record.reviewedBy,
              lastValidatedAt: record.lastValidatedAt,
              source: record.source,
            }}
            editorInitial={{
              id: record.id,
              title: record.title,
              summary: record.summary,
              recordType: record.recordType,
              lifecycleStatus: record.lifecycleStatus,
              sourceOfTruthMode: record.sourceOfTruthMode,
              contentMarkdown: record.contentMarkdown,
              projectId: record.projectId,
              systemId: record.systemId,
              tags: record.tags,
              source: record.source,
            }}
            projects={projects}
            systems={systems}
            canMutate={canMutate}
            canPurge={canPurge}
          />
        }
      />

      {record.lifecycleStatus === 'superseded' ? (
        <p className="mb-4 rounded-md border border-danger/20 bg-danger-soft px-4 py-3 text-danger">
          {t('supersededWarning')}
        </p>
      ) : null}

      <KnowledgeRecordMoreDetails
        leading={
          <>
            <Badge tone={lifecycleTone(record.lifecycleStatus)}>
              {record.lifecycleStatus}
            </Badge>
            <Badge tone="brand">{record.sourceOfTruthMode}</Badge>
            {isArchived ? <Badge tone="warn">{tArchive('archivedBadge')}</Badge> : null}
            <span className="text-sm text-ink-muted">v{record.currentVersionNumber}</span>
            {canMutate && !isArchived && !gitManaged ? (
              <RecordLifecycleActions
                recordId={record.id}
                lifecycleStatus={record.lifecycleStatus}
              />
            ) : null}
            {gitManaged && record.source?.sourceUri ? (
              <a
                href={record.source.sourceUri}
                target="_blank"
                rel="noreferrer"
                className="text-sm font-medium text-brand no-underline hover:text-brand-hover"
              >
                {t('viewOnGitHub')}
              </a>
            ) : null}
          </>
        }
        summary={<p className="m-0">{record.summary || tCommon('noSummary')}</p>}
        links={
          <>
            {project ? (
              <p className="m-0 text-ink-muted">
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
              <p className="m-0 text-ink-muted">
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
                {tCommon('tagsList', {
                  tags: record.tags.map((tag) => tag.name).join(', '),
                })}
              </p>
            ) : null}
          </>
        }
        sourceRows={[
          { label: t('sourceType'), value: record.source?.sourceType ?? dash },
          { label: t('sourceTitle'), value: record.source?.sourceTitle ?? dash },
          { label: t('provider'), value: record.source?.sourceProvider ?? dash },
          { label: t('reference'), value: record.source?.sourceReference ?? dash },
          {
            label: t('uri'),
            value: record.source?.sourceUri ? (
              <a href={record.source.sourceUri}>{record.source.sourceUri}</a>
            ) : (
              dash
            ),
          },
          { label: t('model'), value: record.source?.generatedByModel ?? dash },
          { label: t('verifiedAt'), value: record.verifiedAt ?? dash },
          { label: t('reviewedBy'), value: record.reviewedBy ?? dash },
          { label: t('lastValidated'), value: record.lastValidatedAt ?? dash },
          { label: tCommon('updated'), value: record.updatedAt },
        ]}
      />

      <Panel>
        <MarkdownDocument html={record.contentHtml ?? ''} toc={record.toc ?? []} />
      </Panel>
    </Page>
  );
}
