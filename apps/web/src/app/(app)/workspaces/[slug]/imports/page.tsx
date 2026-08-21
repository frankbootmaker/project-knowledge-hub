import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ImportTypePickerButton } from '../../../../../components/ImportTypePickerButton';
import { OpsCountStrip } from '../../../../../components/ops/OpsCountStrip';
import {
  Badge,
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
      <p className="mt-0 mb-3">
        <Link
          href={`/workspaces/${workspace.slug}`}
          className="text-xs text-ink-muted no-underline hover:text-ink"
        >
          {t('backToWorkspace')}
        </Link>
      </p>
      <OpsCountStrip
        items={[
          { label: t('countTotal'), value: imports.length },
          {
            label: t('countActive'),
            value: imports.filter((item) => !item.archivedAt).length,
          },
          {
            label: t('countArchived'),
            value: imports.filter((item) => item.archivedAt).length,
          },
        ]}
      />
      <section className="kh-ops-panel">
        {imports.length === 0 ? (
          <p className="kh-ops-empty">{t('empty')}</p>
        ) : (
          <div className="kh-ops-table-wrap">
            <table className="kh-ops-data-table">
              <thead>
                <tr>
                  <th>{t('title')}</th>
                  <th>{t('colFormat')}</th>
                  <th>{t('colStatus')}</th>
                  <th>{t('colUpdated')}</th>
                </tr>
              </thead>
              <tbody>
                {imports.map((item) => (
                  <tr key={item.id}>
                    <td className="kh-ops-primary-cell">
                      <Link
                        href={`/workspaces/${workspace.slug}/imports/${item.id}`}
                        className="no-underline"
                      >
                        {item.title}
                      </Link>
                    </td>
                    <td>
                      <span className="kh-ops-type-chip">{item.contentFormat}</span>
                    </td>
                    <td>
                      {item.archivedAt ? (
                        <Badge>{t('archivedBadge')}</Badge>
                      ) : (
                        <Badge tone="success">{t('countActive')}</Badge>
                      )}
                    </td>
                    <td>
                      {new Date(item.createdAt).toLocaleString()}
                      {item.generatedByModel
                        ? ` · ${t('modelLabel', { model: item.generatedByModel })}`
                        : ''}
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
