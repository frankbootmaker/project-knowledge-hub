import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Badge, Page, PageHeader, Panel } from '../../../../../../components/ui';
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
    <Page wide>
      <PageHeader
        eyebrow={
          <>
            <Link
              href={`/workspaces/${workspace.slug}`}
              className="text-brand no-underline hover:text-brand-hover"
            >
              {workspace.name}
            </Link>
            {' / '}
            {t('breadcrumb')}
          </>
        }
        title={system.name}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <span>{system.slug}</span>
            <Badge>{system.status}</Badge>
            {system.environment ? <span>· {system.environment}</span> : null}
          </span>
        }
      />

      <Panel>
        <p className="mt-0 mb-3 text-ink-muted">{system.summary || tCommon('noSummary')}</p>
        <p className="m-0 text-ink-muted">{system.description || tCommon('noDescription')}</p>
        <p className="mt-3 mb-0 text-sm text-ink-muted">
          {t('type')}: {system.systemType || t('unspecified')}
          {project ? (
            <>
              {' '}
              · {tCommon('project')}:{' '}
              <Link
                href={`/workspaces/${workspace.slug}/projects/${project.slug}`}
                className="text-brand no-underline hover:text-brand-hover"
              >
                {project.name}
              </Link>
            </>
          ) : (
            ` · ${t('independentSystem')}`
          )}
        </p>
        {system.tags.length > 0 ? (
          <p className="mt-3 mb-0 text-xs text-ink-muted">
            {tCommon('tagsList', { tags: system.tags.map((tag) => tag.name).join(', ') })}
          </p>
        ) : null}
      </Panel>
    </Page>
  );
}
