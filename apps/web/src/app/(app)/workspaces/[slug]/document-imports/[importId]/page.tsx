import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { DocumentImportDetail } from '../../../../../../components/DocumentImportDetail';
import { Page, PageHeader } from '../../../../../../components/ui';
import { apiFetch, requireSession } from '../../../../../../lib/session';

type Workspace = { id: string; name: string; slug: string };

type DocumentImport = {
  id: string;
  workspaceId: string;
  title: string;
  lane: string;
  status: string;
  originalFilename: string;
  contentType: string;
  byteSize: number;
  convertedMarkdown: string | null;
  contentWarnings?: Array<{
    code: string;
    severity: 'info' | 'warning' | 'high';
    count: number;
    label: string;
  }>;
  conversionWarnings?: string[];
  conversionError: string | null;
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
  media: Array<{
    workspaceMediaId: string;
    attachmentIndex: number;
    originalFilename: string | null;
    url: string;
  }>;
};

export default async function DocumentImportDetailPage({
  params,
}: {
  params: Promise<{ slug: string; importId: string }>;
}) {
  const session = await requireSession();
  const t = await getTranslations('documentImports');
  const { slug, importId } = await params;

  const workspacesResponse = await apiFetch('/api/v1/workspaces');
  if (!workspacesResponse.ok) notFound();
  const { workspaces } = (await workspacesResponse.json()) as {
    workspaces: Workspace[];
  };
  const workspace = workspaces.find((item) => item.slug === slug);
  if (!workspace) notFound();

  const importResponse = await apiFetch(`/api/v1/document-imports/${importId}`);
  if (!importResponse.ok) notFound();
  const { documentImport } = (await importResponse.json()) as {
    documentImport: DocumentImport;
  };
  if (documentImport.workspaceId !== workspace.id) notFound();

  const canMutate =
    session.user.isSystemAdmin ||
    session.memberships.some(
      (membership) =>
        membership.workspaceId === workspace.id &&
        (membership.role === 'workspace_admin' ||
          membership.role === 'maintainer'),
    );

  return (
    <Page narrow>
      <PageHeader title={documentImport.title} description={t('detailHelp')} />
      <p className="mt-0 mb-6">
        <Link
          href={`/workspaces/${workspace.slug}`}
          className="text-sm text-ink-muted no-underline hover:text-ink"
        >
          {t('backToWorkspace')}
        </Link>
      </p>
      <DocumentImportDetail
        workspaceSlug={workspace.slug}
        documentImport={documentImport}
        canMutate={canMutate}
      />
    </Page>
  );
}
