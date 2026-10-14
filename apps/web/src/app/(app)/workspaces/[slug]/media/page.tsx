import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import {
  WorkspaceMediaLibrary,
  type WorkspaceMediaItem,
} from '../../../../../components/WorkspaceMediaLibrary';
import { Page, PageHeader } from '../../../../../components/ui';
import { apiFetch, requireSession } from '../../../../../lib/session';

type Workspace = { id: string; name: string; slug: string };

export default async function WorkspaceMediaPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const session = await requireSession();
  const t = await getTranslations('media');
  const { slug } = await params;

  const listResponse = await apiFetch('/api/v1/workspaces');
  if (!listResponse.ok) notFound();
  const { workspaces } = (await listResponse.json()) as { workspaces: Workspace[] };
  const workspace = workspaces.find((item) => item.slug === slug);
  if (!workspace) notFound();

  const canMutate =
    session.user.isSystemAdmin ||
    session.memberships.some(
      (membership) =>
        membership.workspaceId === workspace.id &&
        (membership.role === 'workspace_admin' || membership.role === 'maintainer'),
    );

  const mediaResponse = await apiFetch(
    `/api/v1/workspaces/${workspace.id}/media?limit=100`,
  );
  const media = mediaResponse.ok
    ? ((await mediaResponse.json()) as { media: WorkspaceMediaItem[] }).media
    : [];

  return (
    <Page wide>
      <PageHeader
        eyebrow={t('eyebrow')}
        title={t('title')}
        description={t('subtitle', { workspace: workspace.name })}
      />
      <p className="mt-0 mb-3">
        <Link
          href={`/workspaces/${workspace.slug}`}
          className="text-xs text-ink-muted no-underline hover:text-ink"
        >
          {t('backToWorkspace')}
        </Link>
      </p>
      <WorkspaceMediaLibrary
        workspaceId={workspace.id}
        canMutate={canMutate}
        initialMedia={media}
      />
    </Page>
  );
}
