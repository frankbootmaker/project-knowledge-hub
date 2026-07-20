import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ConversationImportDetail } from '../../../../../../components/ConversationImportDetail';
import { Page, PageHeader } from '../../../../../../components/ui';
import { apiFetch, requireSession } from '../../../../../../lib/session';

type Workspace = { id: string; name: string; slug: string };

type ConversationImport = {
  id: string;
  workspaceId: string;
  title: string;
  contentFormat: string;
  rawContent: string;
  sourceProvider: string | null;
  generatedByModel: string | null;
  archivedAt: string | null;
  createdAt: string;
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

  return (
    <Page wide>
      <PageHeader title={conversationImport.title} description={t('detailSubtitle')} />
      <p className="mt-0 mb-6">
        <Link
          href={`/workspaces/${summary.slug}/imports`}
          className="text-sm text-ink-muted no-underline hover:text-ink"
        >
          {t('backToList')}
        </Link>
      </p>
      <ConversationImportDetail
        workspaceSlug={summary.slug}
        conversationImport={conversationImport}
        canMutate={canMutate}
      />
    </Page>
  );
}
