import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ConversationImportDetail } from '../../../../../../components/ConversationImportDetail';
import { ConversationImportManageMenu } from '../../../../../../components/ConversationImportManageMenu';
import { PanelBackLink } from '../../../../../../components/PanelBackLink';
import { RegisterShellCrumbs } from '../../../../../../components/ops/ShellCrumbContext';
import { Page, PageHeader } from '../../../../../../components/ui';
import { apiFetch, requireSession } from '../../../../../../lib/session';

type Workspace = { id: string; name: string; slug: string };

type ConversationImport = {
  id: string;
  workspaceId: string;
  title: string;
  contentFormat: string;
  rawContent: string;
  draftMarkdownPreview?: string;
  contentWarnings?: Array<{
    code: string;
    severity: 'info' | 'warning' | 'high';
    count: number;
    label: string;
  }>;
  suggestedChunks?: Array<{
    id: string;
    title: string;
    contentMarkdown: string;
    excerptNote: string;
  }>;
  sourceProvider: string | null;
  generatedByModel: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt?: string;
  linkedRecords: Array<{
    knowledgeRecordId: string;
    title: string;
    slug: string;
    recordType: string;
    lifecycleStatus: string;
    excerptNote: string | null;
    createdAt: string;
  }>;
};

export default async function ConversationImportDetailPage({
  params,
}: {
  params: Promise<{ slug: string; importId: string }>;
}) {
  const session = await requireSession();
  const t = await getTranslations('imports');
  const { slug, importId } = await params;

  const listResponse = await apiFetch('/api/v1/workspaces');
  if (!listResponse.ok) notFound();
  const { workspaces } = (await listResponse.json()) as { workspaces: Workspace[] };
  const summary = workspaces.find((workspace) => workspace.slug === slug);
  if (!summary) notFound();

  const importResponse = await apiFetch(`/api/v1/conversation-imports/${importId}`);
  if (!importResponse.ok) notFound();
  const { conversationImport } = (await importResponse.json()) as {
    conversationImport: ConversationImport;
  };

  if (conversationImport.workspaceId !== summary.id) {
    notFound();
  }

  const canMutate =
    session.user.isSystemAdmin ||
    session.memberships.some(
      (membership) =>
        membership.workspaceId === summary.id &&
        (membership.role === 'workspace_admin' || membership.role === 'maintainer'),
    );
  const canPurge =
    session.user.isSystemAdmin ||
    session.memberships.some(
      (membership) =>
        membership.workspaceId === summary.id &&
        membership.role === 'workspace_admin',
    );

  return (
    <Page wide>
      <RegisterShellCrumbs pageTitle={conversationImport.title} />
      <PageHeader
        eyebrow={
          <>
            <Link
              href={`/workspaces/${summary.slug}`}
              className="text-brand no-underline hover:text-brand-hover"
            >
              {summary.name}
            </Link>
            {' / '}
            <Link
              href={`/workspaces/${summary.slug}/imports`}
              className="text-brand no-underline hover:text-brand-hover"
            >
              {t('title')}
            </Link>
          </>
        }
        title={conversationImport.title}
        description={t('detailSubtitle')}
        actions={
          <ConversationImportManageMenu
            workspaceSlug={summary.slug}
            conversationImport={{
              id: conversationImport.id,
              title: conversationImport.title,
              contentFormat: conversationImport.contentFormat,
              sourceProvider: conversationImport.sourceProvider,
              generatedByModel: conversationImport.generatedByModel,
              archivedAt: conversationImport.archivedAt,
              createdAt: conversationImport.createdAt,
              updatedAt: conversationImport.updatedAt,
              linkedRecordCount: conversationImport.linkedRecords.length,
            }}
            canMutate={canMutate}
            canPurge={canPurge}
          />
        }
      />
      <ConversationImportDetail
        workspaceSlug={summary.slug}
        conversationImport={conversationImport}
        canMutate={canMutate}
      />
      <section className="kh-ops-panel mt-4">
        <PanelBackLink href={`/workspaces/${summary.slug}/imports`} divided={false}>
          {t('backToList')}
        </PanelBackLink>
      </section>
    </Page>
  );
}
