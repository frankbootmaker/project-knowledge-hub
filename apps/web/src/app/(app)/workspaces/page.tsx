import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { LinkButton, ListCard, Page, PageHeader } from '../../../components/ui';
import { apiFetch, requireSession } from '../../../lib/session';

type Workspace = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
};

export default async function WorkspacesPage() {
  const session = await requireSession();
  const t = await getTranslations('workspaces');
  const response = await apiFetch('/api/v1/workspaces');
  const payload = response.ok
    ? ((await response.json()) as { workspaces: Workspace[] })
    : { workspaces: [] };

  return (
    <Page>
      <PageHeader
        title={t('title')}
        actions={
          session.user.isSystemAdmin ? (
            <LinkButton href="/workspaces/new">{t('new')}</LinkButton>
          ) : null
        }
      />
      <ul className="m-0 grid list-none gap-3 p-0">
        {payload.workspaces.map((workspace) => (
          <ListCard key={workspace.id}>
            <Link href={`/workspaces/${workspace.slug}`} className="text-lg font-semibold no-underline">
              {workspace.name}
            </Link>
            <div className="mt-1 text-sm text-ink-muted">{workspace.slug}</div>
            {workspace.description ? (
              <p className="mt-2 mb-0 text-ink-muted">{workspace.description}</p>
            ) : null}
          </ListCard>
        ))}
        {payload.workspaces.length === 0 ? (
          <li className="kh-muted list-none">{t('empty')}</li>
        ) : null}
      </ul>
    </Page>
  );
}
