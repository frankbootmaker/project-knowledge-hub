import { KnowledgeRecordEditView } from '../../../../../../../components/knowledge-record/KnowledgeRecordEditView';

export default async function EditKnowledgeRecordPage({
  params,
}: {
  params: Promise<{ slug: string; recordSlug: string }>;
}) {
  const { slug, recordSlug } = await params;
  return <KnowledgeRecordEditView workspaceSlug={slug} recordSlug={recordSlug} />;
}
