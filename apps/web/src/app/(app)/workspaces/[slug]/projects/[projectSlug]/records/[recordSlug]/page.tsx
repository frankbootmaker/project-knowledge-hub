import { KnowledgeRecordDetailView } from '../../../../../../../../components/knowledge-record/KnowledgeRecordDetailView';

export default async function ProjectKnowledgeRecordPage({
  params,
}: {
  params: Promise<{ slug: string; projectSlug: string; recordSlug: string }>;
}) {
  const { slug, projectSlug, recordSlug } = await params;
  return (
    <KnowledgeRecordDetailView
      workspaceSlug={slug}
      recordSlug={recordSlug}
      projectContext={{ projectSlug }}
    />
  );
}
