import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { ArchiveEntityButton } from '../../../../../components/ArchiveEntityButton';
import { LocalDateTime } from '../../../../../components/LocalDateTime';
import { Badge, Page, PageHeader, lifecycleLabel } from '../../../../../components/ui';
import {
  knowledgeRecordAppearsInArchive,
  projectAppearsInArchive,
  systemAppearsInArchive,
} from '../../../../../lib/archive-listings';
import { recordHref } from '../../../../../lib/record-href';
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
  status?: string | null;
  archivedAt: string | null;
  updatedAt: string;
};

type System = {
  id: string;
  name: string;
  slug: string;
  status?: string | null;
  projectId: string | null;
  archivedAt: string | null;
  updatedAt: string;
};

type RecordRow = {
  id: string;
  title: string;
  slug: string;
  recordType: string;
  humanKey?: string | null;
  language?: string | null;
  lifecycleStatus?: string | null;
  archivedAt: string | null;
  updatedAt: string;
};

export default async function WorkspaceArchivedPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const session = await requireSession();
  const locale = await getLocale();
  const t = await getTranslations('archive');
  const tWorkspaces = await getTranslations('workspaces');
  const tRecords = await getTranslations('records');
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
    ? ((await projectsRes.json()) as { projects: Project[] }).projects.filter((item) =>
        projectAppearsInArchive(item),
      )
    : [];
  const systems = systemsRes.ok
    ? ((await systemsRes.json()) as { systems: System[] }).systems.filter((item) =>
        systemAppearsInArchive(item),
      )
    : [];
  const records = recordsRes.ok
    ? (
        (await recordsRes.json()) as { knowledgeRecords: RecordRow[] }
      ).knowledgeRecords.filter((item) => knowledgeRecordAppearsInArchive(item))
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

      <div className="grid gap-4">
        <section className="kh-ops-panel">
          <div className="kh-ops-panel-head">
            <h2 className="kh-ops-panel-title">{tWorkspaces('projects')}</h2>
          </div>
          {projects.length === 0 ? (
            <p className="kh-ops-empty">{t('emptyProjects')}</p>
          ) : (
            <div className="kh-ops-table-wrap">
              <table className="kh-ops-data-table">
                <thead>
                  <tr>
                    <th>{tWorkspaces('colName')}</th>
                    <th>{tWorkspaces('colStatus')}</th>
                    <th>{tWorkspaces('colUpdated')}</th>
                    <th>{t('colRestore')}</th>
                  </tr>
                </thead>
                <tbody>
                  {projects.map((project) => (
                    <tr key={project.id}>
                      <td className="kh-ops-primary-cell">
                        <Link
                          href={`/workspaces/${workspace.slug}/projects/${project.slug}`}
                          className="no-underline"
                        >
                          {project.name}
                        </Link>
                      </td>
                      <td>{project.status}</td>
                      <td>
                        <LocalDateTime value={project.updatedAt} dateOnly locale={locale} />
                      </td>
                      <td>
                        {canManage ? (
                          <ArchiveEntityButton
                            kind="project"
                            entityId={project.id}
                            entityName={project.name}
                            archived
                          />
                        ) : (
                          <Badge tone="warn">{t('archivedBadge')}</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="kh-ops-panel">
          <div className="kh-ops-panel-head">
            <h2 className="kh-ops-panel-title">{tWorkspaces('systems')}</h2>
          </div>
          {systems.length === 0 ? (
            <p className="kh-ops-empty">{t('emptySystems')}</p>
          ) : (
            <div className="kh-ops-table-wrap">
              <table className="kh-ops-data-table">
                <thead>
                  <tr>
                    <th>{tWorkspaces('colName')}</th>
                    <th>{tWorkspaces('colStatus')}</th>
                    <th>{tWorkspaces('colLink')}</th>
                    <th>{tWorkspaces('colUpdated')}</th>
                    <th>{t('colRestore')}</th>
                  </tr>
                </thead>
                <tbody>
                  {systems.map((system) => (
                    <tr key={system.id}>
                      <td className="kh-ops-primary-cell">
                        <Link
                          href={`/workspaces/${workspace.slug}/systems/${system.slug}`}
                          className="no-underline"
                        >
                          {system.name}
                        </Link>
                      </td>
                      <td>
                        <span className="kh-ops-type-chip">{system.status}</span>
                      </td>
                      <td>
                        {system.projectId
                          ? tWorkspaces('linkedToProject')
                          : tWorkspaces('independent')}
                      </td>
                      <td>
                        <LocalDateTime value={system.updatedAt} dateOnly locale={locale} />
                      </td>
                      <td>
                        {canManage ? (
                          <ArchiveEntityButton
                            kind="system"
                            entityId={system.id}
                            entityName={system.name}
                            archived
                          />
                        ) : (
                          <Badge tone="warn">{t('archivedBadge')}</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="kh-ops-panel">
          <div className="kh-ops-panel-head">
            <h2 className="kh-ops-panel-title">{tWorkspaces('knowledgeRecords')}</h2>
          </div>
          {records.length === 0 ? (
            <p className="kh-ops-empty">{t('emptyRecords')}</p>
          ) : (
            <div className="kh-ops-table-wrap">
              <table className="kh-ops-data-table">
                <thead>
                  <tr>
                    <th>{tWorkspaces('colKey')}</th>
                    <th>{tWorkspaces('colTitle')}</th>
                    <th>{tWorkspaces('colType')}</th>
                    <th>{tWorkspaces('colLanguage')}</th>
                    <th>{tWorkspaces('colLifecycle')}</th>
                    <th>{tWorkspaces('colUpdated')}</th>
                    <th>{t('colRestore')}</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((record) => {
                    const recordPath = recordHref({
                      workspaceSlug: workspace.slug,
                      recordSlug: record.slug,
                    });
                    const key = record.humanKey;
                    return (
                      <tr key={record.id}>
                        <td>
                          <Link
                            href={recordPath}
                            className={key ? 'kh-ops-key-badge' : 'kh-ops-type-chip'}
                          >
                            {key ?? record.recordType}
                          </Link>
                        </td>
                        <td className="kh-ops-primary-cell">
                          <Link href={recordPath} className="no-underline">
                            {record.title}
                          </Link>
                        </td>
                        <td>{record.recordType}</td>
                        <td>{record.language ?? '—'}</td>
                        <td>
                          {lifecycleLabel(record.lifecycleStatus ?? 'draft', tRecords)}
                        </td>
                        <td>
                          <LocalDateTime value={record.updatedAt} dateOnly locale={locale} />
                        </td>
                        <td>
                          {canManage ? (
                            <ArchiveEntityButton
                              kind="record"
                              entityId={record.id}
                              entityName={record.title}
                              archived
                            />
                          ) : (
                            <Badge tone="warn">{t('archivedBadge')}</Badge>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </Page>
  );
}
