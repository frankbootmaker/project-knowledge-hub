import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ConversationImportForm } from '../../../../../../components/ConversationImportForm';
import { Page, PageHeader } from '../../../../../../components/ui';
import { apiFetch, requireSession } from '../../../../../../lib/session';

type Workspace = { id: string; name: string; slug: string };
type Option = { id: string; name: string; slug: string };

export default async function NewConversationImportPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const session = await requireSession();
  const t = await getTranslations('imports');
  const { slug } = await params;

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
        (membership.role === 'workspace_admin' || membership.role === 'maintainer'),
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
      <PageHeader title={t('createTitle')} description={t('createHelp')} />
      <p className="mt-0 mb-6">
        <Link
          href={`/workspaces/${workspace.slug}`}
          className="text-sm text-ink-muted no-underline hover:text-ink"
        >
          {t('backToWorkspace')}
        </Link>
      </p>
      <ConversationImportForm
        workspaceId={workspace.id}
        workspaceSlug={workspace.slug}
        projects={projects}
        systems={systems}
      />
    </Page>
  );
}
