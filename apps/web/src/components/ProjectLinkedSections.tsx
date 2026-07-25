'use client';

import { useTranslations } from 'next-intl';
import {
  CatalogueSection,
  type CatalogueListItem,
} from './CatalogueSection';

export type ProjectLinkedSystem = {
  id: string;
  name: string;
  slug: string;
  status: string;
  summary?: string | null;
  tags?: Array<{ name: string }>;
  updatedAt?: string | null;
};

export type ProjectLinkedRecord = {
  id: string;
  title: string;
  slug: string;
  recordType: string;
  lifecycleStatus: string;
  summary?: string | null;
  updatedAt: string;
};

export function ProjectLinkedSections({
  workspaceSlug,
  systems,
  records,
  canMutate,
}: {
  workspaceSlug: string;
  systems: ProjectLinkedSystem[];
  records: ProjectLinkedRecord[];
  canMutate: boolean;
}) {
  const t = useTranslations('projects');
  const tWorkspaces = useTranslations('workspaces');
  const tCommon = useTranslations('common');

  const systemItems: CatalogueListItem[] = systems.map((system) => ({
    id: system.id,
    title: system.name,
    href: `/workspaces/${workspaceSlug}/systems/${system.slug}`,
    secondaryBadge: system.status,
    subtitle: system.summary,
    updatedAt: system.updatedAt,
    tagsLine:
      system.tags && system.tags.length > 0
        ? tCommon('tagsList', {
            tags: system.tags.map((tag) => tag.name).join(', '),
          })
        : null,
    searchText: [
      system.name,
      system.slug,
      system.summary ?? '',
      system.status,
    ]
      .join(' ')
      .toLowerCase(),
    filterValue: system.status,
  }));

  const recordItems: CatalogueListItem[] = records.map((record) => ({
    id: record.id,
    title: record.title,
    href: `/workspaces/${workspaceSlug}/records/${record.slug}`,
    primaryBadge: record.recordType,
    secondaryBadge: record.lifecycleStatus,
    subtitle: record.summary,
    updatedAt: record.updatedAt,
    searchText: [
      record.title,
      record.slug,
      record.recordType,
      record.lifecycleStatus,
      record.summary ?? '',
    ]
      .join(' ')
      .toLowerCase(),
    filterValue: record.lifecycleStatus,
  }));

  return (
    <>
      <CatalogueSection
        title={t('linkedSystems')}
        items={systemItems}
        emptyLabel={t('noLinkedSystems')}
        searchPlaceholder={tWorkspaces('sectionSearchSystems')}
        filterLabel={tWorkspaces('sectionFilterStatus')}
        filterAllLabel={tWorkspaces('sectionFilterAll')}
        createHref={`/workspaces/${workspaceSlug}/systems/new`}
        createLabel={tWorkspaces('newSystem')}
        canCreate={canMutate}
      />
      <CatalogueSection
        title={t('linkedKnowledge')}
        items={recordItems}
        emptyLabel={t('noLinkedKnowledge')}
        searchPlaceholder={tWorkspaces('sectionSearchRecords')}
        filterLabel={tWorkspaces('sectionFilterLifecycle')}
        filterAllLabel={tWorkspaces('sectionFilterAll')}
        createHref={`/workspaces/${workspaceSlug}/records/new`}
        createLabel={tWorkspaces('newRecord')}
        canCreate={canMutate}
      />
    </>
  );
}
