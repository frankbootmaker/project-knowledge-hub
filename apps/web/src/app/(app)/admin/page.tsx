import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { PageHeader, Panel } from '../../../components/ui';
import { apiFetch } from '../../../lib/session';

export default async function AdminOverviewPage() {
  const t = await getTranslations('admin');

  const [usersRes, clientsRes, workspacesRes] = await Promise.all([
    apiFetch('/api/v1/users'),
    apiFetch('/api/v1/api-clients'),
    apiFetch('/api/v1/workspaces'),
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

  const cards = [
    { href: '/admin/users', label: t('usersCard'), count: userCount },
    { href: '/admin/api-clients', label: t('clientsCard'), count: clientCount },
    { href: '/workspaces', label: t('workspacesCard'), count: workspaceCount },
  ];

  return (
    <div>
      <PageHeader title={t('title')} description={t('overviewBlurb')} />
      <div className="grid gap-4 sm:grid-cols-3">
        {cards.map((card) => (
          <Panel key={card.href} className="flex flex-col gap-3">
            <div>
              <p className="m-0 text-sm text-ink-muted">{card.label}</p>
              <p className="mt-1 mb-0 text-3xl font-semibold tracking-tight">{card.count}</p>
            </div>
            <Link
              href={card.href}
              className="text-sm font-medium text-brand no-underline hover:text-brand-hover"
            >
              {t('open')}
            </Link>
          </Panel>
        ))}
      </div>
    </div>
  );
}
