import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { LocalDateTime } from '../LocalDateTime';
import { KnowledgeRecordDetailActions } from '../KnowledgeRecordDetailActions';
import {
  KnowledgeRecordLinkedItems,
  type KnowledgeRecordLinkedItemsPayload,
} from '../KnowledgeRecordLinkedItems';
import { KnowledgeRecordMoreDetails } from '../KnowledgeRecordMoreDetails';
import { MarkdownDocument } from '../MarkdownDocument';
import { PanelBackLink } from '../PanelBackLink';
import { RecordLifecycleActions } from '../RecordLifecycleActions';
import { RecordTranslationSwitcher } from '../RecordTranslationSwitcher';
import { RegisterShellCrumbs } from '../ops/ShellCrumbContext';
import { Badge, Page, PageHeader, lifecycleLabel, lifecycleTone } from '../ui';
import { recordHref } from '../../lib/record-href';
import {
  canMutateWorkspace,
  canPurgeWorkspace,
  ensureRecordInProject,
  requireProjectBySlug,
  requireWorkspaceBySlug,
  type ProjectRecordContext,
} from '../../lib/project-record-access';
import { apiFetch, requireSession } from '../../lib/session';

type System = { id: string; name: string; slug: string };
type Project = { id: string; name: string; slug: string };

