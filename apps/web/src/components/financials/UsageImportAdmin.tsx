'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { applyTableView, collectEnumOptions, compareText } from '../../lib/data-table';
import { formatMoney } from '../../lib/project-currency';
import { useSyncEnumFilters, useTableState } from '../../lib/use-table-state';
import { Button, ErrorText, Field, FilePicker, Input, useToast } from '../ui';
import { DataTable, dataTableFilterFields, type DataColumn } from '../ui/DataTable';
import { TableFilterControl } from '../ui/TableFilterControl';

export type UsageImportSummary = {
  dateFrom: string | null;
  dateTo: string | null;
  totals: {
    tokensInput: number;
    tokensCacheWrite: number;
    tokensCache: number;
    tokensOutput: number;
    tokensTotal: number;
  };
  models: Array<{ model: string; rowCount: number; tokensTotal: number }>;
  linkedCount: number;
  unassignedCount: number;
};

export type UsageImportRow = {
  id: string;
  source: string;
  fileName: string | null;
  createdBy: { displayName: string; email: string } | null;
  createdAt: string;
  rowCountTotal: number;
  rowCountInserted: number;
  rowCountDuplicate: number;
  rowCountLinked: number;
  rowCountErrors: number;
  rowCountNoTokens: number;
  errors: Array<{ rowNumber: number; message: string }>;
  summary: UsageImportSummary | null;
};

export type UsagePreview = {
  rowCountTotal: number;
  rowCountInserted: number;
  rowCountDuplicate: number;
  rowCountLinked: number;
  rowCountErrors: number;
  rowCountNoTokens: number;
  dateFrom: string | null;
  dateTo: string | null;
  models: Array<{ model: string; rowCount: number; tokensTotal: number }>;
  totals: {
    tokensInput: number;
    tokensCacheWrite: number;
    tokensCache: number;
    tokensOutput: number;
    tokensTotal: number;
  };
  errors: Array<{ rowNumber: number; message: string }>;
  theoretical?: Array<{
    currency: string;
    linked: number;
    unassigned: number;
    total: number;
    paid: number;
  }>;
  unpricedModels?: Array<{ model: string; rowCount: number }>;
};

export type UnassignedUsageGroup = {
  cloudAgentId: string | null;
  rowCount: number;
  tokensTotal: number;
  latestAt: string;
  models: string[];
};

type ErrorPayload = { error?: { message?: string } };

