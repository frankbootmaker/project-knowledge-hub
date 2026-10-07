import { KnowledgeRecordHistoryView } from '../../../../../../../../../components/knowledge-record/KnowledgeRecordHistoryView';

export default async function ProjectKnowledgeRecordHistoryPage({
  params,
}: {
  params: Promise<{ slug: string; projectSlug: string; recordSlug: string }>;
}) {
  const { slug, projectSlug, recordSlug } = await params;
  return (
    <KnowledgeRecordHistoryView
      workspaceSlug={slug}
      recordSlug={recordSlug}
      projectContext={{ projectSlug }}
    />
  );
}
