import { KnowledgeRecordEditView } from '../../../../../../../../../components/knowledge-record/KnowledgeRecordEditView';

export default async function ProjectKnowledgeRecordEditPage({
  params,
}: {
  params: Promise<{ slug: string; projectSlug: string; recordSlug: string }>;
}) {
  const { slug, projectSlug, recordSlug } = await params;
  return (
    <KnowledgeRecordEditView
      workspaceSlug={slug}
      recordSlug={recordSlug}
      projectContext={{ projectSlug }}
    />
  );
}
