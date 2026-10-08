import { notFound } from 'next/navigation';
import { KnowledgeRecordEditor } from '../KnowledgeRecordEditor';
import { RegisterShellCrumbs } from '../ops/ShellCrumbContext';
import { recordHref } from '../../lib/record-href';
import {
  canMutateWorkspace,
  ensureRecordInProject,
  requireProjectBySlug,
  requireWorkspaceBySlug,
  type ProjectRecordContext,
} from '../../lib/project-record-access';
import { apiFetch, requireSession } from '../../lib/session';

type Option = { id: string; name: string; slug: string };
type KnowledgeRecord = {
  id: string;
  title: string;
  slug: string;
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

export async function KnowledgeRecordEditView({
  workspaceSlug,
  recordSlug,
  projectContext,
}: {
  workspaceSlug: string;
  recordSlug: string;
  projectContext?: ProjectRecordContext;
}) {
  const session = await requireSession();
  const workspace = await requireWorkspaceBySlug(workspaceSlug);
  const routeProject = projectContext
    ? await requireProjectBySlug(workspace.id, projectContext.projectSlug)
    : null;

  if (!canMutateWorkspace(session, workspace.id)) {
    notFound();
  }

  const listResponse = await apiFetch(`/api/v1/knowledge-records?workspaceId=${workspace.id}`);
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
  const record = detailPayload.knowledgeRecord;
  if (routeProject) {
    await ensureRecordInProject({
      workspaceSlug: workspace.slug,
      project: routeProject,
      record,
    });
  }

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
    <>
      {routeProject ? (
        <RegisterShellCrumbs projectName={routeProject.name} recordTitle={record.title} />
      ) : null}
      <KnowledgeRecordEditor
        mode="edit"
        workspaceSlug={workspace.slug}
        workspaceId={workspace.id}
        recordBasePath={
          routeProject
            ? recordHref({
                workspaceSlug: workspace.slug,
                projectSlug: routeProject.slug,
                recordSlug: record.slug,
              })
            : undefined
        }
        projects={projects}
        systems={systems}
        initial={record}
      />
    </>
  );
}