type KnowledgeRecord = {
  id: string;
  title: string;
  slug: string;
  summary: string | null;
  recordType: string;
  humanKey?: string | null;
  language?: string | null;
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
  reviewedByUser: {
    id: string;
    displayName: string;
    email: string;
  } | null;
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

export async function KnowledgeRecordDetailView({
  workspaceSlug,
  recordSlug,
  projectContext,
}: {
  workspaceSlug: string;
  recordSlug: string;
  projectContext?: ProjectRecordContext;
}) {
  const session = await requireSession();
  const locale = await getLocale();
  const t = await getTranslations('records');
  const tArchive = await getTranslations('archive');
  const tCommon = await getTranslations('common');

  const workspace = await requireWorkspaceBySlug(workspaceSlug);
  const routeProject = projectContext
    ? await requireProjectBySlug(workspace.id, projectContext.projectSlug)
    : null;

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
  if (routeProject) {
    await ensureRecordInProject({
      workspaceSlug: workspace.slug,
      project: routeProject,
      record,
    });
  }
  const isArchived = Boolean(record.archivedAt);

  const [projectsResponse, systemsResponse, llmCapabilitiesResponse] = await Promise.all([
    apiFetch(`/api/v1/projects?workspaceId=${workspace.id}`),
    apiFetch(`/api/v1/systems?workspaceId=${workspace.id}`),
    apiFetch('/api/v1/llm/capabilities'),
  ]);
  const projects = projectsResponse.ok
    ? ((await projectsResponse.json()) as { projects: Project[] }).projects
    : [];
  const systems = systemsResponse.ok
    ? ((await systemsResponse.json()) as { systems: System[] }).systems
    : [];
  const translationConfigured = llmCapabilitiesResponse.ok
    ? Boolean(
        (
          (await llmCapabilitiesResponse.json()) as {
            translationConfigured?: boolean;
          }
        ).translationConfigured,
      )
    : false;
  const project = projects.find((item) => item.id === record.projectId);
  const system = systems.find((item) => item.id === record.systemId);

  const canMutate = canMutateWorkspace(session, workspace.id);
  const canPurge = canPurgeWorkspace(session, workspace.id);
  const gitManaged = record.sourceOfTruthMode === 'git_managed';
  const recordBasePath = recordHref({
    workspaceSlug: workspace.slug,
    projectSlug: routeProject?.slug,
    recordSlug: record.slug,
  });
  const knowledgeProject = routeProject ?? project;
  const knowledgeListHref = knowledgeProject
    ? `/workspaces/${workspace.slug}/projects/${knowledgeProject.slug}#project-knowledge`
    : `/workspaces/${workspace.slug}`;
  const knowledgeListLabel = knowledgeProject?.name ?? t('eyebrow');

  const [translationsResponse, linksResponse] = await Promise.all([
    apiFetch(`/api/v1/knowledge-records/${record.id}/translations`),
    apiFetch(`/api/v1/knowledge-records/${record.id}/linked-items`),
  ]);
  const linkedItems: KnowledgeRecordLinkedItemsPayload = linksResponse.ok
    ? (
        (await linksResponse.json()) as {
          linkedItems: KnowledgeRecordLinkedItemsPayload;
        }
      ).linkedItems
    : { deliveryLinks: [], raidLinks: [], changeItems: [] };
  const translations = translationsResponse.ok
    ? (
        (await translationsResponse.json()) as {
          translations: Array<{
            id: string;
            slug: string;
            language: string | null;
            title: string;
            lifecycleStatus: string;
          }>;
        }
      ).translations
    : [];

  const dash = tCommon('emDash');

  return (
    <Page wide>
      {routeProject ? (
        <RegisterShellCrumbs projectName={routeProject.name} recordTitle={record.title} />
      ) : null}
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
            <Link
              href={knowledgeListHref}
              className="text-brand no-underline hover:text-brand-hover"
            >
              {knowledgeListLabel}
            </Link>
          </>
        }
        title={record.humanKey ? `${record.humanKey} · ${record.title}` : record.title}
        description={`${record.slug} · ${record.recordType} · ${record.language ?? 'en'}`}
        actions={
          <span className="inline-flex flex-wrap items-center gap-2">
            <Badge tone={lifecycleTone(record.lifecycleStatus)}>
              {lifecycleLabel(record.lifecycleStatus, t)}
            </Badge>
            {isArchived ? <Badge tone="warn">{tArchive('archivedBadge')}</Badge> : null}
          </span>
        }
      />
      {record.lifecycleStatus === 'superseded' ? (
        <p className="kh-ops-status-row mb-3" data-tone="danger">
          {t('supersededWarning')}
        </p>
      ) : null}
      <div className="kh-ops-detail-grid">
        <div className="min-w-0">
        <article className="kh-ops-panel min-w-0 overflow-hidden">
          <div className="kh-ops-record-head">
            <div className="kh-ops-history-meta">
              {record.humanKey ? (
                <span className="kh-ops-key-badge">{record.humanKey}</span>
              ) : (
                <span>{record.slug}</span>
              )}
              <span>{record.recordType}</span>
              <span>v{record.currentVersionNumber}</span>
              <span>{record.language ?? 'en'}</span>
            </div>
            <h1>{record.title}</h1>
            <span className="inline-flex flex-wrap items-center gap-2">
              <Badge tone={lifecycleTone(record.lifecycleStatus)}>
                {lifecycleLabel(record.lifecycleStatus, t)}
              </Badge>
              {isArchived ? <Badge tone="warn">{tArchive('archivedBadge')}</Badge> : null}
            </span>
          </div>
          <div className="kh-ops-manage-strip">
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
                className="kh-ops-text-btn no-underline"
              >
                {t('viewOnGitHub')}
              </a>
            ) : null}
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <KnowledgeRecordDetailActions
                workspaceSlug={workspace.slug}
                workspaceId={workspace.id}
                recordBasePath={recordBasePath}
                record={{
                  id: record.id,
                  title: record.title,
                  slug: record.slug,
                  summary: record.summary,
                  recordType: record.recordType,
                  humanKey: record.humanKey,
                  language: record.language,
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
                  reviewedByUser: record.reviewedByUser,
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
                  language: record.language,
                  projectId: record.projectId,
                  systemId: record.systemId,
                  tags: record.tags,
                  source: record.source,
                }}
                projects={projects}
                systems={systems}
                canMutate={canMutate}
                canPurge={canPurge}
                visionConfigured={translationConfigured}
              />
            </div>
          </div>
          <MarkdownDocument
            html={record.contentHtml ?? ''}
            toc={record.toc ?? []}
            title={record.title}
          />
        </article>
        <PanelBackLink href={knowledgeListHref} divided={false} className="px-0">
          {t('backToList')}
        </PanelBackLink>
        </div>

        <aside className="kh-ops-editor-stack">
          <RecordTranslationSwitcher
            workspaceSlug={workspace.slug}
            recordBasePath={recordBasePath}
            currentRecordId={record.id}
            translations={translations}
          />
          <section className="kh-ops-panel">
            <div className="kh-ops-panel-head">
              <h2 className="kh-ops-panel-title">{tCommon('status')}</h2>
            </div>
            <dl className="kh-ops-keyvals">
              <dt>{t('lifecycleStatus')}</dt>
              <dd>
                <span className="inline-flex flex-wrap items-center gap-2">
                  {lifecycleLabel(record.lifecycleStatus, t)}
                  {isArchived ? <Badge tone="warn">{tArchive('archivedBadge')}</Badge> : null}
                </span>
              </dd>
              <dt>{t('sourceOfTruth')}</dt>
              <dd>{record.sourceOfTruthMode}</dd>
              <dt>{t('contentLanguage')}</dt>
              <dd>{record.language ?? 'en'}</dd>
              <dt>{tCommon('updated')}</dt>
              <dd>
                <LocalDateTime value={record.updatedAt} locale={locale} />
              </dd>
              {isArchived && record.archivedAt ? (
                <>
                  <dt>{tArchive('archivedBadge')}</dt>
                  <dd>
                    <LocalDateTime value={record.archivedAt} locale={locale} />
                  </dd>
                </>
              ) : null}
            </dl>
          </section>
          {record.tags.length > 0 ? (
            <section className="kh-ops-panel">
              <div className="kh-ops-panel-head">
                <h2 className="kh-ops-panel-title">{tCommon('tags')}</h2>
              </div>
              <div className="kh-ops-tag-list">
                {record.tags.map((tag) => (
                  <span key={tag.name} className="kh-ops-tag">
                    {tag.name}
                  </span>
                ))}
              </div>
            </section>
          ) : null}
          <KnowledgeRecordMoreDetails
            summary={<p className="m-0">{record.summary || tCommon('noSummary')}</p>}
            linkedItems={
              <KnowledgeRecordLinkedItems
                workspaceSlug={workspace.slug}
                linkedItems={linkedItems}
              />
            }
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
              </>
            }
            sourceRows={[
              {
                label: t('contentLanguage'),
                value: record.language ?? 'en',
              },
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
              {
                label: t('verifiedAt'),
                value: record.verifiedAt ? (
                  <LocalDateTime value={record.verifiedAt} locale={locale} />
                ) : (
                  dash
                ),
              },
              {
                label: t('reviewedBy'),
                value: record.reviewedByUser
                  ? record.reviewedByUser.email
                    ? `${record.reviewedByUser.displayName} (${record.reviewedByUser.email})`
                    : record.reviewedByUser.displayName
                  : (record.reviewedBy ?? dash),
              },
              {
                label: t('lastValidated'),
                value: record.lastValidatedAt ? (
                  <LocalDateTime value={record.lastValidatedAt} locale={locale} />
                ) : (
                  dash
                ),
              },
              {
                label: tCommon('updated'),
                value: <LocalDateTime value={record.updatedAt} locale={locale} />,
              },
            ]}
          />
        </aside>
      </div>
    </Page>
  );
}
