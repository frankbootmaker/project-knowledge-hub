import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import type { DocumentImportOcrEngine } from '@project-knowledge-hub/document-import';
import { DocumentImportForm } from '../../../../../../components/DocumentImportForm';
import { Page, PageHeader } from '../../../../../../components/ui';
import { apiFetch, requireSession } from '../../../../../../lib/session';

function defaultOcrEngine(): DocumentImportOcrEngine {
  const value = process.env.DOCUMENT_IMPORT_OCR_ENGINE;
  if (value === 'vision' || value === 'tesseract' || value === 'none') {
    return value;
  }
  return 'none';
}

type Workspace = { id: string; name: string; slug: string };
type Option = { id: string; name: string; slug: string };

export default async function NewDocumentImportPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ lane?: string }>;
}) {
  const session = await requireSession();
  const t = await getTranslations('documentImports');
  const { slug } = await params;
  const { lane: laneParam } = await searchParams;
  const lane = laneParam === 'image' ? 'image' : 'document';

  const workspacesResponse = await apiFetch('/api/v1/workspaces');
  if (!workspacesResponse.ok) notFound();
  const { workspaces } = (await workspacesResponse.json()) as {
    workspaces: Workspace[];
  };
  const workspace = workspaces.find((item) => item.slug === slug);
  if (!workspace) notFound();

  const canMutate =
    session.user.isSystemAdmin ||
    session.memberships.some(
      (membership) =>
        membership.workspaceId === workspace.id &&
        (membership.role === 'workspace_admin' ||
          membership.role === 'maintainer'),
    );
  if (!canMutate) notFound();

  const [projectsResponse, systemsResponse] = await Promise.all([
    apiFetch(`/api/v1/projects?workspaceId=${workspace.id}`),
    apiFetch(`/api/v1/systems?workspaceId=${workspace.id}`),
  ]);
  const projects = projectsResponse.ok
    ? ((await projectsResponse.json()) as { projects: Option[] }).projects
    : [];
  const systems = systemsResponse.ok
    ? ((await systemsResponse.json()) as { systems: Option[] }).systems
    : [];

  return (
    <Page narrow>
      <PageHeader
        title={lane === 'image' ? t('createImageTitle') : t('createDocumentTitle')}
        description={
          lane === 'image' ? t('imageHelp') : t('documentHelp')
        }
      />
      <p className="mt-0 mb-6">
        <Link
          href={`/workspaces/${workspace.slug}`}
          className="text-sm text-ink-muted no-underline hover:text-ink"
        >
          {t('backToWorkspace')}
        </Link>
      </p>
      <DocumentImportForm
        workspaceId={workspace.id}
        workspaceSlug={workspace.slug}
        lane={lane}
        projects={projects}
        systems={systems}
        defaultOcrEngine={defaultOcrEngine()}
        visionConfigured={Boolean(process.env.VISION_LLM_BASE_URL)}
      />
    </Page>
  );
}
