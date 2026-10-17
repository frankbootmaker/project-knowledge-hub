'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import {
  projectCurrencySchema,
  splitBillingEntryByMonth,
  type ProjectCurrency,
} from '@project-knowledge-hub/domain';
import { formatMoney, parseOptionalNumber } from '../../lib/project-currency';
import { AiBillingChart } from '../AiBillingChart';
import { Button, ErrorText, Field, Input, Modal, Select, useToast } from '../ui';

type BillingType = 'subscription' | 'plan_change' | 'on_demand';

export type AiBillingEntryRow = {
  id: string;
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
  aiSystemId: string | null;
};

export type AiCostChartPoint = {
  period: string;
  currency: string;
  paidCost: number;
  subscription: number;
  planChange: number;
  onDemand: number;
  theoreticalApiCost: number;
};

export type AiCostPoolProject = {
  projectId: string;
  name: string;
  slug: string;
  tokens: number;
  overridePercent: number | null;
  amount: number;
  method: 'override' | 'tokens' | 'equal';
};

export type AiCostPool = {
  period: string;
  currency: string;
  aiSystemId: string | null;
  aiSystemName: string | null;
  paidTotal: number;
  projects: AiCostPoolProject[];
};

export type AiSystemPrice = {
  id: string;
  name: string;
  slug: string;
  systemType: string | null;
  aiTokenRatePer1k: number | null;
  aiTokenRateInputPer1k: number | null;
  aiTokenRateOutputPer1k: number | null;
  aiTokenRateCachePer1k: number | null;
  aiTokenRateCacheWritePer1k: number | null;
};

type EntryDraft = {
  id: string | null;
  servicePeriodStart: string;
  servicePeriodEnd: string;
  providerChoice: string;
  providerCustom: string;
  plan: string;
  type: BillingType;
  amount: string;
  currency: ProjectCurrency;
  paidAt: string;
  note: string;
  externalRef: string;
  aiSystemId: string;
};

const CURRENCIES = projectCurrencySchema.options;

/** Stored as free text. "Other" is only a form choice. */
const AI_COST_PROVIDERS = [
  'Cursor',
  'OpenAI',
  'Anthropic',
  'Google (Gemini)',
  'GitHub Copilot',
  'xAI',
  'Mistral',
] as const;

const OTHER_PROVIDER = 'other';

function providerFields(provider: string): {
  providerChoice: string;
  providerCustom: string;
} {
  if ((AI_COST_PROVIDERS as readonly string[]).includes(provider)) {
    return { providerChoice: provider, providerCustom: '' };
  }
  return { providerChoice: OTHER_PROVIDER, providerCustom: provider };
}

function providerName(draft: EntryDraft): string {
  if (draft.providerChoice === OTHER_PROVIDER) return draft.providerCustom.trim();
  return draft.providerChoice;
}

function emptyDraft(currency: ProjectCurrency): EntryDraft {
  return {
    id: null,
    servicePeriodStart: '',
    servicePeriodEnd: '',
    providerChoice: 'Cursor',
    providerCustom: '',
    plan: '',
    type: 'subscription',
    amount: '',
    currency,
    paidAt: '',
    note: '',
    externalRef: '',
    aiSystemId: '',
  };
}

function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function rateText(value: number | null): string {
  return value == null ? '' : String(value);
}

