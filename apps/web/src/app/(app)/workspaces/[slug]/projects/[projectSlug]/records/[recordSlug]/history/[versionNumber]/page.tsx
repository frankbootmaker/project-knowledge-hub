import { KnowledgeRecordVersionView } from '../../../../../../../../../../components/knowledge-record/KnowledgeRecordVersionView';

export default async function ProjectKnowledgeRecordVersionPage({
  params,
}: {
  params: Promise<{
    slug: string;
    projectSlug: string;
    recordSlug: string;
    versionNumber: string;
  }>;
}) {
  const { slug, projectSlug, recordSlug, versionNumber } = await params;
  return (
    <KnowledgeRecordVersionView
      workspaceSlug={slug}
      recordSlug={recordSlug}
      versionNumber={versionNumber}
      projectContext={{ projectSlug }}
    />
  );
}
