import { getTranslations } from 'next-intl/server';
import { Page, PageHeader } from '../../../components/ui';
import {
  WorkspacesList,
  type WorkspaceListItem,
} from '../../../components/WorkspacesList';
import { apiFetch, requireSession } from '../../../lib/session';

export default async function WorkspacesPage() {
  const session = await requireSession();
  const t = await getTranslations('workspaces');
  const response = await apiFetch('/api/v1/workspaces?includeArchived=true');
  const payload = response.ok
    ? ((await response.json()) as { workspaces: WorkspaceListItem[] })
    : { workspaces: [] };

  return (
    <Page>
      <PageHeader title={t('title')} />
      <WorkspacesList
        workspaces={payload.workspaces}
        canCreate={session.user.isSystemAdmin}
      />
    </Page>
  );
}
