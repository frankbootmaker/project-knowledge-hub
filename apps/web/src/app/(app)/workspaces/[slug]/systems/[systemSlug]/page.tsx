import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { SystemManageMenu } from '../../../../../../components/SystemManageMenu';
import { Badge, Page, PageHeader } from '../../../../../../components/ui';
import { apiFetch, requireSession } from '../../../../../../lib/session';

type Workspace = { id: string; slug: string; name: string };
type SystemItDetails = {
  hostname?: string;
  primaryUrl?: string;
  vendor?: string;
  deploymentModel?: string;
  supportContact?: string;
  documentationUrl?: string;
  dataClassification?: string;
};

type System = {
  id: string;
  name: string;
  slug: string;
  status: string;
  summary: string | null;
  description: string | null;
  systemType: string | null;
  environment: string | null;
  version: string | null;
  criticality: string | null;
  itDetails?: SystemItDetails;
  itCostMode?: 'flat' | 'one_time' | 'note_only' | null;
  itFlatMonthlyFee?: string | null;
  itOneTimeCost?: string | null;
  itBudgetAllocation?: string | null;
  projectId: string | null;
  tags: Array<{ name: string }>;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};
type Project = { id: string; name: string; slug: string };

export default async function SystemDetailPage({
  params,
}: {
  params: Promise<{ slug: string; systemSlug: string }>;
}) {
  const session = await requireSession();
  const t = await getTranslations('systems');
  const tArchive = await getTranslations('archive');
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

  const systemsResponse = await apiFetch(
    `/api/v1/systems?workspaceId=${workspace.id}&includeArchived=true`,
  );
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
  const isArchived = Boolean(system.archivedAt);

  const canMutate =
    session.user.isSystemAdmin ||
    session.memberships.some(
      (membership) =>
        membership.workspaceId === workspace.id &&
        (membership.role === 'workspace_admin' || membership.role === 'maintainer'),
    );
  const canPurge =
    session.user.isSystemAdmin ||
    session.memberships.some(
      (membership) =>
        membership.workspaceId === workspace.id &&
        membership.role === 'workspace_admin',
    );

  const projectsResponse = await apiFetch(`/api/v1/projects?workspaceId=${workspace.id}`);
  const projects = projectsResponse.ok
    ? ((await projectsResponse.json()) as { projects: Project[] }).projects
    : [];

  let project: Project | null = null;
  if (system.projectId) {
    project = projects.find((item) => item.id === system.projectId) ?? null;
    if (!project) {
      const projectResponse = await apiFetch(`/api/v1/projects/${system.projectId}`);
      if (projectResponse.ok) {
        project = ((await projectResponse.json()) as { project: Project }).project;
      }
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
            {isArchived ? <Badge tone="warn">{tArchive('archivedBadge')}</Badge> : null}
            {system.environment ? <span>· {system.environment}</span> : null}
          </span>
        }
        actions={
          <SystemManageMenu
            workspaceSlug={workspace.slug}
            system={system}
            projects={projects}
            canMutate={canMutate}
            canPurge={canPurge}
          />
        }
      />

      <div className="kh-ops-detail-grid">
        <section className="kh-ops-panel">
          <div className="kh-ops-panel-head">
            <h2 className="kh-ops-panel-title">{tCommon('summary')}</h2>
          </div>
          <div className="kh-ops-card-body">
            <p className="mt-0 mb-3 text-ink-muted">
              {system.summary || tCommon('noSummary')}
            </p>
            <p className="m-0 text-ink-muted">
              {system.description || tCommon('noDescription')}
            </p>
          </div>
        </section>
        <aside className="kh-ops-editor-stack">
          <section className="kh-ops-panel">
            <div className="kh-ops-panel-head">
              <h2 className="kh-ops-panel-title">{tCommon('status')}</h2>
            </div>
            <dl className="kh-ops-keyvals">
              <dt>{tCommon('status')}</dt>
              <dd>{system.status}</dd>
              <dt>{t('type')}</dt>
              <dd>{system.systemType || t('unspecified')}</dd>
              {system.environment ? (
                <>
                  <dt>{t('environment')}</dt>
                  <dd>{system.environment}</dd>
                </>
              ) : null}
              <dt>{tCommon('project')}</dt>
              <dd>
                {project ? (
                  <Link
                    href={`/workspaces/${workspace.slug}/projects/${project.slug}`}
                    className="text-brand no-underline hover:text-brand-hover"
                  >
                    {project.name}
                  </Link>
                ) : (
                  t('independentSystem')
                )}
              </dd>
            </dl>
          </section>
          {system.tags.length > 0 ? (
            <section className="kh-ops-panel">
              <div className="kh-ops-panel-head">
                <h2 className="kh-ops-panel-title">{tCommon('tags')}</h2>
              </div>
              <div className="kh-ops-tag-list">
                {system.tags.map((tag) => (
                  <span key={tag.name} className="kh-ops-tag">
                    {tag.name}
                  </span>
                ))}
              </div>
            </section>
          ) : null}
        </aside>
      </div>
    </Page>
  );
}
