import { KnowledgeRecordDetailView } from '../../../../../../components/knowledge-record/KnowledgeRecordDetailView';

export default async function KnowledgeRecordDetailPage({
  params,
}: {
  params: Promise<{ slug: string; recordSlug: string }>;
}) {
  const { slug, recordSlug } = await params;
  return <KnowledgeRecordDetailView workspaceSlug={slug} recordSlug={recordSlug} />;
}
