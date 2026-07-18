import Link from 'next/link';
import { notFound } from 'next/navigation';
import { apiFetch, requireSession } from '../../../../../../lib/session';

type Workspace = { id: string; slug: string; name: string };
type Project = {
  id: string;
  name: string;
  slug: string;
  status: string;
  summary: string | null;
  description: string | null;
  tags: Array<{ name: string }>;
  updatedAt: string;
};
type System = {
  id: string;
  name: string;
  slug: string;
  status: string;
  projectId: string | null;
};

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ slug: string; projectSlug: string }>;
}) {
  await requireSession();
  const { slug, projectSlug } = await params;

  const workspacesResponse = await apiFetch('/api/v1/workspaces');
  if (!workspacesResponse.ok) {
    notFound();
  }
  const workspacesPayload = (await workspacesResponse.json()) as { workspaces: Workspace[] };
  const workspace = workspacesPayload.workspaces.find((item) => item.slug === slug);
  if (!workspace) {
    notFound();
  }

  const projectsResponse = await apiFetch(`/api/v1/projects?workspaceId=${workspace.id}`);
  if (!projectsResponse.ok) {
    notFound();
  }
  const projectsPayload = (await projectsResponse.json()) as { projects: Project[] };
  const projectSummary = projectsPayload.projects.find((item) => item.slug === projectSlug);
  if (!projectSummary) {
    notFound();
  }

  const detailResponse = await apiFetch(`/api/v1/projects/${projectSummary.id}`);
  if (!detailResponse.ok) {
    notFound();
  }
  const detailPayload = (await detailResponse.json()) as { project: Project };
  const project = detailPayload.project;

  const systemsResponse = await apiFetch(
    `/api/v1/systems?workspaceId=${workspace.id}&projectId=${project.id}`,
  );
  const systems = systemsResponse.ok
    ? ((await systemsResponse.json()) as { systems: System[] }).systems
    : [];

  return (
    <main style={{ maxWidth: 880, margin: '0 auto' }}>
      <p style={{ opacity: 0.7 }}>
        <Link href={`/workspaces/${workspace.slug}`}>{workspace.name}</Link> / project
      </p>
      <h1 style={{ marginBottom: '0.35rem' }}>{project.name}</h1>
      <p style={{ opacity: 0.7, marginTop: 0 }}>
        {project.slug} · {project.status}
      </p>
      <section
        style={{
          marginTop: '1.25rem',
          padding: '1.25rem',
          background: 'rgba(255,255,255,0.72)',
          border: '1px solid rgba(21,32,43,0.08)',
        }}
      >
        <p>{project.summary || 'No summary.'}</p>
        <p>{project.description || 'No description.'}</p>
        {project.tags.length > 0 ? (
          <p style={{ opacity: 0.75, marginBottom: 0 }}>
            Tags: {project.tags.map((tag) => tag.name).join(', ')}
          </p>
        ) : null}
      </section>

      <section style={{ marginTop: '2rem' }}>
        <h2>Linked systems</h2>
        <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: '0.65rem' }}>
          {systems.map((system) => (
            <li key={system.id}>
              <Link href={`/workspaces/${workspace.slug}/systems/${system.slug}`}>
                {system.name}
              </Link>{' '}
              <span style={{ opacity: 0.7 }}>({system.status})</span>
            </li>
          ))}
          {systems.length === 0 ? <li>No systems linked to this project.</li> : null}
        </ul>
      </section>
    </main>
  );
}