export function UsageImportAdmin({
  workspaceId,
  canImport,
  imports,
  unassignedTotal,
  unassigned,
  unassignedTheoretical = [],
  unpricedModels = [],
}: {
  workspaceId: string;
  canImport: boolean;
  imports: UsageImportRow[];
  unassignedTotal: number;
  unassigned: UnassignedUsageGroup[];
  unassignedTheoretical?: Array<{ currency: string; amount: number }>;
  unpricedModels?: Array<{ model: string; rowCount: number }>;
}) {
  const t = useTranslations('financials');
  const locale = useLocale();
  const router = useRouter();
  const { pushToast } = useToast();
  const [fileName, setFileName] = useState<string | null>(null);
  const [csv, setCsv] = useState<string | null>(null);
  const [preview, setPreview] = useState<UsagePreview | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const number = (value: number) => value.toLocaleString(locale);
  const when = (value: string | null) =>
    value ? new Date(value).toLocaleString(locale) : t('usageNoDate');
  const usageDate = (value: string) =>
    new Intl.DateTimeFormat(locale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(value));
  const usageRange = (from: string | null, to: string | null) => {
    if (!from) return t('usageNoDate');
    const start = usageDate(from);
    const end = to ? usageDate(to) : start;
    return start === end ? start : `${start} – ${end}`;
  };

  async function postCsv(path: string) {
    const response = await fetch(path, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        Origin: window.location.origin,
      },
      body: JSON.stringify({ csv, fileName }),
    });
    const payload = (await response.json().catch(() => ({}))) as ErrorPayload &
      UsagePreview & {
        import?: UsageImportRow;
      };
    if (!response.ok) {
      throw new Error(payload.error?.message || t('usageImportFailed'));
    }
    return payload;
  }

  async function onPreview() {
    if (!csv) return;
    setPending(true);
    setError(null);
    try {
      const payload = await postCsv(`/api/v1/workspaces/${workspaceId}/ai-usage-imports/preview`);
      setPreview(payload);
    } catch (err) {
      setPreview(null);
      setError(err instanceof Error ? err.message : t('usagePreviewFailed'));
    } finally {
      setPending(false);
    }
  }

  async function onImport() {
    if (csv === null) return;
    setPending(true);
    setError(null);
    try {
      await postCsv(`/api/v1/workspaces/${workspaceId}/ai-usage-imports`);
      setCsv(null);
      setFileName(null);
      setPreview(null);
      pushToast(t('usageImported'), 'success');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('usageImportFailed'));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="kh-ops-panel">
        <div className="kh-ops-panel-head">
          <h2 className="kh-ops-panel-title">{t('usageImportTitle')}</h2>
        </div>
        <div className="flex flex-col gap-3 p-4">
          <p className="m-0 text-sm text-ink-muted">{t('usageImportHint')}</p>
          {canImport ? (
            <>
              <Field label={t('usageChooseFile')}>
                <FilePicker
                  accept=".csv,text/csv"
                  fileName={fileName}
                  disabled={pending}
                  onFileChange={(file, text) => {
                    setPreview(null);
                    setError(null);
                    if (!file) {
                      setFileName(null);
                      setCsv(null);
                      return;
                    }
                    setFileName(file.name);
                    setCsv(text ?? '');
                  }}
                />
              </Field>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={pending || csv === null}
                  onClick={() => void onPreview()}
                >
                  {t('usagePreview')}
                </Button>
                <Button
                  type="button"
                  disabled={pending || csv === null}
                  onClick={() => void onImport()}
                >
                  {pending ? t('usageImporting') : t('usageConfirm')}
                </Button>
              </div>
            </>
          ) : (
            <p className="m-0 text-sm text-ink-muted">{t('usageAdminOnly')}</p>
          )}
          {error ? <ErrorText>{error}</ErrorText> : null}
          {preview ? (
            <>
              <div className="kh-ops-stats">
                <Stat label={t('usageRows')} value={number(preview.rowCountTotal)} />
                <Stat
                  label={t('usageDateRange')}
                  value={usageRange(preview.dateFrom, preview.dateTo)}
                  compact
                />
                <Stat label={t('usageLinked')} value={number(preview.rowCountLinked)} />
                <Stat label={t('usageWouldInsert')} value={number(preview.rowCountInserted)} />
                <Stat label={t('usageDuplicates')} value={number(preview.rowCountDuplicate)} />
                <Stat label={t('usageNoTokens')} value={number(preview.rowCountNoTokens)} />
                <Stat label={t('usageErrors')} value={number(preview.rowCountErrors)} />
              </div>
              <p className="m-0 text-sm text-ink-muted">
                {t('usageTotals')}: {t('usageInput')} {number(preview.totals.tokensInput)},{' '}
                {t('usageCacheWrite')} {number(preview.totals.tokensCacheWrite)}, {t('usageCache')}{' '}
                {number(preview.totals.tokensCache)}, {t('usageOutput')}{' '}
                {number(preview.totals.tokensOutput)}, {t('usageTotal')}{' '}
                {number(preview.totals.tokensTotal)}
              </p>
              {preview.theoretical?.map((row) => (
                <p key={row.currency} className="m-0 text-sm">
                  {row.currency} · {t('usagePaid')}: {formatMoney(row.paid, row.currency, locale)} ·{' '}
                  {t('usageTheoretical')}: {formatMoney(row.total, row.currency, locale)} ·{' '}
                  {t('theoreticalLinked')}: {formatMoney(row.linked, row.currency, locale)} ·{' '}
                  {t('theoreticalUnassigned')}: {formatMoney(row.unassigned, row.currency, locale)}
                </p>
              ))}
              {preview.unpricedModels && preview.unpricedModels.length > 0 ? (
                <p className="m-0 text-sm text-ink-muted">
                  {t('unpricedModels')}: {preview.unpricedModels.map((row) => row.model).join(', ')}
                </p>
              ) : null}
              {preview.models.length > 0 ? (
                <div className="kh-ops-table-wrap">
                  <table className="kh-ops-data-table">
                    <thead>
                      <tr>
                        <th>{t('usageModel')}</th>
                        <th>{t('usageRows')}</th>
                        <th>{t('usageTotal')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.models.map((model) => (
                        <tr key={model.model}>
                          <td>{model.model}</td>
                          <td>{number(model.rowCount)}</td>
                          <td>{number(model.tokensTotal)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
              {preview.errors.length > 0 ? (
                <ErrorList title={t('usageRowErrors')} errors={preview.errors} />
              ) : null}
            </>
          ) : null}
        </div>
      </section>

      <section className="kh-ops-panel">
        <div className="kh-ops-panel-head">
          <h2 className="kh-ops-panel-title">{t('usageLogTitle')}</h2>
        </div>
        {imports.length === 0 ? (
          <p className="m-0 p-4 text-sm text-ink-muted">{t('usageLogEmpty')}</p>
        ) : (
          <div className="kh-ops-table-wrap">
            <table className="kh-ops-data-table">
              <thead>
                <tr>
                  <th>{t('usageWhen')}</th>
                  <th>{t('usageWho')}</th>
                  <th>{t('usageFile')}</th>
                  <th>{t('usageSource')}</th>
                  <th>{t('usageRows')}</th>
                  <th>{t('usageInserted')}</th>
                  <th>{t('usageDuplicate')}</th>
                  <th>{t('usageLinkedCol')}</th>
                  <th>{t('usageNoTokens')}</th>
                  <th>{t('usageErrorCol')}</th>
                </tr>
              </thead>
              <tbody>
                {imports.map((item) => (
                  <Fragment key={item.id}>
                    <tr>
                      <td>{when(item.createdAt)}</td>
                      <td>{item.createdBy?.displayName ?? '—'}</td>
                      <td>{item.fileName ?? '—'}</td>
                      <td>{item.source === 'csv' ? t('sourceCsv') : item.source}</td>
                      <td>{number(item.rowCountTotal)}</td>
                      <td>{number(item.rowCountInserted)}</td>
                      <td>{number(item.rowCountDuplicate)}</td>
                      <td>{number(item.rowCountLinked)}</td>
                      <td>{number(item.rowCountNoTokens)}</td>
                      <td>
                        {number(item.rowCountErrors)}
                        {item.errors.length > 0 ? (
                          <details>
                            <summary>{t('usageRowErrors')}</summary>
                            <ErrorList title={t('usageRowErrors')} errors={item.errors} />
                          </details>
                        ) : null}
                      </td>
                    </tr>
                    <tr>
                      <td colSpan={10}>
                        <details>
                          <summary>{t('usageSummary')}</summary>
                          <ImportSummary
                            workspaceId={workspaceId}
                            item={item}
                            number={number}
                            usageRange={usageRange}
                          />
                        </details>
                      </td>
                    </tr>
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="kh-ops-panel">
        <div className="kh-ops-panel-head">
          <h2 className="kh-ops-panel-title">{t('usageUnassignedTitle')}</h2>
        </div>
        <div className="flex flex-col gap-3 p-4">
          <p className="m-0 text-sm text-ink-muted">{t('usageUnassignedHint')}</p>
          {unassignedTheoretical.map((row) => (
            <p key={row.currency} className="m-0 text-sm">
              {t('theoreticalUnassigned')}: {formatMoney(row.amount, row.currency, locale)}
            </p>
          ))}
          {unpricedModels.length > 0 ? (
            <p className="m-0 text-sm text-ink-muted">
              {t('unpricedModels')}: {unpricedModels.map((row) => row.model).join(', ')}
            </p>
          ) : null}
          {unassignedTotal === 0 ? (
            <p className="m-0 text-sm text-ink-muted">{t('usageUnassignedEmpty')}</p>
          ) : null}
        </div>
        {unassignedTotal > 0 ? (
          <UnassignedUsageTable groups={unassigned} number={number} when={when} />
        ) : null}
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  compact = false,
}: {
  label: string;
  value: string;
  compact?: boolean;
}) {
  return (
    <div className="kh-ops-stat">
      <div className="kh-ops-stat-label">{label}</div>
      <div className={compact ? 'kh-ops-stat-value is-compact' : 'kh-ops-stat-value'}>{value}</div>
    </div>
  );
}

function ImportSummary({
  workspaceId,
  item,
  number,
  usageRange,
}: {
  workspaceId: string;
  item: UsageImportRow;
  number: (value: number) => string;
  usageRange: (from: string | null, to: string | null) => string;
}) {
  const t = useTranslations('financials');
  const summary = item.summary;
  if (!summary) {
    return <p className="m-0 mt-2 text-sm text-ink-muted">{t('usageSummaryMissing')}</p>;
  }
  return (
    <div className="mt-2 flex flex-col gap-2">
      <p className="m-0 text-sm text-ink-muted">
        {t('usageDateRange')}: {usageRange(summary.dateFrom, summary.dateTo)}
      </p>
      <p className="m-0 text-sm text-ink-muted">
        {t('usageTotals')}: {t('usageInput')} {number(summary.totals.tokensInput)},{' '}
        {t('usageCacheWrite')} {number(summary.totals.tokensCacheWrite)}, {t('usageCache')}{' '}
        {number(summary.totals.tokensCache)}, {t('usageOutput')}{' '}
        {number(summary.totals.tokensOutput)}, {t('usageTotal')}{' '}
        {number(summary.totals.tokensTotal)}
      </p>
      <p className="m-0 text-sm text-ink-muted">
        {t('usageLinked')}: {number(summary.linkedCount)}. {t('usageUnassignedCount')}:{' '}
        {number(summary.unassignedCount)}
      </p>
      {summary.models.length > 0 ? (
        <div className="kh-ops-table-wrap">
          <table className="kh-ops-data-table">
            <thead>
              <tr>
                <th>{t('usageModel')}</th>
                <th className="kh-ops-num">{t('usageRows')}</th>
                <th className="kh-ops-num">{t('usageTotal')}</th>
              </tr>
            </thead>
            <tbody>
              {summary.models.map((model) => (
                <tr key={model.model}>
                  <td>{model.model}</td>
                  <td className="kh-ops-num">{number(model.rowCount)}</td>
                  <td className="kh-ops-num">{number(model.tokensTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <UnassignedImportRows workspaceId={workspaceId} importId={item.id} number={number} />
    </div>
  );
}

type UnassignedPage = {
  rows: Array<{
    id: string;
    occurredAt: string;
    cloudAgentId: string | null;
    model: string;
    tokensInput: number;
    tokensCacheWrite: number;
    tokensCache: number;
    tokensOutput: number;
    tokensTotal: number;
  }>;
  total: number;
  nextCursor: string | null;
  hasMore: boolean;
};

function UnassignedImportRows({
  workspaceId,
  importId,
  number,
}: {
  workspaceId: string;
  importId: string;
  number: (value: number) => string;
}) {
  const t = useTranslations('financials');
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [previous, setPrevious] = useState<Array<string | undefined>>([]);
  const [page, setPage] = useState<UnassignedPage | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const params = new URLSearchParams({ limit: '25' });
    if (cursor) params.set('cursor', cursor);
    void fetch(
      `/api/v1/workspaces/${workspaceId}/ai-usage-imports/${importId}/unassigned?${params}`,
      { credentials: 'include' },
    )
      .then(async (response) => {
        const payload = (await response.json().catch(() => ({}))) as UnassignedPage & ErrorPayload;
        if (!response.ok) {
          throw new Error(payload.error?.message || t('usageImportFailed'));
        }
        return payload;
      })
      .then((payload) => {
        if (!cancelled) setPage(payload);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : t('usageImportFailed'));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, cursor, workspaceId, importId, t]);

  const when = (value: string) => new Date(value).toLocaleString(locale);

  return (
    <div>
      <Button type="button" variant="secondary" onClick={() => setOpen((value) => !value)}>
        {t('usageLoadUnassigned')}
      </Button>
      {open && error ? <ErrorText>{error}</ErrorText> : null}
      {open && page && page.rows.length === 0 ? (
        <p className="m-0 mt-2 text-sm text-ink-muted">{t('usageUnassignedRowsEmpty')}</p>
      ) : null}
      {open && page && page.rows.length > 0 ? (
        <div className="mt-2 flex flex-col gap-2">
          <div className="kh-ops-table-wrap">
            <table className="kh-ops-data-table" aria-label={t('usageUnassignedRows')}>
              <thead>
                <tr>
                  <th>{t('usageWhen')}</th>
                  <th>{t('usageCloudAgent')}</th>
                  <th>{t('usageModel')}</th>
                  <th className="kh-ops-num">{t('usageInput')}</th>
                  <th className="kh-ops-num">{t('usageCacheWrite')}</th>
                  <th className="kh-ops-num">{t('usageCache')}</th>
                  <th className="kh-ops-num">{t('usageOutput')}</th>
                  <th className="kh-ops-num">{t('usageTotal')}</th>
                </tr>
              </thead>
              <tbody>
                {page.rows.map((row) => (
                  <tr key={row.id}>
                    <td>{when(row.occurredAt)}</td>
                    <td>{row.cloudAgentId ?? t('usageNoAgent')}</td>
                    <td>{row.model}</td>
                    <td className="kh-ops-num">{number(row.tokensInput)}</td>
                    <td className="kh-ops-num">{number(row.tokensCacheWrite)}</td>
                    <td className="kh-ops-num">{number(row.tokensCache)}</td>
                    <td className="kh-ops-num">{number(row.tokensOutput)}</td>
                    <td className="kh-ops-num">{number(row.tokensTotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={previous.length === 0}
              onClick={() => {
                const prior = previous[previous.length - 1];
                setPrevious((stack) => stack.slice(0, -1));
                setCursor(prior);
              }}
            >
              {t('usagePrev')}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={!page.hasMore || !page.nextCursor}
              onClick={() => {
                if (!page.nextCursor) return;
                setPrevious((stack) => [...stack, cursor]);
                setCursor(page.nextCursor);
              }}
            >
              {t('usageNext')}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Inclusive local calendar day, matching the Latest cell. */
function usageLocalDay(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function usageInDateRange(iso: string, from: string, to: string): boolean {
  const day = usageLocalDay(iso);
  if (from && (!day || day < from)) return false;
  if (to && (!day || day > to)) return false;
  return true;
}

function usageGroupKey(group: UnassignedUsageGroup): string {
  return group.cloudAgentId ?? 'none';
}

function UnassignedUsageTable({
  groups,
  number,
  when,
}: {
  groups: UnassignedUsageGroup[];
  number: (value: number) => string;
  when: (value: string | null) => string;
}) {
  const t = useTranslations('financials');
  const tTable = useTranslations('table');
  const locale = useLocale();
  const table = useTableState({
    namespace: 'usage',
    defaultSortKey: 'latest',
    defaultSortDir: 'desc',
  });
  const from = table.extras.from ?? '';
  const to = table.extras.to ?? '';
  const modelOptions = useMemo(
    () =>
      collectEnumOptions(
        groups,
        (group) => group.models,
        (value) => value,
        locale,
      ),
    [groups, locale],
  );
  const columns = useMemo<Array<DataColumn<UnassignedUsageGroup>>>(
    () => [
      {
        id: 'agent',
        header: t('usageCloudAgent'),
        kind: 'text',
        sort: {
          type: 'text',
          getValue: (group) => group.cloudAgentId ?? '',
        },
        filter: {
          type: 'text',
          getValue: (group) => group.cloudAgentId ?? t('usageNoAgent'),
        },
        cell: (group) => group.cloudAgentId ?? t('usageNoAgent'),
      },
      {
        id: 'rows',
        header: t('usageRows'),
        kind: 'number',
        sort: { type: 'number', getValue: (group) => group.rowCount },
        cell: (group) => number(group.rowCount),
      },
      {
        id: 'tokens',
        header: t('usageTotal'),
        kind: 'number',
        sort: { type: 'number', getValue: (group) => group.tokensTotal },
        cell: (group) => number(group.tokensTotal),
      },
      {
        id: 'latest',
        header: t('usageLatest'),
        kind: 'date',
        sort: {
          type: 'date',
          getValue: (group) => group.latestAt,
          defaultDir: 'desc',
        },
        cell: (group) => when(group.latestAt),
      },
      {
        id: 'model',
        header: t('usageModels'),
        kind: 'text',
        sort: {
          type: 'text',
          getValue: (group) => group.models.join(', '),
        },
        filter: {
          type: 'enum',
          getValue: (group) => group.models,
          options: modelOptions,
        },
        cell: (group) => (group.models.length > 0 ? group.models.join(', ') : '—'),
      },
    ],
    [modelOptions, number, t, when],
  );
  useSyncEnumFilters(table.filters, columns, table.setEnumFilter);

  const filtersActive = table.filtersActive || from !== '' || to !== '';
  const visible = useMemo(
    () =>
      applyTableView({
        rows: groups,
        locale,
        query: table.query,
        search: (group, needle) =>
          [group.cloudAgentId ?? '', t('usageNoAgent'), ...group.models]
            .join(' ')
            .toLowerCase()
            .includes(needle),
        sortKey: table.sortKey,
        sortDir: table.sortDir,
        filters: table.filters,
        textFilters: table.textFilters,
        columns,
        tieBreak: (left, right) =>
          compareText(left.cloudAgentId ?? '', right.cloudAgentId ?? '', locale),
      }).filter((group) => usageInDateRange(group.latestAt, from, to)),
    [
      columns,
      from,
      groups,
      locale,
      t,
      table.filters,
      table.query,
      table.sortDir,
      table.sortKey,
      table.textFilters,
      to,
    ],
  );

  function clearFilters() {
    table.clearFilters();
    table.setExtra('from', '');
    table.setExtra('to', '');
  }

  const bareEmpty = visible.length === 0 && !filtersActive;

  return (
    <>
      <div className="kh-ops-toolbar mb-0 border-0 border-b border-line">
        <label className="flex min-w-[220px] flex-1 items-center gap-2">
          <span className="sr-only">{t('usageUnassignedSearch')}</span>
          <Input
            type="search"
            value={table.query}
            onChange={(event) => table.setQuery(event.target.value)}
            placeholder={t('usageUnassignedSearch')}
            aria-label={t('usageUnassignedSearch')}
            className="h-10 min-h-10 py-1.5 text-xs"
          />
        </label>
        <TableFilterControl
          fields={dataTableFilterFields(columns)}
          enumFilters={table.filters}
          textFilters={table.textFilters}
          onEnumFilter={table.setEnumFilter}
          onTextFilter={table.setTextFilter}
          onClearFilters={clearFilters}
          filtersActive={filtersActive}
          insertAfter={{
            id: 'agent',
            content: (
              <fieldset className="kh-ops-table-filter-group">
                <legend>{t('usageLatest')}</legend>
                <label className="grid gap-1">
                  <span>{t('from')}</span>
                  <Input
                    type="date"
                    value={from}
                    aria-label={t('from')}
                    className="h-10 min-h-10 py-1.5 text-xs"
                    onChange={(event) => table.setExtra('from', event.target.value)}
                  />
                </label>
                <label className="grid gap-1">
                  <span>{t('to')}</span>
                  <Input
                    type="date"
                    value={to}
                    aria-label={t('to')}
                    className="h-10 min-h-10 py-1.5 text-xs"
                    onChange={(event) => table.setExtra('to', event.target.value)}
                  />
                </label>
              </fieldset>
            ),
          }}
        />
        {filtersActive ? (
          <Button
            type="button"
            variant="secondary"
            className="kh-ops-tree-filter-clear h-8 min-h-8 px-2 text-xs"
            onClick={clearFilters}
          >
            {tTable('clearFilters')}
          </Button>
        ) : null}
      </div>
      {bareEmpty ? (
        <div className="kh-ops-empty-state">
          <div className="kh-ops-empty-mark">00</div>
          <h3>{t('usageUnassignedTitle')}</h3>
          <p>{table.query.trim() ? tTable('emptyFiltered') : t('usageUnassignedEmpty')}</p>
        </div>
      ) : (
        <DataTable
          rows={visible}
          rowKey={usageGroupKey}
          columns={columns}
          sortKey={table.sortKey}
          sortDir={table.sortDir}
          onToggleSort={table.toggleSort}
          enumFilters={table.filters}
          textFilters={table.textFilters}
          onEnumFilter={table.setEnumFilter}
          onTextFilter={table.setTextFilter}
          onClearFilters={clearFilters}
          filtersActive={filtersActive}
          hideHeaderFilter
          empty={
            <>
              <h3>{t('usageUnassignedTitle')}</h3>
              <p>{tTable('emptyFiltered')}</p>
            </>
          }
        />
      )}
    </>
  );
}

function ErrorList({
  title,
  errors,
}: {
  title: string;
  errors: Array<{ rowNumber: number; message: string }>;
}) {
  return (
    <ul className="m-0 pl-5 text-sm" aria-label={title}>
      {errors.map((item) => (
        <li key={`${item.rowNumber}-${item.message}`}>
          {item.rowNumber > 0 ? `${item.rowNumber}: ` : ''}
          {item.message}
        </li>
      ))}
    </ul>
  );
}
