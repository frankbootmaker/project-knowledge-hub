'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Badge, Input, LinkButton, lifecycleLabel } from './ui';
import { ImportTypePickerButton } from './ImportTypePickerButton';
import { CollapsibleSection } from './CollapsibleSection';
import {
  groupRecordsByTranslationFamily,
  normalizeContentLanguage,
  pickPreferredRecord,
} from '../lib/translation-families';

export type { CatalogueListItem } from './CatalogueSection';

export type WorkspaceCatalogueProject = {
  id: string;
  name: string;
  slug: string;
  status: string;
  summary: string | null;
  tags: Array<{ name: string }>;
  updatedAt: string;
  overallRag?: 'green' | 'amber' | 'red';
};

export type WorkspaceCatalogueSystem = {
  id: string;
  name: string;
  slug: string;
  status: string;
  projectId: string | null;
  summary: string | null;
  tags: Array<{ name: string }>;
  updatedAt: string;
};

export type WorkspaceCatalogueRecord = {
  id: string;
  title: string;
  slug: string;
  recordType: string;
  humanKey?: string | null;
  lifecycleStatus: string;
  language?: string | null;
  translationGroupId?: string | null;
  summary: string | null;
  systemId: string | null;
  updatedAt: string;
};

function ragTone(
  rag: 'green' | 'amber' | 'red',
): 'success' | 'warn' | 'danger' {
  if (rag === 'red') return 'danger';
  if (rag === 'amber') return 'warn';
  return 'success';
}

