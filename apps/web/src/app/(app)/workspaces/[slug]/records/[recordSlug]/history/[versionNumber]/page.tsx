import { KnowledgeRecordVersionView } from '../../../../../../../../components/knowledge-record/KnowledgeRecordVersionView';

export default async function KnowledgeVersionDetailPage({
  params,
}: {
  params: Promise<{ slug: string; recordSlug: string; versionNumber: string }>;
}) {
  const { slug, recordSlug, versionNumber } = await params;
  return (
    <KnowledgeRecordVersionView
      workspaceSlug={slug}
      recordSlug={recordSlug}
      versionNumber={versionNumber}
    />
  );
}
