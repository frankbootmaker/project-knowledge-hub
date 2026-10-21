import Link from 'next/link';

export const MONITORING_ADMIN_TABS = ['dashboard', 'maintenance', 'alerts'] as const;

export type MonitoringAdminTab = (typeof MONITORING_ADMIN_TABS)[number];

export function parseMonitoringAdminTab(
  value: string | string[] | undefined,
): MonitoringAdminTab {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === 'maintenance' || raw === 'alerts') return raw;
  return 'dashboard';
}

export function monitoringAdminTabHref(
  tab: MonitoringAdminTab,
  range?: string,
): string {
  const params = new URLSearchParams();
  if (range && range !== '24h') params.set('range', range);
  if (tab !== 'dashboard') params.set('tab', tab);
  const query = params.toString();
  return query ? `/admin/monitoring?${query}` : '/admin/monitoring';
}

export function MonitoringAdminTabs({
  active,
  range,
  label,
  labels,
}: {
  active: MonitoringAdminTab;
  range?: string;
  label: string;
  labels: Record<MonitoringAdminTab, string>;
}) {
  return (
    <nav className="kh-ops-page-tabs" role="tablist" aria-label={label}>
      {MONITORING_ADMIN_TABS.map((tab) => {
        const selected = tab === active;
        return (
          <Link
            key={tab}
            href={monitoringAdminTabHref(tab, range)}
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