function formatUpdated(value: string, locale: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function WorkspaceCatalogueSections({
  workspaceSlug,
  projects,
  systems,
  records,
  canMutate,
}: {
  workspaceSlug: string;
  projects: WorkspaceCatalogueProject[];
  systems: WorkspaceCatalogueSystem[];
  records: WorkspaceCatalogueRecord[];
  canMutate: boolean;
}) {
  const t = useTranslations('workspaces');
  const tProjects = useTranslations('projects');
  const tRecords = useTranslations('records');
  const locale = useLocale();
  const [projectQuery, setProjectQuery] = useState('');
  const [systemQuery, setSystemQuery] = useState('');
  const [recordQuery, setRecordQuery] = useState('');

  const filteredProjects = useMemo(() => {
    const needle = projectQuery.trim().toLowerCase();
    if (!needle) return projects;
    return projects.filter((project) =>
      [project.name, project.slug, project.summary ?? '', project.status]
        .join(' ')
        .toLowerCase()
        .includes(needle),
    );
  }, [projectQuery, projects]);

  const filteredSystems = useMemo(() => {
    const needle = systemQuery.trim().toLowerCase();
    if (!needle) return systems;
    return systems.filter((system) =>
      [system.name, system.slug, system.summary ?? '', system.status]
        .join(' ')
        .toLowerCase()
        .includes(needle),
    );
  }, [systemQuery, systems]);

  const recordFamilies = useMemo(
    () =>
      groupRecordsByTranslationFamily(records).map((family) => {
        const preferred = pickPreferredRecord(family, locale);
        return { family, preferred };
      }),
    [locale, records],
  );

  const filteredRecords = useMemo(() => {
    const needle = recordQuery.trim().toLowerCase();
    if (!needle) return recordFamilies;
    return recordFamilies.filter(({ family, preferred }) =>
      family
        .flatMap((record) => [
          record.title,
          record.slug,
          record.recordType,
          record.humanKey ?? '',
          record.lifecycleStatus,
          normalizeContentLanguage(record.language),
          record.summary ?? '',
          preferred.title,
        ])
        .join(' ')
        .toLowerCase()
        .includes(needle),
    );
  }, [recordFamilies, recordQuery]);

  return (
    <>
      <CollapsibleSection
        storageKey={`workspace:${workspaceSlug}:projects`}
        title={t('projects')}
        defaultOpen
      >
        <section className="kh-ops-panel">
          <div className="kh-ops-toolbar mb-0 border-0 border-b border-line">
            <Input
              type="search"
              value={projectQuery}
              onChange={(event) => setProjectQuery(event.target.value)}
              placeholder={t('sectionSearchProjects')}
              className="h-10 min-h-10 min-w-[220px] flex-1 py-1.5 text-xs"
            />
            {canMutate ? (
              <LinkButton href={`/workspaces/${workspaceSlug}/projects/new`}>
                {t('newProject')}
              </LinkButton>
            ) : null}
          </div>
          {filteredProjects.length === 0 ? (
            <p className="kh-ops-empty">
              {projectQuery.trim() ? t('sectionEmptyFiltered') : t('noProjects')}
            </p>
          ) : (
            <div className="kh-ops-project-grid">
              {filteredProjects.map((project) => {
                const overallRag = project.overallRag ?? 'green';
                return (
                  <article key={project.id} className="kh-ops-project-card">
                    <Badge tone={ragTone(overallRag)}>
                      {tProjects(`rag.${overallRag}`)}
                    </Badge>
                    <h3>
                      <Link
                        href={`/workspaces/${workspaceSlug}/projects/${project.slug}`}
                      >
                        {project.name}
                      </Link>
                    </h3>
                    <p>{project.summary || t('noDescription')}</p>
                    <div className="kh-ops-project-card-foot">
                      <span>{project.status}</span>
                      <span>{formatUpdated(project.updatedAt, locale)}</span>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </CollapsibleSection>
      <CollapsibleSection
        storageKey={`workspace:${workspaceSlug}:systems`}
        title={t('systems')}
        defaultOpen
      >
        <section className="kh-ops-panel">
          <div className="kh-ops-toolbar mb-0 border-0 border-b border-line">
            <Input
              type="search"
              value={systemQuery}
              onChange={(event) => setSystemQuery(event.target.value)}
              placeholder={t('sectionSearchSystems')}
              className="h-10 min-h-10 min-w-[220px] flex-1 py-1.5 text-xs"
            />
            {canMutate ? (
              <LinkButton href={`/workspaces/${workspaceSlug}/systems/new`}>
                {t('newSystem')}
              </LinkButton>
            ) : null}
          </div>
          {filteredSystems.length === 0 ? (
            <p className="kh-ops-empty">
              {systemQuery.trim() ? t('sectionEmptyFiltered') : t('noSystems')}
            </p>
          ) : (
            <div className="kh-ops-table-wrap">
              <table className="kh-ops-data-table">
                <thead>
                  <tr>
                    <th>{t('colName')}</th>
                    <th>{t('colStatus')}</th>
                    <th>{t('colLink')}</th>
                    <th>{t('colUpdated')}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSystems.map((system) => (
                    <tr key={system.id}>
                      <td className="kh-ops-primary-cell">
                        <Link
                          href={`/workspaces/${workspaceSlug}/systems/${system.slug}`}
                          className="no-underline"
                        >
                          {system.name}
                        </Link>
                      </td>
                      <td>
                        <span className="kh-ops-type-chip">{system.status}</span>
                      </td>
                      <td>
                        {system.projectId ? t('linkedToProject') : t('independent')}
                      </td>
                      <td>{formatUpdated(system.updatedAt, locale)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </CollapsibleSection>
      <CollapsibleSection
        storageKey={`workspace:${workspaceSlug}:records`}
        title={t('knowledgeRecords')}
        defaultOpen
      >
        <section className="kh-ops-panel">
          <div className="kh-ops-toolbar mb-0 border-0 border-b border-line">
            <Input
              type="search"
              value={recordQuery}
              onChange={(event) => setRecordQuery(event.target.value)}
              placeholder={t('sectionSearchRecords')}
              className="h-10 min-h-10 min-w-[220px] flex-1 py-1.5 text-xs"
            />
            {canMutate ? (
              <LinkButton href={`/workspaces/${workspaceSlug}/records/new`}>
                {t('newRecord')}
              </LinkButton>
            ) : null}
          </div>
          {filteredRecords.length === 0 ? (
            <p className="kh-ops-empty">
              {recordQuery.trim() ? t('sectionEmptyFiltered') : t('noRecords')}
            </p>
          ) : (
            <div className="kh-ops-table-wrap">
              <table className="kh-ops-data-table">
                <thead>
                  <tr>
                    <th>{t('colKey')}</th>
                    <th>{t('colTitle')}</th>
                    <th>{t('colType')}</th>
                    <th>{t('colLanguage')}</th>
                    <th>{t('colLifecycle')}</th>
                    <th>{t('colUpdated')}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRecords.map(({ family, preferred }) => {
                    const languages = [
                      ...new Set(
                        family.map((record) =>
                          normalizeContentLanguage(record.language),
                        ),
                      ),
                    ].sort((a, b) => a.localeCompare(b));
                    return (
                      <tr key={preferred.translationGroupId ?? preferred.id}>
                        <td>
                          <span className="kh-ops-type-chip">
                            {preferred.humanKey ?? preferred.recordType}
                          </span>
                        </td>
                        <td className="kh-ops-primary-cell">
                          <Link
                            href={`/workspaces/${workspaceSlug}/records/${preferred.slug}`}
                            className="no-underline"
                          >
                            {preferred.title}
                          </Link>
                        </td>
                        <td>{preferred.recordType}</td>
                        <td>{languages.join(', ')}</td>
                        <td>
                          {lifecycleLabel(preferred.lifecycleStatus, tRecords)}
                        </td>
                        <td>{formatUpdated(preferred.updatedAt, locale)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </CollapsibleSection>
      <CollapsibleSection
        storageKey={`workspace:${workspaceSlug}:imports`}
        title={t('imports')}
        defaultOpen
        action={
          canMutate ? (
            <ImportTypePickerButton
              workspaceSlug={workspaceSlug}
              label={t('newImport')}
            />
          ) : (
            <LinkButton
              href={`/workspaces/${workspaceSlug}/imports`}
              variant="secondary"
            >
              {t('imports')}
            </LinkButton>
          )
        }
      >
        <p className="m-0 text-sm text-ink-muted">
          <Link
            href={`/workspaces/${workspaceSlug}/imports`}
            className="kh-text-link"
          >
            {t('viewImports')}
          </Link>
        </p>
      </CollapsibleSection>
    </>
  );
}
