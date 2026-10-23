import { permanentRedirect, notFound, redirect } from 'next/navigation';
import { isUuid, parseHumanKey } from '@project-knowledge-hub/domain';
import { apiFetch, type SessionPayload } from './session';
import {
  replaceIssueKeyQuery,
  type IssueKeyQueryParam,
} from './project-url-redirect';

export type RecordWorkspace = { id: string; slug: string; name: string };

export type RecordProject = { id: string; name: string; slug: string };

export type ProjectRecordContext = {
  projectSlug: string;
};

export function canMutateWorkspace(session: SessionPayload, workspaceId: string): boolean {
  return (
    session.user.isSystemAdmin ||
    session.memberships.some(
      (membership) =>
        membership.workspaceId === workspaceId &&
        (membership.role === 'workspace_admin' || membership.role === 'maintainer'),
    )
  );
}

export function canAdminWorkspace(session: SessionPayload, workspaceId: string): boolean {
  return (
    session.user.isSystemAdmin ||
    session.memberships.some(
      (membership) =>
        membership.workspaceId === workspaceId && membership.role === 'workspace_admin',
    )
  );
}

export function canPurgeWorkspace(session: SessionPayload, workspaceId: string): boolean {
  return canAdminWorkspace(session, workspaceId);
}

/** Same resolution as the project page: missing or inaccessible is 404. */
export async function requireWorkspaceBySlug(slug: string): Promise<RecordWorkspace> {
  const response = await apiFetch('/api/v1/workspaces');
  if (!response.ok) {
    notFound();
  }
  const payload = (await response.json()) as { workspaces: RecordWorkspace[] };
  const workspace = payload.workspaces.find((item) => item.slug === slug);
  if (!workspace) {
    notFound();
  }
  return workspace;
}

export async function requireProjectBySlug(
  workspaceId: string,
  projectSlug: string,
): Promise<RecordProject> {
  const response = await apiFetch(
    `/api/v1/projects?workspaceId=${workspaceId}&includeArchived=true`,
  );
  if (!response.ok) {
    notFound();
  }
  const payload = (await response.json()) as { projects: RecordProject[] };
  const summary = payload.projects.find((item) => item.slug === projectSlug);
  if (!summary) {
    notFound();
  }
  const detailResponse = await apiFetch(`/api/v1/projects/${summary.id}`);
  if (!detailResponse.ok) {
    notFound();
  }
  const detail = (await detailResponse.json()) as { project: RecordProject };
  return detail.project;
}

/**
 * Human keys in ?task=, ?raid=, and ?change= redirect to the entity id.
 * A retired prefix still resolves. UUID query values stay as they are.
 */
export async function redirectHumanKeyQuery(input: {
  projectId: string;
  pathname: string;
  task: string | null;
  raid: string | null;
  change: string | null;
}): Promise<void> {
  const candidates: Array<{ param: IssueKeyQueryParam; value: string | null }> = [
    { param: 'task', value: input.task },
    { param: 'raid', value: input.raid },
    { param: 'change', value: input.change },
  ];
  for (const candidate of candidates) {
    const value = candidate.value?.trim() ?? '';
    if (!value || isUuid(value) || !parseHumanKey(value)) continue;
    const response = await apiFetch(
      `/api/v1/projects/${input.projectId}/resolve-issue-key?key=${encodeURIComponent(value)}`,
    );
    if (!response.ok) continue;
    const payload = (await response.json()) as {
      entityId?: string;
      queryParam?: IssueKeyQueryParam | null;
    };
    if (!payload.entityId || payload.queryParam !== candidate.param) continue;
    permanentRedirect(
      replaceIssueKeyQuery({
        pathname: input.pathname,
        task: input.task,
        raid: input.raid,
        change: input.change,
        param: candidate.param,
        entityId: payload.entityId,
      }),
    );
  }
}

/**
 * Stay on the nested route only when the record belongs to the project or
 * has a delivery link into it. Otherwise send the reader to the workspace record.
 */
export async function ensureRecordInProject(input: {
  workspaceSlug: string;
  project: RecordProject;
  record: { id: string; slug: string; projectId: string | null };
}): Promise<void> {
  if (input.record.projectId === input.project.id) {
    return;
  }
  const response = await apiFetch(`/api/v1/knowledge-records/${input.record.id}/delivery-links`);
  if (response.ok) {
    const payload = (await response.json()) as {
      deliveryLinks?: Array<{ projectId?: string | null }>;
    };
    const linked = (payload.deliveryLinks ?? []).some(
      (link) => link.projectId === input.project.id,
    );
    if (linked) {
      return;
    }
  }
  redirect(`/workspaces/${input.workspaceSlug}/records/${input.record.slug}`);
}
