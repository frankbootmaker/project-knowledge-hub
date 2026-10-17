'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { formatMoney } from '../../lib/project-currency';
import { AiBillingChart } from '../AiBillingChart';
import { Button, Field, Input, Select } from '../ui';

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
};

export type PlatformAiEntry = {
  id: string;
  workspaceId: string;
  workspaceName: string;
  workspaceSlug: string;
  period: string;
  provider: string;
  plan: string | null;
  type: BillingType;
  amount: number;
  currency: string;
  paidAt: string | null;
  note: string | null;
  externalRef: string | null;
};

export type PlatformAiCostReport = {
  from: string;
  to: string;
  periods: string[];
  workspaces: Array<{ id: string; name: string; slug: string }>;
  providers: string[];
  months: PlatformAiMonth[];
  totals: PlatformAiTotal[];
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
  const currencies = useMemo(() => {
    const found = new Set<string>();
    for (const row of [...report.months, ...report.totals, ...report.entries]) {
      found.add(row.currency);
    }
    return [...found].sort((a, b) => a.localeCompare(b));
  }, [report]);
  const [currency, setCurrency] = useState(currencies[0] ?? 'EUR');
  const activeCurrency = currencies.includes(currency) ? currency : (currencies[0] ?? 'EUR');
  const months = report.months.filter((row) => row.currency === activeCurrency);
  const totals = report.totals.filter((row) => row.currency === activeCurrency);
  const entries = report.entries;
  const providers =
    filters.provider && !report.providers.includes(filters.provider)
      ? [filters.provider, ...report.providers]
      : report.providers;
  const monthOptions = [...report.periods].reverse();

  return (
    <div className="grid gap-3">
      <form method="get" action="/admin/financials" className="kh-ops-toolbar flex-wrap">
        <Field label={t('from')} className="min-w-36">
          <Input type="month" name="from" defaultValue={report.from} />
        </Field>
        <Field label={t('to')} className="min-w-36">
          <Input type="month" name="to" defaultValue={report.to} />
        </Field>
        {filters.workspaceId ? (
          <input type="hidden" name="workspaceId" value={filters.workspaceId} />
        ) : null}
        {filters.provider ? <input type="hidden" name="provider" value={filters.provider} /> : null}
        {filters.type ? <input type="hidden" name="type" value={filters.type} /> : null}
        {filters.period ? <input type="hidden" name="period" value={filters.period} /> : null}
        <Button type="submit" variant="secondary" className="self-end">
          {t('apply')}
        </Button>
      </form>

      {currencies.length > 1 ? (
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
      {currencies.length > 1 ? (
        <p className="m-0 text-[13px] text-ink-muted">{t('currenciesSeparate')}</p>
      ) : null}

      <section className="kh-ops-panel">
        <div className="kh-ops-panel-head">
          <h2 className="kh-ops-panel-title">{t('chartTitle')}</h2>
        </div>
        <div className="kh-ops-chart-wrap">
          <div className="kh-ops-chart-legend">
            <span>
              <i className="kh-ops-ai-cost-sub" />
              {t('type.subscription')}
            </span>
            <span>
              <i className="kh-ops-ai-cost-change" />
              {t('type.plan_change')}
            </span>
            <span>
              <i className="kh-ops-ai-cost-demand" />
              {t('type.on_demand')}
            </span>
            <span>
              <i className="kh-ops-ai-cost-line" />
              {t('theoretical')}
            </span>
          </div>
          {totals.length === 0 ? (
            <p className="kh-ops-empty">{t('chartEmpty')}</p>
          ) : (
            <AiBillingChart
              periods={totals.map((row) => ({ ...row, legacyToken: 0 }))}
              ariaLabel={t('chartAria')}
            />
          )}
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
                    <td>{row.period}</td>
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
            </table>
          </div>
        )}
        {totals.length > 0 ? (
          <div className="kh-ops-table-wrap">
            <table className="kh-ops-data-table">
              <thead>
                <tr>
                  <th>{t('total')}</th>
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
                {totals.map((row) => (
                  <tr key={`${row.period}-${row.currency}`}>
                    <td>{t('total')}</td>
                    <td>{row.period}</td>
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
            </table>
          </div>
        ) : null}
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
                  {period}
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
                    <td>{entry.period}</td>
                    <td>{entry.provider}</td>
                    <td>{entry.plan ?? '—'}</td>
                    <td>{t(`type.${entry.type}`)}</td>
                    <td>{entry.currency}</td>
                    <td className="kh-ops-num">
                      {formatMoney(entry.amount, entry.currency, locale)}
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
