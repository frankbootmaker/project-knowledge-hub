import { getTranslations } from 'next-intl/server';
import {
  AiConnectionsPanel,
  type MyApiClient,
} from '../../../../components/AiConnectionsPanel';
import type { OauthGrantRow } from '../../../../components/admin/OauthGrantsList';
import { PageHeader } from '../../../../components/ui';
import { apiFetch, requireSession } from '../../../../lib/session';

export default async function AiConnectionsPage() {
  await requireSession();
  const t = await getTranslations('aiConnections');

  const [clientsRes, workspacesRes, grantsRes, preflightRes] = await Promise.all([
    apiFetch('/api/v1/me/api-clients'),
    apiFetch('/api/v1/workspaces'),
    apiFetch('/api/v1/me/oauth/grants'),
    apiFetch('/api/v1/me/mcp/setup/preflight'),
  ]);

  const clients = clientsRes.ok
    ? ((await clientsRes.json()) as { apiClients: MyApiClient[] }).apiClients
    : [];
  const workspaces = workspacesRes.ok
    ? ((await workspacesRes.json()) as {
        workspaces: Array<{ id: string; name: string; slug: string }>;
      }).workspaces
    : [];
  const grants = grantsRes.ok
    ? ((await grantsRes.json()) as { grants: OauthGrantRow[] }).grants
    : [];
  const preflight = preflightRes.ok
    ? ((await preflightRes.json()) as {
        oauthResourceUrl?: string;
        oauthEnabled?: boolean;
      })
    : null;

  return (
    <div>
      <PageHeader title={t('title')} description={t('subtitle')} />
      <AiConnectionsPanel
        initialClients={clients}
        workspaces={workspaces}
        grants={grants}
        oauthResourceUrl={preflight?.oauthResourceUrl ?? ''}
        oauthEnabled={preflight?.oauthEnabled === true}
      />
    </div>
  );
}
