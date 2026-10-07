import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { VersionRestoreButton } from '../VersionRestoreButton';
import { RegisterShellCrumbs } from '../ops/ShellCrumbContext';
import { Badge, Page, PageHeader, lifecycleLabel } from '../ui';
import { recordHref } from '../../lib/record-href';
import {
  canMutateWorkspace,
  ensureRecordInProject,
  requireProjectBySlug,
  requireWorkspaceBySlug,
  type ProjectRecordContext,
} from '../../lib/project-record-access';
import { apiFetch, requireSession } from '../../lib/session';

type Version = {
  versionNumber: number;
  title: string;
  lifecycleStatus: string;
  changeMessage: string | null;
  createdAt: string;
  createdBy: string;
};

export async function KnowledgeRecordHistoryView({
  workspaceSlug,
  recordSlug,
  projectContext,
}: {
  workspaceSlug: string;
  recordSlug: string;
  projectContext?: ProjectRecordContext;
}) {
  const session = await requireSession();
  const t = await getTranslations('records');
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
      currentVersionNumber: number;
      lifecycleStatus: string;
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

  const versionsResponse = await apiFetch(`/api/v1/knowledge-records/${record.id}/versions`);
  if (!versionsResponse.ok) {
    notFound();
  }
  const versionsPayload = (await versionsResponse.json()) as {
    versions: Version[];
    currentVersionNumber: number;
  };

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
              href={`/workspaces/${workspace.slug}`}
              className="text-brand no-underline hover:text-brand-hover"
            >
              {workspace.name}
            </Link>
            {' / '}
            <Link href={recordBasePath} className="text-brand no-underline hover:text-brand-hover">
              {record.title}
            </Link>
            {' / '}
            {t('history')}
          </>
        }
        title={t('versionHistory')}
        description={t('currentVersion', {
          version: versionsPayload.currentVersionNumber,
          status: lifecycleLabel(record.lifecycleStatus, t),
        })}
      />

      <section className="kh-ops-panel">
        <ul className="kh-ops-history-list">
          {versionsPayload.versions.map((version) => {
            const isCurrent = version.versionNumber === versionsPayload.currentVersionNumber;
            const isHistorical = !isCurrent;
            return (
              <li key={version.versionNumber} className="kh-ops-history-item">
                <span className="kh-ops-code-box">{version.versionNumber}</span>
                <div className="min-w-0">
                  <h3>{version.title}</h3>
                  <div className="kh-ops-history-meta">
                    <span>{version.createdAt}</span>
                    {version.changeMessage ? <span>{version.changeMessage}</span> : null}
                  </div>
                  {isHistorical ? (
                    <p className="mt-2 mb-0 text-xs text-warn">{t('historicalWarningList')}</p>
                  ) : null}
                </div>
                <div className="grid shrink-0 justify-items-end gap-2">
                  {isCurrent ? (
                    <Badge tone="success">{t('current')}</Badge>
                  ) : (
                    <Badge tone="warn">{t('historical')}</Badge>
                  )}
                  <Link
                    href={recordHref({
                      workspaceSlug: workspace.slug,
                      projectSlug: routeProject?.slug,
                      recordSlug: record.slug,
                      suffix: `history/${version.versionNumber}`,
                    })}
                    className="kh-ops-text-btn no-underline"
                  >
                    {t('view')}
                  </Link>
                  {canMutate && isHistorical ? (
                    <VersionRestoreButton
                      recordId={record.id}
                      versionNumber={version.versionNumber}
                      workspaceSlug={workspace.slug}
                      recordSlug={record.slug}
                      recordBasePath={recordBasePath}
                    />
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </Page>
  );
}
