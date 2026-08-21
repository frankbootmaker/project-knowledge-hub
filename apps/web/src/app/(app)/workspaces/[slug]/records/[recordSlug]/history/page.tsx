import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { VersionRestoreButton } from '../../../../../../../components/VersionRestoreButton';
import {
  Badge,
  Page,
  PageHeader,
  lifecycleLabel,
} from '../../../../../../../components/ui';
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
  const t = await getTranslations('records');
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
            <Link
              href={`/workspaces/${workspace.slug}/records/${record.slug}`}
              className="text-brand no-underline hover:text-brand-hover"
            >
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
            const isCurrent =
              version.versionNumber === versionsPayload.currentVersionNumber;
            const isHistorical = !isCurrent;
            return (
              <li key={version.versionNumber} className="kh-ops-history-item">
                <span className="kh-ops-code-box">{version.versionNumber}</span>
                <div className="min-w-0">
                  <h3>{version.title}</h3>
                  <div className="kh-ops-history-meta">
                    <span>{version.createdAt}</span>
                    {version.changeMessage ? (
                      <span>{version.changeMessage}</span>
                    ) : null}
                  </div>
                  {isHistorical ? (
                    <p className="mt-2 mb-0 text-xs text-warn">
                      {t('historicalWarningList')}
                    </p>
                  ) : null}
                </div>
                <div className="grid shrink-0 justify-items-end gap-2">
                  {isCurrent ? (
                    <Badge tone="success">{t('current')}</Badge>
                  ) : (
                    <Badge tone="warn">{t('historical')}</Badge>
                  )}
                  <Link
                    href={`/workspaces/${workspace.slug}/records/${record.slug}/history/${version.versionNumber}`}
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
