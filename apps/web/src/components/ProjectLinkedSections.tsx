'use client';

import { useLocale, useTranslations } from 'next-intl';
import {
  CatalogueSection,
  type CatalogueListItem,
  type CatalogueLocaleVariant,
} from './CatalogueSection';
import { lifecycleLabel } from './ui';
import {
  groupRecordsByTranslationFamily,
  normalizeContentLanguage,
  pickPreferredRecord,
} from '../lib/translation-families';

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
  language?: string | null;
  translationGroupId?: string | null;
  summary?: string | null;
  updatedAt: string;
};

function recordVariant(
  record: ProjectLinkedRecord,
  workspaceSlug: string,
  statusLabel: string,
): CatalogueLocaleVariant {
  const language = normalizeContentLanguage(record.language);
  return {
    id: record.id,
    title: record.title,
    href: `/workspaces/${workspaceSlug}/records/${record.slug}`,
    language,
    secondaryBadge: statusLabel,
    subtitle: record.summary,
    updatedAt: record.updatedAt,
    filterValue: record.lifecycleStatus,
    filterLabel: statusLabel,
  };
}

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
  const tRecords = useTranslations('records');
  const locale = useLocale();

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

  const recordItems: CatalogueListItem[] = groupRecordsByTranslationFamily(records).map(
    (family) => {
      const preferred = pickPreferredRecord(family, locale);
      const statusLabel = lifecycleLabel(preferred.lifecycleStatus, tRecords);
      const variants = family.map((record) =>
        recordVariant(
          record,
          workspaceSlug,
          lifecycleLabel(record.lifecycleStatus, tRecords),
        ),
      );
      const languages = [...new Set(variants.map((variant) => variant.language))].sort(
        (a, b) => a.localeCompare(b),
      );
      const preferredVariant = recordVariant(preferred, workspaceSlug, statusLabel);

      return {
        id: preferred.translationGroupId ?? preferred.id,
        title: preferredVariant.title,
        href: preferredVariant.href,
        primaryBadge: preferred.recordType,
        secondaryBadge: preferredVariant.secondaryBadge,
        subtitle: preferredVariant.subtitle,
        updatedAt: preferredVariant.updatedAt,
        language: preferredVariant.language,
        languages,
        localeVariants: variants,
        searchText: family
          .flatMap((record) => [
            record.title,
            record.slug,
            record.recordType,
            record.lifecycleStatus,
            normalizeContentLanguage(record.language),
            record.summary ?? '',
          ])
          .join(' ')
          .toLowerCase(),
        filterValue: preferredVariant.filterValue,
        filterLabel: preferredVariant.filterLabel,
      };
    },
  );

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
        languageFilterLabel={tWorkspaces('sectionFilterLanguage')}
        languageFilterAllLabel={tWorkspaces('sectionFilterAnyLanguage')}
        createHref={`/workspaces/${workspaceSlug}/records/new`}
        createLabel={tWorkspaces('newRecord')}
        canCreate={canMutate}
      />
    </>
  );
}
