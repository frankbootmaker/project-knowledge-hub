'use client';

import { useEffect, useState } from 'react';
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
  canMutate,
  canPurge,
  visionConfigured = false,
}: {
  workspaceSlug: string;
  workspaceId: string;
  recordBasePath?: string;
  record: RecordManageDetails;
  editorInitial: KnowledgeRecordEditorInitial;
  canMutate: boolean;
  canPurge: boolean;
  /** VISION_LLM_BASE_URL set — enables Translate with AI. */
  visionConfigured?: boolean;
}) {
  const t = useTranslations('records');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [options, setOptions] = useState<{ projects: Option[]; systems: Option[] } | null>(null);
  const gitManaged = record.sourceOfTruthMode === 'git_managed';
  const archived = Boolean(record.archivedAt);
  const canEdit = canMutate && !archived && !gitManaged;

  useEffect(() => {
    if (!editOpen) return;
    let cancelled = false;
    void Promise.all([
      fetch(`/api/v1/projects?workspaceId=${workspaceId}&view=picker`, {
        credentials: 'include',
      }),
      fetch(`/api/v1/systems?workspaceId=${workspaceId}&summary=true`, {
        credentials: 'include',
      }),
    ])
      .then(async ([projectsResponse, systemsResponse]) => {
        if (cancelled) return;
        const projectBody = projectsResponse.ok
          ? ((await projectsResponse.json()) as { projects?: Option[] })
          : null;
        const systemBody = systemsResponse.ok
          ? ((await systemsResponse.json()) as { systems?: Option[] })
          : null;
        if (cancelled) return;
        setOptions({
          projects: projectBody?.projects ?? [],
          systems: systemBody?.systems ?? [],
        });
      })
      .catch(() => {
        if (!cancelled) setOptions({ projects: [], systems: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [editOpen, workspaceId]);

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
          {options ? (
          <KnowledgeRecordEditor
            mode="edit"
            layout="modal"
            workspaceSlug={workspaceSlug}
            workspaceId={workspaceId}
            recordBasePath={recordBasePath}
            projects={options.projects}
            systems={options.systems}
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
          ) : (
            <p className="m-0 text-sm text-ink-muted">{tCommon('loading')}</p>
          )}
        </Modal>
      ) : null}
    </>
  );
}
