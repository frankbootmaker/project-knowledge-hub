'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import {
  addCalendarDays,
  lastDayOfMonth,
  lookupFxRate,
  summarizeAiBillingMonth,
  type FxRate,
} from '@project-knowledge-hub/domain';
import { formatAiBillingMonth, formatServiceDate } from '../../lib/ai-billing-month';
import { formatMoney } from '../../lib/project-currency';
import { AiBillingChart, AiBillingChartLegend } from '../AiBillingChart';
import { Button, ErrorText, Field, Input, Select, useToast } from '../ui';
import {
  AiCostGrainToggle,
  AiCostPeriodForm,
  type AiCostGrain,
  type AiCostViewRange,
} from './AiCostPeriodForm';

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
  fromDay?: string;
  toDay?: string;
  grain?: AiCostGrain;
  grainAdjusted?: boolean;
  chart?: PlatformAiTotal[];
  originalChart?: PlatformAiTotal[];
  theoretical?: Array<{
    currency: string;
    linked: number;
    unassigned: number;
    total: number;
  }>;
  unpricedModels?: Array<{ model: string }>;
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

function formatQuotedRate(rate: number): string {
  return rate.toFixed(8).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}

function workspaceHref(slug: string): string {
  return `/workspaces/${slug}/financials`;
}

function entryAmount(
  entry: PlatformAiEntry,
  original: boolean,
): { amount: number; currency: string } {
  if (original) return { amount: entry.amount, currency: entry.currency };
  return {
    amount: entry.convertedAmount ?? entry.amount,
    currency: entry.convertedCurrency ?? entry.currency,
  };
}

function filterOverviewMonths(
  months: PlatformAiMonth[],
  entries: PlatformAiEntry[],
  filters: PlatformAiCostFilters,
  original: boolean,
): PlatformAiMonth[] {
  const rows = months.filter((row) => {
    if (filters.workspaceId && row.workspaceId !== filters.workspaceId) return false;
    if (filters.period && row.period !== filters.period) return false;
    return true;
  });
  if (filters.provider) {
    const allowed = new Set(rows.map((row) => row.currency));
    const sums = new Map<string, { subscription: number; planChange: number; onDemand: number }>();
    for (const entry of entries) {
      const money = entryAmount(entry, original);
      if (allowed.size > 0 && !allowed.has(money.currency)) continue;
      const key = `${entry.workspaceId}|${entry.period}|${money.currency}`;
      const current = sums.get(key) ?? { subscription: 0, planChange: 0, onDemand: 0 };
      if (entry.type === 'subscription') current.subscription += money.amount;
      else if (entry.type === 'plan_change') current.planChange += money.amount;
      else current.onDemand += money.amount;
      sums.set(key, current);
    }
    const known = new Map(
      rows.map((row) => [`${row.workspaceId}|${row.period}|${row.currency}`, row]),
    );
    const next: PlatformAiMonth[] = [];
    for (const [key, parts] of sums) {
      const [workspaceId, period, currency] = key.split('|');
      const sample = entries.find((entry) => entry.workspaceId === workspaceId);
      const base = known.get(key) ?? {
        workspaceId: workspaceId ?? '',
        workspaceName: sample?.workspaceName ?? '',
        workspaceSlug: sample?.workspaceSlug ?? '',
        period: period ?? '',
        currency: currency ?? '',
        subscription: 0,
        planChange: 0,
        onDemand: 0,
        paidCost: 0,
        theoreticalApiCost: 0,
        difference: 0,
        ratio: null,
      };
      next.push({
        ...base,
        ...summarizeAiBillingMonth({
          period: base.period,
          currency: base.currency,
          subscription: parts.subscription,
          planChange: parts.planChange,
          onDemand: parts.onDemand,
          theoreticalApiCost: 0,
        }),
      });
    }
    return next.sort(compareOverviewRows);
  }
  if (!filters.type) return rows;
  return rows
    .map((row) => ({
      ...row,
      ...summarizeAiBillingMonth({
        period: row.period,
        currency: row.currency,
        subscription: filters.type === 'subscription' ? row.subscription : 0,
        planChange: filters.type === 'plan_change' ? row.planChange : 0,
        onDemand: filters.type === 'on_demand' ? row.onDemand : 0,
        theoreticalApiCost: row.theoreticalApiCost,
      }),
    }))
    .filter((row) => {
      if (filters.type === 'subscription') return row.subscription !== 0;
      if (filters.type === 'plan_change') return row.planChange !== 0;
      return row.onDemand !== 0;
    });
}

function compareOverviewRows(a: PlatformAiMonth, b: PlatformAiMonth): number {
  const period = b.period.localeCompare(a.period);
  if (period !== 0) return period;
  const currency = a.currency.localeCompare(b.currency);
  if (currency !== 0) return currency;
  return a.workspaceName.localeCompare(b.workspaceName) || a.workspaceId.localeCompare(b.workspaceId);
}

