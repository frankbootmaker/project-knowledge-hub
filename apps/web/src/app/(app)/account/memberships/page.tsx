import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import {
  Badge,
  ListCard,
  PageHeader,
  Panel,
} from '../../../../components/ui';
import { apiFetch, requireSession } from '../../../../lib/session';

type WorkspaceRow = {
  id: string;
  name: string;
  slug: string;
  archivedAt: string | null;
};

function roleTone(role: string): 'brand' | 'success' | 'neutral' {
  if (role === 'workspace_admin') return 'brand';
  if (role === 'maintainer') return 'success';
  return 'neutral';
}

export default async function AccountMembershipsPage() {
  const session = await requireSession();
  const t = await getTranslations('account');
  const tAdmin = await getTranslations('admin');

  function roleLabel(role: string): string {
    if (role === 'workspace_admin') return tAdmin('roleWorkspaceAdmin');
    if (role === 'maintainer') return tAdmin('roleMaintainer');
    if (role === 'reader') return tAdmin('roleReader');
    return role;
  }

  const workspacesResponse = await apiFetch(
    '/api/v1/workspaces?includeArchived=true',
  );
  if (!workspacesResponse.ok) {
    return (
      <div>
        <PageHeader
          title={t('memberships')}
          description={t('membershipsSubtitle')}
        />
        <p className="kh-muted">{t('membershipsLoadFailed')}</p>
      </div>
    );
  }

  const { workspaces } = (await workspacesResponse.json()) as {
    workspaces: WorkspaceRow[];
  };
  const roleByWorkspaceId = new Map(
    session.memberships.map((membership) => [membership.workspaceId, membership.role]),
  );

  const rows = workspaces
    .filter((workspace) => roleByWorkspaceId.has(workspace.id))
    .map((workspace) => ({
      ...workspace,
      role: roleByWorkspaceId.get(workspace.id) ?? 'reader',
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div>
      <PageHeader
        title={t('memberships')}
        description={t('membershipsSubtitle')}
      />

      {session.user.isSystemAdmin ? (
        <Panel className="mb-4">
          <p className="m-0 text-sm text-ink-muted">{t('membershipsSystemAdminNote')}</p>
        </Panel>
      ) : null}

      {rows.length === 0 ? (
        <Panel>
          <p className="m-0 text-sm text-ink-muted">{t('membershipsEmpty')}</p>
        </Panel>
      ) : (
        <ul className="m-0 grid list-none gap-3 p-0">
          {rows.map((row) => (
            <ListCard key={row.id}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <Link
                    href={`/workspaces/${row.slug}`}
                    className="font-semibold text-ink no-underline hover:text-brand"
                  >
                    {row.name}
                  </Link>
                  <p className="m-0 mt-0.5 text-sm text-ink-muted">{row.slug}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {row.archivedAt ? (
                    <Badge tone="warn">{t('membershipsArchived')}</Badge>
                  ) : null}
                  <Badge tone={roleTone(row.role)}>{roleLabel(row.role)}</Badge>
                </div>
              </div>
            </ListCard>
          ))}
        </ul>
      )}

      <p className="mt-4 mb-0 text-sm text-ink-muted">{t('membershipsHelp')}</p>
    </div>
  );
}
