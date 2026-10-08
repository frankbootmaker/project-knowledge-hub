import { notFound, redirect } from 'next/navigation';
import { apiFetch, type SessionPayload } from './session';

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

export function canPurgeWorkspace(session: SessionPayload, workspaceId: string): boolean {
  return (
    session.user.isSystemAdmin ||
    session.memberships.some(
      (membership) =>
        membership.workspaceId === workspaceId && membership.role === 'workspace_admin',
    )
  );
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
