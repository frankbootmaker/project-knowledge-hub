import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { PageHeader } from '../../../../components/ui';
import { apiFetch, requireSession } from '../../../../lib/session';

type WorkspaceRow = {
  id: string;
  name: string;
  slug: string;
  archivedAt: string | null;
};

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
        <p className="kh-ops-status-row mb-4">{t('membershipsSystemAdminNote')}</p>
      ) : null}

      {rows.length === 0 ? (
        <p className="kh-ops-empty">{t('membershipsEmpty')}</p>
      ) : (
        <section className="kh-ops-panel">
          <div className="kh-ops-table-wrap">
            <table className="kh-ops-data-table">
              <thead>
                <tr>
                  <th>{tAdmin('colWorkspace')}</th>
                  <th>{tAdmin('colRole')}</th>
                  <th>{tAdmin('colStatus')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td className="kh-ops-primary-cell">
                      <Link
                        href={`/workspaces/${row.slug}`}
                        className="no-underline"
                      >
                        {row.name}
                      </Link>
                    </td>
                    <td>
                      <span className="kh-ops-type-chip">{roleLabel(row.role)}</span>
                    </td>
                    <td>
                      {row.archivedAt ? (
                        <span className="kh-ops-type-chip">
                          {t('membershipsArchived')}
                        </span>
                      ) : (
                        t('membershipsActive')
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <p className="mt-4 mb-0 text-sm text-ink-muted">{t('membershipsHelp')}</p>
    </div>
  );
}
