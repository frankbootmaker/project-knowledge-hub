import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { MarkdownDocument } from '../../../../../../../../components/MarkdownDocument';
import { VersionRestoreButton } from '../../../../../../../../components/VersionRestoreButton';
import {
  Badge,
  Page,
  PageHeader,
  Panel,
  lifecycleTone,
} from '../../../../../../../../components/ui';
import { apiFetch, requireSession } from '../../../../../../../../lib/session';

type Workspace = { id: string; slug: string; name: string };

export default async function KnowledgeVersionDetailPage({
  params,
}: {
  params: Promise<{ slug: string; recordSlug: string; versionNumber: string }>;
}) {
  const session = await requireSession();
  const t = await getTranslations('records');
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
    <Page wide>
      <PageHeader
        eyebrow={
          <>
            <Link
              href={`/workspaces/${workspace.slug}/records/${record.slug}/history`}
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
            <span className="text-lg font-normal text-ink-muted">
              v{version.versionNumber}
            </span>
          </>
        }
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <Badge tone={lifecycleTone(version.lifecycleStatus)}>
              {version.lifecycleStatus}
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
            />
          ) : null
        }
      />

      {version.isHistorical ? (
        <p className="mb-4 rounded-md border border-warn/20 bg-warn-soft px-4 py-3 text-warn">
          {t('historicalWarningDetail')}
        </p>
      ) : null}

      {version.changeMessage ? (
        <p className="mb-4 text-ink-muted">
          {t('changeMessageLabel', { message: version.changeMessage })}
        </p>
      ) : null}

      <Panel>
        <MarkdownDocument html={version.contentHtml ?? ''} toc={version.toc ?? []} />
      </Panel>
    </Page>
  );
}
