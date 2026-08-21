'use client';

import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { AssistantBrandMark } from './AssistantBrandMark';
import { UserAvatar } from './UserAvatar';
import { Badge, Button, Input, Select } from './ui';
import { formatMoney } from '../lib/project-currency';
import type { Stakeholder } from './ProjectStakeholdersPanel';

type SortKey = 'person' | 'role' | 'engagement' | 'rate' | 'status';

function compareText(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: 'base' });
}

function rateNumber(value: string | null | undefined): number {
  if (value == null || value === '') return -1;
  const n = Number(value);
  return Number.isFinite(n) ? n : -1;
}

export function ProjectStakeholdersList({
  stakeholders,
  canMutate,
  pending,
  nameById,
  currency,
  onManage,
  onManageAi,
  onAddDerived,
  onCreate,
}: {
  stakeholders: Stakeholder[];
  canMutate: boolean;
  pending: boolean;
  nameById: Map<string, string>;
  currency: string;
  onManage: (row: Stakeholder) => void;
  onManageAi: (row: Stakeholder) => void;
  onAddDerived: (row: Stakeholder) => void;
  onCreate: () => void;
}) {
  const t = useTranslations('stakeholders');
  const tWorkspaces = useTranslations('workspaces');
  const locale = useLocale();
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('person');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((current) => (current === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortKey(key);
    setSortDir('asc');
  }

  function roleLabel(row: Stakeholder): string {
    if (row.kind === 'ai_assistant') return t('kindAiAssistant');
    if (row.kind === 'open_role') return t('kindOpenRole');
    if (row.projectRole) return t(`projectRole.${row.projectRole}`);
    return t('derivedOnly');
  }

  function statusLabel(row: Stakeholder): string {
    if (row.kind === 'open_role') return t('staffingStatus.open');
    if (row.kind === 'ai_assistant') return t('kindAiAssistant');
    if (row.staffingStatus === 'assigned') return t('staffingStatus.assigned');
    if (row.staffingStatus === 'open') return t('staffingStatus.open');
    return t('derivedOnly');
  }

  function engagementLabel(row: Stakeholder): string {
    if (row.kind === 'ai_assistant' && row.aiCostMode) {
      return t(`aiCostMode.${row.aiCostMode}`);
    }
    const parts: string[] = [];
    if (row.engagementType) {
      parts.push(t(`engagement.${row.engagementType}`));
    }
    if (row.allocatedDailyHours) {
      parts.push(
        t('hoursPerDay', { hours: row.allocatedDailyHours }),
      );
    }
    return parts.join(' · ') || '—';
  }

  const roleOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const row of stakeholders) {
      const value =
        row.kind === 'ai_assistant'
          ? 'kind:ai_assistant'
          : row.kind === 'open_role'
            ? 'kind:open_role'
            : row.projectRole
              ? `role:${row.projectRole}`
              : 'derived';
      if (!seen.has(value)) seen.set(value, roleLabel(row));
    }
    return [...seen.entries()];
  }, [stakeholders, t]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matched = stakeholders.filter((row) => {
      const value =
        row.kind === 'ai_assistant'
          ? 'kind:ai_assistant'
          : row.kind === 'open_role'
            ? 'kind:open_role'
            : row.projectRole
              ? `role:${row.projectRole}`
              : 'derived';
      if (roleFilter && value !== roleFilter) return false;
      if (!needle) return true;
      const haystack = [
        row.displayName,
        row.fullName ?? '',
        row.email ?? '',
        row.jobTitle ?? '',
        row.notes ?? '',
        row.roleDescription ?? '',
        roleLabel(row),
        statusLabel(row),
        engagementLabel(row),
        (row.competencies ?? []).map((item) => item.name).join(' '),
        row.raciRoles.join(' '),
        row.reportsToUserId
          ? (nameById.get(row.reportsToUserId) ?? '')
          : '',
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(needle);
    });
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...matched].sort((a, b) => {
      let result = 0;
      switch (sortKey) {
        case 'role':
          result = compareText(roleLabel(a), roleLabel(b));
          break;
        case 'engagement':
          result = compareText(engagementLabel(a), engagementLabel(b));
          break;
        case 'rate':
          result = rateNumber(a.hourlyRate) - rateNumber(b.hourlyRate);
          break;
        case 'status':
          result = compareText(statusLabel(a), statusLabel(b));
          break;
        default:
          result = compareText(a.displayName, b.displayName);
      }
      if (result === 0) result = compareText(a.displayName, b.displayName);
      return result * dir;
    });
  }, [
    engagementLabel,
    nameById,
    query,
    roleFilter,
    roleLabel,
    sortDir,
    sortKey,
    stakeholders,
    statusLabel,
  ]);

  const columns: Array<{ key: SortKey; label: string; numeric?: boolean }> = [
    { key: 'person', label: t('colPerson') },
    { key: 'role', label: t('colRole') },
    { key: 'engagement', label: t('colEngagement') },
    { key: 'rate', label: t('colRate'), numeric: true },
    { key: 'status', label: t('colStatus') },
  ];

  return (
    <section className="kh-ops-panel">
      <div className="kh-ops-toolbar mb-0 border-0 border-b border-line">
        <label className="flex min-w-[220px] flex-1 items-center gap-2">
          <span className="sr-only">{t('searchPlaceholder')}</span>
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('searchPlaceholder')}
            className="h-10 min-h-10 py-1.5 text-xs"
          />
        </label>
        <Select
          className="h-10 min-h-10 w-auto py-1.5 text-xs"
          value={roleFilter}
          onChange={(event) => setRoleFilter(event.target.value)}
          aria-label={t('filterRole')}
        >
          <option value="">{tWorkspaces('sectionFilterAll')}</option>
          {roleOptions.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
        {canMutate ? (
          <Button type="button" onClick={onCreate}>
            {t('addItem')}
          </Button>
        ) : null}
      </div>
      {filtered.length === 0 ? (
        <div className="kh-ops-empty-state">
          <div className="kh-ops-empty-mark">00</div>
          <h3>{t('emptyTitle')}</h3>
          <p>{query.trim() || roleFilter ? t('emptyFiltered') : t('empty')}</p>
        </div>
      ) : (
        <div className="kh-ops-table-wrap">
          <table className="kh-ops-data-table kh-ops-delivery-list">
            <thead>
              <tr>
                {columns.map((column) => (
                  <th
                    key={column.key}
                    className={column.numeric ? 'kh-ops-num' : undefined}
                  >
                    <button
                      type="button"
                      data-sort-direction={
                        sortKey === column.key
                          ? (sortDir === 'asc' ? '↑' : '↓')
                          : undefined
                      }
                      aria-label={t('sortBy', { column: column.label })}
                      onClick={() => toggleSort(column.key)}
                    >
                      {column.label}
                    </button>
                  </th>
                ))}
                <th>{t('colCompetencies')}</th>
                {canMutate ? <th /> : null}
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => {
                const isAi = row.kind === 'ai_assistant';
                const isOpenRole = row.kind === 'open_role';
                const competencies = (row.competencies ?? [])
                  .map((item) => item.name)
                  .join(', ');
                const rate = rateNumber(row.hourlyRate);
                return (
                  <tr key={row.id}>
                    <td>
                      <span className="kh-ops-roster-person">
                        {isAi ? (
                          <AssistantBrandMark
                            brand={row.assistantBrand}
                            name={row.displayName}
                            slug={row.systemSlug}
                            size="sm"
                          />
                        ) : (
                          <UserAvatar
                            displayName={row.displayName}
                            fullName={row.fullName}
                            avatarUrl={row.avatarUrl}
                            size="sm"
                          />
                        )}
                        <span className="kh-ops-roster-person-copy">
                          <span className="kh-ops-primary-cell">
                            {row.displayName}
                          </span>
                          {row.email ? <small>{row.email}</small> : null}
                        </span>
                      </span>
                    </td>
                    <td>
                      <div className="flex flex-wrap items-center gap-1">
                        <Badge tone={isOpenRole || isAi ? 'brand' : 'neutral'}>
                          {roleLabel(row)}
                        </Badge>
                        {isOpenRole && row.projectRole ? (
                          <Badge>{t(`projectRole.${row.projectRole}`)}</Badge>
                        ) : null}
                      </div>
                    </td>
                    <td>{engagementLabel(row)}</td>
                    <td className="kh-ops-num">
                      {rate < 0
                        ? '—'
                        : t('hourlyRateValue', {
                            amount: formatMoney(rate, currency, locale),
                          })}
                    </td>
                    <td>
                      <Badge
                        tone={
                          isOpenRole
                            ? 'warn'
                            : row.staffingStatus === 'assigned'
                              ? 'success'
                              : 'neutral'
                        }
                      >
                        {statusLabel(row)}
                      </Badge>
                    </td>
                    <td>
                      <span className="kh-ops-competency-list" title={competencies}>
                        {competencies || '—'}
                      </span>
                    </td>
                    {canMutate ? (
                      <td>
                        {isAi ? (
                          row.systemId ? (
                            <Button
                              type="button"
                              variant="secondary"
                              className="h-8 min-h-8 px-2 text-xs"
                              disabled={pending}
                              onClick={() => onManageAi(row)}
                            >
                              {t('manageAiCost')}
                            </Button>
                          ) : null
                        ) : row.rosterId ? (
                          <Button
                            type="button"
                            variant="secondary"
                            className="h-8 min-h-8 px-2 text-xs"
                            disabled={pending}
                            onClick={() => onManage(row)}
                          >
                            {isOpenRole ? t('manageOpenRole') : t('manage')}
                          </Button>
                        ) : (
                          <Button
                            type="button"
                            variant="secondary"
                            className="h-8 min-h-8 px-2 text-xs"
                            disabled={pending}
                            onClick={() => onAddDerived(row)}
                          >
                            {t('addToRoster')}
                          </Button>
                        )}
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
