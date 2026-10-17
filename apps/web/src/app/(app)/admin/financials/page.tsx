import { getTranslations } from 'next-intl/server';
import {
  PlatformFinancialsTabs,
  parsePlatformFinancialsTab,
} from '../../../../components/admin/PlatformFinancialsTabs';
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
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value) ? value : '';
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
  if (filters.workspaceId) params.set('workspaceId', filters.workspaceId);
  if (filters.provider) params.set('provider', filters.provider);
  if (filters.type) params.set('type', filters.type);
  if (filters.period) params.set('period', filters.period);
  const suffix = params.size > 0 ? `?${params.toString()}` : '';
  const response = await apiFetch(`/api/v1/admin/ai-cost${suffix}`);
  const report = response.ok ? ((await response.json()) as PlatformAiCostReport) : null;
  const error = response.ok
    ? null
    : (((await response.json().catch(() => null)) as { error?: { message?: string } } | null)?.error
        ?.message ?? t('saveFailed'));

  return (
    <div>
      <PageHeader eyebrow={tAdmin('eyebrow')} title={t('title')} description={t('platformBlurb')} />
      <PlatformFinancialsTabs
        active={tab}
        label={t('tabsLabel')}
        labels={{ 'ai-cost': t('tabAiCost') }}
      />
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
