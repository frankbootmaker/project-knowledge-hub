'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Input, LinkButton, lifecycleLabel } from './ui';
import { CollapsibleSection } from './CollapsibleSection';
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
  humanKey?: string | null;
  lifecycleStatus: string;
  language?: string | null;
  translationGroupId?: string | null;
  summary?: string | null;
  updatedAt: string;
};

function formatUpdated(value: string | null | undefined, locale: string): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function ProjectLinkedSections({
  workspaceSlug,
  projectId,
  systems,
  records,
  canMutate,
}: {
  workspaceSlug: string;
  projectId: string;
  systems: ProjectLinkedSystem[];
  records: ProjectLinkedRecord[];
  canMutate: boolean;
}) {
  const t = useTranslations('projects');
  const tWorkspaces = useTranslations('workspaces');
  const tRecords = useTranslations('records');
  const locale = useLocale();
  const [systemQuery, setSystemQuery] = useState('');
  const [recordQuery, setRecordQuery] = useState('');

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
        id="project-systems"
        storageKey={`project:${projectId}:systems`}
        title={t('linkedSystems')}
        defaultOpen
      >
        <section className="kh-ops-panel">
          <div className="kh-ops-toolbar mb-0 border-0 border-b border-line">
            <Input
              type="search"
              value={systemQuery}
              onChange={(event) => setSystemQuery(event.target.value)}
              placeholder={tWorkspaces('sectionSearchSystems')}
              className="h-10 min-h-10 min-w-[220px] flex-1 py-1.5 text-xs"
            />
            {canMutate ? (
              <LinkButton href={`/workspaces/${workspaceSlug}/systems/new`}>
                {tWorkspaces('newSystem')}
              </LinkButton>
            ) : null}
          </div>
          {filteredSystems.length === 0 ? (
            <p className="kh-ops-empty">
              {systemQuery.trim()
                ? tWorkspaces('sectionEmptyFiltered')
                : t('noLinkedSystems')}
            </p>
          ) : (
            <div className="kh-ops-table-wrap">
              <table className="kh-ops-data-table">
                <thead>
                  <tr>
                    <th>{tWorkspaces('colName')}</th>
                    <th>{tWorkspaces('colStatus')}</th>
                    <th>{tWorkspaces('colUpdated')}</th>
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
        id="project-knowledge"
        storageKey={`project:${projectId}:records`}
        title={t('linkedKnowledge')}
        defaultOpen
      >
        <section className="kh-ops-panel">
          <div className="kh-ops-toolbar mb-0 border-0 border-b border-line">
            <Input
              type="search"
              value={recordQuery}
              onChange={(event) => setRecordQuery(event.target.value)}
              placeholder={tWorkspaces('sectionSearchRecords')}
              className="h-10 min-h-10 min-w-[220px] flex-1 py-1.5 text-xs"
            />
            {canMutate ? (
              <LinkButton href={`/workspaces/${workspaceSlug}/records/new`}>
                {tWorkspaces('newRecord')}
              </LinkButton>
            ) : null}
          </div>
          {filteredRecords.length === 0 ? (
            <p className="kh-ops-empty">
              {recordQuery.trim()
                ? tWorkspaces('sectionEmptyFiltered')
                : t('noLinkedKnowledge')}
            </p>
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
    </>
  );
}
