import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { GitConnectionsPanel } from '../../../../../components/GitConnectionsPanel';
import { Page, PageHeader } from '../../../../../components/ui';
import { apiFetch, requireSession } from '../../../../../lib/session';

type Workspace = { id: string; name: string; slug: string };
type Project = { id: string; name: string; slug: string };
type Connection = {
  id: string;
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
  const t = await getTranslations('gitSync');
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

  const worstHealth = connections.reduce<string | null>((worst, connection) => {
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
    <Page wide>
      <PageHeader
        title={t('title')}
        description={t('subtitle', { workspace: workspace.name })}
        actions={
          <div className="flex flex-wrap items-center gap-3">
            {worstHealth ? (
              <span className="text-sm text-ink-muted" title={t(`health_${worstHealth}`)}>
                {t('overallHealth')}: {t(`health_${worstHealth}`)}
              </span>
            ) : null}
            <Link href={`/workspaces/${workspace.slug}`} className="text-sm text-brand no-underline">
              {t('backToWorkspace')}
            </Link>
          </div>
        }
      />
      <GitConnectionsPanel
        workspaceId={workspace.id}
        projects={projects}
        initialConnections={connections as Parameters<
          typeof GitConnectionsPanel
        >[0]['initialConnections']}
        canManage={canManage}
      />
    </Page>
  );
}
