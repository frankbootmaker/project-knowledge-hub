import type { ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';
import { NavLink, Panel } from '../../../components/ui';
import { requireSession } from '../../../lib/session';

const links = [
  { href: '/account/profile', key: 'profile' as const, exact: true },
  { href: '/account/identity', key: 'identity' as const, exact: true },
  { href: '/account/password', key: 'password' as const, exact: true },
  { href: '/account/ai-connections', key: 'aiConnections' as const },
];

export default async function AccountLayout({ children }: { children: ReactNode }) {
  await requireSession();
  const t = await getTranslations('account');

  // Same responsive sidebar pattern as admin (DESIGN_SYSTEM.md → Responsive).
  return (
    <div className="grid gap-8 lg:grid-cols-[220px_1fr]">
      <Panel variant="default" className="h-fit p-3">
        <p className="mb-3 px-2 text-xs font-semibold tracking-[0.12em] text-ink-muted uppercase">
          {t('title')}
        </p>
        <nav className="grid gap-1" aria-label={t('title')}>
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

        <div className="mt-4 border-t border-line pt-4">
          <p className="mb-2 px-2 text-xs font-semibold tracking-[0.12em] text-danger uppercase">
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
      </Panel>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
