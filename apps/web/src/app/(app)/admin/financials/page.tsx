import { getTranslations } from 'next-intl/server';
import {
  PlatformFinancialsTabs,
  parsePlatformFinancialsTab,
} from '../../../../components/admin/PlatformFinancialsTabs';
import { ModelRatesAdmin } from '../../../../components/financials/ModelRatesAdmin';
import {
  PlatformAiCost,
  type PlatformAiCostReport,
} from '../../../../components/financials/PlatformAiCost';
import { ErrorText, PageHeader } from '../../../../components/ui';
import { apiFetch } from '../../../../lib/session';

function first(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw?.trim() ?? '';
}

function periodOrEmpty(value: string): string {
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return value;
  if (/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(value)) return value;
  return '';
}

function safeZone(value: string): string {
  return /^[A-Za-z0-9_+/-]{1,80}$/.test(value) ? value : '';
}

export default async function AdminFinancialsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await getTranslations('financials');
  const tAdmin = await getTranslations('admin');
  const query = await searchParams;
  const tab = parsePlatformFinancialsTab(query.tab);
  const range = first(query.range);
  const grain = first(query.grain);
  const timeZone = safeZone(first(query.tz));
  const filters = {
    from: periodOrEmpty(first(query.from)),
    to: periodOrEmpty(first(query.to)),
    workspaceId: first(query.workspaceId),
    provider: first(query.provider),
    type: first(query.type),
    period: periodOrEmpty(first(query.period)),
  };
  const params = new URLSearchParams();
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  if (
    range === 'last12' ||
    range === 'year' ||
    range === 'quarter' ||
    range === 'month' ||
    range === 'all'
  ) {
    params.set('range', range);
  }
  if (grain === 'month' || grain === 'week' || grain === 'day') params.set('grain', grain);
  if (timeZone) params.set('timeZone', timeZone);
  if (filters.workspaceId) params.set('workspaceId', filters.workspaceId);
  if (filters.provider) params.set('provider', filters.provider);
  if (filters.type) params.set('type', filters.type);
  if (filters.period) params.set('period', filters.period);
  const suffix = params.size > 0 ? `?${params.toString()}` : '';
  const response = tab === 'ai-cost'
    ? await apiFetch(`/api/v1/admin/ai-cost${suffix}`)
    : null;
  const report = response?.ok ? ((await response.json()) as PlatformAiCostReport) : null;
  const error = response == null || response.ok
    ? null
    : (((await response.json().catch(() => null)) as { error?: { message?: string } } | null)?.error
        ?.message ?? t('saveFailed'));

  return (
    <div>
      <PageHeader eyebrow={tAdmin('eyebrow')} title={t('title')} description={t('platformBlurb')} />
      <PlatformFinancialsTabs
        active={tab}
        label={t('tabsLabel')}
        labels={{
          'ai-cost': t('tabAiCost'),
          'model-rates': t('tabModelRates'),
        }}
      />
      {tab === 'model-rates' ? <ModelRatesAdmin scope="global" canEdit /> : null}
      {tab === 'ai-cost' && report ? (
        <PlatformAiCost
          report={report}
          filters={{
            workspaceId: filters.workspaceId,
            provider: filters.provider,
            type: filters.type,
            period: filters.period,
          }}
        />
      ) : null}
      {tab === 'ai-cost' && !report ? <ErrorText>{error}</ErrorText> : null}
    </div>
  );
}
