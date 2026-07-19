import { notFound } from 'next/navigation';
import { WorkspaceSyncPage } from '../../../../../components/WorkspaceSyncPage';
import { apiFetch, requireSession } from '../../../../../lib/session';

type Workspace = { id: string; name: string; slug: string };
type Project = { id: string; name: string; slug: string };
type Connection = {
  id: string;
  provider: string;
  owner: string;
  repo: string;
  branch: string;
  projectId: string | null;
  status: string;
  lastError: string | null;
  lastSyncedAt: string | null;
  lastSyncedCommitSha: string | null;
  accessTokenPreview: string;
  includePaths: string[];
  excludePaths: string[];
  hasWebhookSecret?: boolean;
  syncHealth: {
    status: string;
    remoteCommitSha: string | null;
    lastSyncedCommitSha: string | null;
    lastSyncedAt: string | null;
    message: string;
  } | null;
};

export default async function WorkspaceGitPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const session = await requireSession();
  const { slug } = await params;

  const listResponse = await apiFetch('/api/v1/workspaces');
  if (!listResponse.ok) notFound();
  const { workspaces } = (await listResponse.json()) as { workspaces: Workspace[] };
  const summary = workspaces.find((workspace) => workspace.slug === slug);
  if (!summary) notFound();

  const [detailResponse, projectsResponse, connectionsResponse] = await Promise.all([
    apiFetch(`/api/v1/workspaces/${summary.id}`),
    apiFetch(`/api/v1/projects?workspaceId=${summary.id}`),
    apiFetch(`/api/v1/workspaces/${summary.id}/git-connections?checkRemote=true`),
  ]);
  if (!detailResponse.ok) notFound();

  const { workspace } = (await detailResponse.json()) as { workspace: Workspace };
  const projects = projectsResponse.ok
    ? ((await projectsResponse.json()) as { projects: Project[] }).projects
    : [];
  const connections = connectionsResponse.ok
    ? ((await connectionsResponse.json()) as { connections: Connection[] }).connections
    : [];

  const canManage =
    session.user.isSystemAdmin ||
    session.memberships.some(
      (membership) =>
        membership.workspaceId === workspace.id && membership.role === 'workspace_admin',
    );

  const overallHealth = connections.reduce<string | null>((worst, connection) => {
    const status = connection.syncHealth?.status;
    if (!status) return worst;
    const rank: Record<string, number> = {
      error: 5,
      needs_sync: 4,
      never_synced: 3,
      check_failed: 2,
      paused: 1,
      healthy: 0,
    };
    if (worst == null || (rank[status] ?? 0) > (rank[worst] ?? 0)) return status;
    return worst;
  }, null);

  return (
    <WorkspaceSyncPage
      workspaceId={workspace.id}
      workspaceName={workspace.name}
      workspaceSlug={workspace.slug}
      projects={projects}
      connections={connections as Parameters<
        typeof WorkspaceSyncPage
      >[0]['connections']}
      canManage={canManage}
      overallHealth={overallHealth}
    />
  );
}
