import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { AdminOverviewHealth } from '../../../components/admin/AdminOverviewHealth';
import type { MonitoringPayload } from '../../../components/admin/monitoring-types';
import { PageHeader } from '../../../components/ui';
import { apiFetch } from '../../../lib/session';

export default async function AdminOverviewPage() {
  const t = await getTranslations('admin');

  const [usersRes, clientsRes, workspacesRes, orgsRes, monitoringRes] = await Promise.all([
    apiFetch('/api/v1/users'),
    apiFetch('/api/v1/api-clients'),
    apiFetch('/api/v1/workspaces'),
    apiFetch('/api/v1/organizations'),
    apiFetch('/api/v1/admin/monitoring?range=24h'),
  ]);

  const userCount = usersRes.ok
    ? ((await usersRes.json()) as { users: unknown[] }).users.length
    : 0;
  const clientCount = clientsRes.ok
    ? ((await clientsRes.json()) as { apiClients: unknown[] }).apiClients.length
    : 0;
  const workspaceCount = workspacesRes.ok
    ? ((await workspacesRes.json()) as { workspaces: unknown[] }).workspaces.length
    : 0;
  const organizationCount = orgsRes.ok
    ? ((await orgsRes.json()) as { organizations: unknown[] }).organizations.length
    : 0;
  const monitoring = monitoringRes.ok
    ? ((await monitoringRes.json()) as MonitoringPayload)
    : null;

  const cards = [
    { href: '/admin/identity', label: t('organizationsCard'), count: organizationCount },
    { href: '/admin/identity?tab=users', label: t('usersCard'), count: userCount },
    { href: '/admin/mcp-setup?tab=clients', label: t('clientsCard'), count: clientCount },
    { href: '/workspaces', label: t('workspacesCard'), count: workspaceCount },
  ];

  return (
    <div>
      <PageHeader
        eyebrow={t('eyebrow')}
        title={t('title')}
        description={t('overviewBlurb')}
      />
      <AdminOverviewHealth monitoring={monitoring} />
      <div className="kh-ops-health-grid" data-cols="4">
        {cards.map((card) => (
          <Link key={card.href} href={card.href} className="kh-ops-health-card">
            <small>{card.label}</small>
            <strong>{card.count}</strong>
          </Link>
        ))}
      </div>
    </div>
  );
}

