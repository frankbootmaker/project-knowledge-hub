'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { workspaceTileClassName } from '../lib/workspace-colors';
import {
  Badge,
  FunctionHeader,
  Input,
  LinkButton,
  Select,
} from './ui';

export type WorkspaceListItem = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  color: string | null;
  archivedAt: string | null;
};

type StatusFilter = 'all' | 'active' | 'archived';

function matchesWorkspaceSearch(workspace: WorkspaceListItem, query: string): boolean {
  if (!query) return true;
  const haystack = [workspace.name, workspace.slug, workspace.description ?? '']
    .join(' ')
    .toLowerCase();
  return haystack.includes(query);
}

export function WorkspacesList({
  workspaces,
  canCreate,
}: {
  workspaces: WorkspaceListItem[];
  canCreate: boolean;
}) {
  const t = useTranslations('workspaces');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active');

  const filtered = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return workspaces.filter((workspace) => {
      const archived = Boolean(workspace.archivedAt);
      if (statusFilter === 'active' && archived) return false;
      if (statusFilter === 'archived' && !archived) return false;
      return matchesWorkspaceSearch(workspace, query);
    });
  }, [workspaces, searchQuery, statusFilter]);

  return (
    <div className="grid gap-6">
      <FunctionHeader
        search={
          <Input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('searchPlaceholder')}
            aria-label={t('searchPlaceholder')}
          />
        }
        filters={
          <Select
            value={statusFilter}
            onChange={(e) =>
              setStatusFilter(e.target.value as StatusFilter)
            }
            aria-label={t('filterStatus')}
          >
            <option value="all">{t('filterAll')}</option>
            <option value="active">{t('statusHealthy')}</option>
            <option value="archived">{t('statusArchived')}</option>
          </Select>
        }
        actions={
          canCreate ? (
            <LinkButton href="/workspaces/new">{t('new')}</LinkButton>
          ) : null
        }
      />

      {filtered.length === 0 ? (
        <p className="kh-ops-empty">
          {workspaces.length === 0 ? t('empty') : t('emptyFiltered')}
        </p>
      ) : (
        <div className="kh-ops-project-grid px-0">
          {filtered.map((workspace) => {
            const archived = Boolean(workspace.archivedAt);
            return (
              <article
                key={workspace.id}
                className={`kh-ops-project-card ${workspaceTileClassName(
                  workspace.color,
                  workspace.id,
                )}`}
              >
                {archived ? (
                  <Badge tone="neutral">{t('statusArchived')}</Badge>
                ) : (
                  <Badge tone="success">{t('statusHealthy')}</Badge>
                )}
                <h3>
                  <Link href={`/workspaces/${workspace.slug}`}>
                    {workspace.name}
                  </Link>
                </h3>
                <p>{workspace.description || t('noDescription')}</p>
                <div className="kh-ops-project-card-foot">
                  <span>{workspace.slug}</span>
                  <Link
                    href={`/workspaces/${workspace.slug}`}
                    className="kh-ops-text-btn no-underline"
                  >
                    {t('openWorkspace')}
                  </Link>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
