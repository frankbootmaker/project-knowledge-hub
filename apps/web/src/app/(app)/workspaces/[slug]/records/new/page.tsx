import { notFound } from 'next/navigation';
import { KnowledgeRecordEditor } from '../../../../../../components/KnowledgeRecordEditor';
import { apiFetch, requireSession } from '../../../../../../lib/session';

type Workspace = { id: string; slug: string; name: string };
type Option = { id: string; name: string; slug: string };

export default async function NewKnowledgeRecordPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const session = await requireSession();
  const { slug } = await params;

  const workspacesResponse = await apiFetch('/api/v1/workspaces');
  if (!workspacesResponse.ok) {
    notFound();
  }
  const workspacesPayload = (await workspacesResponse.json()) as { workspaces: Workspace[] };
  const workspace = workspacesPayload.workspaces.find((item) => item.slug === slug);
  if (!workspace) {
    notFound();
  }

  const canMutate =
    session.user.isSystemAdmin ||
    session.memberships.some(
      (membership) =>
        membership.workspaceId === workspace.id &&
        (membership.role === 'workspace_admin' || membership.role === 'maintainer'),
    );
  if (!canMutate) {
    notFound();
  }

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
    <KnowledgeRecordEditor
      mode="create"
      workspaceSlug={workspace.slug}
      workspaceId={workspace.id}
      projects={projects}
      systems={systems}
    />
  );
}
