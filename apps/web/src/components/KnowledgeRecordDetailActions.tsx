'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  KnowledgeRecordEditor,
  type KnowledgeRecordEditorInitial,
} from './KnowledgeRecordEditor';
import {
  KnowledgeRecordManageMenu,
  type RecordManageDetails,
} from './KnowledgeRecordManageMenu';
import { Modal } from './ui';

type Option = { id: string; name: string; slug: string };

export function KnowledgeRecordDetailActions({
  workspaceSlug,
  workspaceId,
  record,
  editorInitial,
  projects,
  systems,
  canMutate,
  canPurge,
}: {
  workspaceSlug: string;
  workspaceId: string;
  record: RecordManageDetails;
  editorInitial: KnowledgeRecordEditorInitial;
  projects: Option[];
  systems: Option[];
  canMutate: boolean;
  canPurge: boolean;
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
        record={record}
        canMutate={canMutate}
        canPurge={canPurge}
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
            projects={projects}
            systems={systems}
            initial={editorInitial}
            onCancel={() => setEditOpen(false)}
            onSaved={(slug) => {
              setEditOpen(false);
              if (slug && slug !== record.slug) {
                router.push(`/workspaces/${workspaceSlug}/records/${slug}`);
              }
              router.refresh();
            }}
          />
        </Modal>
      ) : null}
    </>
  );
}
