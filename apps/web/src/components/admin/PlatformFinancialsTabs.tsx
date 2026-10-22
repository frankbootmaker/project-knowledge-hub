import Link from 'next/link';

/** Platform Financials. Model rates edits the global price list. */
export const PLATFORM_FINANCIALS_TABS = ['ai-cost', 'model-rates'] as const;

export type PlatformFinancialsTab = (typeof PLATFORM_FINANCIALS_TABS)[number];

export function parsePlatformFinancialsTab(
  value: string | string[] | undefined,
): PlatformFinancialsTab {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw && (PLATFORM_FINANCIALS_TABS as readonly string[]).includes(raw)) {
    return raw as PlatformFinancialsTab;
  }
  return 'ai-cost';
}

export function platformFinancialsTabHref(tab: PlatformFinancialsTab): string {
  if (tab === 'ai-cost') return '/admin/financials';
  return `/admin/financials?tab=${tab}`;
}

export function PlatformFinancialsTabs({
  active,
  label,
  labels,
}: {
  active: PlatformFinancialsTab;
  label: string;
  labels: Record<PlatformFinancialsTab, string>;
}) {
  return (
    <nav className="kh-ops-page-tabs" role="tablist" aria-label={label}>
      {PLATFORM_FINANCIALS_TABS.map((tab) => {
        const selected = tab === active;
        return (
          <Link
            key={tab}
            href={platformFinancialsTabHref(tab)}
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
