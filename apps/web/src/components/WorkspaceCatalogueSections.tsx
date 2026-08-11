'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { LinkButton, lifecycleLabel } from './ui';
import { ImportTypePickerButton } from './ImportTypePickerButton';
import {
  CatalogueSection,
  type CatalogueListItem,
  type CatalogueLocaleVariant,
} from './CatalogueSection';
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

function recordVariant(
  record: WorkspaceCatalogueRecord,
  workspaceSlug: string,
  linkedToSystem: string,
  statusLabel: string,
): CatalogueLocaleVariant {
  const language = normalizeContentLanguage(record.language);
  return {
    id: record.id,
    title: record.title,
    href: `/workspaces/${workspaceSlug}/records/${record.slug}`,
    language,
    secondaryBadge: statusLabel,
    subtitle: record.systemId
      ? `${linkedToSystem}${record.summary ? ` — ${record.summary}` : ''}`
      : record.summary,
    updatedAt: record.updatedAt,
    filterValue: record.lifecycleStatus,
    filterLabel: statusLabel,
  };
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
  const tCommon = useTranslations('common');
  const tProjects = useTranslations('projects');
  const tRecords = useTranslations('records');
  const locale = useLocale();

  const projectItems: CatalogueListItem[] = projects.map((project) => {
    const overallRag = project.overallRag ?? 'green';
    const ragTone =
      overallRag === 'red'
        ? ('danger' as const)
        : overallRag === 'amber'
          ? ('warn' as const)
          : ('success' as const);
    return {
      id: project.id,
      title: project.name,
      href: `/workspaces/${workspaceSlug}/projects/${project.slug}`,
      statusBadges: [
        {
          label: `${tProjects('ragOverall')}: ${tProjects(`rag.${overallRag}`)}`,
          tone: ragTone,
          title: tProjects('ragLabel'),
        },
      ],
      primaryBadge: project.status,
      subtitle: project.summary,
      updatedAt: project.updatedAt,
      tagsLine:
        project.tags.length > 0
          ? tCommon('tagsList', {
              tags: project.tags.map((tag) => tag.name).join(', '),
            })
          : null,
      searchText: [
        project.name,
        project.slug,
        project.summary ?? '',
        project.status,
        overallRag,
      ]
        .join(' ')
        .toLowerCase(),
      filterValue: project.status,
    };
  });

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

  const recordItems: CatalogueListItem[] = groupRecordsByTranslationFamily(records).map(
    (family) => {
      const preferred = pickPreferredRecord(family, locale);
      const statusLabel = lifecycleLabel(preferred.lifecycleStatus, tRecords);
      const variants = family.map((record) =>
        recordVariant(
          record,
          workspaceSlug,
          t('linkedToSystem'),
          lifecycleLabel(record.lifecycleStatus, tRecords),
        ),
      );
      const languages = [...new Set(variants.map((variant) => variant.language))].sort(
        (a, b) => a.localeCompare(b),
      );
      const preferredVariant = recordVariant(
        preferred,
        workspaceSlug,
        t('linkedToSystem'),
        statusLabel,
      );

      return {
        id: preferred.translationGroupId ?? preferred.id,
        title: preferredVariant.title,
        href: preferredVariant.href,
        primaryBadge: preferred.humanKey ?? preferred.recordType,
        secondaryBadge: preferred.humanKey
          ? preferred.recordType
          : preferredVariant.secondaryBadge,
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
            record.humanKey ?? '',
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
      <CollapsibleSection
        storageKey={`workspace:${workspaceSlug}:projects`}
        title={t('projects')}
        defaultOpen
      >
        <CatalogueSection
          title={t('projects')}
          showTitle={false}
          className="mb-0"
          items={projectItems}
          emptyLabel={t('noProjects')}
          searchPlaceholder={t('sectionSearchProjects')}
          filterLabel={t('sectionFilterStatus')}
          filterAllLabel={t('sectionFilterAll')}
          createHref={`/workspaces/${workspaceSlug}/projects/new`}
          createLabel={t('newProject')}
          canCreate={canMutate}
        />
      </CollapsibleSection>
      <CollapsibleSection
        storageKey={`workspace:${workspaceSlug}:systems`}
        title={t('systems')}
        defaultOpen
      >
        <CatalogueSection
          title={t('systems')}
          showTitle={false}
          className="mb-0"
          items={systemItems}
          emptyLabel={t('noSystems')}
          searchPlaceholder={t('sectionSearchSystems')}
          filterLabel={t('sectionFilterStatus')}
          filterAllLabel={t('sectionFilterAll')}
          createHref={`/workspaces/${workspaceSlug}/systems/new`}
          createLabel={t('newSystem')}
          canCreate={canMutate}
        />
      </CollapsibleSection>
      <CollapsibleSection
        storageKey={`workspace:${workspaceSlug}:records`}
        title={t('knowledgeRecords')}
        defaultOpen
      >
        <CatalogueSection
          title={t('knowledgeRecords')}
          showTitle={false}
          className="mb-0"
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
