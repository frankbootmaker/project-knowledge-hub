import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ImportTypePickerButton } from '../../../../../components/ImportTypePickerButton';
import {
  Badge,
  ListCard,
  Page,
  PageHeader,
} from '../../../../../components/ui';
import { apiFetch, requireSession } from '../../../../../lib/session';

type Workspace = { id: string; name: string; slug: string };

type ConversationImportSummary = {
  id: string;
  title: string;
  contentFormat: string;
  createdAt: string;
  archivedAt: string | null;
  generatedByModel: string | null;
};

export default async function WorkspaceImportsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const session = await requireSession();
  const t = await getTranslations('imports');
  const { slug } = await params;

  const listResponse = await apiFetch('/api/v1/workspaces');
  if (!listResponse.ok) notFound();
  const { workspaces } = (await listResponse.json()) as { workspaces: Workspace[] };
  const summary = workspaces.find((workspace) => workspace.slug === slug);
  if (!summary) notFound();

  const detailResponse = await apiFetch(`/api/v1/workspaces/${summary.id}`);
  if (!detailResponse.ok) notFound();
  const { workspace } = (await detailResponse.json()) as { workspace: Workspace };

  const importsResponse = await apiFetch(
    `/api/v1/conversation-imports?workspaceId=${workspace.id}`,
  );
  const imports = importsResponse.ok
    ? (
        (await importsResponse.json()) as {
          conversationImports: ConversationImportSummary[];
        }
      ).conversationImports
    : [];

  const canMutate =
    session.user.isSystemAdmin ||
    session.memberships.some(
      (membership) =>
        membership.workspaceId === workspace.id &&
        (membership.role === 'workspace_admin' || membership.role === 'maintainer'),
    );

  return (
    <Page wide>
      <PageHeader
        title={t('title')}
        description={t('subtitle', { workspace: workspace.name })}
        actions={
          canMutate ? (
            <ImportTypePickerButton workspaceSlug={workspace.slug} />
          ) : null
        }
      />
      <p className="mt-0 mb-6">
        <Link
          href={`/workspaces/${workspace.slug}`}
          className="text-sm text-ink-muted no-underline hover:text-ink"
        >
          {t('backToWorkspace')}
        </Link>
      </p>
      <ul className="m-0 grid list-none gap-3 p-0">
        {imports.map((item) => (
          <ListCard key={item.id}>
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={`/workspaces/${workspace.slug}/imports/${item.id}`}
                className="font-semibold no-underline"
              >
                {item.title}
              </Link>
              <Badge tone="brand">{item.contentFormat}</Badge>
              {item.archivedAt ? <Badge>{t('archivedBadge')}</Badge> : null}
            </div>
            <p className="mt-2 mb-0 text-sm text-ink-muted">
              {new Date(item.createdAt).toLocaleString()}
              {item.generatedByModel
                ? ` · ${t('modelLabel', { model: item.generatedByModel })}`
                : ''}
            </p>
          </ListCard>
        ))}
        {imports.length === 0 ? (
          <li className="kh-muted list-none">{t('empty')}</li>
        ) : null}
      </ul>
    </Page>
  );
}
