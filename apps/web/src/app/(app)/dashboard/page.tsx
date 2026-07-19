import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Page, PageHeader, Panel } from '../../../components/ui';
import { requireSession } from '../../../lib/session';

export default async function DashboardPage() {
  const session = await requireSession();
  const t = await getTranslations('dashboard');

  return (
    <Page>
      <PageHeader
        title={t('title')}
        description={
          <>
            {t('signedInAs', { email: session.user.email })}
            {session.user.isSystemAdmin ? ` ${t('systemAdmin')}` : ''}.
          </>
        }
      />
      <Panel>
        <h2 className="mt-0 mb-3 text-lg font-semibold">{t('getStarted')}</h2>
        <ul className="m-0 grid list-none gap-2 p-0">
          <li>
            <Link
              href="/workspaces"
              className="block rounded-md border border-line bg-panel-solid px-4 py-3 no-underline transition hover:border-brand/35 hover:bg-brand-soft"
            >
              {t('browseWorkspaces')}
            </Link>
          </li>
          {session.user.isSystemAdmin ? (
            <li>
              <Link
                href="/workspaces/new"
                className="block rounded-md border border-line bg-panel-solid px-4 py-3 no-underline transition hover:border-brand/35 hover:bg-brand-soft"
              >
                {t('createWorkspace')}
              </Link>
            </li>
          ) : null}
        </ul>
      </Panel>
    </Page>
  );
}
