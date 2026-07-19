import { apiFetch, type SessionPayload } from './session';

export type ArchivedWorkspace = {
  id: string;
  name: string;
  slug: string;
  archivedAt: string | null;
  updatedAt: string;
};

export type ArchivedProject = {
  id: string;
  name: string;
  slug: string;
  workspaceId: string;
  workspaceSlug: string;
  workspaceName: string;
  archivedAt: string | null;
  updatedAt: string;
};

export type ArchivedSystem = {
  id: string;
  name: string;
  slug: string;
  workspaceId: string;
  workspaceSlug: string;
  workspaceName: string;
  archivedAt: string | null;
  updatedAt: string;
};

export type ArchivedRecord = {
  id: string;
  title: string;
  slug: string;
  workspaceId: string;
  workspaceSlug: string;
  workspaceName: string;
  archivedAt: string | null;
  updatedAt: string;
};

export type ArchivedListings = {
  workspaces: ArchivedWorkspace[];
  projects: ArchivedProject[];
  systems: ArchivedSystem[];
  records: ArchivedRecord[];
};

type WorkspaceRow = ArchivedWorkspace;
type ProjectRow = {
  id: string;
  name: string;
  slug: string;
  workspaceId: string;
  archivedAt: string | null;
  updatedAt: string;
};
type SystemRow = {
  id: string;
  name: string;
  slug: string;
  workspaceId: string;
  archivedAt: string | null;
  updatedAt: string;
};
type RecordRow = {
  id: string;
  title: string;
  slug: string;
  workspaceId: string;
  archivedAt: string | null;
  updatedAt: string;
};

export function canRestoreWorkspace(
  session: SessionPayload,
  workspaceId: string,
): boolean {
  if (session.user.isSystemAdmin) {
    return true;
  }
  return session.memberships.some(
    (membership) =>
      membership.workspaceId === workspaceId &&
      membership.role === 'workspace_admin',
  );
}

export function canRestoreCatalogue(
  session: SessionPayload,
  workspaceId: string,
): boolean {
  if (session.user.isSystemAdmin) {
    return true;
  }
  return session.memberships.some(
    (membership) =>
      membership.workspaceId === workspaceId &&
      (membership.role === 'workspace_admin' || membership.role === 'maintainer'),
  );
}

export async function loadArchivedListings(): Promise<ArchivedListings> {
  const workspacesRes = await apiFetch('/api/v1/workspaces?includeArchived=true');
  const workspaces = workspacesRes.ok
    ? ((await workspacesRes.json()) as { workspaces: WorkspaceRow[] }).workspaces
    : [];

  const archivedWorkspaces = workspaces.filter((item) => item.archivedAt);

  const bundles = await Promise.all(
    workspaces.map(async (workspace) => {
      const [projectsRes, systemsRes, recordsRes] = await Promise.all([
        apiFetch(
          `/api/v1/projects?workspaceId=${workspace.id}&includeArchived=true`,
        ),
        apiFetch(
          `/api/v1/systems?workspaceId=${workspace.id}&includeArchived=true`,
        ),
        apiFetch(
          `/api/v1/knowledge-records?workspaceId=${workspace.id}&includeArchived=true`,
        ),
      ]);
      const projects = projectsRes.ok
        ? ((await projectsRes.json()) as { projects: ProjectRow[] }).projects.filter(
            (item) => item.archivedAt,
          )
        : [];
      const systems = systemsRes.ok
        ? ((await systemsRes.json()) as { systems: SystemRow[] }).systems.filter(
            (item) => item.archivedAt,
          )
        : [];
      const records = recordsRes.ok
        ? (
            (await recordsRes.json()) as { knowledgeRecords: RecordRow[] }
          ).knowledgeRecords.filter((item) => item.archivedAt)
        : [];
      return { workspace, projects, systems, records };
    }),
  );

  return {
    workspaces: archivedWorkspaces,
    projects: bundles.flatMap((bundle) =>
      bundle.projects.map((project) => ({
        ...project,
        workspaceSlug: bundle.workspace.slug,
        workspaceName: bundle.workspace.name,
      })),
    ),
    systems: bundles.flatMap((bundle) =>
      bundle.systems.map((system) => ({
        ...system,
        workspaceSlug: bundle.workspace.slug,
        workspaceName: bundle.workspace.name,
      })),
    ),
    records: bundles.flatMap((bundle) =>
      bundle.records.map((record) => ({
        ...record,
        workspaceSlug: bundle.workspace.slug,
        workspaceName: bundle.workspace.name,
      })),
    ),
  };
}
