import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';
import { NavLink, Panel } from '../../../components/ui';
import { requireSession } from '../../../lib/session';

const links = [
  { href: '/admin', key: 'overview' as const, exact: true },
  { href: '/admin/organizations', key: 'organizations' as const },
  { href: '/admin/mcp-setup', key: 'mcpSetup' as const },
  { href: '/admin/email', key: 'email' as const },
  { href: '/admin/api-clients', key: 'apiClients' as const },
  { href: '/admin/users', key: 'users' as const },
  { href: '/admin/memberships', key: 'memberships' as const },
  { href: '/admin/archive', key: 'archive' as const },
  { href: '/admin/audit', key: 'audit' as const },
  { href: '/status', key: 'status' as const },
];

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await requireSession();
  if (!session.user.isSystemAdmin) {
    redirect('/dashboard');
  }

  const t = await getTranslations('admin');

  // Responsive: sidebar stacks above content below `lg` (DESIGN_SYSTEM.md → Responsive).
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
      </Panel>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
