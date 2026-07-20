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
  ListCard,
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

      <ul className="m-0 grid list-none gap-3 p-0">
        {filtered.map((workspace) => {
          const archived = Boolean(workspace.archivedAt);
          return (
            <ListCard
              key={workspace.id}
              className={workspaceTileClassName(workspace.color, workspace.id)}
            >
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={`/workspaces/${workspace.slug}`}
                  className="text-lg font-semibold no-underline"
                >
                  {workspace.name}
                </Link>
                {archived ? <Badge tone="neutral">{t('statusArchived')}</Badge> : null}
              </div>
              <div className="mt-1 text-sm text-ink-muted">{workspace.slug}</div>
              {workspace.description ? (
                <p className="mt-2 mb-0 text-ink-muted">{workspace.description}</p>
              ) : null}
            </ListCard>
          );
        })}
        {filtered.length === 0 ? (
          <li className="kh-muted list-none">
            {workspaces.length === 0 ? t('empty') : t('emptyFiltered')}
          </li>
        ) : null}
      </ul>
    </div>
  );
}
