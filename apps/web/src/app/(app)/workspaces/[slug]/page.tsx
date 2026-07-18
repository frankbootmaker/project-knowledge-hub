import Link from 'next/link';
import { notFound } from 'next/navigation';
import { apiFetch, requireSession } from '../../../../lib/session';

type Workspace = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  updatedAt: string;
};

type Project = {
  id: string;
  name: string;
  slug: string;
  status: string;
  summary: string | null;
  tags: Array<{ name: string }>;
};

type System = {
  id: string;
  name: string;
  slug: string;
  status: string;
  projectId: string | null;
  summary: string | null;
  tags: Array<{ name: string }>;
};

type KnowledgeRecord = {
  id: string;
  name?: string;
  title: string;
  slug: string;
  recordType: string;
  lifecycleStatus: string;
  summary: string | null;
  systemId: string | null;
};

export default async function WorkspaceDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const session = await requireSession();
  const { slug } = await params;

  const listResponse = await apiFetch('/api/v1/workspaces');
  if (!listResponse.ok) {
    notFound();
  }

  const listPayload = (await listResponse.json()) as { workspaces: Workspace[] };
  const summary = listPayload.workspaces.find((workspace) => workspace.slug === slug);
  if (!summary) {
    notFound();
  }

  const detailResponse = await apiFetch(`/api/v1/workspaces/${summary.id}`);
  if (!detailResponse.ok) {
    notFound();
  }

  const detailPayload = (await detailResponse.json()) as { workspace: Workspace };
  const workspace = detailPayload.workspace;

  const [projectsResponse, systemsResponse, recordsResponse] = await Promise.all([
    apiFetch(`/api/v1/projects?workspaceId=${workspace.id}`),
    apiFetch(`/api/v1/systems?workspaceId=${workspace.id}`),
    apiFetch(`/api/v1/knowledge-records?workspaceId=${workspace.id}`),
  ]);

  const projects = projectsResponse.ok
    ? ((await projectsResponse.json()) as { projects: Project[] }).projects
    : [];
  const systems = systemsResponse.ok
    ? ((await systemsResponse.json()) as { systems: System[] }).systems
    : [];
  const records = recordsResponse.ok
    ? ((await recordsResponse.json()) as { knowledgeRecords: KnowledgeRecord[] })
        .knowledgeRecords
    : [];

  const canMutate =
    session.user.isSystemAdmin ||
    session.memberships.some(
      (membership) =>
        membership.workspaceId === workspace.id &&
        (membership.role === 'workspace_admin' || membership.role === 'maintainer'),
    );

  return (
    <main style={{ maxWidth: 960, margin: '0 auto' }}>
      <h1 style={{ marginBottom: '0.35rem' }}>{workspace.name}</h1>
      <p style={{ opacity: 0.7, marginTop: 0 }}>{workspace.slug}</p>
      <section
        style={{
          marginTop: '1.25rem',
          padding: '1.25rem',
          background: 'rgba(255,255,255,0.72)',
          border: '1px solid rgba(21,32,43,0.08)',
        }}
      >
        <p>{workspace.description || 'No description provided.'}</p>
      </section>

      <section style={{ marginTop: '2rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0 }}>Projects</h2>
          {canMutate ? (
            <Link href={`/workspaces/${workspace.slug}/projects/new`}>New project</Link>
          ) : null}
        </div>
        <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: '0.65rem', marginTop: '1rem' }}>
          {projects.map((project) => (
            <li
              key={project.id}
              style={{
                padding: '0.9rem 1rem',
                background: 'rgba(255,255,255,0.72)',
                border: '1px solid rgba(21,32,43,0.08)',
              }}
            >
              <Link href={`/workspaces/${workspace.slug}/projects/${project.slug}`}>
                <strong>{project.name}</strong>
              </Link>
              <div style={{ opacity: 0.7 }}>
                {project.status}
                {project.summary ? ` — ${project.summary}` : ''}
              </div>
              {project.tags.length > 0 ? (
                <div style={{ opacity: 0.65, marginTop: '0.35rem' }}>
                  Tags: {project.tags.map((tag) => tag.name).join(', ')}
                </div>
              ) : null}
            </li>
          ))}
          {projects.length === 0 ? <li>No projects yet.</li> : null}
        </ul>
      </section>

      <section style={{ marginTop: '2rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0 }}>Systems</h2>
          {canMutate ? (
            <Link href={`/workspaces/${workspace.slug}/systems/new`}>New system</Link>
          ) : null}
        </div>
        <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: '0.65rem', marginTop: '1rem' }}>
          {systems.map((system) => (
            <li
              key={system.id}
              style={{
                padding: '0.9rem 1rem',
                background: 'rgba(255,255,255,0.72)',
                border: '1px solid rgba(21,32,43,0.08)',
              }}
            >
              <Link href={`/workspaces/${workspace.slug}/systems/${system.slug}`}>
                <strong>{system.name}</strong>
              </Link>
              <div style={{ opacity: 0.7 }}>
                {system.status}
                {system.projectId ? ' · linked to a project' : ' · independent'}
                {system.summary ? ` — ${system.summary}` : ''}
              </div>
              {system.tags.length > 0 ? (
                <div style={{ opacity: 0.65, marginTop: '0.35rem' }}>
                  Tags: {system.tags.map((tag) => tag.name).join(', ')}
                </div>
              ) : null}
            </li>
          ))}
          {systems.length === 0 ? <li>No systems yet.</li> : null}
        </ul>
      </section>

      <section style={{ marginTop: '2rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0 }}>Knowledge records</h2>
          {canMutate ? (
            <Link href={`/workspaces/${workspace.slug}/records/new`}>New record</Link>
          ) : null}
        </div>
        <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: '0.65rem', marginTop: '1rem' }}>
          {records.map((record) => (
            <li
              key={record.id}
              style={{
                padding: '0.9rem 1rem',
                background: 'rgba(255,255,255,0.72)',
                border: '1px solid rgba(21,32,43,0.08)',
              }}
            >
              <Link href={`/workspaces/${workspace.slug}/records/${record.slug}`}>
                <strong>{record.title}</strong>
              </Link>
              <div style={{ opacity: 0.7 }}>
                {record.recordType} · {record.lifecycleStatus}
                {record.systemId ? ' · linked to a system' : ''}
                {record.summary ? ` — ${record.summary}` : ''}
              </div>
            </li>
          ))}
          {records.length === 0 ? <li>No knowledge records yet.</li> : null}
        </ul>
      </section>
    </main>
  );
}
