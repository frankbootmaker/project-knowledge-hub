import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import {
  LinkButton,
  Page,
  PageHeader,
  Panel,
  SectionHeader,
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

  return (
    <Page wide>
      <PageHeader
        title={t('title')}
        description={
          <>
            {t('welcome', { name: session.user.displayName })}{' '}
            {t('signedInAs', { email: session.user.email })}
            {session.user.isSystemAdmin ? ` ${t('systemAdmin')}` : ''}.
          </>
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <LinkButton href="/workspaces" variant="secondary">
              {t('browseWorkspaces')}
            </LinkButton>
            {session.user.isSystemAdmin ? (
              <LinkButton href="/workspaces/new">{t('createWorkspace')}</LinkButton>
            ) : null}
          </div>
        }
      />

      <section className="mb-8">
        <SectionHeader
          title={t('myWorkspaces')}
          action={
            data.workspaceTotal > 0 ? (
              <Link href="/workspaces" className="kh-text-link">
                {t('viewAllWorkspaces')}
              </Link>
            ) : null
          }
        />
        {data.workspaces.length === 0 ? (
          <Panel>
            <p className="m-0 text-sm text-ink-muted">{t('emptyWorkspaces')}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <LinkButton href="/workspaces" variant="secondary">
                {t('browseWorkspaces')}
              </LinkButton>
              {session.user.isSystemAdmin ? (
                <LinkButton href="/workspaces/new">{t('createWorkspace')}</LinkButton>
              ) : null}
            </div>
          </Panel>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {data.workspaces.map((workspace) => {
                const role = roleLabel(workspace.role, t);
                return (
                  <Link
                    key={workspace.id}
                    href={`/workspaces/${workspace.slug}`}
                    className={cn(
                      'kh-panel block no-underline transition hover:border-brand/35',
                      workspaceTileClassName(workspace.color, workspace.id),
                    )}
                  >
                    <p className="m-0 text-base font-semibold text-ink">
                      {workspace.name}
                    </p>
                    {role ? (
                      <p className="mt-1 mb-0 text-sm text-ink-muted">{role}</p>
                    ) : null}
                    <p className="mt-3 mb-0 text-xs text-ink-muted">
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
            {hiddenWorkspaceCount > 0 ? (
              <p className="mt-3 mb-0 text-sm text-ink-muted">
                {t('moreWorkspaces', { count: hiddenWorkspaceCount })}
              </p>
            ) : null}
          </>
        )}
      </section>

      <section className="mb-8 grid gap-4 sm:grid-cols-2">
        <Link
          href={searchHref}
          className="kh-panel block no-underline transition hover:border-brand/35 hover:bg-brand-soft/40"
        >
          <p className="m-0 text-base font-semibold text-ink">{t('searchTitle')}</p>
          <p className="mt-1 mb-0 text-sm text-ink-muted">{t('searchBlurb')}</p>
        </Link>
        {session.user.isSystemAdmin ? (
          <Link
            href="/admin"
            className="kh-panel block no-underline transition hover:border-brand/35 hover:bg-brand-soft/40"
          >
            <p className="m-0 text-base font-semibold text-ink">{t('adminTitle')}</p>
            <p className="mt-1 mb-0 text-sm text-ink-muted">{t('adminBlurb')}</p>
          </Link>
        ) : (
          <Link
            href="/workspaces"
            className="kh-panel block no-underline transition hover:border-brand/35 hover:bg-brand-soft/40"
          >
            <p className="m-0 text-base font-semibold text-ink">
              {t('browseWorkspaces')}
            </p>
            <p className="mt-1 mb-0 text-sm text-ink-muted">{t('browseBlurb')}</p>
          </Link>
        )}
      </section>

      <section>
        <SectionHeader title={t('recentTitle')} />
        {data.recent.length === 0 ? (
          <p className="m-0 text-sm text-ink-muted">{t('recentEmpty')}</p>
        ) : (
          <ul className="m-0 grid list-none gap-2 p-0">
            {data.recent.map((item) => (
              <li key={`${item.kind}-${item.id}`}>
                <Link
                  href={item.href}
                  className="flex flex-wrap items-baseline justify-between gap-2 rounded-md border border-line bg-panel-solid px-4 py-3 no-underline transition hover:border-brand/35 hover:bg-brand-soft/40"
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-ink">
                      {item.title}
                    </span>
                    <span className="mt-0.5 block text-xs text-ink-muted">
                      {kindLabel(item.kind, t)} · {item.workspaceName}
                    </span>
                  </span>
                  <time
                    className="shrink-0 text-xs text-ink-muted"
                    dateTime={item.updatedAt}
                  >
                    {new Date(item.updatedAt).toLocaleString()}
                  </time>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </Page>
  );
}
