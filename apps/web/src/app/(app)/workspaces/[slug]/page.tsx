import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { WorkspaceCatalogueSections } from '../../../../components/WorkspaceCatalogueSections';
import { WorkspaceManageMenu } from '../../../../components/WorkspaceManageMenu';
import { WorkspaceStatusBadge } from '../../../../components/WorkspaceStatusBadge';
import { Page, PageHeader } from '../../../../components/ui';
import { apiFetch, requireSession } from '../../../../lib/session';
import { workspaceAccentClassName } from '../../../../lib/workspace-colors';
import { resolveWorkspaceStatus } from '../../../../lib/workspace-status';
import { cn } from '../../../../lib/cn';

type WorkspacePerson = {
  id: string;
  displayName: string;
  email: string;
};

type Workspace = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  color: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string | null;
  owners?: WorkspacePerson[];
};

type Project = {
  id: string;
  name: string;
  slug: string;
  status: string;
  summary: string | null;
  tags: Array<{ name: string }>;
};

type System = {
  id: string;
  name: string;
  slug: string;
  status: string;
  projectId: string | null;
  summary: string | null;
  tags: Array<{ name: string }>;
};

type KnowledgeRecord = {
  id: string;
  title: string;
  slug: string;
  recordType: string;
  lifecycleStatus: string;
  summary: string | null;
  systemId: string | null;
};

export default async function WorkspaceDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const session = await requireSession();
  const tGit = await getTranslations('gitSync');
  const { slug } = await params;

  const listResponse = await apiFetch('/api/v1/workspaces');
  if (!listResponse.ok) {
    notFound();
  }

  const listPayload = (await listResponse.json()) as { workspaces: Workspace[] };
  const summary = listPayload.workspaces.find((workspace) => workspace.slug === slug);
  if (!summary) {
    notFound();
  }

  const detailResponse = await apiFetch(`/api/v1/workspaces/${summary.id}`);
  if (!detailResponse.ok) {
    notFound();
  }

  const detailPayload = (await detailResponse.json()) as { workspace: Workspace };
  const workspace = detailPayload.workspace;
  const owners = workspace.owners ?? [];

  const [projectsResponse, systemsResponse, recordsResponse, gitResponse] =
    await Promise.all([
      apiFetch(`/api/v1/projects?workspaceId=${workspace.id}`),
      apiFetch(`/api/v1/systems?workspaceId=${workspace.id}`),
      apiFetch(`/api/v1/knowledge-records?workspaceId=${workspace.id}`),
      apiFetch(`/api/v1/workspaces/${workspace.id}/git-connections?checkRemote=true`),
    ]);

  const projects = projectsResponse.ok
    ? ((await projectsResponse.json()) as { projects: Project[] }).projects
    : [];
  const systems = systemsResponse.ok
    ? ((await systemsResponse.json()) as { systems: System[] }).systems
    : [];
  const records = recordsResponse.ok
    ? ((await recordsResponse.json()) as { knowledgeRecords: KnowledgeRecord[] })
        .knowledgeRecords
    : [];
  const gitConnections = gitResponse.ok
    ? (
        (await gitResponse.json()) as {
          connections: Array<{ syncHealth?: { status: string } | null }>;
        }
      ).connections
    : [];
  const workspaceStatus = resolveWorkspaceStatus({
    archived: Boolean(workspace.archivedAt),
    workspaceSlug: workspace.slug,
    gitHealthStatuses: gitConnections.map(
      (connection) => connection.syncHealth?.status,
    ),
  });
  const gitHealthLabel = workspaceStatus.gitHealth
    ? tGit(`health_${workspaceStatus.gitHealth}`)
    : workspaceStatus.kind === 'healthy' && gitConnections.length > 0
      ? tGit('health_healthy')
      : null;

  const canMutate =
    session.user.isSystemAdmin ||
    session.memberships.some(
      (membership) =>
        membership.workspaceId === workspace.id &&
        (membership.role === 'workspace_admin' || membership.role === 'maintainer'),
    );
  const canManageWorkspace =
    session.user.isSystemAdmin ||
    session.memberships.some(
      (membership) =>
        membership.workspaceId === workspace.id &&
        membership.role === 'workspace_admin',
    );

  return (
    <Page wide>
      <PageHeader
        title={workspace.name}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <WorkspaceStatusBadge status={workspaceStatus} />
            <WorkspaceManageMenu
              workspaceId={workspace.id}
              workspaceSlug={workspace.slug}
              workspaceName={workspace.name}
              archived={Boolean(workspace.archivedAt)}
              color={workspace.color}
              canManageArchive={canManageWorkspace}
              canManageColor={canManageWorkspace}
              canEditDetails={canManageWorkspace}
              gitHealthLabel={gitHealthLabel}
              details={{
                id: workspace.id,
                slug: workspace.slug,
                description: workspace.description,
                createdAt: workspace.createdAt,
                updatedAt: workspace.updatedAt,
                archived: Boolean(workspace.archivedAt),
                ownerNames: owners.map((owner) => owner.displayName),
                projectCount: projects.length,
                systemCount: systems.length,
                recordCount: records.length,
                gitConnectionCount: gitConnections.length,
                memberAdminCount: owners.length,
              }}
            />
          </div>
        }
      />
      {workspace.description?.trim() ? (
        <p className="mt-0 mb-3 max-w-3xl text-base leading-relaxed text-ink-muted">
          {workspace.description.trim()}
        </p>
      ) : null}
      <div
        className={cn(
          'kh-workspace-accent-bar mb-8',
          workspaceAccentClassName(workspace.color, workspace.id),
        )}
        aria-hidden
      />

      <WorkspaceCatalogueSections
        workspaceSlug={workspace.slug}
        projects={projects}
        systems={systems}
        records={records}
        canMutate={canMutate}
      />
    </Page>
  );
}
