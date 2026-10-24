import { coalesceInflight } from './coalesce';
import { apiFetch, readSessionToken } from './session';

/** Same window as My Work: the resumed render starts after the shell finishes. */
export const WORKSPACE_HOME_COALESCE_MS = 2_000;

export type WorkspaceHomeWorkspace = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  color: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string | null;
  owners?: Array<{ id: string; displayName: string; email: string }>;
};

export type WorkspaceHomeProject = {
  id: string;
  name: string;
  slug: string;
  status: string;
  summary: string | null;
  createdVia?: string | null;
  generatedByModel?: string | null;
  tags: Array<{ name: string }>;
  updatedAt: string;
  overallRag?: 'green' | 'amber' | 'red';
};

export type WorkspaceHomeSystem = {
  id: string;
  name: string;
  slug: string;
  status: string;
  projectId: string | null;
  summary: string | null;
  tags: Array<{ name: string }>;
  updatedAt: string;
};

export type WorkspaceHomeRecord = {
  id: string;
  title: string;
  slug: string;
  recordType: string;
  humanKey?: string | null;
  lifecycleStatus: string;
  language?: string | null;
  translationGroupId?: string | null;
  summary: string | null;
  systemId: string | null;
  updatedAt: string;
};

export type WorkspaceHomeGitConnection = {
  syncHealth?: { status: string } | null;
};

export type WorkspaceHomeData = {
  workspace: WorkspaceHomeWorkspace | null;
  projects: WorkspaceHomeProject[];
  systems: WorkspaceHomeSystem[];
  records: WorkspaceHomeRecord[];
  gitConnections: WorkspaceHomeGitConnection[];
};

async function readOk<T>(response: Response): Promise<T | null> {
  if (!response.ok) return null;
  return (await response.json()) as T;
}

async function fetchWorkspaceHome(workspaceId: string): Promise<WorkspaceHomeData> {
  const [detail, projects, systems, records, git] = await Promise.all([
    apiFetch(`/api/v1/workspaces/${workspaceId}`),
    apiFetch(`/api/v1/projects?workspaceId=${workspaceId}`),
    apiFetch(`/api/v1/systems?workspaceId=${workspaceId}&summary=true`),
    apiFetch(`/api/v1/knowledge-records?workspaceId=${workspaceId}`),
    apiFetch(`/api/v1/workspaces/${workspaceId}/git-connections?checkRemote=false`),
  ]);
  const detailBody = await readOk<{ workspace: WorkspaceHomeWorkspace }>(detail);
  const projectBody = await readOk<{ projects: WorkspaceHomeProject[] }>(projects);
  const systemBody = await readOk<{ systems: WorkspaceHomeSystem[] }>(systems);
  const recordBody = await readOk<{ knowledgeRecords: WorkspaceHomeRecord[] }>(records);
  const gitBody = await readOk<{ connections: WorkspaceHomeGitConnection[] }>(git);
  return {
    workspace: detailBody?.workspace ?? null,
    projects: projectBody?.projects ?? [],
    systems: systemBody?.systems ?? [],
    records: recordBody?.knowledgeRecords ?? [],
    gitConnections: gitBody?.connections ?? [],
  };
}

/**
 * One catalogue load per workspace, shared by the shell pass and the resumed
 * pass. Git health here is the last sync. The page asks for the live remote
 * SHA after paint.
 */
export async function loadWorkspaceHome(workspaceId: string): Promise<WorkspaceHomeData> {
  const token = await readSessionToken();
  return coalesceInflight(
    `workspace-home:${token ?? ''}:${workspaceId}`,
    WORKSPACE_HOME_COALESCE_MS,
    () => fetchWorkspaceHome(workspaceId),
  );
}
