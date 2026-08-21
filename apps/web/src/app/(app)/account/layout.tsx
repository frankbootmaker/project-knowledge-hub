import type { ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';
import { NavLink } from '../../../components/ui';
import { requireSession } from '../../../lib/session';

const links = [
  { href: '/account/profile', key: 'profile' as const, exact: true },
  { href: '/account/display', key: 'display' as const, exact: true },
  { href: '/account/memberships', key: 'memberships' as const, exact: true },
  { href: '/account/identity', key: 'identity' as const, exact: true },
  { href: '/account/password', key: 'password' as const, exact: true },
  { href: '/account/notifications', key: 'notifications' as const, exact: true },
  { href: '/account/ai-connections', key: 'aiConnections' as const },
];

export default async function AccountLayout({ children }: { children: ReactNode }) {
  await requireSession();
  const t = await getTranslations('account');

  // Same responsive sidebar pattern as admin (DESIGN_SYSTEM.md → Responsive).
  return (
    <div className="grid gap-8 lg:grid-cols-[200px_1fr]">
      <aside className="kh-ops-panel h-fit overflow-hidden">
        <p className="kh-ops-eyebrow mb-0 px-3 pt-3">
          {t('title')}
        </p>
        <nav className="grid gap-1 px-2 pb-2" aria-label={t('title')}>
          {links.map((link) => (
            <NavLink
              key={link.href}
              href={link.href}
              tone="sidebar"
              exact={link.exact}
            >
              {t(link.key)}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-line px-2 pt-3 pb-2">
          <p className="kh-ops-eyebrow mb-2 text-danger">
            {t('dangerZone')}
          </p>
          <nav className="grid gap-1" aria-label={t('dangerZone')}>
            <NavLink
              href="/account/close"
              tone="sidebar"
              exact
              className="text-danger hover:text-danger"
              activeClassName="kh-sidebar-link-active text-danger"
            >
              {t('closeAccount')}
            </NavLink>
          </nav>
        </div>
      </aside>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
