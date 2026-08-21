import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { DashboardInsightWidgets } from '../../../components/DashboardInsightWidgets';
import { DashboardMyTasks } from '../../../components/DashboardMyTasks';
import { OpsCountStrip } from '../../../components/ops/OpsCountStrip';
import {
  Badge,
  LinkButton,
  Page,
  PageHeader,
} from '../../../components/ui';
import { loadDashboardData } from '../../../lib/dashboard';
import { requireSession } from '../../../lib/session';
import { workspaceTileClassName } from '../../../lib/workspace-colors';
import { cn } from '../../../lib/cn';

function roleLabel(
  role: string | null,
  t: Awaited<ReturnType<typeof getTranslations>>,
) {
  if (role === 'workspace_admin') return t('roleWorkspaceAdmin');
  if (role === 'maintainer') return t('roleMaintainer');
  if (role === 'reader') return t('roleReader');
  if (role === 'system_admin') return t('roleSystemAdmin');
  return null;
}

function kindLabel(
  kind: 'project' | 'system' | 'record',
  t: Awaited<ReturnType<typeof getTranslations>>,
) {
  if (kind === 'project') return t('kindProject');
  if (kind === 'system') return t('kindSystem');
  return t('kindRecord');
}

export default async function DashboardPage() {
  const session = await requireSession();
  const t = await getTranslations('dashboard');
  const data = await loadDashboardData(session);
  const searchHref = data.primaryWorkspaceId
    ? `/search?workspaceId=${encodeURIComponent(data.primaryWorkspaceId)}`
    : '/search';
  const hiddenWorkspaceCount = Math.max(
    0,
    data.workspaceTotal - data.workspaces.length,
  );
  const openTasks = data.myTasks.filter(
    (task) => task.status !== 'done' && task.status !== 'cancelled',
  );
  const blockedCount = data.myTasks.filter((task) => task.status === 'blocked').length;
  const dueSoon = data.insights.tasksByDue.dueSoon;
  const overdue = data.insights.tasksByDue.overdue;
  const queueTone = overdue > 0 ? 'danger' : dueSoon > 0 ? 'warn' : 'success';

  return (
    <Page wide>
      <PageHeader
        eyebrow={t('eyebrow', { name: session.user.displayName })}
        title={t('title')}
        description={
          <>
            {t('subtitle')}{' '}
            {t('signedInAs', { email: session.user.email })}
            {session.user.isSystemAdmin ? ` ${t('systemAdmin')}` : ''}.
          </>
        }
        actions={
          <Badge tone={queueTone}>
            {t('dueThisWeekBadge', { count: dueSoon })}
          </Badge>
        }
      />

      <OpsCountStrip
        items={[
          { label: t('countAssigned'), value: openTasks.length },
          { label: t('countDueThisWeek'), value: dueSoon },
          { label: t('countBlocked'), value: blockedCount },
          { label: t('countOverdue'), value: overdue },
          { label: t('countOpenRaid'), value: data.insights.openRaid.total },
        ]}
      />

      <DashboardMyTasks tasks={data.myTasks} />

      <DashboardInsightWidgets
        insights={data.insights}
        prefs={data.displayPrefs.dashboardWidgets}
      />

      <section className="kh-ops-panel">
        <div className="kh-ops-panel-head">
          <h2 className="kh-ops-panel-title">{t('myWorkspaces')}</h2>
          <div className="flex flex-wrap items-center gap-2">
            {data.workspaceTotal > 0 ? (
              <Link href="/workspaces" className="kh-text-link text-xs">
                {t('viewAllWorkspaces')}
              </Link>
            ) : null}
            {session.user.isSystemAdmin ? (
              <LinkButton href="/workspaces/new">{t('createWorkspace')}</LinkButton>
            ) : null}
          </div>
        </div>
        {data.workspaces.length === 0 ? (
          <div className="px-4 py-4">
            <p className="m-0 text-xs text-ink-muted">{t('emptyWorkspaces')}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <LinkButton href="/workspaces" variant="secondary">
                {t('browseWorkspaces')}
              </LinkButton>
            </div>
          </div>
        ) : (
          <div className="grid gap-0 sm:grid-cols-2 lg:grid-cols-3">
            {data.workspaces.map((workspace, index) => {
              const role = roleLabel(workspace.role, t);
              return (
                <Link
                  key={workspace.id}
                  href={`/workspaces/${workspace.slug}`}
                  className={cn(
                    'block border-line p-3.5 no-underline transition hover:bg-brand-soft/30',
                    index % 3 !== 2 && 'lg:border-r',
                    index % 2 !== 1 && 'sm:border-r lg:border-r-0',
                    index < data.workspaces.length - (data.workspaces.length % 3 || 3)
                      ? 'border-b'
                      : '',
                    workspaceTileClassName(workspace.color, workspace.id),
                  )}
                >
                  <p className="m-0 text-sm font-semibold text-ink">{workspace.name}</p>
                  {role ? (
                    <p className="mt-1 mb-0 text-[11px] text-ink-muted">{role}</p>
                  ) : null}
                  <p className="mt-2 mb-0 text-[11px] text-ink-muted">
                    {t('workspaceCounts', {
                      projects: workspace.projectCount,
                      systems: workspace.systemCount,
                      records: workspace.recordCount,
                    })}
                  </p>
                </Link>
              );
            })}
          </div>
        )}
        {hiddenWorkspaceCount > 0 ? (
          <p className="m-0 border-t border-line px-3.5 py-2 text-[11px] text-ink-muted">
            {t('moreWorkspaces', { count: hiddenWorkspaceCount })}
          </p>
        ) : null}
      </section>

      <section className="mb-3 grid gap-0 border border-line bg-panel-solid sm:grid-cols-2">
        <Link
          href={searchHref}
          className="block border-line p-3.5 no-underline transition hover:bg-brand-soft/30 sm:border-r"
        >
          <p className="m-0 text-sm font-semibold text-ink">{t('searchTitle')}</p>
          <p className="mt-1 mb-0 text-[11px] text-ink-muted">{t('searchBlurb')}</p>
        </Link>
        {session.user.isSystemAdmin ? (
          <Link
            href="/admin"
            className="block p-3.5 no-underline transition hover:bg-brand-soft/30"
          >
            <p className="m-0 text-sm font-semibold text-ink">{t('adminTitle')}</p>
            <p className="mt-1 mb-0 text-[11px] text-ink-muted">{t('adminBlurb')}</p>
          </Link>
        ) : (
          <Link
            href="/workspaces"
            className="block p-3.5 no-underline transition hover:bg-brand-soft/30"
          >
            <p className="m-0 text-sm font-semibold text-ink">
              {t('browseWorkspaces')}
            </p>
            <p className="mt-1 mb-0 text-[11px] text-ink-muted">{t('browseBlurb')}</p>
          </Link>
        )}
      </section>

      <section className="kh-ops-panel">
        <div className="kh-ops-panel-head">
          <h2 className="kh-ops-panel-title">{t('recentTitle')}</h2>
        </div>
        {data.recent.length === 0 ? (
          <p className="kh-ops-empty">{t('recentEmpty')}</p>
        ) : (
          <div className="kh-ops-table-wrap">
            <table className="kh-ops-data-table">
              <thead>
                <tr>
                  <th>{t('colWorkItem')}</th>
                  <th>{t('colKind')}</th>
                  <th>{t('colWorkspace')}</th>
                  <th>{t('colUpdated')}</th>
                </tr>
              </thead>
              <tbody>
                {data.recent.map((item) => (
                  <tr key={`${item.kind}-${item.id}`}>
                    <td className="kh-ops-primary-cell">
                      <Link href={item.href} className="no-underline">
                        {item.title}
                      </Link>
                    </td>
                    <td>
                      <span className="kh-ops-type-chip">{kindLabel(item.kind, t)}</span>
                    </td>
                    <td>{item.workspaceName}</td>
                    <td>
                      <time dateTime={item.updatedAt}>
                        {new Date(item.updatedAt).toLocaleString()}
                      </time>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </Page>
  );
}
