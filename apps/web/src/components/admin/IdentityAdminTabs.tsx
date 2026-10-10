import Link from 'next/link';

export const IDENTITY_ADMIN_TABS = ['organizations', 'users', 'sso'] as const;

export type IdentityAdminTab = (typeof IDENTITY_ADMIN_TABS)[number];

export function parseIdentityAdminTab(value: string | string[] | undefined): IdentityAdminTab {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === 'users' || raw === 'sso') return raw;
  return 'organizations';
}

export function identityAdminTabHref(tab: IdentityAdminTab): string {
  if (tab === 'organizations') return '/admin/identity';
  return `/admin/identity?tab=${tab}`;
}

export function IdentityAdminTabs({
  active,
  label,
  labels,
}: {
  active: IdentityAdminTab;
  label: string;
  labels: Record<IdentityAdminTab, string>;
}) {
  return (
    <nav className="kh-ops-page-tabs" role="tablist" aria-label={label}>
      {IDENTITY_ADMIN_TABS.map((tab) => {
        const selected = tab === active;
        return (
          <Link
            key={tab}
            href={identityAdminTabHref(tab)}
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
