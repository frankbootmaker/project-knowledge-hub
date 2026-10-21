'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { projectCurrencySchema, type ProjectCurrency } from '@project-knowledge-hub/domain';
import { Button, DateField, ErrorText, Field, Input, Select, useToast } from '../ui';

type PriceRow = {
  id: string;
  workspaceId: string | null;
  model: string;
  inputPerMillion: number;
  cacheWritePerMillion: number;
  cacheReadPerMillion: number;
  outputPerMillion: number;
  currency: string;
  effectiveFrom: string;
  source: 'default' | 'workspace';
};

const CURRENCIES = projectCurrencySchema.options;

export function ModelPriceAdmin({ workspaceId }: { workspaceId: string }) {
  const t = useTranslations('financials');
  const { pushToast } = useToast();
  const [prices, setPrices] = useState<PriceRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [model, setModel] = useState('');
  const [inputRate, setInputRate] = useState('0');
  const [cacheWrite, setCacheWrite] = useState('0');
  const [cacheRead, setCacheRead] = useState('0');
  const [output, setOutput] = useState('0');
  const [currency, setCurrency] = useState<ProjectCurrency>('USD');
  const [effectiveFrom, setEffectiveFrom] = useState('2026-01-01');

  async function load() {
    const response = await fetch(`/api/v1/workspaces/${workspaceId}/ai-model-prices`, {
      credentials: 'include',
    });
    if (!response.ok) return;
    const payload = (await response.json()) as { prices: PriceRow[] };
    setPrices(payload.prices);
  }

  useEffect(() => {
    void load();
  }, [workspaceId]);

  async function save() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/workspaces/${workspaceId}/ai-model-prices`, {
        method: 'PUT',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Origin: window.location.origin,
        },
        body: JSON.stringify({
          model,
          inputPerMillion: Number(inputRate),
          cacheWritePerMillion: Number(cacheWrite),
          cacheReadPerMillion: Number(cacheRead),
          outputPerMillion: Number(output),
          currency,
          effectiveFrom,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      if (!response.ok) throw new Error(payload.error?.message || t('priceSaveFailed'));
      pushToast(t('priceSaved'), 'success');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('priceSaveFailed'));
    } finally {
      setPending(false);
    }
  }

  async function remove(id: string) {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/v1/workspaces/${workspaceId}/ai-model-prices/${id}`,
        {
          method: 'DELETE',
          credentials: 'include',
          headers: { Origin: window.location.origin },
        },
      );
      if (!response.ok) throw new Error(t('priceSaveFailed'));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('priceSaveFailed'));
    } finally {
      setPending(false);
    }
  }

  async function reprice() {
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

  return (
    <section className="kh-ops-panel">
      <div className="kh-ops-panel-head">
        <h2 className="kh-ops-panel-title">{t('modelPriceTitle')}</h2>
      </div>
      <div className="flex flex-col gap-3 p-4">
        <p className="m-0 text-sm text-ink-muted">{t('modelPriceHint')}</p>
        {error ? <ErrorText>{error}</ErrorText> : null}
        <div className="kh-ops-table-wrap">
          <table className="kh-ops-data-table">
            <thead>
              <tr>
                <th>{t('modelPattern')}</th>
                <th className="kh-ops-num">{t('priceInput')}</th>
                <th className="kh-ops-num">{t('priceCacheWrite')}</th>
                <th className="kh-ops-num">{t('priceCacheRead')}</th>
                <th className="kh-ops-num">{t('priceOutput')}</th>
                <th>{t('currency')}</th>
                <th>{t('priceEffective')}</th>
                <th>{t('priceSource')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {prices.map((row) => (
                <tr key={row.id}>
                  <td>{row.model}</td>
                  <td className="kh-ops-num">{row.inputPerMillion}</td>
                  <td className="kh-ops-num">{row.cacheWritePerMillion}</td>
                  <td className="kh-ops-num">{row.cacheReadPerMillion}</td>
                  <td className="kh-ops-num">{row.outputPerMillion}</td>
                  <td>{row.currency}</td>
                  <td>{row.effectiveFrom}</td>
                  <td>
                    {row.source === 'workspace' ? t('priceSourceWorkspace') : t('priceSourceDefault')}
                  </td>
                  <td>
                    {row.source === 'workspace' ? (
                      <Button
                        type="button"
                        variant="ghost"
                        disabled={pending}
                        onClick={() => void remove(row.id)}
                      >
                        {t('priceDelete')}
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="kh-ops-form-grid">
          <Field label={t('modelPattern')}>
            <Input value={model} onChange={(event) => setModel(event.target.value)} />
          </Field>
          <Field label={t('priceInput')}>
            <Input
              type="number"
              min="0"
              step="0.000001"
              value={inputRate}
              onChange={(event) => setInputRate(event.target.value)}
            />
          </Field>
          <Field label={t('priceCacheWrite')}>
            <Input
              type="number"
              min="0"
              step="0.000001"
              value={cacheWrite}
              onChange={(event) => setCacheWrite(event.target.value)}
            />
          </Field>
          <Field label={t('priceCacheRead')}>
            <Input
              type="number"
              min="0"
              step="0.000001"
              value={cacheRead}
              onChange={(event) => setCacheRead(event.target.value)}
            />
          </Field>
          <Field label={t('priceOutput')}>
            <Input
              type="number"
              min="0"
              step="0.000001"
              value={output}
              onChange={(event) => setOutput(event.target.value)}
            />
          </Field>
          <Field label={t('currency')}>
            <Select
              value={currency}
              onChange={(event) => setCurrency(event.target.value as ProjectCurrency)}
            >
              {CURRENCIES.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('priceEffective')}>
            <DateField value={effectiveFrom} onChange={setEffectiveFrom} />
          </Field>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={pending || model.trim().length === 0} onClick={() => void save()}>
            {t('priceSave')}
          </Button>
          <Button type="button" variant="secondary" disabled={pending} onClick={() => void reprice()}>
            {t('priceReprice')}
          </Button>
        </div>
      </div>
    </section>
  );
}
