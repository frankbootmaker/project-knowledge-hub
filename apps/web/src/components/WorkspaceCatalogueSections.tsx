'use client';

import { useTranslations } from 'next-intl';
import { LinkButton, SectionHeader, lifecycleLabel } from './ui';
import { ImportTypePickerButton } from './ImportTypePickerButton';
import {
  CatalogueSection,
  type CatalogueListItem,
} from './CatalogueSection';

export type { CatalogueListItem } from './CatalogueSection';

export type WorkspaceCatalogueProject = {
  id: string;
  name: string;
  slug: string;
  status: string;
  summary: string | null;
  tags: Array<{ name: string }>;
  updatedAt: string;
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
  lifecycleStatus: string;
  language?: string | null;
  summary: string | null;
  systemId: string | null;
  updatedAt: string;
};

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
  const tCommon = useTranslations('common');
  const tRecords = useTranslations('records');

  const projectItems: CatalogueListItem[] = projects.map((project) => ({
    id: project.id,
    title: project.name,
    href: `/workspaces/${workspaceSlug}/projects/${project.slug}`,
    primaryBadge: project.status,
    subtitle: project.summary,
    updatedAt: project.updatedAt,
    tagsLine:
      project.tags.length > 0
        ? tCommon('tagsList', {
            tags: project.tags.map((tag) => tag.name).join(', '),
          })
        : null,
    searchText: [project.name, project.slug, project.summary ?? '', project.status]
      .join(' ')
      .toLowerCase(),
    filterValue: project.status,
  }));

  const systemItems: CatalogueListItem[] = systems.map((system) => ({
    id: system.id,
    title: system.name,
    href: `/workspaces/${workspaceSlug}/systems/${system.slug}`,
    secondaryBadge: system.status,
    subtitle: `${system.projectId ? t('linkedToProject') : t('independent')}${
      system.summary ? ` — ${system.summary}` : ''
    }`,
    updatedAt: system.updatedAt,
    tagsLine:
      system.tags.length > 0
        ? tCommon('tagsList', {
            tags: system.tags.map((tag) => tag.name).join(', '),
          })
        : null,
    searchText: [system.name, system.slug, system.summary ?? '', system.status]
      .join(' ')
      .toLowerCase(),
    filterValue: system.status,
  }));

  const recordItems: CatalogueListItem[] = records.map((record) => {
    const statusLabel = lifecycleLabel(record.lifecycleStatus, tRecords);
    const language = record.language ?? 'en';
    return {
      id: record.id,
      title: record.title,
      href: `/workspaces/${workspaceSlug}/records/${record.slug}`,
      primaryBadge: record.recordType,
      secondaryBadge: statusLabel,
      subtitle: record.systemId
        ? `${t('linkedToSystem')}${record.summary ? ` — ${record.summary}` : ''}`
        : record.summary,
      updatedAt: record.updatedAt,
      language,
      searchText: [
        record.title,
        record.slug,
        record.recordType,
        record.lifecycleStatus,
        statusLabel,
        language,
        record.summary ?? '',
      ]
        .join(' ')
        .toLowerCase(),
      filterValue: record.lifecycleStatus,
      filterLabel: statusLabel,
    };
  });

  return (
    <>
      <CatalogueSection
        title={t('projects')}
        items={projectItems}
        emptyLabel={t('noProjects')}
        searchPlaceholder={t('sectionSearchProjects')}
        filterLabel={t('sectionFilterStatus')}
        filterAllLabel={t('sectionFilterAll')}
        createHref={`/workspaces/${workspaceSlug}/projects/new`}
        createLabel={t('newProject')}
        canCreate={canMutate}
      />
      <CatalogueSection
        title={t('systems')}
        items={systemItems}
        emptyLabel={t('noSystems')}
        searchPlaceholder={t('sectionSearchSystems')}
        filterLabel={t('sectionFilterStatus')}
        filterAllLabel={t('sectionFilterAll')}
        createHref={`/workspaces/${workspaceSlug}/systems/new`}
        createLabel={t('newSystem')}
        canCreate={canMutate}
      />
      <CatalogueSection
        title={t('knowledgeRecords')}
        items={recordItems}
        emptyLabel={t('noRecords')}
        searchPlaceholder={t('sectionSearchRecords')}
        filterLabel={t('sectionFilterLifecycle')}
        filterAllLabel={t('sectionFilterAll')}
        languageFilterLabel={t('sectionFilterLanguage')}
        languageFilterAllLabel={t('sectionFilterAnyLanguage')}
        createHref={`/workspaces/${workspaceSlug}/records/new`}
        createLabel={t('newRecord')}
        canCreate={canMutate}
      />
      <section>
        <SectionHeader
          title={t('imports')}
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
        />
      </section>
    </>
  );
}