function rollupOverviewTotals(rows: PlatformAiMonth[]): PlatformAiTotal[] {
  const grouped = new Map<
    string,
    {
      period: string;
      currency: string;
      subscription: number;
      planChange: number;
      onDemand: number;
      theoreticalApiCost: number;
      scheduled: boolean;
      fxRate: number | null;
      fxRateDate: string | null;
      fxSource: string | null;
    }
  >();
  for (const row of rows) {
    const key = `${row.period}|${row.currency}`;
    const current = grouped.get(key);
    if (!current) {
      grouped.set(key, {
        period: row.period,
        currency: row.currency,
        subscription: row.subscription,
        planChange: row.planChange,
        onDemand: row.onDemand,
        theoreticalApiCost: row.theoreticalApiCost,
        scheduled: Boolean(row.scheduled),
        fxRate: row.fxRate ?? null,
        fxRateDate: row.fxRateDate ?? null,
        fxSource: row.fxSource ?? null,
      });
      continue;
    }
    current.subscription += row.subscription;
    current.planChange += row.planChange;
    current.onDemand += row.onDemand;
    current.theoreticalApiCost += row.theoreticalApiCost;
    const sameFx =
      current.fxSource === (row.fxSource ?? null) &&
      current.fxRateDate === (row.fxRateDate ?? null);
    if (!sameFx) {
      current.fxRate = null;
      current.fxRateDate = null;
      current.fxSource = row.fxSource ? 'mixed' : current.fxSource;
    }
  }
  return [...grouped.values()]
    .map((row) => ({
      ...summarizeAiBillingMonth(row),
      scheduled: row.scheduled,
      fxRate: row.fxRate,
      fxRateDate: row.fxRateDate,
      fxSource: row.fxSource,
    }))
    .sort((a, b) => a.currency.localeCompare(b.currency) || b.period.localeCompare(a.period));
}

