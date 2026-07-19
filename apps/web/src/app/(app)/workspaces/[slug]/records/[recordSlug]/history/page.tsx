import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { VersionRestoreButton } from '../../../../../../../components/VersionRestoreButton';
import {
  Badge,
  ListCard,
  Page,
  PageHeader,
  lifecycleTone,
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
          status: record.lifecycleStatus,
        })}
      />

      <ul className="m-0 grid list-none gap-3 p-0">
        {versionsPayload.versions.map((version) => {
          const isCurrent = version.versionNumber === versionsPayload.currentVersionNumber;
          const isHistorical = !isCurrent;
          return (
            <ListCard key={version.versionNumber}>
              <div className="flex justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <strong>v{version.versionNumber}</strong>
                    {isCurrent ? (
                      <Badge tone="success">{t('current')}</Badge>
                    ) : (
                      <Badge tone="warn">{t('historical')}</Badge>
                    )}
                    <Badge tone={lifecycleTone(version.lifecycleStatus)}>
                      {version.lifecycleStatus}
                    </Badge>
                  </div>
                  <p className="mt-2 mb-0 text-ink">{version.title}</p>
                  <p className="mt-1 mb-0 text-sm text-ink-muted">{version.createdAt}</p>
                  {version.changeMessage ? (
                    <p className="mt-2 mb-0 text-sm">{version.changeMessage}</p>
                  ) : null}
                  {isHistorical ? (
                    <p className="mt-3 mb-0 rounded-md bg-warn-soft px-3 py-2 text-sm text-warn">
                      {t('historicalWarningList')}
                    </p>
                  ) : null}
                </div>
                <div className="grid shrink-0 content-start gap-2">
                  <Link
                    href={`/workspaces/${workspace.slug}/records/${record.slug}/history/${version.versionNumber}`}
                    className="text-sm font-medium text-brand no-underline hover:text-brand-hover"
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
              </div>
            </ListCard>
          );
        })}
      </ul>
    </Page>
  );
}
