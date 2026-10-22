'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { projectCurrencySchema, type ProjectCurrency } from '@project-knowledge-hub/domain';
import {
  Badge,
  Button,
  DateField,
  ErrorText,
  Field,
  FilePicker,
  Input,
  Select,
  useToast,
} from '../ui';

type PriceRow = {
  id: string;
  workspaceId: string | null;
  model: string;
  inputPerMillion: number;
  outputPerMillion: number;
  cacheReadPerMillion: number;
  cacheWritePerMillion: number;
  blendedPerMillion: number;
  currency: string;
  effectiveFrom: string;
  sourceNote: string | null;
  scope: 'global' | 'workspace';
  inherited: boolean;
  overridden: boolean;
  overridesGlobal: boolean;
  retired: boolean;
};

type UnpricedModel = { model: string; rowCount: number; tokensTotal?: number };

type RateKey = 'input' | 'output' | 'cacheRead' | 'cacheWrite' | 'blended';

type Draft = {
  model: string;
  input: string;
  output: string;
  cacheRead: string;
  cacheWrite: string;
  blended: string;
  currency: ProjectCurrency;
  effectiveFrom: string;
  sourceNote: string;
  inherited: Partial<Record<RateKey, number>>;
};

type ImportPlan = {
  added: Array<{ model: string }>;
  changed: Array<{ before: { model: string }; after: { model: string } }>;
  unchanged: Array<{ model: string }>;
  errors: Array<{ row: number; field: string; message: string }>;
};

const CURRENCIES = projectCurrencySchema.options;

const EMPTY_DRAFT: Draft = {
  model: '',
  input: '',
  output: '',
  cacheRead: '',
  cacheWrite: '',
  blended: '',
  currency: 'USD',
  effectiveFrom: '2026-01-01',
  sourceNote: '',
  inherited: {},
};

function emptyDraft(model = ''): Draft {
  return { ...EMPTY_DRAFT, model, inherited: {} };
}

