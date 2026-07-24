import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ProjectManageMenu } from '../../../../../../components/ProjectManageMenu';
import {
  Badge,
  ListCard,
  Page,
  PageHeader,
  Panel,
  SectionHeader,
} from '../../../../../../components/ui';
import { apiFetch, requireSession } from '../../../../../../lib/session';

export const dynamic = 'force-dynamic';

type Workspace = { id: string; slug: string; name: string };
type Project = {
  id: string;
  name: string;
  slug: string;
  status: string;
  summary: string | null;
  description: string | null;
  tags: Array<{ name: string }>;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};
type System = {
  id: string;
  name: string;
  slug: string;
  status: string;
  projectId: string | null;
};
type KnowledgeRecordSummary = {
  id: string;
  title: string;
  slug: string;
  recordType: string;
  lifecycleStatus: string;
  updatedAt: string;
};

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ slug: string; projectSlug: string }>;
}) {
  const session = await requireSession();
  const t = await getTranslations('projects');
  const tArchive = await getTranslations('archive');
  const tCommon = await getTranslations('common');
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

  const projectsResponse = await apiFetch(
    `/api/v1/projects?workspaceId=${workspace.id}&includeArchived=true`,
  );
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
  const isArchived = Boolean(project.archivedAt);

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

  const [systemsResponse, recordsResponse] = await Promise.all([
    apiFetch(`/api/v1/systems?workspaceId=${workspace.id}&projectId=${project.id}`),
    apiFetch(
      `/api/v1/knowledge-records?workspaceId=${workspace.id}&projectId=${project.id}`,
    ),
  ]);
  const systems = systemsResponse.ok
    ? ((await systemsResponse.json()) as { systems: System[] }).systems
    : [];
  const knowledgeRecords = recordsResponse.ok
    ? ((await recordsResponse.json()) as { knowledgeRecords: KnowledgeRecordSummary[] })
        .knowledgeRecords
    : [];

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
        title={project.name}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <span>{project.slug}</span>
            <Badge tone="brand">{project.status}</Badge>
            {isArchived ? <Badge tone="warn">{tArchive('archivedBadge')}</Badge> : null}
          </span>
        }
        actions={
          <ProjectManageMenu
            workspaceSlug={workspace.slug}
            project={project}
            canMutate={canMutate}
            canPurge={canPurge}
          />
        }
      />

      <Panel className="mb-8">
        <p className="mt-0 mb-3 text-ink-muted">{project.summary || tCommon('noSummary')}</p>
        <p className="m-0 text-ink-muted">{project.description || tCommon('noDescription')}</p>
        {project.tags.length > 0 ? (
          <p className="mt-3 mb-0 text-xs text-ink-muted">
            {tCommon('tagsList', { tags: project.tags.map((tag) => tag.name).join(', ') })}
          </p>
        ) : null}
      </Panel>

      <section>
        <SectionHeader title={t('linkedSystems')} />
        <ul className="m-0 grid list-none gap-3 p-0">
          {systems.map((system) => (
            <ListCard key={system.id}>
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={`/workspaces/${workspace.slug}/systems/${system.slug}`}
                  className="font-semibold no-underline"
                >
                  {system.name}
                </Link>
                <Badge>{system.status}</Badge>
              </div>
            </ListCard>
          ))}
          {systems.length === 0 ? (
            <li className="kh-muted list-none">{t('noLinkedSystems')}</li>
          ) : null}
        </ul>
      </section>

      <section className="mt-8">
        <SectionHeader title={t('linkedKnowledge')} />
        <ul className="m-0 grid list-none gap-3 p-0">
          {knowledgeRecords.map((record) => (
            <ListCard key={record.id}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/workspaces/${workspace.slug}/records/${record.slug}`}
                      className="font-semibold no-underline"
                    >
                      {record.title}
                    </Link>
                    <Badge tone="brand">{record.recordType}</Badge>
                    <Badge>{record.lifecycleStatus}</Badge>
                  </div>
                </div>
                <time
                  className="shrink-0 text-xs text-ink-muted"
                  dateTime={record.updatedAt}
                >
                  {tCommon('lastUpdated')}: {new Date(record.updatedAt).toLocaleString()}
                </time>
              </div>
            </ListCard>
          ))}
          {knowledgeRecords.length === 0 ? (
            <li className="kh-muted list-none">{t('noLinkedKnowledge')}</li>
          ) : null}
        </ul>
      </section>
    </Page>
  );
}
