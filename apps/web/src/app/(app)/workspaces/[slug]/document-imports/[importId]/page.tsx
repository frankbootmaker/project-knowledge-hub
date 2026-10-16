import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { DocumentImportDetail } from '../../../../../../components/DocumentImportDetail';
import { PanelBackLink } from '../../../../../../components/PanelBackLink';
import { RegisterShellCrumbs } from '../../../../../../components/ops/ShellCrumbContext';
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
  const tImports = await getTranslations('imports');
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
      <RegisterShellCrumbs pageTitle={documentImport.title} />
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
              href={`/workspaces/${workspace.slug}/imports`}
              className="text-brand no-underline hover:text-brand-hover"
            >
              {tImports('title')}
            </Link>
          </>
        }
        title={documentImport.title}
        description={t('detailHelp')}
      />
      <DocumentImportDetail
        workspaceSlug={workspace.slug}
        documentImport={documentImport}
        canMutate={canMutate}
      />
      <section className="kh-ops-panel mt-4">
        <PanelBackLink href={`/workspaces/${workspace.slug}`} divided={false}>
          {t('backToWorkspace')}
        </PanelBackLink>
      </section>
    </Page>
  );
}
