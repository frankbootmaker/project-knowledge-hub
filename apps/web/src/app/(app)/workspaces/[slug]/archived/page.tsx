import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ArchiveEntityButton } from '../../../../../components/ArchiveEntityButton';
import {
  Badge,
  ListCard,
  Page,
  PageHeader,
  SectionHeader,
} from '../../../../../components/ui';
import { apiFetch, requireSession } from '../../../../../lib/session';

type Workspace = {
  id: string;
  name: string;
  slug: string;
  archivedAt: string | null;
};

type Project = {
  id: string;
  name: string;
  slug: string;
  archivedAt: string | null;
  updatedAt: string;
};

type System = {
  id: string;
  name: string;
  slug: string;
  archivedAt: string | null;
  updatedAt: string;
};

type RecordRow = {
  id: string;
  title: string;
  slug: string;
  archivedAt: string | null;
  updatedAt: string;
};

export default async function WorkspaceArchivedPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const session = await requireSession();
  const t = await getTranslations('archive');
  const tWorkspaces = await getTranslations('workspaces');
  const { slug } = await params;

  const listResponse = await apiFetch('/api/v1/workspaces');
  if (!listResponse.ok) {
    notFound();
  }
  const listPayload = (await listResponse.json()) as { workspaces: Workspace[] };
  const workspace = listPayload.workspaces.find((item) => item.slug === slug);
  if (!workspace) {
    notFound();
  }

  const canManage =
    session.user.isSystemAdmin ||
    session.memberships.some(
      (membership) =>
        membership.workspaceId === workspace.id &&
        (membership.role === 'workspace_admin' || membership.role === 'maintainer'),
    );

  const [projectsRes, systemsRes, recordsRes] = await Promise.all([
    apiFetch(`/api/v1/projects?workspaceId=${workspace.id}&includeArchived=true`),
    apiFetch(`/api/v1/systems?workspaceId=${workspace.id}&includeArchived=true`),
    apiFetch(
      `/api/v1/knowledge-records?workspaceId=${workspace.id}&includeArchived=true`,
    ),
  ]);

  const projects = projectsRes.ok
    ? ((await projectsRes.json()) as { projects: Project[] }).projects.filter(
        (item) => item.archivedAt,
      )
    : [];
  const systems = systemsRes.ok
    ? ((await systemsRes.json()) as { systems: System[] }).systems.filter(
        (item) => item.archivedAt,
      )
    : [];
  const records = recordsRes.ok
    ? (
        (await recordsRes.json()) as { knowledgeRecords: RecordRow[] }
      ).knowledgeRecords.filter((item) => item.archivedAt)
    : [];

  return (
    <Page wide>
      <PageHeader
        eyebrow={
          <Link
            href={`/workspaces/${workspace.slug}`}
            className="text-brand no-underline hover:text-brand-hover"
          >
            {workspace.name}
          </Link>
        }
        title={t('workspaceTitle')}
        description={t('workspaceBlurb')}
      />

      <section className="mb-8">
        <SectionHeader title={tWorkspaces('projects')} />
        <ul className="m-0 grid list-none gap-3 p-0">
          {projects.map((project) => (
            <ListCard key={project.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/workspaces/${workspace.slug}/projects/${project.slug}`}
                      className="font-semibold no-underline"
                    >
                      {project.name}
                    </Link>
                    <Badge tone="warn">{t('archivedBadge')}</Badge>
                  </div>
                  <p className="mt-1 mb-0 text-xs text-ink-muted">
                    {new Date(project.updatedAt).toLocaleString()}
                  </p>
                </div>
                {canManage ? (
                  <ArchiveEntityButton
                    kind="project"
                    entityId={project.id}
                    entityName={project.name}
                    archived
                  />
                ) : null}
              </div>
            </ListCard>
          ))}
          {projects.length === 0 ? (
            <li className="kh-muted list-none">{t('emptyProjects')}</li>
          ) : null}
        </ul>
      </section>

      <section className="mb-8">
        <SectionHeader title={tWorkspaces('systems')} />
        <ul className="m-0 grid list-none gap-3 p-0">
          {systems.map((system) => (
            <ListCard key={system.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/workspaces/${workspace.slug}/systems/${system.slug}`}
                      className="font-semibold no-underline"
                    >
                      {system.name}
                    </Link>
                    <Badge tone="warn">{t('archivedBadge')}</Badge>
                  </div>
                  <p className="mt-1 mb-0 text-xs text-ink-muted">
                    {new Date(system.updatedAt).toLocaleString()}
                  </p>
                </div>
                {canManage ? (
                  <ArchiveEntityButton
                    kind="system"
                    entityId={system.id}
                    entityName={system.name}
                    archived
                  />
                ) : null}
              </div>
            </ListCard>
          ))}
          {systems.length === 0 ? (
            <li className="kh-muted list-none">{t('emptySystems')}</li>
          ) : null}
        </ul>
      </section>

      <section>
        <SectionHeader title={tWorkspaces('knowledgeRecords')} />
        <ul className="m-0 grid list-none gap-3 p-0">
          {records.map((record) => (
            <ListCard key={record.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/workspaces/${workspace.slug}/records/${record.slug}`}
                      className="font-semibold no-underline"
                    >
                      {record.title}
                    </Link>
                    <Badge tone="warn">{t('archivedBadge')}</Badge>
                  </div>
                  <p className="mt-1 mb-0 text-xs text-ink-muted">
                    {new Date(record.updatedAt).toLocaleString()}
                  </p>
                </div>
                {canManage ? (
                  <ArchiveEntityButton
                    kind="record"
                    entityId={record.id}
                    entityName={record.title}
                    archived
                  />
                ) : null}
              </div>
            </ListCard>
          ))}
          {records.length === 0 ? (
            <li className="kh-muted list-none">{t('emptyRecords')}</li>
          ) : null}
        </ul>
      </section>
    </Page>
  );
}
