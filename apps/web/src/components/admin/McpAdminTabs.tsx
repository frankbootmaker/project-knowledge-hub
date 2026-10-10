import Link from 'next/link';

export const MCP_ADMIN_TABS = [
  'bearer',
  'oauth',
  'clients',
  'memberships',
  'providers',
] as const;

export type McpAdminTab = (typeof MCP_ADMIN_TABS)[number];

export function parseMcpAdminTab(value: string | string[] | undefined): McpAdminTab {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === 'oauth' || raw === 'clients' || raw === 'memberships' || raw === 'providers') {
    return raw;
  }
  return 'bearer';
}

export function mcpAdminTabHref(tab: McpAdminTab): string {
  if (tab === 'bearer') return '/admin/mcp-setup';
  return `/admin/mcp-setup?tab=${tab}`;
}

export function McpAdminTabs({
  active,
  label,
  labels,
}: {
  active: McpAdminTab;
  label: string;
  labels: Record<McpAdminTab, string>;
}) {
  return (
    <nav className="kh-ops-page-tabs" role="tablist" aria-label={label}>
      {MCP_ADMIN_TABS.map((tab) => {
        const selected = tab === active;
        return (
          <Link
            key={tab}
            href={mcpAdminTabHref(tab)}
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
