import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { ArchiveEntityButton } from './ArchiveEntityButton';
import { Badge } from './ui';
import {
  canRestoreCatalogue,
  canRestoreWorkspace,
  type ArchivedListings,
} from '../lib/archive-listings';
import type { SessionPayload } from '../lib/session';

function formatDate(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export async function ArchivedItemsSections({
  session,
  listings,
  showWorkspaces,
}: {
  session: SessionPayload;
  listings: ArchivedListings;
  showWorkspaces: boolean;
}) {
  const t = await getTranslations('archive');

  return (
    <div className="grid gap-4">
      {showWorkspaces ? (
        <section className="kh-ops-panel">
          <div className="kh-ops-panel-head">
            <h2 className="kh-ops-panel-title">{t('sectionWorkspaces')}</h2>
          </div>
          {listings.workspaces.length === 0 ? (
            <p className="kh-ops-empty">{t('emptyWorkspaces')}</p>
          ) : (
            <div className="kh-ops-table-wrap">
              <table className="kh-ops-data-table">
                <thead>
                  <tr>
                    <th>{t('colItem')}</th>
                    <th>{t('colKind')}</th>
                    <th>{t('colDate')}</th>
                    <th>{t('colRestore')}</th>
                  </tr>
                </thead>
                <tbody>
                  {listings.workspaces.map((workspace) => (
                    <tr key={workspace.id}>
                      <td className="kh-ops-primary-cell">
                        {workspace.name}
                        <div className="font-mono text-[11px] font-normal text-ink-muted">
                          {workspace.slug}
                        </div>
                      </td>
                      <td>
                        <span className="kh-ops-type-chip">{t('kindWorkspace')}</span>
                      </td>
                      <td>{formatDate(workspace.archivedAt ?? workspace.updatedAt)}</td>
                      <td>
                        {canRestoreWorkspace(session, workspace.id) ? (
                          <ArchiveEntityButton
                            kind="workspace"
                            entityId={workspace.id}
                            entityName={workspace.name}
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
      ) : null}

      <section className="kh-ops-panel">
        <div className="kh-ops-panel-head">
          <h2 className="kh-ops-panel-title">{t('sectionProjects')}</h2>
        </div>
        {listings.projects.length === 0 ? (
          <p className="kh-ops-empty">{t('emptyProjects')}</p>
        ) : (
          <div className="kh-ops-table-wrap">
            <table className="kh-ops-data-table">
              <thead>
                <tr>
                  <th>{t('colItem')}</th>
                  <th>{t('colKind')}</th>
                  <th>{t('colDate')}</th>
                  <th>{t('colRestore')}</th>
                </tr>
              </thead>
              <tbody>
                {listings.projects.map((project) => (
                  <tr key={project.id}>
                    <td className="kh-ops-primary-cell">
                      <Link
                        href={`/workspaces/${project.workspaceSlug}/projects/${project.slug}`}
                        className="no-underline"
                      >
                        {project.name}
                      </Link>
                      <div className="text-[11px] font-normal text-ink-muted">
                        {project.workspaceName}
                      </div>
                    </td>
                    <td>
                      <span className="kh-ops-type-chip">{t('kindProject')}</span>
                    </td>
                    <td>{formatDate(project.archivedAt ?? project.updatedAt)}</td>
                    <td>
                      {canRestoreCatalogue(session, project.workspaceId) ? (
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
          <h2 className="kh-ops-panel-title">{t('sectionSystems')}</h2>
        </div>
        {listings.systems.length === 0 ? (
          <p className="kh-ops-empty">{t('emptySystems')}</p>
        ) : (
          <div className="kh-ops-table-wrap">
            <table className="kh-ops-data-table">
              <thead>
                <tr>
                  <th>{t('colItem')}</th>
                  <th>{t('colKind')}</th>
                  <th>{t('colDate')}</th>
                  <th>{t('colRestore')}</th>
                </tr>
              </thead>
              <tbody>
                {listings.systems.map((system) => (
                  <tr key={system.id}>
                    <td className="kh-ops-primary-cell">
                      <Link
                        href={`/workspaces/${system.workspaceSlug}/systems/${system.slug}`}
                        className="no-underline"
                      >
                        {system.name}
                      </Link>
                      <div className="text-[11px] font-normal text-ink-muted">
                        {system.workspaceName}
                      </div>
                    </td>
                    <td>
                      <span className="kh-ops-type-chip">{t('kindSystem')}</span>
                    </td>
                    <td>{formatDate(system.archivedAt ?? system.updatedAt)}</td>
                    <td>
                      {canRestoreCatalogue(session, system.workspaceId) ? (
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
          <h2 className="kh-ops-panel-title">{t('sectionRecords')}</h2>
        </div>
        {listings.records.length === 0 ? (
          <p className="kh-ops-empty">{t('emptyRecords')}</p>
        ) : (
          <div className="kh-ops-table-wrap">
            <table className="kh-ops-data-table">
              <thead>
                <tr>
                  <th>{t('colItem')}</th>
                  <th>{t('colKind')}</th>
                  <th>{t('colDate')}</th>
                  <th>{t('colRestore')}</th>
                </tr>
              </thead>
              <tbody>
                {listings.records.map((record) => (
                  <tr key={record.id}>
                    <td className="kh-ops-primary-cell">
                      {record.humanKey ? (
                        <span className="kh-ops-type-chip mr-2">
                          {record.humanKey}
                        </span>
                      ) : null}
                      <Link
                        href={`/workspaces/${record.workspaceSlug}/records/${record.slug}`}
                        className="no-underline"
                      >
                        {record.title}
                      </Link>
                      <div className="text-[11px] font-normal text-ink-muted">
                        {record.workspaceName}
                      </div>
                    </td>
                    <td>
                      <span className="kh-ops-type-chip">{t('kindRecord')}</span>
                    </td>
                    <td>{formatDate(record.archivedAt ?? record.updatedAt)}</td>
                    <td>
                      {canRestoreCatalogue(session, record.workspaceId) ? (
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
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