export function ModelRatesAdmin({
  scope,
  workspaceId,
  canEdit,
}: {
  scope: 'global' | 'workspace';
  workspaceId?: string;
  canEdit: boolean;
}) {
  const t = useTranslations('financials');
  const { pushToast } = useToast();
  const [prices, setPrices] = useState<PriceRow[]>([]);
  const [unpriced, setUnpriced] = useState<UnpricedModel[]>([]);
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [importText, setImportText] = useState<string | null>(null);
  const [importFormat, setImportFormat] = useState<'csv' | 'json'>('csv');
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const base = scope === 'global'
    ? '/api/v1/admin/ai-model-prices'
    : `/api/v1/workspaces/${workspaceId}/ai-model-prices`;

  const load = useCallback(async () => {
    const response = await fetch(base, { credentials: 'include' });
    if (!response.ok) return;
    const payload = (await response.json()) as { prices: PriceRow[] };
    setPrices(payload.prices);
    if (scope === 'workspace' && workspaceId) {
      const usage = await fetch(`/api/v1/workspaces/${workspaceId}/ai-cost`, {
        credentials: 'include',
      });
      if (usage.ok) {
        const body = (await usage.json()) as { unpricedModels?: UnpricedModel[] };
        setUnpriced(body.unpricedModels ?? []);
      }
    }
  }, [base, scope, workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  function inheritedAmount(key: RateKey): number | null {
    const value = draft.inherited[key];
    return value == null ? null : value;
  }

  function rateNumber(key: RateKey, raw: string): number | undefined {
    if (raw.trim() === '') {
      const inherited = inheritedAmount(key);
      return inherited == null ? undefined : inherited;
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return undefined;
    return parsed;
  }

  function scopeLabel(row: PriceRow): string {
    if (row.retired) return t('priceRetiredBadge');
    if (scope === 'workspace' && row.inherited) return t('priceInherited');
    if (row.overridden) return t('priceOverridden');
    if (row.overridesGlobal) return t('priceOverride');
    if (row.scope === 'global') return t('priceScopeGlobal');
    return t('priceScopeWorkspace');
  }

  async function save() {
    if (draft.sourceNote.trim().length === 0) {
      setError(t('priceSourceRequired'));
      return;
    }
    const input = rateNumber('input', draft.input);
    const output = rateNumber('output', draft.output);
    const cacheRead = rateNumber('cacheRead', draft.cacheRead);
    const cacheWrite = rateNumber('cacheWrite', draft.cacheWrite);
    const blended = rateNumber('blended', draft.blended);
    if (
      input == null ||
      output == null ||
      cacheRead == null ||
      cacheWrite == null ||
      blended == null
    ) {
      setError(t('rateInvalid'));
      return;
    }
    setPending(true);
    setError(null);
    try {
      const response = await fetch(base, {
        method: 'PUT',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Origin: window.location.origin,
        },
        body: JSON.stringify({
          model: draft.model,
          inputPerMillion: input,
          outputPerMillion: output,
          cacheReadPerMillion: cacheRead,
          cacheWritePerMillion: cacheWrite,
          blendedPerMillion: blended,
          currency: draft.currency,
          effectiveFrom: draft.effectiveFrom,
          sourceNote: draft.sourceNote,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      if (!response.ok) throw new Error(payload.error?.message || t('priceSaveFailed'));
      pushToast(t('priceSaved'), 'success');
      setDraft(emptyDraft());
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('priceSaveFailed'));
    } finally {
      setPending(false);
    }
  }

  async function retire(id: string) {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(
        scope === 'global' ? `${base}/${id}/retire` : `${base}/${id}`,
        {
          method: scope === 'global' ? 'POST' : 'DELETE',
          credentials: 'include',
          headers: { Origin: window.location.origin },
        },
      );
      if (!response.ok) throw new Error(t('priceSaveFailed'));
      pushToast(t('priceRetired'), 'success');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('priceSaveFailed'));
    } finally {
      setPending(false);
    }
  }

  function currencyOf(row: PriceRow): ProjectCurrency {
    return CURRENCIES.includes(row.currency as ProjectCurrency)
      ? (row.currency as ProjectCurrency)
      : 'USD';
  }

  function startOverride(row: PriceRow) {
    setDraft({
      ...emptyDraft(row.model),
      currency: currencyOf(row),
      effectiveFrom: row.effectiveFrom,
      sourceNote: row.sourceNote ?? '',
      inherited: {
        input: row.inputPerMillion,
        output: row.outputPerMillion,
        cacheRead: row.cacheReadPerMillion,
        cacheWrite: row.cacheWritePerMillion,
        blended: row.blendedPerMillion,
      },
    });
  }

  function startEdit(row: PriceRow) {
    setDraft({
      model: row.model,
      input: String(row.inputPerMillion),
      output: String(row.outputPerMillion),
      cacheRead: String(row.cacheReadPerMillion),
      cacheWrite: String(row.cacheWritePerMillion),
      blended: String(row.blendedPerMillion),
      currency: currencyOf(row),
      effectiveFrom: row.effectiveFrom,
      sourceNote: row.sourceNote ?? '',
      inherited: {},
    });
  }

  async function previewImport() {
    if (importText == null) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`${base}/import/preview`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Origin: window.location.origin,
        },
        body: JSON.stringify({ format: importFormat, text: importText }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        plan?: ImportPlan;
        error?: { message?: string };
      };
      if (!response.ok || !payload.plan) {
        throw new Error(payload.error?.message || t('importPreviewFailed'));
      }
      setPlan(payload.plan);
    } catch (err) {
      setPlan(null);
      setError(err instanceof Error ? err.message : t('importPreviewFailed'));
    } finally {
      setPending(false);
    }
  }

  async function applyImport() {
    if (importText == null || !plan || plan.errors.length > 0) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`${base}/import`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Origin: window.location.origin,
        },
        body: JSON.stringify({ format: importFormat, text: importText }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      if (!response.ok) throw new Error(payload.error?.message || t('importApplyFailed'));
      pushToast(t('importApplied'), 'success');
      setPlan(null);
      setImportText(null);
      setFileName(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('importApplyFailed'));
    } finally {
      setPending(false);
    }
  }

  async function download(format: 'csv' | 'json') {
    const response = await fetch(`${base}/export?format=${format}`, { credentials: 'include' });
    if (!response.ok) {
      setError(t('priceSaveFailed'));
      return;
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `model-rates.${format}`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="grid gap-3">
      <section className="kh-ops-panel">
        <div className="kh-ops-panel-head">
          <h2 className="kh-ops-panel-title">{t('modelRatesTitle')}</h2>
        </div>
        <div className="flex flex-col gap-3 p-4">
          <p className="kh-ops-card-body m-0 p-0 text-[13px] text-ink-muted">{t('modelRatesHint')}</p>
          {error ? <ErrorText>{error}</ErrorText> : null}
          <div className="kh-ops-table-wrap">
            <table className="kh-ops-data-table">
              <thead>
                <tr>
                  <th>{t('modelPattern')}</th>
                  <th className="kh-ops-num">{t('priceInput')}</th>
                  <th className="kh-ops-num">{t('priceOutput')}</th>
                  <th className="kh-ops-num">{t('priceCacheRead')}</th>
                  <th className="kh-ops-num">{t('priceCacheWrite')}</th>
                  <th className="kh-ops-num">{t('priceBlended')}</th>
                  <th>{t('currency')}</th>
                  <th>{t('priceEffective')}</th>
                  <th>{t('priceScope')}</th>
                  <th>{t('priceSourceNote')}</th>
                  {canEdit ? <th /> : null}
                </tr>
              </thead>
              <tbody>
                {prices.map((row) => (
                  <tr key={row.id}>
                    <td>{row.model}</td>
                    <td className="kh-ops-num">{row.inputPerMillion}</td>
                    <td className="kh-ops-num">{row.outputPerMillion}</td>
                    <td className="kh-ops-num">{row.cacheReadPerMillion}</td>
                    <td className="kh-ops-num">{row.cacheWritePerMillion}</td>
                    <td className="kh-ops-num">{row.blendedPerMillion}</td>
                    <td>{row.currency}</td>
                    <td>{row.effectiveFrom}</td>
                    <td>
                      <Badge tone={row.retired ? 'warn' : row.overridesGlobal ? 'brand' : 'neutral'}>
                        {scopeLabel(row)}
                      </Badge>
                    </td>
                    <td>{row.sourceNote || '—'}</td>
                    {canEdit ? (
                      <td>
                        <div className="flex flex-wrap gap-2">
                          {scope === 'workspace' && row.scope === 'global' && !row.retired ? (
                            <Button type="button" variant="secondary" onClick={() => startOverride(row)}>
                              {t('priceOverride')}
                            </Button>
                          ) : null}
                          {((scope === 'workspace' && row.scope === 'workspace')
                            || (scope === 'global' && row.scope === 'global'))
                            && !row.retired ? (
                            <>
                              <Button
                                type="button"
                                variant="secondary"
                                onClick={() => startEdit(row)}
                              >
                                {t('priceEdit')}
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                disabled={pending}
                                onClick={() => void retire(row.id)}
                              >
                                {t('priceRetire')}
                              </Button>
                            </>
                          ) : null}
                        </div>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {canEdit ? (
            <>
              <div className="kh-ops-form-grid">
                <Field label={t('modelPattern')}>
                  <Input
                    value={draft.model}
                    onChange={(event) => setDraft({ ...draft, model: event.target.value })}
                  />
                </Field>
                <RateField
                  label={t('priceInput')}
                  value={draft.input}
                  inherited={inheritedAmount('input')}
                  inheritedLabel={t('inherited')}
                  onChange={(input) => setDraft({ ...draft, input })}
                />
                <RateField
                  label={t('priceOutput')}
                  value={draft.output}
                  inherited={inheritedAmount('output')}
                  inheritedLabel={t('inherited')}
                  onChange={(output) => setDraft({ ...draft, output })}
                />
                <RateField
                  label={t('priceCacheRead')}
                  value={draft.cacheRead}
                  inherited={inheritedAmount('cacheRead')}
                  inheritedLabel={t('inherited')}
                  onChange={(cacheRead) => setDraft({ ...draft, cacheRead })}
                />
                <RateField
                  label={t('priceCacheWrite')}
                  value={draft.cacheWrite}
                  inherited={inheritedAmount('cacheWrite') ?? inheritedAmount('blended')}
                  inheritedLabel={t('inherited')}
                  onChange={(cacheWrite) => setDraft({ ...draft, cacheWrite })}
                />
                <RateField
                  label={t('priceBlended')}
                  value={draft.blended}
                  inherited={inheritedAmount('blended')}
                  inheritedLabel={t('inherited')}
                  onChange={(blended) => setDraft({ ...draft, blended })}
                />
                <Field label={t('currency')}>
                  <Select
                    value={draft.currency}
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
                <Field label={t('priceEffective')}>
                  <DateField
                    value={draft.effectiveFrom}
                    onChange={(effectiveFrom) => setDraft({ ...draft, effectiveFrom })}
                  />
                </Field>
                <Field label={t('priceSourceNote')} className="kh-ops-field-span">
                  <Input
                    value={draft.sourceNote}
                    onChange={(event) => setDraft({ ...draft, sourceNote: event.target.value })}
                  />
                </Field>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  disabled={
                    pending
                    || draft.model.trim().length === 0
                    || draft.sourceNote.trim().length === 0
                  }
                  onClick={() => void save()}
                >
                  {t('priceSave')}
                </Button>
                {scope === 'workspace' && workspaceId ? (
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={pending}
                    onClick={() => void reprice(workspaceId, setError, setPending, pushToast, t)}
                  >
                    {t('priceReprice')}
                  </Button>
                ) : null}
              </div>
            </>
          ) : null}
        </div>
      </section>

      {scope === 'workspace' ? (
        <section className="kh-ops-panel">
          <div className="kh-ops-panel-head">
            <h2 className="kh-ops-panel-title">{t('unpricedTitle')}</h2>
          </div>
          {unpriced.length === 0 ? (
            <p className="kh-ops-empty">{t('unpricedEmpty')}</p>
          ) : (
            <div className="kh-ops-table-wrap">
              <table className="kh-ops-data-table">
                <thead>
                  <tr>
                    <th>{t('usageModel')}</th>
                    <th className="kh-ops-num">{t('usageRows')}</th>
                    {canEdit ? <th /> : null}
                  </tr>
                </thead>
                <tbody>
                  {unpriced.map((row) => (
                    <tr key={row.model}>
                      <td>{row.model}</td>
                      <td className="kh-ops-num">{row.rowCount}</td>
                      {canEdit ? (
                        <td>
                          <Button
                            type="button"
                            variant="secondary"
                            onClick={() => setDraft(emptyDraft(row.model))}
                          >
                            {t('priceAdd')}
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
      ) : null}

      {canEdit ? (
        <section className="kh-ops-panel">
          <div className="kh-ops-panel-head">
            <h2 className="kh-ops-panel-title">{t('importTitle')}</h2>
          </div>
          <div className="flex flex-col gap-3 p-4">
            <p className="m-0 text-[13px] text-ink-muted">{t('importHint')}</p>
            <Field label={t('importFile')}>
              <FilePicker
                accept=".csv,.json,text/csv,application/json"
                fileName={fileName}
                disabled={pending}
                onFileChange={(file, text) => {
                  setPlan(null);
                  setError(null);
                  if (!file) {
                    setFileName(null);
                    setImportText(null);
                    return;
                  }
                  setFileName(file.name);
                  setImportText(text ?? '');
                  setImportFormat(file.name.toLowerCase().endsWith('.json') ? 'json' : 'csv');
                }}
              />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="secondary"
                disabled={pending || importText == null}
                onClick={() => void previewImport()}
              >
                {t('importPreview')}
              </Button>
              <Button
                type="button"
                disabled={pending || !plan || plan.errors.length > 0 || importText == null}
                onClick={() => void applyImport()}
              >
                {t('importApply')}
              </Button>
              <Button type="button" variant="secondary" onClick={() => void download('csv')}>
                {t('importExportCsv')}
              </Button>
              <Button type="button" variant="secondary" onClick={() => void download('json')}>
                {t('importExportJson')}
              </Button>
            </div>
            {plan ? (
              <>
                <div className="kh-ops-stats">
                  <p className="kh-ops-stat m-0">
                    <span className="kh-ops-stat-label">{t('importAdded')}</span>
                    <span className="kh-ops-stat-value">{plan.added.length}</span>
                  </p>
                  <p className="kh-ops-stat m-0">
                    <span className="kh-ops-stat-label">{t('importChanged')}</span>
                    <span className="kh-ops-stat-value">{plan.changed.length}</span>
                  </p>
                  <p className="kh-ops-stat m-0">
                    <span className="kh-ops-stat-label">{t('importUnchanged')}</span>
                    <span className="kh-ops-stat-value">{plan.unchanged.length}</span>
                  </p>
                </div>
                {plan.errors.length > 0 ? (
                  <ul className="m-0 list-none p-0 text-[13px]">
                    {plan.errors.map((item) => (
                      <li key={`${item.row}-${item.field}`}>
                        <ErrorText>
                          {t('importErrorRow', {
                            row: item.row,
                            field: item.field,
                            message: item.message,
                          })}
                        </ErrorText>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="m-0 text-[13px] text-ink-muted">{t('importConfirmHint')}</p>
                )}
              </>
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function RateField({
  label,
  value,
  inherited,
  inheritedLabel,
  onChange,
}: {
  label: string;
  value: string;
  inherited: number | null;
  inheritedLabel: string;
  onChange: (value: string) => void;
}) {
  const showInherited = value.trim() === '' && inherited != null;
  const placeholder = showInherited ? `${inherited} (${inheritedLabel})` : undefined;
  return (
    <Field label={label}>
      <Input
        type="number"
        min="0"
        step="0.000001"
        className="tabular-nums"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
      {showInherited ? (
        <span className="kh-ops-menu-type mt-1 block text-ink-muted">{placeholder}</span>
      ) : null}
    </Field>
  );
}

async function reprice(
  workspaceId: string,
  setError: (value: string | null) => void,
  setPending: (value: boolean) => void,
  pushToast: (message: string, tone?: 'success' | 'danger' | 'info') => void,
  t: (key: 'priceSaveFailed' | 'priceRepriced') => string,
) {
  setPending(true);
  setError(null);
  try {
    const response = await fetch(
      `/api/v1/workspaces/${workspaceId}/ai-model-prices/reprice`,
      {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Origin: window.location.origin,
        },
        body: '{}',
      },
    );
    if (!response.ok) throw new Error(t('priceSaveFailed'));
    pushToast(t('priceRepriced'), 'success');
  } catch (err) {
    setError(err instanceof Error ? err.message : t('priceSaveFailed'));
  } finally {
    setPending(false);
  }
}
