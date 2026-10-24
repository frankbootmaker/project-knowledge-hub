import { cache } from 'react';
import type { DisplayPrefs } from '@project-knowledge-hub/domain';
import {
  DEFAULT_DISPLAY_PREFS,
  mergeDisplayPrefs,
} from '@project-knowledge-hub/domain';
import { coalesceInflight } from './coalesce';
import {
  apiFetch,
  fetchWorkspaceList,
  readSessionToken,
  type SessionPayload,
  type WorkspaceListRow,
} from './session';

const DASHBOARD_INSIGHTS_COALESCE_MS = 2_000;
const DASHBOARD_HOME_COALESCE_MS = 2_000;

export const DASHBOARD_WORKSPACE_TILE_LIMIT = 6;
export const DASHBOARD_RECENT_LIMIT = 5;

export type DashboardInsights = {
  tasksByDue: {
    overdue: number;
    dueSoon: number;
    later: number;
    none: number;
  };
  projectHealthRag: {
    green: number;
    amber: number;
    red: number;
  };
  openRaid: {
    risks: number;
    issues: number;
    assumptions: number;
    dependencies: number;
    total: number;
  };
  budgetAttention: Array<{
    projectId: string;
    projectName: string;
    projectSlug: string;
    workspaceSlug: string;
    cpi: number | null;
    spi: number | null;
    financialRag: 'green' | 'amber' | 'red';
  }>;
};

export type DashboardWorkspace = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  color: string | null;
  updatedAt: string;
  role: string | null;
  projectCount: number;
  systemCount: number;
  recordCount: number;
};

export type DashboardRecentItem = {
  kind: 'project' | 'system' | 'record';
  id: string;
  humanKey: string | null;
  title: string;
  href: string;
  workspaceName: string;
  status: string;
  updatedAt: string;
};

export type DashboardAssignedTask = {
  id: string;
  humanKey: string | null;
  title: string;
  description: string | null;
  status: string;
  dueDate: string | null;
  myRole: 'R' | 'A' | 'C' | 'I';
  projectName: string;
  projectSlug: string;
  workspaceId: string;
  workspaceName: string;
  workspaceSlug: string;
  milestoneTitle: string | null;
  currentOwner?: {
    userId: string;
    displayName: string;
    email: string;
  } | null;
  updatedAt: string;
};

const EMPTY_INSIGHTS: DashboardInsights = {
  tasksByDue: { overdue: 0, dueSoon: 0, later: 0, none: 0 },
  projectHealthRag: { green: 0, amber: 0, red: 0 },
  openRaid: {
    risks: 0,
    issues: 0,
    assumptions: 0,
    dependencies: 0,
    total: 0,
  },
  budgetAttention: [],
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

export const loadDashboardTasks = cache(async (): Promise<DashboardAssignedTask[]> => {
  const response = await apiFetch('/api/v1/me/tasks');
  if (!response.ok) return [];
  const body = (await response.json()) as { tasks?: DashboardAssignedTask[] };
  return body.tasks ?? [];
});

async function fetchDashboardInsights(): Promise<DashboardInsights> {
  const response = await apiFetch('/api/v1/me/dashboard-insights');
  if (!response.ok) return EMPTY_INSIGHTS;
  const body = (await response.json()) as { insights?: DashboardInsights };
  return body.insights ?? EMPTY_INSIGHTS;
}

export const loadDashboardInsights = cache(async (): Promise<DashboardInsights> => {
  const token = await readSessionToken();
  return coalesceInflight(
    `me:dashboard-insights:${token ?? ''}`,
    DASHBOARD_INSIGHTS_COALESCE_MS,
    fetchDashboardInsights,
  );
});

export const loadDashboardDisplayPrefs = cache(async (): Promise<DisplayPrefs> => {
  const response = await apiFetch('/api/v1/me');
  if (!response.ok) return DEFAULT_DISPLAY_PREFS;
  const body = (await response.json()) as { user?: { displayPrefs?: DisplayPrefs } };
  return mergeDisplayPrefs(body.user?.displayPrefs);
});

type WorkspaceCounts = {
  workspaceId: string;
  projectCount: number;
  systemCount: number;
  recordCount: number;
};

type RecentApiItem = {
  kind: DashboardRecentItem['kind'];
  id: string;
  humanKey: string | null;
  title: string;
  slug: string;
  workspaceName: string;
  workspaceSlug: string;
  status: string;
  updatedAt: string;
};

function recentHref(item: RecentApiItem): string {
  if (item.kind === 'project') {
    return `/workspaces/${item.workspaceSlug}/projects/${item.slug}`;
  }
  if (item.kind === 'system') {
    return `/workspaces/${item.workspaceSlug}/systems/${item.slug}`;
  }
  return `/workspaces/${item.workspaceSlug}/records/${item.slug}`;
}

async function fetchWorkspaceCounts(): Promise<WorkspaceCounts[]> {
  const response = await apiFetch('/api/v1/me/workspace-counts');
  if (!response.ok) return [];
  const body = (await response.json()) as { counts?: WorkspaceCounts[] };
  return body.counts ?? [];
}

async function fetchRecentItems(limit: number): Promise<RecentApiItem[]> {
  const response = await apiFetch(`/api/v1/me/recent?limit=${limit}`);
  if (!response.ok) return [];
  const body = (await response.json()) as { recent?: RecentApiItem[] };
  return body.recent ?? [];
}

export const loadDashboardWorkspaceSection = cache(async (
  session: SessionPayload,
): Promise<{
  workspaces: DashboardWorkspace[];
  workspaceTotal: number;
  recent: DashboardRecentItem[];
  primaryWorkspaceId: string | null;
}> => {
  const token = await readSessionToken();
  const workspaces = await fetchWorkspaceList();
  const sorted = [...workspaces].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
  const tileWorkspaces = sorted.slice(0, DASHBOARD_WORKSPACE_TILE_LIMIT);
  const [counts, recentRows] = await Promise.all([
    coalesceInflight(
      `me:workspace-counts:${token ?? ''}`,
      DASHBOARD_HOME_COALESCE_MS,
      fetchWorkspaceCounts,
    ),
    coalesceInflight(
      `me:recent:${token ?? ''}:${DASHBOARD_RECENT_LIMIT}`,
      DASHBOARD_HOME_COALESCE_MS,
      () => fetchRecentItems(DASHBOARD_RECENT_LIMIT),
    ),
  ]);
  const countById = new Map(counts.map((row) => [row.workspaceId, row]));

  return {
    workspaces: tileWorkspaces.map((workspace) =>
      toDashboardWorkspace(session, workspace, countById.get(workspace.id)),
    ),
    workspaceTotal: workspaces.length,
    recent: recentRows.map((item) => ({
      kind: item.kind,
      id: item.id,
      humanKey: item.humanKey,
      title: item.title,
      href: recentHref(item),
      workspaceName: item.workspaceName,
      status: item.status,
      updatedAt: item.updatedAt,
    })),
    primaryWorkspaceId: tileWorkspaces[0]?.id ?? null,
  };
});

function toDashboardWorkspace(
  session: SessionPayload,
  workspace: WorkspaceListRow,
  counts: WorkspaceCounts | undefined,
): DashboardWorkspace {
  return {
    id: workspace.id,
    name: workspace.name,
    slug: workspace.slug,
    description: workspace.description,
    color: workspace.color ?? null,
    updatedAt: workspace.updatedAt,
    role: membershipRole(session, workspace.id),
    projectCount: counts?.projectCount ?? 0,
    systemCount: counts?.systemCount ?? 0,
    recordCount: counts?.recordCount ?? 0,
  };
}