export function AiCostAdmin({
  workspaceId,
  workspaceSlug,
  canMutate,
  entries,
  chart,
  pools,
  systems,
}: {
  workspaceId: string;
  workspaceSlug: string;
  canMutate: boolean;
  entries: AiBillingEntryRow[];
  chart: AiCostChartPoint[];
  pools: AiCostPool[];
  systems: AiSystemPrice[];
}) {
  const t = useTranslations('financials');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const router = useRouter();
  const { pushToast } = useToast();
  const aiSystems = systems.filter((system) => system.systemType === 'ai_assistant');
  const systemName = new Map(aiSystems.map((system) => [system.id, system.name]));
  const currencies = useMemo(() => {
    const found = new Set<string>();
    for (const row of [...entries, ...chart, ...pools]) found.add(row.currency);
    return [...found];
  }, [entries, chart, pools]);
  const [currency, setCurrency] = useState(currencies[0] ?? 'EUR');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<EntryDraft | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [percents, setPercents] = useState<Record<string, string>>({});
  const [rates, setRates] = useState<Record<string, Record<string, string>>>({});

  const visibleChart = chart.filter((row) => row.currency === currency);
  const visibleEntries = entries.filter((row) => row.currency === currency);
  const visiblePools = pools.filter((row) => row.currency === currency);
  const rangeInvalid = Boolean(
    draft?.servicePeriodStart &&
      draft.servicePeriodEnd &&
      draft.servicePeriodEnd < draft.servicePeriodStart,
  );
  const splitPreview = useMemo(() => {
    if (!draft?.servicePeriodStart || !draft.servicePeriodEnd || rangeInvalid) return [];
    const amount = parseOptionalNumber(draft.amount);
    if (amount == null) return [];
    return splitBillingEntryByMonth({
      amount,
      period: draft.servicePeriodStart.slice(0, 7),
      servicePeriodStart: draft.servicePeriodStart,
      servicePeriodEnd: draft.servicePeriodEnd,
    });
  }, [draft, rangeInvalid]);

  async function reload() {
    router.refresh();
  }

  async function saveEntry() {
    if (!draft || pending) return;
    const amount = parseOptionalNumber(draft.amount);
    if (amount == null) {
      setError(t('amountRequired'));
      return;
    }
    if (!draft.servicePeriodStart || !draft.servicePeriodEnd) {
      setError(t('serviceDatesRequired'));
      return;
    }
    if (draft.servicePeriodEnd < draft.servicePeriodStart) {
      setError(t('serviceRangeInvalid'));
      return;
    }
    const provider = providerName(draft);
    if (!provider) {
      setError(t('providerRequired'));
      return;
    }
    setPending(true);
    setError(null);
    const body = {
      period: draft.servicePeriodStart.slice(0, 7),
      servicePeriodStart: draft.servicePeriodStart,
      servicePeriodEnd: draft.servicePeriodEnd,
      provider,
      plan: draft.plan.trim() || null,
      type: draft.type,
      amount,
      currency: draft.currency,
      paidAt: draft.paidAt.trim() || null,
      note: draft.note.trim() || null,
      externalRef: draft.externalRef.trim() || null,
      aiSystemId: draft.aiSystemId || null,
    };
    try {
      const response = await fetch(
        draft.id
          ? `/api/v1/workspaces/${workspaceId}/ai-billing-entries/${draft.id}`
          : `/api/v1/workspaces/${workspaceId}/ai-billing-entries`,
        {
          method: draft.id ? 'PATCH' : 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            Origin: window.location.origin,
          },
          body: JSON.stringify(body),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      if (!response.ok) throw new Error(payload.error?.message || t('saveFailed'));
      setDraft(null);
      pushToast(t('saved'), 'success');
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('saveFailed'));
    } finally {
      setPending(false);
    }
  }

  async function deleteEntry(entryId: string) {
    if (confirmDeleteId !== entryId) {
      setConfirmDeleteId(entryId);
      return;
    }
    setPending(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/v1/workspaces/${workspaceId}/ai-billing-entries/${entryId}`,
        {
          method: 'DELETE',
          credentials: 'include',
          headers: { Origin: window.location.origin },
        },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      if (!response.ok) throw new Error(payload.error?.message || t('saveFailed'));
      setConfirmDeleteId(null);
      pushToast(t('deleted'), 'success');
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('saveFailed'));
    } finally {
      setPending(false);
    }
  }

  function percentKey(pool: AiCostPool, projectId: string): string {
    return `${pool.period}|${pool.aiSystemId ?? ''}|${projectId}`;
  }

  async function savePercent(pool: AiCostPool, project: AiCostPoolProject) {
    const key = percentKey(pool, project.projectId);
    const raw = percents[key];
    if (raw == null) return;
    const percent = raw.trim() === '' ? null : parseOptionalNumber(raw);
    if (percent === undefined) {
      setError(t('percentInvalid'));
      return;
    }
    setPending(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/v1/workspaces/${workspaceId}/ai-billing-allocations`,
        {
          method: 'PUT',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            Origin: window.location.origin,
          },
          body: JSON.stringify({
            projectId: project.projectId,
            period: pool.period,
            aiSystemId: pool.aiSystemId,
            percent,
          }),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      if (!response.ok) throw new Error(payload.error?.message || t('saveFailed'));
      pushToast(t('allocationSaved'), 'success');
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('saveFailed'));
    } finally {
      setPending(false);
    }
  }

  function rateValue(system: AiSystemPrice, field: string, current: number | null): string {
    return rates[system.id]?.[field] ?? rateText(current);
  }

  function setRate(systemId: string, field: string, value: string) {
    setRates((prev) => ({
      ...prev,
      [systemId]: { ...prev[systemId], [field]: value },
    }));
  }

  async function saveRates(system: AiSystemPrice) {
    const fields = [
      ['aiTokenRatePer1k', system.aiTokenRatePer1k],
      ['aiTokenRateInputPer1k', system.aiTokenRateInputPer1k],
      ['aiTokenRateOutputPer1k', system.aiTokenRateOutputPer1k],
      ['aiTokenRateCachePer1k', system.aiTokenRateCachePer1k],
      ['aiTokenRateCacheWritePer1k', system.aiTokenRateCacheWritePer1k],
    ] as const;
    const body: Record<string, number | null> = {};
    for (const [field, current] of fields) {
      const raw = rateValue(system, field, current);
      const parsed = parseOptionalNumber(raw);
      if (parsed === undefined) {
        setError(t('rateInvalid'));
        return;
      }
      body[field] = parsed;
    }
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/systems/${system.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Origin: window.location.origin,
        },
        body: JSON.stringify(body),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      if (!response.ok) throw new Error(payload.error?.message || t('saveFailed'));
      pushToast(t('ratesSaved'), 'success');
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('saveFailed'));
    } finally {
      setPending(false);
    }
  }

  function openEdit(entry: AiBillingEntryRow) {
    const parsed = projectCurrencySchema.safeParse(entry.currency);
    setDraft({
      id: entry.id,
      servicePeriodStart: entry.servicePeriodStart ?? '',
      servicePeriodEnd: entry.servicePeriodEnd ?? '',
      ...providerFields(entry.provider),
      plan: entry.plan ?? '',
      type: entry.type,
      amount: String(entry.amount),
      currency: parsed.success ? parsed.data : 'EUR',
      paidAt: toLocalInput(entry.paidAt),
      note: entry.note ?? '',
      externalRef: entry.externalRef ?? '',
      aiSystemId: entry.aiSystemId ?? '',
    });
  }

  return (
    <div className="grid gap-3">
      {error && !draft ? <ErrorText>{error}</ErrorText> : null}
      {currencies.length > 1 ? (
        <Field label={t('currency')} className="max-w-xs">
          <Select value={currency} onChange={(event) => setCurrency(event.target.value)}>
            {currencies.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </Select>
        </Field>
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
          {visibleChart.length === 0 ? (
            <p className="kh-ops-empty">{t('chartEmpty')}</p>
          ) : (
            <AiBillingChart
              periods={visibleChart.map((row) => ({ ...row, legacyToken: 0 }))}
              ariaLabel={t('chartAria')}
            />
          )}
        </div>
      </section>

      <section className="kh-ops-panel">
        <div className="kh-ops-panel-head">
          <h2 className="kh-ops-panel-title">{t('entriesTitle')}</h2>
          {canMutate ? (
            <Button
              type="button"
              variant="secondary"
              className="w-fit"
              onClick={() =>
                setDraft(
                  emptyDraft(
                    projectCurrencySchema.safeParse(currency).success
                      ? (currency as ProjectCurrency)
                      : 'EUR',
                  ),
                )
              }
            >
              {t('addEntry')}
            </Button>
          ) : null}
        </div>
        {visibleEntries.length === 0 ? (
          <p className="kh-ops-empty">{t('entriesEmpty')}</p>
        ) : (
          <div className="kh-ops-table-wrap">
            <table className="kh-ops-data-table">
              <thead>
                <tr>
                  <th>{t('period')}</th>
                  <th>{t('provider')}</th>
                  <th>{t('system')}</th>
                  <th>{t('plan')}</th>
                  <th>{t('typeLabel')}</th>
                  <th className="kh-ops-num">{t('amount')}</th>
                  <th>{t('paidAt')}</th>
                  <th>{t('externalRef')}</th>
                  <th>{t('note')}</th>
                  {canMutate ? <th>{t('actions')}</th> : null}
                </tr>
              </thead>
              <tbody>
                {visibleEntries.map((entry) => (
                  <tr key={entry.id}>
                    <td>
                      {entry.servicePeriodStart && entry.servicePeriodEnd
                        ? `${entry.servicePeriodStart} – ${entry.servicePeriodEnd}`
                        : entry.period}
                    </td>
                    <td>{entry.provider}</td>
                    <td>
                      {entry.aiSystemId
                        ? (systemName.get(entry.aiSystemId) ?? t('workspacePool'))
                        : t('workspacePool')}
                    </td>
                    <td>{entry.plan ?? '—'}</td>
                    <td>{t(`type.${entry.type}`)}</td>
                    <td className="kh-ops-num">
                      {formatMoney(entry.amount, entry.currency, locale)}
                    </td>
                    <td>{entry.paidAt ? entry.paidAt.slice(0, 10) : '—'}</td>
                    <td>{entry.externalRef ?? '—'}</td>
                    <td className="kh-ops-cell-text">{entry.note ?? '—'}</td>
                    {canMutate ? (
                      <td>
                        <Button type="button" variant="ghost" onClick={() => openEdit(entry)}>
                          {t('edit')}
                        </Button>
                        <Button
                          type="button"
                          variant={confirmDeleteId === entry.id ? 'danger' : 'ghost'}
                          disabled={pending}
                          onClick={() => void deleteEntry(entry.id)}
                        >
                          {confirmDeleteId === entry.id ? t('confirmDelete') : t('delete')}
                        </Button>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="kh-ops-panel">
        <div className="kh-ops-panel-head">
          <h2 className="kh-ops-panel-title">{t('allocationTitle')}</h2>
        </div>
        <p className="kh-ops-card-body m-0 px-3 pt-3 text-[13px] text-ink-muted">
          {t('allocationHint')}
        </p>
        {visiblePools.length === 0 ? (
          <p className="kh-ops-empty">{t('allocationEmpty')}</p>
        ) : (
          visiblePools.map((pool) => (
            <div key={`${pool.period}-${pool.currency}-${pool.aiSystemId ?? 'workspace'}`}>
              <p className="kh-ops-panel-meta m-0 px-3 pt-3">
                {pool.period}
                {' · '}
                {pool.aiSystemName ?? t('workspacePool')}
                {' · '}
                {formatMoney(pool.paidTotal, pool.currency, locale)}
              </p>
              <div className="kh-ops-table-wrap">
                <table className="kh-ops-data-table">
                  <thead>
                    <tr>
                      <th>{t('project')}</th>
                      <th className="kh-ops-num">{t('tokens')}</th>
                      <th>{t('methodLabel')}</th>
                      <th className="kh-ops-num">{t('percent')}</th>
                      <th className="kh-ops-num">{t('allocated')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pool.projects.map((project) => {
                      const key = percentKey(pool, project.projectId);
                      return (
                        <tr key={project.projectId}>
                          <td>
                            <Link
                              href={`/workspaces/${workspaceSlug}/projects/${project.slug}`}
                              className="kh-text-link"
                            >
                              {project.name}
                            </Link>
                          </td>
                          <td className="kh-ops-num">{project.tokens}</td>
                          <td>{t(`method.${project.method}`)}</td>
                          <td className="kh-ops-num">
                            {canMutate ? (
                              <Input
                                type="number"
                                min="0"
                                max="100"
                                step="0.01"
                                className="ml-auto w-24"
                                value={
                                  percents[key] ??
                                  (project.overridePercent == null
                                    ? ''
                                    : String(project.overridePercent))
                                }
                                disabled={pending}
                                aria-label={t('percentFor', { project: project.name })}
                                onChange={(event) =>
                                  setPercents((prev) => ({
                                    ...prev,
                                    [key]: event.target.value,
                                  }))
                                }
                                onBlur={() => void savePercent(pool, project)}
                              />
                            ) : (
                              (project.overridePercent ?? '—')
                            )}
                          </td>
                          <td className="kh-ops-num">
                            {formatMoney(project.amount, pool.currency, locale)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))
        )}
      </section>

      <section className="kh-ops-panel">
        <div className="kh-ops-panel-head">
          <h2 className="kh-ops-panel-title">{t('pricesTitle')}</h2>
        </div>
        <p className="kh-ops-card-body m-0 px-3 pt-3 text-[13px] text-ink-muted">
          {t('pricesHint')}
        </p>
        {aiSystems.length === 0 ? (
          <p className="kh-ops-empty">{t('pricesEmpty')}</p>
        ) : (
          <div className="kh-ops-table-wrap">
            <table className="kh-ops-data-table">
              <thead>
                <tr>
                  <th>{t('system')}</th>
                  <th className="kh-ops-num">{t('rateBlended')}</th>
                  <th className="kh-ops-num">{t('rateInput')}</th>
                  <th className="kh-ops-num">{t('rateOutput')}</th>
                  <th className="kh-ops-num">{t('rateCache')}</th>
                  <th className="kh-ops-num">{t('rateCacheWrite')}</th>
                  {canMutate ? <th>{t('actions')}</th> : null}
                </tr>
              </thead>
              <tbody>
                {aiSystems.map((system) => (
                  <tr key={system.id}>
                    <td>
                      <Link
                        href={`/workspaces/${workspaceSlug}/systems/${system.slug}`}
                        className="kh-text-link"
                      >
                        {system.name}
                      </Link>
                    </td>
                    {(
                      [
                        ['aiTokenRatePer1k', system.aiTokenRatePer1k],
                        ['aiTokenRateInputPer1k', system.aiTokenRateInputPer1k],
                        ['aiTokenRateOutputPer1k', system.aiTokenRateOutputPer1k],
                        ['aiTokenRateCachePer1k', system.aiTokenRateCachePer1k],
                        ['aiTokenRateCacheWritePer1k', system.aiTokenRateCacheWritePer1k],
                      ] as const
                    ).map(([field, current]) => (
                      <td key={field} className="kh-ops-num">
                        {canMutate ? (
                          <Input
                            type="number"
                            min="0"
                            step="0.0001"
                            className="ml-auto w-28"
                            value={rateValue(system, field, current)}
                            disabled={pending}
                            aria-label={`${system.name} ${t(fieldLabel(field))}`}
                            onChange={(event) => setRate(system.id, field, event.target.value)}
                          />
                        ) : (
                          rateText(current) || '—'
                        )}
                      </td>
                    ))}
                    {canMutate ? (
                      <td>
                        <Button
                          type="button"
                          variant="secondary"
                          disabled={pending}
                          onClick={() => void saveRates(system)}
                        >
                          {t('saveRates')}
                        </Button>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Modal
        open={draft != null}
        onClose={() => setDraft(null)}
        title={draft?.id ? t('editEntry') : t('addEntry')}
        description={t('entryHint')}
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => setDraft(null)}>
              {tCommon('cancel')}
            </Button>
            <Button
              type="button"
              disabled={
                pending ||
                !draft?.servicePeriodStart ||
                !draft.servicePeriodEnd ||
                rangeInvalid ||
                !providerName(draft) ||
                draft.amount.trim() === ''
              }
              onClick={() => void saveEntry()}
            >
              {pending ? tCommon('saving') : t('save')}
            </Button>
          </>
        }
      >
        {draft ? (
          <div className="kh-ops-form-grid">
            {error ? <div className="kh-ops-field-span"><ErrorText>{error}</ErrorText></div> : null}
            <Field label={t('serviceStart')}>
              <Input
                type="date"
                value={draft.servicePeriodStart}
                disabled={pending}
                onChange={(event) =>
                  setDraft({ ...draft, servicePeriodStart: event.target.value })
                }
              />
            </Field>
            <Field label={t('serviceEnd')}>
              <Input
                type="date"
                value={draft.servicePeriodEnd}
                min={draft.servicePeriodStart || undefined}
                disabled={pending}
                onChange={(event) =>
                  setDraft({ ...draft, servicePeriodEnd: event.target.value })
                }
              />
            </Field>
            {rangeInvalid ? (
              <div className="kh-ops-field-span">
                <ErrorText>{t('serviceRangeInvalid')}</ErrorText>
              </div>
            ) : null}
            {splitPreview.length > 0 ? (
              <div className="kh-ops-field-span">
                <p className="m-0 text-[13px] text-ink-muted">{t('splitPreview')}</p>
                <ul className="m-0 mt-1 list-none p-0 text-[13px]">
                  {splitPreview.map((slice) => (
                    <li key={slice.period}>
                      {slice.period}
                      {' · '}
                      {formatMoney(slice.amount, draft.currency, locale)}
                      {' · '}
                      {t('splitDays', { days: slice.days })}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <Field label={t('typeLabel')}>
              <Select
                value={draft.type}
                disabled={pending}
                onChange={(event) =>
                  setDraft({ ...draft, type: event.target.value as BillingType })
                }
              >
                <option value="subscription">{t('type.subscription')}</option>
                <option value="plan_change">{t('type.plan_change')}</option>
                <option value="on_demand">{t('type.on_demand')}</option>
              </Select>
            </Field>
            <Field label={t('provider')}>
              <Select
                value={draft.providerChoice}
                disabled={pending}
                onChange={(event) =>
                  setDraft({ ...draft, providerChoice: event.target.value })
                }
              >
                {AI_COST_PROVIDERS.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
                <option value={OTHER_PROVIDER}>{t('providerOther')}</option>
              </Select>
            </Field>
            {draft.providerChoice === OTHER_PROVIDER ? (
              <Field label={t('providerCustom')}>
                <Input
                  value={draft.providerCustom}
                  disabled={pending}
                  onChange={(event) =>
                    setDraft({ ...draft, providerCustom: event.target.value })
                  }
                />
              </Field>
            ) : null}
            <Field label={t('system')}>
              <Select
                value={draft.aiSystemId}
                disabled={pending}
                onChange={(event) => setDraft({ ...draft, aiSystemId: event.target.value })}
              >
                <option value="">{t('workspacePool')}</option>
                {aiSystems.map((system) => (
                  <option key={system.id} value={system.id}>
                    {system.name}
                  </option>
                ))}
              </Select>
              {draft.aiSystemId === '' ? (
                <span className="mt-1 block text-[13px] font-normal normal-case tracking-normal text-ink-muted">
                  {t('workspacePoolHelp')}
                </span>
              ) : null}
            </Field>
            <Field label={t('plan')}>
              <Input
                value={draft.plan}
                disabled={pending}
                placeholder={t('planPlaceholder')}
                onChange={(event) => setDraft({ ...draft, plan: event.target.value })}
              />
            </Field>
            <Field label={t('amount')}>
              <Input
                type="number"
                step="0.01"
                value={draft.amount}
                disabled={pending}
                onChange={(event) => setDraft({ ...draft, amount: event.target.value })}
              />
            </Field>
            <Field label={t('currency')}>
              <Select
                value={draft.currency}
                disabled={pending}
                onChange={(event) =>
                  setDraft({ ...draft, currency: event.target.value as ProjectCurrency })
                }
              >
                {CURRENCIES.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('paidAt')}>
              <Input
                type="datetime-local"
                value={draft.paidAt}
                disabled={pending}
                onChange={(event) => setDraft({ ...draft, paidAt: event.target.value })}
              />
            </Field>
            <Field label={t('externalRef')} className="kh-ops-field-span">
              <Input
                value={draft.externalRef}
                disabled={pending}
                onChange={(event) => setDraft({ ...draft, externalRef: event.target.value })}
              />
            </Field>
            <Field label={t('note')} className="kh-ops-field-span">
              <Input
                value={draft.note}
                disabled={pending}
                onChange={(event) => setDraft({ ...draft, note: event.target.value })}
              />
            </Field>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

function fieldLabel(
  field:
    | 'aiTokenRatePer1k'
    | 'aiTokenRateInputPer1k'
    | 'aiTokenRateOutputPer1k'
    | 'aiTokenRateCachePer1k'
    | 'aiTokenRateCacheWritePer1k',
): 'rateBlended' | 'rateInput' | 'rateOutput' | 'rateCache' | 'rateCacheWrite' {
  switch (field) {
    case 'aiTokenRatePer1k':
      return 'rateBlended';
    case 'aiTokenRateInputPer1k':
      return 'rateInput';
    case 'aiTokenRateOutputPer1k':
      return 'rateOutput';
    case 'aiTokenRateCachePer1k':
      return 'rateCache';
    case 'aiTokenRateCacheWritePer1k':
      return 'rateCacheWrite';
  }
}