function OverviewFilters({
  report,
  filters,
  providers,
  monthOptions,
  locale,
  grain,
  timeZone,
}: {
  report: PlatformAiCostReport;
  filters: PlatformAiCostFilters;
  providers: string[];
  monthOptions: string[];
  locale: string;
  grain: string;
  timeZone: string;
}) {
  const t = useTranslations('financials');
  const router = useRouter();

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const params = new URLSearchParams();
    for (const [key, value] of new FormData(event.currentTarget).entries()) {
      if (typeof value === 'string' && value) params.set(key, value);
    }
    const query = params.toString();
    router.push(query ? `/admin/financials?${query}` : '/admin/financials', { scroll: false });
  }

  return (
    <form onSubmit={applyFilters} className="kh-ops-toolbar flex-wrap">
      {report.range && report.range !== 'custom' ? (
        <input type="hidden" name="range" value={report.range} />
      ) : (
        <>
          <input type="hidden" name="from" value={report.fromDay ?? report.from} />
          <input type="hidden" name="to" value={report.toDay ?? report.to} />
        </>
      )}
      {grain ? <input type="hidden" name="grain" value={grain} /> : null}
      {timeZone ? <input type="hidden" name="tz" value={timeZone} /> : null}
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
  );
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
  const router = useRouter();
  const { pushToast } = useToast();
  const [timeZone, setTimeZone] = useState('UTC');
  useEffect(() => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (zone) setTimeZone(zone);
  }, []);
  const [showOriginal, setShowOriginal] = useState(false);
  const [fxDate, setFxDate] = useState('');
  const [fxBase, setFxBase] = useState('EUR');
  const [fxQuote, setFxQuote] = useState('USD');
  const [fxRate, setFxRate] = useState('');
  const [fxQuoteNote, setFxQuoteNote] = useState<string | null>(null);
  const [fxLookup, setFxLookup] = useState(0);
  const [fxError, setFxError] = useState<string | null>(null);
  const [fxPending, setFxPending] = useState(false);
  useEffect(() => {
    const base = fxBase.trim();
    const quote = fxQuote.trim();
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(fxDate) ||
      !/^[A-Z]{3}$/.test(base) ||
      !/^[A-Z]{3}$/.test(quote) ||
      base === quote
    ) {
      setFxQuoteNote(null);
      return;
    }
    const controller = new AbortController();
    const params = new URLSearchParams({
      from: addCalendarDays(fxDate, -21),
      to: fxDate,
    });
    void (async () => {
      try {
        const response = await fetch(`/api/v1/admin/exchange-rates?${params.toString()}`, {
          credentials: 'include',
          signal: controller.signal,
        });
        if (!response.ok) return;
        const payload = (await response.json()) as { rates?: FxRate[] };
        if (controller.signal.aborted) return;
        const found = lookupFxRate(payload.rates ?? [], base, quote, fxDate);
        if (!found) {
          setFxRate('');
          setFxQuoteNote(t('fxMissing'));
          return;
        }
        setFxRate(formatQuotedRate(found.rate));
        setFxQuoteNote(t('fxQuoted', { source: found.source.toUpperCase(), date: found.date }));
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
      }
    })();
    return () => controller.abort();
  }, [fxDate, fxBase, fxQuote, fxLookup, t]);
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
  const overviewFiltered = Boolean(
    filters.workspaceId || filters.provider || filters.type || filters.period,
  );
  const overviewMonths = overviewFiltered
    ? filterOverviewMonths(months, report.entries, filters, showOriginal)
    : months;
  const overviewTotals = overviewFiltered ? rollupOverviewTotals(overviewMonths) : totals;
  const sourceChart = showOriginal
    ? (report.originalChart ?? sourceTotals)
    : (report.chart ?? sourceTotals);
  const chartRows = showOriginal
    ? sourceChart.filter((row) => row.currency === activeCurrency)
    : sourceChart;
  const grain = report.grain ?? 'month';
  const grainPreserve: Record<string, string> = {
    tz: timeZone,
    workspaceId: filters.workspaceId,
    provider: filters.provider,
    type: filters.type,
    period: filters.period,
  };
  if ((report.range ?? 'last12') !== 'custom' && report.range) grainPreserve.range = report.range;
  else {
    if (report.fromDay) grainPreserve.from = report.fromDay;
    if (report.toDay) grainPreserve.to = report.toDay;
  }
  function openBucket(period: string) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(grainPreserve)) {
      if (value && key !== 'range' && key !== 'from' && key !== 'to') params.set(key, value);
    }
    params.set('tz', timeZone);
    if (/^\d{4}-\d{2}$/.test(period)) {
      params.set('from', `${period}-01`);
      params.set('to', lastDayOfMonth(period));
    } else if (grain === 'week') {
      params.set('from', period);
      params.set('to', addCalendarDays(period, 6));
    } else {
      params.set('from', period);
      params.set('to', period);
    }
    params.set('grain', 'day');
    router.push(`/admin/financials?${params.toString()}`);
  }
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
        body: JSON.stringify({
          ...(report.fromDay ? { from: report.fromDay } : {}),
          ...(report.toDay ? { to: report.toDay } : {}),
        }),
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
      setFxLookup((current) => current + 1);
      router.refresh();
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
        fromDay={report.fromDay}
        toDay={report.toDay}
        range={report.range ?? 'last12'}
        preserve={{
          workspaceId: filters.workspaceId,
          provider: filters.provider,
          type: filters.type,
          period: filters.period,
          grain,
          tz: timeZone,
        }}
      />

      <div className="flex flex-wrap items-center gap-3">
        <p className="m-0 text-[13px] leading-none text-ink-muted">
          {t('reportingCurrency')}: {report.reportingCurrency ?? 'EUR'}
        </p>
        <Button
          type="button"
          variant="secondary"
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
          <Field label={t('fxDate')} className="kh-ops-fx-date">
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
            variant="secondary"
            className="self-end"
            disabled={fxPending}
            onClick={() => void importRates()}
          >
            {t('fxImport')}
          </Button>
        </form>
        {fxQuoteNote ? (
          <p className="m-0 px-3 pb-3 text-[13px] text-ink-muted">{fxQuoteNote}</p>
        ) : null}
        {fxError ? (
          <div className="px-3 pb-3">
            <ErrorText>{fxError}</ErrorText>
          </div>
        ) : null}
      </section>

      <section className="kh-ops-panel">
        <div className="kh-ops-panel-head">
          <h2 className="kh-ops-panel-title">{t('chartTitle')}</h2>
          <AiCostGrainToggle
            action="/admin/financials"
            grain={grain}
            adjusted={report.grainAdjusted}
            preserve={grainPreserve}
          />
        </div>
        <div className="kh-ops-chart-wrap">
          <AiBillingChartLegend
            periods={chartRows.map((row) => ({ ...row, legacyToken: 0 }))}
            labels={chartLabels}
          />
          {report.theoretical?.map((row) => (
            <p key={row.currency} className="m-0 px-3 text-[13px] text-ink-muted">
              {row.currency} · {t('theoreticalLinked')}: {formatMoney(row.linked, row.currency, locale)}{' '}
              · {t('theoreticalUnassigned')}: {formatMoney(row.unassigned, row.currency, locale)}
            </p>
          ))}
          {chartRows.length === 0 ? (
            <p className="kh-ops-empty">{t('chartEmpty')}</p>
          ) : (
            <AiBillingChart
              periods={chartRows.map((row) => ({ ...row, legacyToken: 0 }))}
              ariaLabel={t('chartAria')}
              locale={locale}
              currency={chartCurrency}
              labels={chartLabels}
              onActivate={openBucket}
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
        <OverviewFilters
          report={report}
          filters={filters}
          providers={providers}
          monthOptions={monthOptions}
          locale={locale}
          grain={grain}
          timeZone={timeZone}
        />
        {overviewMonths.length === 0 ? (
          <p className="kh-ops-empty">{overviewFiltered ? t('overviewNone') : t('noMonths')}</p>
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
                {overviewMonths.map((row) => (
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
              {overviewTotals.length > 0 ? (
                <tfoot>
                  {overviewTotals.map((row) => (
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
        <OverviewFilters
          report={report}
          filters={filters}
          providers={providers}
          monthOptions={monthOptions}
          locale={locale}
          grain={grain}
          timeZone={timeZone}
        />
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
