'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { formatAiBillingMonth, formatServiceDate } from '../../lib/ai-billing-month';
import { formatMoney } from '../../lib/project-currency';
import { AiBillingChart, AiBillingChartLegend } from '../AiBillingChart';
import { Button, ErrorText, Field, Input, Select, useToast } from '../ui';
import { AiCostPeriodForm, type AiCostViewRange } from './AiCostPeriodForm';

type BillingType = 'subscription' | 'plan_change' | 'on_demand';

export type PlatformAiMonth = {
  workspaceId: string;
  workspaceName: string;
  workspaceSlug: string;
  period: string;
  currency: string;
  subscription: number;
  planChange: number;
  onDemand: number;
  paidCost: number;
  theoreticalApiCost: number;
  difference: number;
  ratio: number | null;
  scheduled?: boolean;
  fxRate?: number | null;
  fxRateDate?: string | null;
  fxSource?: string | null;
};

export type PlatformAiTotal = {
  period: string;
  currency: string;
  subscription: number;
  planChange: number;
  onDemand: number;
  paidCost: number;
  theoreticalApiCost: number;
  difference: number;
  ratio: number | null;
  scheduled?: boolean;
  fxRate?: number | null;
  fxRateDate?: string | null;
  fxSource?: string | null;
};

export type PlatformAiEntry = {
  id: string;
  workspaceId: string;
  workspaceName: string;
  workspaceSlug: string;
  period: string;
  servicePeriodStart: string | null;
  servicePeriodEnd: string | null;
  provider: string;
  plan: string | null;
  type: BillingType;
  amount: number;
  currency: string;
  paidAt: string | null;
  note: string | null;
  externalRef: string | null;
  convertedAmount?: number;
  convertedCurrency?: string;
  fxRate?: number | null;
  fxRateDate?: string | null;
  fxSource?: string | null;
};

export type PlatformAiCostReport = {
  from: string;
  to: string;
  range?: AiCostViewRange;
  periods: string[];
  workspaces: Array<{ id: string; name: string; slug: string }>;
  providers: string[];
  reportingCurrency?: string;
  months: PlatformAiMonth[];
  totals: PlatformAiTotal[];
  originalMonths?: PlatformAiMonth[];
  originalTotals?: PlatformAiTotal[];
  entries: PlatformAiEntry[];
};

export type PlatformAiCostFilters = {
  workspaceId: string;
  provider: string;
  type: string;
  period: string;
};

function ratioText(ratio: number | null): string {
  return ratio == null ? '—' : ratio.toFixed(3);
}

function fxDetail(
  source: string | null | undefined,
  rateDate: string | null | undefined,
  rate: number | null | undefined,
): string {
  if (!source) return '';
  const figure = rate == null ? '' : rate.toFixed(6);
  return [source.toUpperCase(), rateDate ?? '', figure].filter(Boolean).join(' · ');
}

function workspaceHref(slug: string): string {
  return `/workspaces/${slug}/financials`;
}

