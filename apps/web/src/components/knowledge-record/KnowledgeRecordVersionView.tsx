import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { MarkdownDocument } from '../MarkdownDocument';
import { VersionRestoreButton } from '../VersionRestoreButton';
import { RegisterShellCrumbs } from '../ops/ShellCrumbContext';
import { Badge, Page, PageHeader, lifecycleLabel, lifecycleTone } from '../ui';
import { recordHref } from '../../lib/record-href';
import {
  canMutateWorkspace,
  ensureRecordInProject,
  requireProjectBySlug,
  requireWorkspaceBySlug,
  type ProjectRecordContext,
} from '../../lib/project-record-access';
import { apiFetch, requireSession } from '../../lib/session';

export async function KnowledgeRecordVersionView({
  workspaceSlug,
  recordSlug,
  versionNumber,
  projectContext,
}: {
  workspaceSlug: string;
  recordSlug: string;
  versionNumber: string;
  projectContext?: ProjectRecordContext;
}) {
  const session = await requireSession();
  const t = await getTranslations('records');
  const versionNum = Number(versionNumber);
  if (!Number.isInteger(versionNum) || versionNum < 1) {
    notFound();
  }

  const workspace = await requireWorkspaceBySlug(workspaceSlug);
  const routeProject = projectContext
    ? await requireProjectBySlug(workspace.id, projectContext.projectSlug)
    : null;

  const listResponse = await apiFetch(`/api/v1/knowledge-records?workspaceId=${workspace.id}`);
  if (!listResponse.ok) {
    notFound();
  }
  const listPayload = (await listResponse.json()) as {
    knowledgeRecords: Array<{
      id: string;
      slug: string;
      title: string;
      projectId: string | null;
    }>;
  };
  const record = listPayload.knowledgeRecords.find((item) => item.slug === recordSlug);
  if (!record) {
    notFound();
  }
  if (routeProject) {
    await ensureRecordInProject({
      workspaceSlug: workspace.slug,
      project: routeProject,
      record,
    });
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
  const canMutate = canMutateWorkspace(session, workspace.id);
  const recordBasePath = recordHref({
    workspaceSlug: workspace.slug,
    projectSlug: routeProject?.slug,
    recordSlug: record.slug,
  });

  return (
    <Page wide>
      {routeProject ? (
        <RegisterShellCrumbs projectName={routeProject.name} recordTitle={record.title} />
      ) : null}
      <PageHeader
        eyebrow={
          <>
            <Link
              href={recordHref({
                workspaceSlug: workspace.slug,
                projectSlug: routeProject?.slug,
                recordSlug: record.slug,
                suffix: 'history',
              })}
              className="text-brand no-underline hover:text-brand-hover"
            >
              {t('versionHistory')}
            </Link>
            {` / v${version.versionNumber}`}
          </>
        }
        title={
          <>
            {version.title}{' '}
            <span className="text-lg font-normal text-ink-muted">v{version.versionNumber}</span>
          </>
        }
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <Badge tone={lifecycleTone(version.lifecycleStatus)}>
              {lifecycleLabel(version.lifecycleStatus, t)}
            </Badge>
            <span>{version.createdAt}</span>
          </span>
        }
        actions={
          canMutate && version.isHistorical ? (
            <VersionRestoreButton
              recordId={record.id}
              versionNumber={version.versionNumber}
              workspaceSlug={workspace.slug}
              recordSlug={record.slug}
              recordBasePath={recordBasePath}
            />
          ) : null
        }
      />

      {version.isHistorical ? (
        <p className="kh-ops-status-row mb-3" data-tone="warn">
          {t('historicalWarningDetail')}
        </p>
      ) : null}

      {version.changeMessage ? (
        <p className="mb-3 text-ink-muted">
          {t('changeMessageLabel', { message: version.changeMessage })}
        </p>
      ) : null}

      <section className="kh-ops-panel min-w-0 overflow-hidden">
        <MarkdownDocument
          html={version.contentHtml ?? ''}
          toc={version.toc ?? []}
          title={version.title}
        />
      </section>
    </Page>
  );
}
