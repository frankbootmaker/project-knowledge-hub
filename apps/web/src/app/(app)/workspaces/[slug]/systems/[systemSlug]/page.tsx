import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { apiFetch, requireSession } from '../../../../../../lib/session';

type Workspace = { id: string; slug: string; name: string };
type System = {
  id: string;
  name: string;
  slug: string;
  status: string;
  summary: string | null;
  description: string | null;
  systemType: string | null;
  environment: string | null;
  projectId: string | null;
  tags: Array<{ name: string }>;
  updatedAt: string;
};
type Project = { id: string; name: string; slug: string };

export default async function SystemDetailPage({
  params,
}: {
  params: Promise<{ slug: string; systemSlug: string }>;
}) {
  await requireSession();
  const t = await getTranslations('systems');
  const tCommon = await getTranslations('common');
  const { slug, systemSlug } = await params;

  const workspacesResponse = await apiFetch('/api/v1/workspaces');
  if (!workspacesResponse.ok) {
    notFound();
  }
  const workspacesPayload = (await workspacesResponse.json()) as { workspaces: Workspace[] };
  const workspace = workspacesPayload.workspaces.find((item) => item.slug === slug);
  if (!workspace) {
    notFound();
  }

  const systemsResponse = await apiFetch(`/api/v1/systems?workspaceId=${workspace.id}`);
  if (!systemsResponse.ok) {
    notFound();
  }
  const systemsPayload = (await systemsResponse.json()) as { systems: System[] };
  const systemSummary = systemsPayload.systems.find((item) => item.slug === systemSlug);
  if (!systemSummary) {
    notFound();
  }

  const detailResponse = await apiFetch(`/api/v1/systems/${systemSummary.id}`);
  if (!detailResponse.ok) {
    notFound();
  }
  const detailPayload = (await detailResponse.json()) as { system: System };
  const system = detailPayload.system;

  let project: Project | null = null;
  if (system.projectId) {
    const projectResponse = await apiFetch(`/api/v1/projects/${system.projectId}`);
    if (projectResponse.ok) {
      project = ((await projectResponse.json()) as { project: Project }).project;
    }
  }

  return (
    <main style={{ maxWidth: 880, margin: '0 auto' }}>
      <p style={{ opacity: 0.7 }}>
        <Link href={`/workspaces/${workspace.slug}`}>{workspace.name}</Link> / {t('breadcrumb')}
      </p>
      <h1 style={{ marginBottom: '0.35rem' }}>{system.name}</h1>
      <p style={{ opacity: 0.7, marginTop: 0 }}>
        {system.slug} · {system.status}
        {system.environment ? ` · ${system.environment}` : ''}
      </p>
      <section
        style={{
          marginTop: '1.25rem',
          padding: '1.25rem',
          background: 'rgba(255,255,255,0.72)',
          border: '1px solid rgba(21,32,43,0.08)',
        }}
      >
        <p>{system.summary || tCommon('noSummary')}</p>
        <p>{system.description || tCommon('noDescription')}</p>
        <p style={{ opacity: 0.75 }}>
          {t('type')}: {system.systemType || t('unspecified')}
          {project ? (
            <>
              {' '}
              · {tCommon('project')}:{' '}
              <Link href={`/workspaces/${workspace.slug}/projects/${project.slug}`}>
                {project.name}
              </Link>
            </>
          ) : (
            ` · ${t('independentSystem')}`
          )}
        </p>
        {system.tags.length > 0 ? (
          <p style={{ opacity: 0.75, marginBottom: 0 }}>
            {tCommon('tagsList', { tags: system.tags.map((tag) => tag.name).join(', ') })}
          </p>
        ) : null}
      </section>
    </main>
  );
}
