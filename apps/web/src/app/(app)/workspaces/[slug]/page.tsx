import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { WorkspaceCatalogueSections } from '../../../../components/WorkspaceCatalogueSections';
import { WorkspaceHomeActions } from '../../../../components/WorkspaceHomeActions';
import { OpsCountStrip } from '../../../../components/ops/OpsCountStrip';
import { Page, PageHeader } from '../../../../components/ui';
import { fetchWorkspaceList, requireSession } from '../../../../lib/session';
import { loadWorkspaceHome } from '../../../../lib/workspace-home';
import { workspaceAccentClassName } from '../../../../lib/workspace-colors';
import { cn } from '../../../../lib/cn';

export const dynamic = 'force-dynamic';

export default async function WorkspaceDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const session = await requireSession();
  const t = await getTranslations('workspaces');
  const { slug } = await params;

  const workspaces = await fetchWorkspaceList();
  const summary = workspaces.find((workspace) => workspace.slug === slug);
  if (!summary) {
    notFound();
  }

  const home = await loadWorkspaceHome(summary.id);
  const workspace = home.workspace;
  if (!workspace) {
    notFound();
  }
  const owners = workspace.owners ?? [];
  const { projects, systems, records, gitConnections } = home;

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
        eyebrow={t('eyebrow')}
        title={workspace.name}
        description={workspace.description?.trim() || undefined}
        actions={
          <WorkspaceHomeActions
            workspaceId={workspace.id}
            workspaceSlug={workspace.slug}
            workspaceName={workspace.name}
            archived={Boolean(workspace.archivedAt)}
            color={workspace.color}
            canManageWorkspace={canManageWorkspace}
            initialGitStatuses={gitConnections.map(
              (connection) => connection.syncHealth?.status,
            )}
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
        }
      />
      <OpsCountStrip
        items={[
          { label: t('countProjects'), value: projects.length },
          { label: t('countSystems'), value: systems.length },
          { label: t('countRecords'), value: records.length },
          { label: t('countGit'), value: gitConnections.length },
        ]}
      />
      <div
        className={cn(
          'kh-workspace-accent-bar mb-4',
          workspaceAccentClassName(workspace.color, workspace.id),
        )}
        aria-hidden
      />

      <WorkspaceCatalogueSections
        key={workspace.id}
        workspaceSlug={workspace.slug}
        projects={projects}
        systems={systems}
        records={records}
        canMutate={canMutate}
      />
    </Page>
  );
}
