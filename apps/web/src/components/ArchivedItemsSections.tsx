import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { ArchiveEntityButton } from './ArchiveEntityButton';
import { Badge, ListCard, SectionHeader } from './ui';
import {
  canRestoreCatalogue,
  canRestoreWorkspace,
  type ArchivedListings,
} from '../lib/archive-listings';
import type { SessionPayload } from '../lib/session';

export async function ArchivedItemsSections({
  session,
  listings,
  showWorkspaces,
}: {
  session: SessionPayload;
  listings: ArchivedListings;
  /** Workspace soft-archive restore (admins / workspace admins). */
  showWorkspaces: boolean;
}) {
  const t = await getTranslations('archive');

  return (
    <>
      {showWorkspaces ? (
        <section className="mb-8">
          <SectionHeader title={t('sectionWorkspaces')} />
          <ul className="m-0 grid list-none gap-3 p-0">
            {listings.workspaces.map((workspace) => (
              <ListCard key={workspace.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <strong>{workspace.name}</strong>
                      <Badge tone="warn">{t('archivedBadge')}</Badge>
                    </div>
                    <p className="mt-1 mb-0 font-mono text-xs text-ink-muted">
                      {workspace.slug}
                    </p>
                  </div>
                  {canRestoreWorkspace(session, workspace.id) ? (
                    <ArchiveEntityButton
                      kind="workspace"
                      entityId={workspace.id}
                      entityName={workspace.name}
                      archived
                    />
                  ) : null}
                </div>
              </ListCard>
            ))}
            {listings.workspaces.length === 0 ? (
              <li className="kh-muted list-none">{t('emptyWorkspaces')}</li>
            ) : null}
          </ul>
        </section>
      ) : null}

      <section className="mb-8">
        <SectionHeader title={t('sectionProjects')} />
        <ul className="m-0 grid list-none gap-3 p-0">
          {listings.projects.map((project) => (
            <ListCard key={project.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/workspaces/${project.workspaceSlug}/projects/${project.slug}`}
                      className="font-semibold no-underline"
                    >
                      {project.name}
                    </Link>
                    <Badge tone="warn">{t('archivedBadge')}</Badge>
                  </div>
                  <p className="mt-1 mb-0 text-xs text-ink-muted">
                    {project.workspaceName}
                  </p>
                </div>
                {canRestoreCatalogue(session, project.workspaceId) ? (
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
          {listings.projects.length === 0 ? (
            <li className="kh-muted list-none">{t('emptyProjects')}</li>
          ) : null}
        </ul>
      </section>

      <section className="mb-8">
        <SectionHeader title={t('sectionSystems')} />
        <ul className="m-0 grid list-none gap-3 p-0">
          {listings.systems.map((system) => (
            <ListCard key={system.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/workspaces/${system.workspaceSlug}/systems/${system.slug}`}
                      className="font-semibold no-underline"
                    >
                      {system.name}
                    </Link>
                    <Badge tone="warn">{t('archivedBadge')}</Badge>
                  </div>
                  <p className="mt-1 mb-0 text-xs text-ink-muted">
                    {system.workspaceName}
                  </p>
                </div>
                {canRestoreCatalogue(session, system.workspaceId) ? (
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
          {listings.systems.length === 0 ? (
            <li className="kh-muted list-none">{t('emptySystems')}</li>
          ) : null}
        </ul>
      </section>

      <section>
        <SectionHeader title={t('sectionRecords')} />
        <ul className="m-0 grid list-none gap-3 p-0">
          {listings.records.map((record) => (
            <ListCard key={record.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/workspaces/${record.workspaceSlug}/records/${record.slug}`}
                      className="font-semibold no-underline"
                    >
                      {record.title}
                    </Link>
                    <Badge tone="warn">{t('archivedBadge')}</Badge>
                  </div>
                  <p className="mt-1 mb-0 text-xs text-ink-muted">
                    {record.workspaceName}
                  </p>
                </div>
                {canRestoreCatalogue(session, record.workspaceId) ? (
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
          {listings.records.length === 0 ? (
            <li className="kh-muted list-none">{t('emptyRecords')}</li>
          ) : null}
        </ul>
      </section>
    </>
  );
}
