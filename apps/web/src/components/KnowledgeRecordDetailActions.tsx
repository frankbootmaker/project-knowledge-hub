'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { KnowledgeRecordEditor, type KnowledgeRecordEditorInitial } from './KnowledgeRecordEditor';
import { KnowledgeRecordManageMenu, type RecordManageDetails } from './KnowledgeRecordManageMenu';
import { recordBaseWithSlug } from '../lib/record-href';
import { Modal } from './ui';

type Option = { id: string; name: string; slug: string };

export function KnowledgeRecordDetailActions({
  workspaceSlug,
  workspaceId,
  recordBasePath,
  record,
  editorInitial,
  projects,
  systems,
  canMutate,
  canPurge,
  visionConfigured = false,
}: {
  workspaceSlug: string;
  workspaceId: string;
  recordBasePath?: string;
  record: RecordManageDetails;
  editorInitial: KnowledgeRecordEditorInitial;
  projects: Option[];
  systems: Option[];
  canMutate: boolean;
  canPurge: boolean;
  /** VISION_LLM_BASE_URL set — enables Translate with AI. */
  visionConfigured?: boolean;
}) {
  const t = useTranslations('records');
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const gitManaged = record.sourceOfTruthMode === 'git_managed';
  const archived = Boolean(record.archivedAt);
  const canEdit = canMutate && !archived && !gitManaged;

  return (
    <>
      <KnowledgeRecordManageMenu
        workspaceSlug={workspaceSlug}
        workspaceId={workspaceId}
        recordBasePath={recordBasePath}
        record={record}
        canMutate={canMutate}
        canPurge={canPurge}
        visionConfigured={visionConfigured}
        onEdit={canEdit ? () => setEditOpen(true) : undefined}
      />

      {canEdit ? (
        <Modal
          open={editOpen}
          onClose={() => setEditOpen(false)}
          title={t('editTitle')}
          size="xl"
          closeOnBackdrop={false}
        >
          <KnowledgeRecordEditor
            mode="edit"
            layout="modal"
            workspaceSlug={workspaceSlug}
            workspaceId={workspaceId}
            recordBasePath={recordBasePath}
            projects={projects}
            systems={systems}
            initial={editorInitial}
            onCancel={() => setEditOpen(false)}
            onSaved={(slug) => {
              setEditOpen(false);
              if (slug && slug !== record.slug) {
                const base =
                  recordBasePath ?? `/workspaces/${workspaceSlug}/records/${record.slug}`;
                router.push(recordBaseWithSlug(base, slug));
              }
              router.refresh();
            }}
          />
        </Modal>
      ) : null}
    </>
  );
}
