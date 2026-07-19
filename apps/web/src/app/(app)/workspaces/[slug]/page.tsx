import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ArchiveEntityButton } from '../../../../components/ArchiveEntityButton';
import {
  Badge,
  ListCard,
  Page,
  PageHeader,
  Panel,
  SectionHeader,
} from '../../../../components/ui';
import { apiFetch, requireSession } from '../../../../lib/session';

type Workspace = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  updatedAt: string;
  archivedAt?: string | null;
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
  title: string;
  slug: string;
  recordType: string;
  lifecycleStatus: string;
  summary: string | null;
  systemId: string | null;
};

function NewLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="text-sm font-medium text-brand no-underline hover:text-brand-hover"
    >
      {label}
    </Link>
  );
}

export default async function WorkspaceDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const session = await requireSession();
  const t = await getTranslations('workspaces');
  const tCommon = await getTranslations('common');
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
  const canArchiveWorkspace =
    session.user.isSystemAdmin ||
    session.memberships.some(
      (membership) =>
        membership.workspaceId === workspace.id &&
        membership.role === 'workspace_admin',
    );

  return (
    <Page wide>
      <PageHeader
        title={workspace.name}
        description={workspace.slug}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/workspaces/${workspace.slug}/archived`}
              className="text-sm font-medium text-brand no-underline hover:text-brand-hover"
            >
              {t('archivedItems')}
            </Link>
            {canArchiveWorkspace ? (
              <ArchiveEntityButton
                kind="workspace"
                entityId={workspace.id}
                entityName={workspace.name}
                archived={Boolean(workspace.archivedAt)}
                redirectOnArchive="/workspaces"
              />
            ) : null}
          </div>
        }
      />
      <Panel className="mb-8">
        <p className="m-0 text-ink-muted">{workspace.description || t('noDescription')}</p>
      </Panel>

      <section className="mb-8">
        <SectionHeader
          title={t('projects')}
          action={
            canMutate ? (
              <NewLink
                href={`/workspaces/${workspace.slug}/projects/new`}
                label={t('newProject')}
              />
            ) : null
          }
        />
        <ul className="m-0 grid list-none gap-3 p-0">
          {projects.map((project) => (
            <ListCard key={project.id}>
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={`/workspaces/${workspace.slug}/projects/${project.slug}`}
                  className="font-semibold no-underline"
                >
                  {project.name}
                </Link>
                <Badge tone="brand">{project.status}</Badge>
              </div>
              {project.summary ? (
                <p className="mt-2 mb-0 text-sm text-ink-muted">{project.summary}</p>
              ) : null}
              {project.tags.length > 0 ? (
                <p className="mt-2 mb-0 text-xs text-ink-muted">
                  {tCommon('tagsList', { tags: project.tags.map((tag) => tag.name).join(', ') })}
                </p>
              ) : null}
            </ListCard>
          ))}
          {projects.length === 0 ? <li className="kh-muted list-none">{t('noProjects')}</li> : null}
        </ul>
      </section>

      <section className="mb-8">
        <SectionHeader
          title={t('systems')}
          action={
            canMutate ? (
              <NewLink
                href={`/workspaces/${workspace.slug}/systems/new`}
                label={t('newSystem')}
              />
            ) : null
          }
        />
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
              <p className="mt-2 mb-0 text-sm text-ink-muted">
                {system.projectId ? t('linkedToProject') : t('independent')}
                {system.summary ? ` — ${system.summary}` : ''}
              </p>
              {system.tags.length > 0 ? (
                <p className="mt-2 mb-0 text-xs text-ink-muted">
                  {tCommon('tagsList', { tags: system.tags.map((tag) => tag.name).join(', ') })}
                </p>
              ) : null}
            </ListCard>
          ))}
          {systems.length === 0 ? <li className="kh-muted list-none">{t('noSystems')}</li> : null}
        </ul>
      </section>

      <section>
        <SectionHeader
          title={t('knowledgeRecords')}
          action={
            canMutate ? (
              <NewLink
                href={`/workspaces/${workspace.slug}/records/new`}
                label={t('newRecord')}
              />
            ) : null
          }
        />
        <ul className="m-0 grid list-none gap-3 p-0">
          {records.map((record) => (
            <ListCard key={record.id}>
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
              <p className="mt-2 mb-0 text-sm text-ink-muted">
                {record.systemId ? t('linkedToSystem') : null}
                {record.summary ? `${record.systemId ? ' — ' : ''}${record.summary}` : ''}
              </p>
            </ListCard>
          ))}
          {records.length === 0 ? <li className="kh-muted list-none">{t('noRecords')}</li> : null}
        </ul>
      </section>
    </Page>
  );
}
