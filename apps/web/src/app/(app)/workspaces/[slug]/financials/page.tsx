import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { AiCostAdmin } from '../../../../../components/financials/AiCostAdmin';
import type {
  AiBillingEntryRow,
  AiCostChartPoint,
  AiCostPool,
  AiSystemPrice,
} from '../../../../../components/financials/AiCostAdmin';
import {
  FinancialsTabs,
  parseFinancialsTab,
} from '../../../../../components/financials/FinancialsTabs';
import { UsageImportAdmin } from '../../../../../components/financials/UsageImportAdmin';
import type {
  UnassignedUsageGroup,
  UsageImportRow,
} from '../../../../../components/financials/UsageImportAdmin';
import { RegisterShellCrumbs } from '../../../../../components/ops/ShellCrumbContext';
import { Page, PageHeader } from '../../../../../components/ui';
import {
  canAdminWorkspace,
  canMutateWorkspace,
} from '../../../../../lib/project-record-access';
import { apiFetch, requireSession } from '../../../../../lib/session';

type Workspace = {
  id: string;
  slug: string;
  name: string;
  reportingCurrency?: string;
};

function first(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw?.trim() ?? '';
}

function periodOrEmpty(value: string): string {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value) ? value : '';
}

export default async function WorkspaceFinancialsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  const t = await getTranslations('financials');
  const { slug } = await params;
  const query = await searchParams;
  const tab = parseFinancialsTab(query.tab);
  const from = periodOrEmpty(first(query.from));
  const to = periodOrEmpty(first(query.to));
  const range = first(query.range);
  const costParams = new URLSearchParams();
  if (from) costParams.set('from', from);
  if (to) costParams.set('to', to);
  if (range === 'last12' || range === 'year' || range === 'all') {
    costParams.set('range', range);
  }
  const costSuffix = costParams.size > 0 ? `?${costParams.toString()}` : '';

  const listResponse = await apiFetch('/api/v1/workspaces');
  if (!listResponse.ok) notFound();
  const { workspaces } = (await listResponse.json()) as { workspaces: Workspace[] };
  const workspace = workspaces.find((item) => item.slug === slug);
  if (!workspace) notFound();

  const [costResponse, systemsResponse, importsResponse, unassignedResponse] =
    await Promise.all([
      tab === 'ai-cost'
        ? apiFetch(`/api/v1/workspaces/${workspace.id}/ai-cost${costSuffix}`)
        : Promise.resolve(null),
      tab === 'ai-cost'
        ? apiFetch(`/api/v1/systems?workspaceId=${workspace.id}`)
        : Promise.resolve(null),
      tab === 'usage-import'
        ? apiFetch(`/api/v1/workspaces/${workspace.id}/ai-usage-imports`)
        : Promise.resolve(null),
      tab === 'usage-import'
        ? apiFetch(`/api/v1/workspaces/${workspace.id}/ai-usage-events/unassigned`)
        : Promise.resolve(null),
    ]);
  const cost = costResponse?.ok
    ? ((await costResponse.json()) as {
        reportingCurrency?: string;
        entries: AiBillingEntryRow[];
        chart: AiCostChartPoint[];
        originalChart?: AiCostChartPoint[];
        pools: AiCostPool[];
        from?: string;
        to?: string;
        range?: 'last12' | 'year' | 'all' | 'custom';
      })
    : { entries: [], chart: [], originalChart: [], pools: [] };
  const systems = systemsResponse?.ok
    ? ((await systemsResponse.json()) as { systems: AiSystemPrice[] }).systems
    : [];
  const usageImports = importsResponse?.ok
    ? ((await importsResponse.json()) as { imports: UsageImportRow[] }).imports
    : [];
  const unassigned = unassignedResponse?.ok
    ? ((await unassignedResponse.json()) as {
        total: number;
        groups: UnassignedUsageGroup[];
      })
    : { total: 0, groups: [] };

  return (
    <Page wide>
      <RegisterShellCrumbs pageTitle={t('title')} />
      <PageHeader
        eyebrow={workspace.name}
        title={t('title')}
        description={t('blurb')}
      />
      <FinancialsTabs
        workspaceSlug={workspace.slug}
        active={tab}
        label={t('tabsLabel')}
        labels={{
          'ai-cost': t('tabAiCost'),
          'usage-import': t('tabUsageImport'),
        }}
      />
      {tab === 'usage-import' ? (
        <UsageImportAdmin
          workspaceId={workspace.id}
          canImport={canAdminWorkspace(session, workspace.id)}
          imports={usageImports}
          unassignedTotal={unassigned.total}
          unassigned={unassigned.groups}
        />
      ) : (
        <AiCostAdmin
          workspaceId={workspace.id}
          workspaceSlug={workspace.slug}
          canMutate={canMutateWorkspace(session, workspace.id)}
          canAdmin={canAdminWorkspace(session, workspace.id)}
          reportingCurrency={cost.reportingCurrency ?? workspace.reportingCurrency ?? 'EUR'}
          entries={cost.entries}
          chart={cost.chart}
          originalChart={cost.originalChart ?? []}
          pools={cost.pools}
          systems={systems}
          from={cost.from}
          to={cost.to}
          range={cost.range}
        />
      )}
    </Page>
  );
}
