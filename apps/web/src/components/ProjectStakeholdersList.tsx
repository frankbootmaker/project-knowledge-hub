'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { AssistantBrandMark } from './AssistantBrandMark';
import { UserAvatar } from './UserAvatar';
import { DataTable, type DataColumn } from './ui/DataTable';
import { Badge, Button, Input, Select } from './ui';
import { applyTableView, compareText } from '../lib/data-table';
import { useSyncEnumFilters, useTableState } from '../lib/use-table-state';
import { formatMoney } from '../lib/project-currency';
import type { Stakeholder } from './ProjectStakeholdersPanel';

function rateNumber(value: string | null | undefined): number {
  if (value == null || value === '') return -1;
  const n = Number(value);
  return Number.isFinite(n) ? n : -1;
}

const STATUS_RANK: Record<string, number> = {
  open: 0,
  assigned: 1,
  ai: 2,
  derived: 3,
};

function roleKey(row: Stakeholder): string {
  if (row.kind === 'ai_assistant') return 'kind:ai_assistant';
  if (row.kind === 'open_role') return 'kind:open_role';
  if (row.projectRole) return `role:${row.projectRole}`;
  return 'derived';
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
  const tTable = useTranslations('table');
  const locale = useLocale();
  const onManageRef = useRef(onManage);
  const onManageAiRef = useRef(onManageAi);
  const onAddDerivedRef = useRef(onAddDerived);
  onManageRef.current = onManage;
  onManageAiRef.current = onManageAi;
  onAddDerivedRef.current = onAddDerived;
  const table = useTableState({
    namespace: 'stk',
    defaultSortKey: 'person',
    defaultSortDir: 'asc',
  });
  const selectedRoles = table.filters.role ?? [];

  useEffect(() => {
    const legacy = table.extras.role;
    if (!legacy) return;
    if (selectedRoles.length === 0) table.setEnumFilter('role', [legacy]);
    table.setExtra('role', '');
  }, [
    selectedRoles.length,
    table.extras.role,
    table.setEnumFilter,
    table.setExtra,
  ]);

  const roleLabel = useCallback((row: Stakeholder): string => {
    if (row.kind === 'ai_assistant') return t('kindAiAssistant');
    if (row.kind === 'open_role') return t('kindOpenRole');
    if (row.projectRole) return t(`projectRole.${row.projectRole}`);
    return t('derivedOnly');
  }, [t]);

  const statusLabel = useCallback((row: Stakeholder): string => {
    if (row.kind === 'open_role') return t('staffingStatus.open');
    if (row.kind === 'ai_assistant') return t('kindAiAssistant');
    if (row.staffingStatus === 'assigned') return t('staffingStatus.assigned');
    if (row.staffingStatus === 'open') return t('staffingStatus.open');
    return t('derivedOnly');
  }, [t]);

  function statusKey(row: Stakeholder): string {
    if (row.kind === 'open_role') return 'open';
    if (row.kind === 'ai_assistant') return 'ai';
    if (row.staffingStatus === 'assigned') return 'assigned';
    if (row.staffingStatus === 'open') return 'open';
    return 'derived';
  }

  const engagementLabel = useCallback((row: Stakeholder): string => {
    if (row.kind === 'ai_assistant' && row.aiCostMode) {
      return t(`aiCostMode.${row.aiCostMode}`);
    }
    const parts: string[] = [];
    if (row.engagementType) {
      parts.push(t(`engagement.${row.engagementType}`));
    }
    if (row.allocatedDailyHours) {
      parts.push(t('hoursPerDay', { hours: row.allocatedDailyHours }));
    }
    return parts.join(' · ') || '—';
  }, [t]);

  const labels = useMemo(() => {
    const role = new Map<string, string>();
    const engagement = new Map<string, string>();
    const roleOptions: Array<{ value: string; label: string }> = [];
    const seen = new Set<string>();
    for (const row of stakeholders) {
      const roleText = roleLabel(row);
      role.set(row.id, roleText);
      engagement.set(row.id, engagementLabel(row));
      const value = roleKey(row);
      if (!seen.has(value)) {
        seen.add(value);
        roleOptions.push({ value, label: roleText });
      }
    }
    return { role, engagement, roleOptions };
  }, [engagementLabel, roleLabel, stakeholders]);

  const statusOptions = useMemo(
    () => [
      { value: 'open', label: t('staffingStatus.open') },
      { value: 'assigned', label: t('staffingStatus.assigned') },
      { value: 'ai', label: t('kindAiAssistant') },
      { value: 'derived', label: t('derivedOnly') },
    ],
    [t],
  );

  const columns = useMemo<Array<DataColumn<Stakeholder>>>(() => {
    const next: Array<DataColumn<Stakeholder>> = [
    {
      id: 'person',
      header: t('colPerson'),
      kind: 'text',
      sort: { type: 'text', getValue: (row) => row.displayName },
      cell: (row) => {
        const isAi = row.kind === 'ai_assistant';
        return (
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
              <span className="kh-ops-primary-cell">{row.displayName}</span>
              {row.email ? <small>{row.email}</small> : null}
            </span>
          </span>
        );
      },
    },
    {
      id: 'role',
      header: t('colRole'),
      kind: 'text',
      sort: {
        type: 'text',
        getValue: (row) => labels.role.get(row.id) ?? '',
      },
      filter: {
        type: 'enum',
        getValue: (row) => roleKey(row),
        options: labels.roleOptions,
      },
      cell: (row) => {
        const isAi = row.kind === 'ai_assistant';
        const isOpenRole = row.kind === 'open_role';
        return (
          <div className="flex flex-wrap items-center gap-1">
            <Badge tone={isOpenRole || isAi ? 'brand' : 'neutral'}>
              {roleLabel(row)}
            </Badge>
            {isOpenRole && row.projectRole ? (
              <Badge>{t(`projectRole.${row.projectRole}`)}</Badge>
            ) : null}
          </div>
        );
      },
    },
    {
      id: 'engagement',
      header: t('colEngagement'),
      kind: 'text',
      sort: {
        type: 'text',
        getValue: (row) => labels.engagement.get(row.id) ?? '',
      },
      cell: (row) => engagementLabel(row),
    },
    {
      id: 'rate',
      header: t('colRate'),
      kind: 'number',
      sort: { type: 'number', getValue: (row) => rateNumber(row.hourlyRate) },
      cell: (row) => {
        const rate = rateNumber(row.hourlyRate);
        if (rate < 0) return '—';
        return t('hourlyRateValue', {
          amount: formatMoney(rate, currency, locale),
        });
      },
    },
    {
      id: 'status',
      header: t('colStatus'),
      kind: 'status',
      sort: {
        type: 'number',
        getValue: (row) => STATUS_RANK[statusKey(row)] ?? 99,
      },
      filter: {
        type: 'enum',
        getValue: statusKey,
        options: statusOptions,
      },
      cell: (row) => {
        const isOpenRole = row.kind === 'open_role';
        return (
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
        );
      },
    },
    {
      id: 'competencies',
      header: t('colCompetencies'),
      kind: 'text',
      cell: (row) => {
        const competencies = (row.competencies ?? [])
          .map((item) => item.name)
          .join(', ');
        return (
          <span className="kh-ops-competency-list" title={competencies}>
            {competencies || '—'}
          </span>
        );
      },
    },
  ];
  if (canMutate) {
    next.push({
      id: 'manage',
      header: '',
      kind: 'actions',
      cell: (row) => {
        const isAi = row.kind === 'ai_assistant';
        const isOpenRole = row.kind === 'open_role';
        if (isAi) {
          if (!row.systemId) return null;
          return (
            <Button
              type="button"
              variant="secondary"
              className="h-8 min-h-8 px-2 text-xs"
              disabled={pending}
              onClick={() => onManageAiRef.current(row)}
            >
              {t('manageAiCost')}
            </Button>
          );
        }
        if (row.rosterId) {
          return (
            <Button
              type="button"
              variant="secondary"
              className="h-8 min-h-8 px-2 text-xs"
              disabled={pending}
              onClick={() => onManageRef.current(row)}
            >
              {isOpenRole ? t('manageOpenRole') : t('manage')}
            </Button>
          );
        }
        return (
          <Button
            type="button"
            variant="secondary"
            className="h-8 min-h-8 px-2 text-xs"
            disabled={pending}
            onClick={() => onAddDerivedRef.current(row)}
          >
            {t('addToRoster')}
          </Button>
        );
      },
    });
  }
  return next;
  }, [
    canMutate,
    currency,
    engagementLabel,
    labels,
    locale,
    pending,
    roleLabel,
    statusLabel,
    statusOptions,
    t,
  ]);
  useSyncEnumFilters(table.filters, columns, table.setEnumFilter);

  const visible = useMemo(() => applyTableView({
    rows: stakeholders,
    locale,
    query: table.query,
    search: (row, needle) =>
      [
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
        row.reportsToUserId ? (nameById.get(row.reportsToUserId) ?? '') : '',
      ]
        .join(' ')
        .toLowerCase()
        .includes(needle),
    sortKey: table.sortKey,
    sortDir: table.sortDir,
    filters: table.filters,
    textFilters: table.textFilters,
    columns,
    tieBreak: (a, b) => compareText(a.displayName, b.displayName, locale),
  }), [
    columns,
    engagementLabel,
    locale,
    nameById,
    roleLabel,
    stakeholders,
    statusLabel,
    table.filters,
    table.query,
    table.sortDir,
    table.sortKey,
    table.textFilters,
  ]);
  const bareEmpty = visible.length === 0 && !table.filtersActive;

  return (
    <section className="kh-ops-panel">
      <div className="kh-ops-toolbar mb-0 border-0 border-b border-line">
        <label className="flex min-w-[220px] flex-1 items-center gap-2">
          <span className="sr-only">{t('searchPlaceholder')}</span>
          <Input
            type="search"
            value={table.query}
            onChange={(event) => table.setQuery(event.target.value)}
            placeholder={t('searchPlaceholder')}
            className="h-10 min-h-10 py-1.5 text-xs"
          />
        </label>
        <Select
          className="h-10 min-h-10 w-auto py-1.5 text-xs"
          value={selectedRoles.length === 1 ? selectedRoles[0] : ''}
          onChange={(event) =>
            table.setEnumFilter(
              'role',
              event.target.value ? [event.target.value] : [],
            )
          }
          aria-label={t('filterRole')}
        >
          <option value="">{tWorkspaces('sectionFilterAll')}</option>
          {labels.roleOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
        {canMutate ? (
          <Button type="button" onClick={onCreate}>
            {t('addItem')}
          </Button>
        ) : null}
      </div>
      {bareEmpty ? (
        <div className="kh-ops-empty-state">
          <div className="kh-ops-empty-mark">00</div>
          <h3>{t('emptyTitle')}</h3>
          <p>
            {table.query.trim() || selectedRoles.length > 0
              ? t('emptyFiltered')
              : t('empty')}
          </p>
        </div>
      ) : (
        <DataTable
          rows={visible}
          rowKey={(row) => row.id}
          columns={columns}
          sortKey={table.sortKey}
          sortDir={table.sortDir}
          onToggleSort={table.toggleSort}
          enumFilters={table.filters}
          textFilters={table.textFilters}
          onEnumFilter={table.setEnumFilter}
          onTextFilter={table.setTextFilter}
          onClearFilters={table.clearFilters}
          filtersActive={table.filtersActive}
          tableClassName="kh-ops-delivery-list"
          empty={
            <>
              <h3>{t('emptyTitle')}</h3>
              <p>{tTable('emptyFiltered')}</p>
            </>
          }
        />
      )}
    </section>
  );
}
