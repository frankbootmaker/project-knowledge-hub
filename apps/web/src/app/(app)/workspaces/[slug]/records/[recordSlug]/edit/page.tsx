import { notFound } from 'next/navigation';
import { KnowledgeRecordEditor } from '../../../../../../../components/KnowledgeRecordEditor';
import { apiFetch, requireSession } from '../../../../../../../lib/session';

type Workspace = { id: string; slug: string; name: string };
type Option = { id: string; name: string; slug: string };
type KnowledgeRecord = {
  id: string;
  title: string;
  summary: string | null;
  recordType: string;
  lifecycleStatus: string;
  sourceOfTruthMode: string;
  contentMarkdown: string;
  projectId: string | null;
  systemId: string | null;
  tags: Array<{ name: string }>;
  source: {
    sourceType: string;
    sourceProvider: string | null;
    sourceReference: string | null;
    sourceTitle: string | null;
    sourceUri: string | null;
    generatedByModel: string | null;
  } | null;
};

export default async function EditKnowledgeRecordPage({
  params,
}: {
  params: Promise<{ slug: string; recordSlug: string }>;
}) {
  const session = await requireSession();
  const { slug, recordSlug } = await params;

  const workspacesResponse = await apiFetch('/api/v1/workspaces');
  if (!workspacesResponse.ok) {
    notFound();
  }
  const workspacesPayload = (await workspacesResponse.json()) as { workspaces: Workspace[] };
  const workspace = workspacesPayload.workspaces.find((item) => item.slug === slug);
  if (!workspace) {
    notFound();
  }

  const canMutate =
    session.user.isSystemAdmin ||
    session.memberships.some(
      (membership) =>
        membership.workspaceId === workspace.id &&
        (membership.role === 'workspace_admin' || membership.role === 'maintainer'),
    );
  if (!canMutate) {
    notFound();
  }

  const listResponse = await apiFetch(
    `/api/v1/knowledge-records?workspaceId=${workspace.id}`,
  );
  if (!listResponse.ok) {
    notFound();
  }
  const listPayload = (await listResponse.json()) as {
    knowledgeRecords: Array<{ id: string; slug: string }>;
  };
  const summary = listPayload.knowledgeRecords.find((item) => item.slug === recordSlug);
  if (!summary) {
    notFound();
  }

  const detailResponse = await apiFetch(`/api/v1/knowledge-records/${summary.id}`);
  if (!detailResponse.ok) {
    notFound();
  }
  const detailPayload = (await detailResponse.json()) as { knowledgeRecord: KnowledgeRecord };

  const [projectsResponse, systemsResponse] = await Promise.all([
    apiFetch(`/api/v1/projects?workspaceId=${workspace.id}`),
    apiFetch(`/api/v1/systems?workspaceId=${workspace.id}`),
  ]);
  const projects = projectsResponse.ok
    ? ((await projectsResponse.json()) as { projects: Option[] }).projects
    : [];
  const systems = systemsResponse.ok
    ? ((await systemsResponse.json()) as { systems: Option[] }).systems
    : [];

  return (
    <KnowledgeRecordEditor
      mode="edit"
      workspaceSlug={workspace.slug}
      workspaceId={workspace.id}
      projects={projects}
      systems={systems}
      initial={detailPayload.knowledgeRecord}
    />
  );
}
