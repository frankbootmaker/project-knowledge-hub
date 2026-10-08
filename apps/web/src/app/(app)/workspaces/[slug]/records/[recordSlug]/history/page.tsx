import { KnowledgeRecordHistoryView } from '../../../../../../../components/knowledge-record/KnowledgeRecordHistoryView';

export default async function KnowledgeRecordHistoryPage({
  params,
}: {
  params: Promise<{ slug: string; recordSlug: string }>;
}) {
  const { slug, recordSlug } = await params;
  return <KnowledgeRecordHistoryView workspaceSlug={slug} recordSlug={recordSlug} />;
}
