import { getTranslations } from 'next-intl/server';
import {
  AiConnectionsPanel,
  type MyApiClient,
} from '../../../../components/AiConnectionsPanel';
import { PageHeader } from '../../../../components/ui';
import { apiFetch, requireSession } from '../../../../lib/session';

export default async function AiConnectionsPage() {
  await requireSession();
  const t = await getTranslations('aiConnections');

  const [clientsRes, workspacesRes] = await Promise.all([
    apiFetch('/api/v1/me/api-clients'),
    apiFetch('/api/v1/workspaces'),
  ]);

  const clients = clientsRes.ok
    ? ((await clientsRes.json()) as { apiClients: MyApiClient[] }).apiClients
    : [];
  const workspaces = workspacesRes.ok
    ? ((await workspacesRes.json()) as {
        workspaces: Array<{ id: string; name: string; slug: string }>;
      }).workspaces
    : [];

  return (
    <div>
      <PageHeader title={t('title')} description={t('subtitle')} />
      <AiConnectionsPanel initialClients={clients} workspaces={workspaces} />
    </div>
  );
}
