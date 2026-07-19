import { apiFetch, type SessionPayload } from './session';

export const DASHBOARD_WORKSPACE_TILE_LIMIT = 6;
export const DASHBOARD_RECENT_LIMIT = 5;

export type DashboardWorkspace = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  updatedAt: string;
  role: string | null;
  projectCount: number;
  systemCount: number;
  recordCount: number;
};

export type DashboardRecentItem = {
  kind: 'project' | 'system' | 'record';
  id: string;
  title: string;
  href: string;
  workspaceName: string;
  updatedAt: string;
};

export type DashboardData = {
  workspaces: DashboardWorkspace[];
  workspaceTotal: number;
  recent: DashboardRecentItem[];
  primaryWorkspaceId: string | null;
};

type WorkspaceRow = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  updatedAt: string;
};

type CountedEntity = {
  id: string;
  name?: string;
  title?: string;
  slug: string;
  updatedAt: string;
};

function membershipRole(
  session: SessionPayload,
  workspaceId: string,
): string | null {
  const membership = session.memberships.find(
    (item) => item.workspaceId === workspaceId,
  );
  if (membership) {
    return membership.role;
  }
  return session.user.isSystemAdmin ? 'system_admin' : null;
}

async function loadWorkspaceBundle(workspace: WorkspaceRow) {
  const [projectsRes, systemsRes, recordsRes] = await Promise.all([
    apiFetch(`/api/v1/projects?workspaceId=${workspace.id}`),
    apiFetch(`/api/v1/systems?workspaceId=${workspace.id}`),
    apiFetch(`/api/v1/knowledge-records?workspaceId=${workspace.id}`),
  ]);

  const projects = projectsRes.ok
    ? ((await projectsRes.json()) as { projects: CountedEntity[] }).projects
    : [];
  const systems = systemsRes.ok
    ? ((await systemsRes.json()) as { systems: CountedEntity[] }).systems
    : [];
  const records = recordsRes.ok
    ? ((await recordsRes.json()) as { knowledgeRecords: CountedEntity[] })
        .knowledgeRecords
    : [];

  return { projects, systems, records };
}

export async function loadDashboardData(
  session: SessionPayload,
): Promise<DashboardData> {
  const response = await apiFetch('/api/v1/workspaces');
  const workspaces = response.ok
    ? ((await response.json()) as { workspaces: WorkspaceRow[] }).workspaces
    : [];

  const sorted = [...workspaces].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
  const tileWorkspaces = sorted.slice(0, DASHBOARD_WORKSPACE_TILE_LIMIT);

  const bundles = await Promise.all(
    tileWorkspaces.map(async (workspace) => {
      const bundle = await loadWorkspaceBundle(workspace);
      return { workspace, ...bundle };
    }),
  );

  const dashboardWorkspaces: DashboardWorkspace[] = bundles.map(
    ({ workspace, projects, systems, records }) => ({
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
      description: workspace.description,
      updatedAt: workspace.updatedAt,
      role: membershipRole(session, workspace.id),
      projectCount: projects.length,
      systemCount: systems.length,
      recordCount: records.length,
    }),
  );

  const recent: DashboardRecentItem[] = bundles
    .flatMap(({ workspace, projects, systems, records }) => [
      ...projects.map((project) => ({
        kind: 'project' as const,
        id: project.id,
        title: project.name ?? project.slug,
        href: `/workspaces/${workspace.slug}/projects/${project.slug}`,
        workspaceName: workspace.name,
        updatedAt: project.updatedAt,
      })),
      ...systems.map((system) => ({
        kind: 'system' as const,
        id: system.id,
        title: system.name ?? system.slug,
        href: `/workspaces/${workspace.slug}/systems/${system.slug}`,
        workspaceName: workspace.name,
        updatedAt: system.updatedAt,
      })),
      ...records.map((record) => ({
        kind: 'record' as const,
        id: record.id,
        title: record.title ?? record.slug,
        href: `/workspaces/${workspace.slug}/records/${record.slug}`,
        workspaceName: workspace.name,
        updatedAt: record.updatedAt,
      })),
    ])
    .sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    )
    .slice(0, DASHBOARD_RECENT_LIMIT);

  return {
    workspaces: dashboardWorkspaces,
    workspaceTotal: workspaces.length,
    recent,
    primaryWorkspaceId: tileWorkspaces[0]?.id ?? null,
  };
}
