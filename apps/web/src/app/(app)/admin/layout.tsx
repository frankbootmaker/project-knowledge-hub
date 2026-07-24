import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';
import { AdminNav } from '../../../components/admin/AdminNav';
import { Panel } from '../../../components/ui';
import { requireSession } from '../../../lib/session';

const MONITORING_HREF = '/admin/monitoring';

const links = [
  // Home
  { href: '/admin', key: 'overview' as const, exact: true },
  // Tenancy & access
  { href: '/admin/organizations', key: 'organizations' as const },
  { href: '/admin/users', key: 'users' as const },
  { href: '/admin/memberships', key: 'memberships' as const },
  // Integrations & platform config
  { href: '/admin/api-clients', key: 'apiClients' as const },
  { href: '/admin/mcp-setup', key: 'mcpSetup' as const },
  { href: '/admin/email', key: 'email' as const },
  { href: '/admin/storage', key: 'storage' as const },
  // Data lifecycle
  { href: '/admin/archive', key: 'archive' as const },
  // Operations
  { href: MONITORING_HREF, key: 'monitoring' as const },
  { href: '/admin/audit', key: 'audit' as const },
];

const monitoringSectionKeys = [
  { hash: 'health', key: 'monitoringNavHealth' as const },
  { hash: 'usage', key: 'monitoringNavUsage' as const },
  { hash: 'maintenance', key: 'monitoringNavMaintenance' as const },
  { hash: 'backups', key: 'monitoringNavBackups' as const },
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
        <AdminNav
          ariaLabel={t('title')}
          monitoringHref={MONITORING_HREF}
          links={links.map((link) => ({
            href: link.href,
            label: t(link.key),
            exact: link.exact,
          }))}
          monitoringSections={monitoringSectionKeys.map((section) => ({
            hash: section.hash,
            label: t(section.key),
          }))}
        />
      </Panel>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