export function PlatformAiCost({
  report,
  filters,
}: {
  report: PlatformAiCostReport;
  filters: PlatformAiCostFilters;
}) {
  const t = useTranslations('financials');
  const locale = useLocale();
  const { pushToast } = useToast();
  const [showOriginal, setShowOriginal] = useState(false);
  const [fxDate, setFxDate] = useState('');
  const [fxBase, setFxBase] = useState('EUR');
  const [fxQuote, setFxQuote] = useState('USD');
  const [fxRate, setFxRate] = useState('');
  const [fxError, setFxError] = useState<string | null>(null);
  const [fxPending, setFxPending] = useState(false);
  const sourceMonths = showOriginal ? (report.originalMonths ?? report.months) : report.months;
  const sourceTotals = showOriginal ? (report.originalTotals ?? report.totals) : report.totals;
  const currencies = useMemo(() => {
    const found = new Set<string>();
    for (const row of [...sourceMonths, ...sourceTotals, ...report.entries]) {
      found.add(row.currency);
    }
    return [...found].sort((a, b) => a.localeCompare(b));
  }, [sourceMonths, sourceTotals, report.entries]);
  const [currency, setCurrency] = useState(report.reportingCurrency ?? currencies[0] ?? 'EUR');
  const activeCurrency = currencies.includes(currency) ? currency : (currencies[0] ?? 'EUR');
  const months = showOriginal
    ? sourceMonths.filter((row) => row.currency === activeCurrency)
    : sourceMonths;
  const totals = showOriginal
    ? sourceTotals.filter((row) => row.currency === activeCurrency)
    : sourceTotals;
  const entries = report.entries;

  async function saveManualRate() {
    const rate = Number(fxRate);
    if (!fxDate || !Number.isFinite(rate) || rate <= 0) {
      setFxError(t('fxRateInvalid'));
      return;
    }
    setFxPending(true);
    setFxError(null);
    try {
      const response = await fetch('/api/v1/admin/exchange-rates', {
        method: 'PUT',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Origin: window.location.origin,
        },
        body: JSON.stringify({ date: fxDate, base: fxBase, quote: fxQuote, rate }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      if (!response.ok) throw new Error(payload.error?.message || t('fxSaveFailed'));
      pushToast(t('fxSaved'), 'success');
    } catch (error) {
      setFxError(error instanceof Error ? error.message : t('fxSaveFailed'));
    } finally {
      setFxPending(false);
    }
  }

  async function importRates() {
    setFxPending(true);
    setFxError(null);
    try {
      const response = await fetch('/api/v1/admin/exchange-rates/import', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Origin: window.location.origin,
        },
        body: JSON.stringify({}),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string | { message?: string } | null;
        imported?: number;
      };
      if (!response.ok) {
        const message =
          typeof payload.error === 'string' ? payload.error : payload.error?.message;
        throw new Error(message || t('fxImportFailed'));
      }
      if (payload.error) setFxError(String(payload.error));
      pushToast(t('fxImported', { count: payload.imported ?? 0 }), 'success');
    } catch (error) {
      setFxError(error instanceof Error ? error.message : t('fxImportFailed'));
    } finally {
      setFxPending(false);
    }
  }
  const providers =
    filters.provider && !report.providers.includes(filters.provider)
      ? [filters.provider, ...report.providers]
      : report.providers;
  const monthOptions = [...report.periods].reverse();

  const chartLabels = {
    subscription: t('type.subscription'),
    planChange: t('type.plan_change'),
    onDemand: t('type.on_demand'),
    paid: t('paid'),
    theoretical: t('theoretical'),
    difference: t('difference'),
    ratio: t('ratio'),
    scheduled: t('scheduled'),
  };
  const monthLabel = (period: string, scheduled?: boolean) => {
    const label = formatAiBillingMonth(period, locale);
    return scheduled ? `${label} (${t('scheduled')})` : label;
  };
  const chartCurrency =
    totals.length > 0 && totals.every((row) => row.currency === totals[0]?.currency)
      ? (totals[0]?.currency ?? activeCurrency)
      : activeCurrency;

  return (
    <div className="grid gap-3">
      <AiCostPeriodForm
        action="/admin/financials"
        from={report.from}
        to={report.to}
        range={report.range ?? 'last12'}
        preserve={{
          workspaceId: filters.workspaceId,
          provider: filters.provider,
          type: filters.type,
          period: filters.period,
        }}
      />

      <div className="flex flex-wrap items-end gap-3">
        <p className="m-0 text-[13px] text-ink-muted">
          {t('reportingCurrency')}: {report.reportingCurrency ?? 'EUR'}
        </p>
        <Button
          type="button"
          variant="ghost"
          className="w-fit"
          onClick={() => setShowOriginal((current) => !current)}
        >
          {showOriginal ? t('showReportingCurrency') : t('showOriginalCurrencies')}
        </Button>
      </div>

      {showOriginal && currencies.length > 1 ? (
        <Field label={t('currency')} className="max-w-xs">
          <Select value={activeCurrency} onChange={(event) => setCurrency(event.target.value)}>
            {currencies.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      {showOriginal && currencies.length > 1 ? (
        <p className="m-0 text-[13px] text-ink-muted">{t('currenciesSeparate')}</p>
      ) : null}

      <section className="kh-ops-panel">
        <div className="kh-ops-panel-head">
          <h2 className="kh-ops-panel-title">{t('fxManualTitle')}</h2>
        </div>
        <p className="kh-ops-card-body m-0 px-3 pt-3 text-[13px] text-ink-muted">
          {t('fxManualHint')}
        </p>
        <form
          className="kh-ops-toolbar flex-wrap"
          onSubmit={(event) => {
            event.preventDefault();
            void saveManualRate();
          }}
        >
          <Field label={t('fxDate')} className="min-w-36">
            <Input type="date" value={fxDate} onChange={(event) => setFxDate(event.target.value)} />
          </Field>
          <Field label={t('fxBase')} className="min-w-24">
            <Input
              value={fxBase}
              maxLength={3}
              onChange={(event) => setFxBase(event.target.value.toUpperCase())}
            />
          </Field>
          <Field label={t('fxQuote')} className="min-w-24">
            <Input
              value={fxQuote}
              maxLength={3}
              onChange={(event) => setFxQuote(event.target.value.toUpperCase())}
            />
          </Field>
          <Field label={t('fxRate')} className="min-w-32">
            <Input
              type="number"
              min="0"
              step="0.00000001"
              value={fxRate}
              onChange={(event) => setFxRate(event.target.value)}
            />
          </Field>
          <Button type="submit" variant="secondary" className="self-end" disabled={fxPending}>
            {t('fxSave')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="self-end"
            disabled={fxPending}
            onClick={() => void importRates()}
          >
            {t('fxImport')}
          </Button>
        </form>
        {fxError ? (
          <div className="px-3 pb-3">
            <ErrorText>{fxError}</ErrorText>
          </div>
        ) : null}
      </section>

      <section className="kh-ops-panel">
        <div className="kh-ops-panel-head">
          <h2 className="kh-ops-panel-title">{t('chartTitle')}</h2>
        </div>
        <div className="kh-ops-chart-wrap">
          <AiBillingChartLegend
            periods={totals.map((row) => ({ ...row, legacyToken: 0 }))}
            labels={chartLabels}
          />
          {totals.length === 0 ? (
            <p className="kh-ops-empty">{t('chartEmpty')}</p>
          ) : (
            <AiBillingChart
              periods={totals.map((row) => ({ ...row, legacyToken: 0 }))}
              ariaLabel={t('chartAria')}
              locale={locale}
              currency={chartCurrency}
              labels={chartLabels}
            />
          )}
          {totals.some((row) => row.fxSource) ? (
            <ul className="m-0 grid gap-1 px-3 pb-3 text-[13px] text-ink-muted">
              {totals.map((row) => {
                const detail = fxDetail(row.fxSource, row.fxRateDate, row.fxRate);
                if (!detail) return null;
                return (
                  <li key={`${row.period}-${row.currency}`}>
                    {monthLabel(row.period, row.scheduled)} · {row.currency} · {detail}
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      </section>

      <section className="kh-ops-panel">
        <div className="kh-ops-panel-head">
          <h2 className="kh-ops-panel-title">{t('overviewTitle')}</h2>
        </div>
        {months.length === 0 ? (
          <p className="kh-ops-empty">{t('noMonths')}</p>
        ) : (
          <div className="kh-ops-table-wrap">
            <table className="kh-ops-data-table">
              <thead>
                <tr>
                  <th>{t('workspace')}</th>
                  <th>{t('period')}</th>
                  <th className="kh-ops-num">{t('type.subscription')}</th>
                  <th className="kh-ops-num">{t('type.plan_change')}</th>
                  <th className="kh-ops-num">{t('type.on_demand')}</th>
                  <th className="kh-ops-num">{t('paid')}</th>
                  <th className="kh-ops-num">{t('theoretical')}</th>
                  <th className="kh-ops-num">{t('difference')}</th>
                  <th className="kh-ops-num">{t('ratio')}</th>
                </tr>
              </thead>
              <tbody>
                {months.map((row) => (
                  <tr key={`${row.workspaceId}-${row.period}-${row.currency}`}>
                    <td>
                      <Link href={workspaceHref(row.workspaceSlug)} className="kh-text-link">
                        {row.workspaceName}
                      </Link>
                    </td>
                    <td>{monthLabel(row.period, row.scheduled)}</td>
                    <td className="kh-ops-num">
                      {formatMoney(row.subscription, row.currency, locale)}
                    </td>
                    <td className="kh-ops-num">
                      {formatMoney(row.planChange, row.currency, locale)}
                    </td>
                    <td className="kh-ops-num">
                      {formatMoney(row.onDemand, row.currency, locale)}
                    </td>
                    <td className="kh-ops-num">
                      {formatMoney(row.paidCost, row.currency, locale)}
                    </td>
                    <td className="kh-ops-num">
                      {formatMoney(row.theoreticalApiCost, row.currency, locale)}
                    </td>
                    <td className="kh-ops-num">
                      {formatMoney(row.difference, row.currency, locale)}
                    </td>
                    <td className="kh-ops-num">{ratioText(row.ratio)}</td>
                  </tr>
                ))}
              </tbody>
              {totals.length > 0 ? (
                <tfoot>
                  {totals.map((row) => (
                    <tr key={`${row.period}-${row.currency}`}>
                      <th scope="row">{t('total')}</th>
                      <td>{monthLabel(row.period, row.scheduled)}</td>
                      <td className="kh-ops-num">
                        {formatMoney(row.subscription, row.currency, locale)}
                      </td>
                      <td className="kh-ops-num">
                        {formatMoney(row.planChange, row.currency, locale)}
                      </td>
                      <td className="kh-ops-num">
                        {formatMoney(row.onDemand, row.currency, locale)}
                      </td>
                      <td className="kh-ops-num">
                        {formatMoney(row.paidCost, row.currency, locale)}
                      </td>
                      <td className="kh-ops-num">
                        {formatMoney(row.theoreticalApiCost, row.currency, locale)}
                      </td>
                      <td className="kh-ops-num">
                        {formatMoney(row.difference, row.currency, locale)}
                      </td>
                      <td className="kh-ops-num">{ratioText(row.ratio)}</td>
                    </tr>
                  ))}
                </tfoot>
              ) : null}
            </table>
          </div>
        )}
      </section>

      <section className="kh-ops-panel">
        <div className="kh-ops-panel-head">
          <h2 className="kh-ops-panel-title">{t('entriesTitle')}</h2>
        </div>
        <p className="kh-ops-card-body m-0 px-3 pt-3 text-[13px] text-ink-muted">
          {t('entriesHint')}
        </p>
        <form method="get" action="/admin/financials" className="kh-ops-toolbar flex-wrap">
          <input type="hidden" name="from" value={report.from} />
          <input type="hidden" name="to" value={report.to} />
          <Field label={t('workspace')} className="min-w-40">
            <Select name="workspaceId" defaultValue={filters.workspaceId}>
              <option value="">{t('allWorkspaces')}</option>
              {report.workspaces.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('provider')} className="min-w-36">
            <Select name="provider" defaultValue={filters.provider}>
              <option value="">{t('allProviders')}</option>
              {providers.map((provider) => (
                <option key={provider} value={provider}>
                  {provider}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('typeLabel')} className="min-w-36">
            <Select name="type" defaultValue={filters.type}>
              <option value="">{t('allTypes')}</option>
              <option value="subscription">{t('type.subscription')}</option>
              <option value="plan_change">{t('type.plan_change')}</option>
              <option value="on_demand">{t('type.on_demand')}</option>
            </Select>
          </Field>
          <Field label={t('month')} className="min-w-36">
            <Select name="period" defaultValue={filters.period}>
              <option value="">{t('allMonths')}</option>
              {monthOptions.map((period) => (
                <option key={period} value={period}>
                  {formatAiBillingMonth(period, locale)}
                </option>
              ))}
            </Select>
          </Field>
          <Button type="submit" variant="secondary" className="self-end">
            {t('apply')}
          </Button>
        </form>
        {entries.length === 0 ? (
          <p className="kh-ops-empty">{t('entriesNone')}</p>
        ) : (
          <div className="kh-ops-table-wrap">
            <table className="kh-ops-data-table">
              <thead>
                <tr>
                  <th>{t('workspace')}</th>
                  <th>{t('period')}</th>
                  <th>{t('serviceStart')}</th>
                  <th>{t('serviceEnd')}</th>
                  <th>{t('provider')}</th>
                  <th>{t('plan')}</th>
                  <th>{t('typeLabel')}</th>
                  <th>{t('currency')}</th>
                  <th className="kh-ops-num">{t('amount')}</th>
                  <th>{t('note')}</th>
                  <th>{t('actions')}</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id}>
                    <td>{entry.workspaceName}</td>
                    <td>{formatAiBillingMonth(entry.period, locale)}</td>
                    <td>{formatServiceDate(entry.servicePeriodStart, locale)}</td>
                    <td>{formatServiceDate(entry.servicePeriodEnd, locale)}</td>
                    <td>{entry.provider}</td>
                    <td>{entry.plan ?? '—'}</td>
                    <td>{t(`type.${entry.type}`)}</td>
                    <td>{entry.currency}</td>
                    <td
                      className="kh-ops-num"
                      title={fxDetail(entry.fxSource, entry.fxRateDate, entry.fxRate)}
                    >
                      {formatMoney(entry.amount, entry.currency, locale)}
                      {entry.convertedCurrency &&
                      entry.convertedCurrency !== entry.currency &&
                      entry.convertedAmount != null ? (
                        <span className="block text-ink-muted">
                          {formatMoney(entry.convertedAmount, entry.convertedCurrency, locale)}
                        </span>
                      ) : null}
                    </td>
                    <td className="kh-ops-cell-text">{entry.note ?? '—'}</td>
                    <td>
                      <Link href={workspaceHref(entry.workspaceSlug)} className="kh-text-link">
                        {t('editInWorkspace')}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
