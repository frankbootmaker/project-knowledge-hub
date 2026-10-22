import Link from 'next/link';

/** Workspace Financials. Model rates sits beside Usage import. */
export const FINANCIALS_TABS = ['ai-cost', 'usage-import', 'model-rates'] as const;

export type FinancialsTab = (typeof FINANCIALS_TABS)[number];

export function parseFinancialsTab(value: string | string[] | undefined): FinancialsTab {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw && (FINANCIALS_TABS as readonly string[]).includes(raw)) {
    return raw as FinancialsTab;
  }
  return 'ai-cost';
}

export function financialsTabHref(workspaceSlug: string, tab: FinancialsTab): string {
  if (tab === 'ai-cost') return `/workspaces/${workspaceSlug}/financials`;
  return `/workspaces/${workspaceSlug}/financials?tab=${tab}`;
}

export function FinancialsTabs({
  workspaceSlug,
  active,
  label,
  labels,
}: {
  workspaceSlug: string;
  active: FinancialsTab;
  label: string;
  labels: Record<FinancialsTab, string>;
}) {
  return (
    <nav className="kh-ops-page-tabs" role="tablist" aria-label={label}>
      {FINANCIALS_TABS.map((tab) => {
        const selected = tab === active;
        return (
          <Link
            key={tab}
            href={financialsTabHref(workspaceSlug, tab)}
            role="tab"
            aria-selected={selected}
            className={selected ? 'active' : undefined}
          >
            {labels[tab]}
          </Link>
        );
      })}
    </nav>
  );
}
