import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { WorkspaceMediaLibrary } from '../../../../../components/WorkspaceMediaLibrary';
import { Page, PageHeader } from '../../../../../components/ui';
import { apiFetch, requireSession } from '../../../../../lib/session';

type Workspace = { id: string; name: string; slug: string };
type KnowledgeRecord = { id: string; title: string; slug: string };
type MediaItem = {
  id: string;
  url: string;
  markdownSnippet: string;
  altText: string | null;
  originalFilename: string | null;
  contentType: string;
  byteSize: number;
  knowledgeRecordId: string | null;
  createdAt: string;
};

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

  const [mediaResponse, recordsResponse] = await Promise.all([
    apiFetch(`/api/v1/workspaces/${workspace.id}/media?limit=100`),
    apiFetch(`/api/v1/knowledge-records?workspaceId=${workspace.id}`),
  ]);
  const media = mediaResponse.ok
    ? ((await mediaResponse.json()) as { media: MediaItem[] }).media
    : [];
  const records = recordsResponse.ok
    ? ((await recordsResponse.json()) as { knowledgeRecords: KnowledgeRecord[] })
        .knowledgeRecords
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
        workspaceSlug={workspace.slug}
        canMutate={canMutate}
        initialMedia={media}
        records={records.map((row) => ({
          id: row.id,
          title: row.title,
          slug: row.slug,
        }))}
      />
    </Page>
  );
}
