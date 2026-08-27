import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { DashboardInsightWidgets } from '../../../components/DashboardInsightWidgets';
import { DashboardMyTasks } from '../../../components/DashboardMyTasks';
import { DashboardRecentList } from '../../../components/DashboardRecentList';
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

      {session.memberships.length === 0 && !session.user.isSystemAdmin ? (
        <section className="kh-ops-panel" aria-live="polite">
          <h2 className="kh-ops-panel-title">{t('waitingWorkspaceTitle')}</h2>
          <p className="kh-ops-empty m-0">{t('waitingWorkspaceBody')}</p>
        </section>
      ) : null}

      <OpsCountStrip
        items={[
          { label: t('countAssigned'), value: openTasks.length },
          { label: t('countDueThisWeek'), value: dueSoon },
          { label: t('countBlocked'), value: blockedCount },
          { label: t('countOverdue'), value: overdue },
          { label: t('countOpenRaid'), value: data.insights.openRaid.total },
        ]}
      />

      <DashboardInsightWidgets
        insights={data.insights}
        prefs={data.displayPrefs.dashboardWidgets}
      />

      <DashboardMyTasks tasks={data.myTasks} />

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
          <div>
            <p className="kh-ops-empty">{t('emptyWorkspaces')}</p>
            <div className="kh-ops-action-line">
              <LinkButton href="/workspaces" variant="secondary">
                {t('browseWorkspaces')}
              </LinkButton>
            </div>
          </div>
        ) : (
          <div className="kh-ops-project-grid">
            {data.workspaces.map((workspace) => {
              const role = roleLabel(workspace.role, t);
              return (
                <article
                  key={workspace.id}
                  className={`kh-ops-project-card ${workspaceTileClassName(
                    workspace.color,
                    workspace.id,
                  )}`}
                >
                  {role ? (
                    <span className="kh-ops-type-chip">{role}</span>
                  ) : null}
                  <h3>
                    <Link href={`/workspaces/${workspace.slug}`}>
                      {workspace.name}
                    </Link>
                  </h3>
                  <p>
                    {t('workspaceCounts', {
                      projects: workspace.projectCount,
                      systems: workspace.systemCount,
                      records: workspace.recordCount,
                    })}
                  </p>
                </article>
              );
            })}
          </div>
        )}
        {hiddenWorkspaceCount > 0 ? (
          <p className="kh-ops-card-foot m-0">{t('moreWorkspaces', { count: hiddenWorkspaceCount })}</p>
        ) : null}
      </section>

      <section className="kh-ops-admin-link-grid mb-3">
        <Link href={searchHref} className="kh-ops-admin-link-card">
          <div>
            <strong>{t('searchTitle')}</strong>
            <small>{t('searchBlurb')}</small>
          </div>
        </Link>
        {session.user.isSystemAdmin ? (
          <Link href="/admin" className="kh-ops-admin-link-card">
            <div>
              <strong>{t('adminTitle')}</strong>
              <small>{t('adminBlurb')}</small>
            </div>
          </Link>
        ) : (
          <Link href="/workspaces" className="kh-ops-admin-link-card">
            <div>
              <strong>{t('browseWorkspaces')}</strong>
              <small>{t('browseBlurb')}</small>
            </div>
          </Link>
        )}
      </section>

      <DashboardRecentList items={data.recent} />
    </Page>
  );
}
