'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ArchiveEntityButton } from './ArchiveEntityButton';
import { PurgeEntityButton } from './PurgeEntityButton';
import {
  ManageDetailRow,
  ManageMenuItem,
  ManageMenuLink,
} from './manage-menu-shared';
import { Button, Modal } from './ui';

export type RecordManageDetails = {
  id: string;
  title: string;
  slug: string;
  summary: string | null;
  recordType: string;
  lifecycleStatus: string;
  sourceOfTruthMode: string;
  currentVersionNumber: number;
  createdAt?: string;
  updatedAt: string;
  archivedAt: string | null;
  tags: Array<{ name: string }>;
  projectName?: string | null;
  systemName?: string | null;
  verifiedAt?: string | null;
  reviewedBy?: string | null;
  lastValidatedAt?: string | null;
  source?: {
    sourceType: string;
    sourceProvider: string | null;
    sourceReference: string | null;
    sourceTitle: string | null;
    sourceUri: string | null;
    generatedByModel: string | null;
  } | null;
};

type Section = 'menu' | 'details' | 'archive' | 'delete';

export function KnowledgeRecordManageMenu(props: {
  workspaceSlug: string;
  record: RecordManageDetails;
  canMutate: boolean;
  canPurge: boolean;
  /** When set, Edit opens the wide editor modal instead of navigating. */
  onEdit?: () => void;
}) {
  const t = useTranslations('records');
  const tCommon = useTranslations('common');
  const tArchive = useTranslations('archive');
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<Section>('menu');

  const archived = Boolean(props.record.archivedAt);
  const gitManaged = props.record.sourceOfTruthMode === 'git_managed';
  const redirectParent = `/workspaces/${props.workspaceSlug}`;
  const editHref = `/workspaces/${props.workspaceSlug}/records/${props.record.slug}/edit`;
  const historyHref = `/workspaces/${props.workspaceSlug}/records/${props.record.slug}/history`;

  function close() {
    setOpen(false);
    setSection('menu');
  }

  function sectionTitle(): string {
    if (section === 'menu') return t('manageTitle');
    if (section === 'details') return t('manageDetails');
    if (section === 'delete') return t('manageDelete');
    return archived ? t('manageRestore') : t('manageArchive');
  }

  if (!props.canMutate && !props.canPurge) {
    return null;
  }

  return (
    <>
      <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
        {t('manage')}
      </Button>

      <Modal
        open={open}
        onClose={close}
        title={sectionTitle()}
        description={section === 'menu' ? t('manageDescription') : undefined}
        size="md"
      >
        {section === 'menu' ? (
          <ul className="m-0 grid list-none gap-2 p-0">
            <ManageMenuItem
              title={t('manageDetails')}
              hint={t('manageDetailsHint')}
              onClick={() => setSection('details')}
            />
            {props.canMutate && !archived && !gitManaged ? (
              props.onEdit ? (
                <ManageMenuItem
                  title={t('manageEdit')}
                  hint={t('manageEditHint')}
                  onClick={() => {
                    close();
                    props.onEdit?.();
                  }}
                />
              ) : (
                <ManageMenuLink
                  href={editHref}
                  title={t('manageEdit')}
                  hint={t('manageEditHint')}
                  onClick={close}
                />
              )
            ) : null}
            <ManageMenuLink
              href={historyHref}
              title={t('history')}
              hint={t('manageHistoryHint')}
              onClick={close}
            />
            {props.canMutate ? (
              <ManageMenuItem
                title={archived ? t('manageRestore') : t('manageArchive')}
                hint={
                  archived ? t('manageRestoreHint') : t('manageArchiveHint')
                }
                onClick={() => setSection('archive')}
              />
            ) : null}
            {props.canPurge ? (
              <ManageMenuItem
                title={t('manageDelete')}
                hint={t('manageDeleteHint')}
                onClick={() => setSection('delete')}
              />
            ) : null}
          </ul>
        ) : null}

        {section === 'details' ? (
          <div className="grid gap-4">
            <dl className="m-0 grid gap-3">
              <ManageDetailRow label={t('detailsId')} value={props.record.id} mono />
              <ManageDetailRow label={t('detailsSlug')} value={props.record.slug} mono />
              <ManageDetailRow
                label={tCommon('summary')}
                value={props.record.summary?.trim() || tCommon('noSummary')}
              />
              <ManageDetailRow label={t('recordType')} value={props.record.recordType} />
              <ManageDetailRow
                label={t('lifecycleStatus')}
                value={props.record.lifecycleStatus}
              />
              <ManageDetailRow
                label={t('sourceOfTruth')}
                value={props.record.sourceOfTruthMode}
              />
              <ManageDetailRow
                label={tCommon('project')}
                value={props.record.projectName ?? tCommon('none')}
              />
              <ManageDetailRow
                label={tCommon('system')}
                value={props.record.systemName ?? tCommon('none')}
              />
              <ManageDetailRow
                label={tCommon('tags')}
                value={
                  props.record.tags.length > 0
                    ? props.record.tags.map((tag) => tag.name).join(', ')
                    : tCommon('none')
                }
              />
              <ManageDetailRow
                label={t('sourceType')}
                value={props.record.source?.sourceType ?? tCommon('emDash')}
              />
              <ManageDetailRow
                label={t('sourceTitle')}
                value={props.record.source?.sourceTitle ?? tCommon('emDash')}
              />
              <ManageDetailRow
                label={t('provider')}
                value={props.record.source?.sourceProvider ?? tCommon('emDash')}
              />
              <ManageDetailRow
                label={t('reference')}
                value={props.record.source?.sourceReference ?? tCommon('emDash')}
              />
              <ManageDetailRow
                label={t('uri')}
                value={props.record.source?.sourceUri ?? tCommon('emDash')}
              />
              <ManageDetailRow
                label={t('model')}
                value={props.record.source?.generatedByModel ?? tCommon('emDash')}
              />
              <ManageDetailRow
                label={t('verifiedAt')}
                value={
                  props.record.verifiedAt
                    ? new Date(props.record.verifiedAt).toLocaleString()
                    : tCommon('emDash')
                }
              />
              <ManageDetailRow
                label={t('reviewedBy')}
                value={props.record.reviewedBy ?? tCommon('emDash')}
              />
              <ManageDetailRow
                label={t('lastValidated')}
                value={
                  props.record.lastValidatedAt
                    ? new Date(props.record.lastValidatedAt).toLocaleString()
                    : tCommon('emDash')
                }
              />
              <ManageDetailRow
                label={tCommon('updated')}
                value={new Date(props.record.updatedAt).toLocaleString()}
              />
            </dl>
            <Button type="button" variant="secondary" onClick={() => setSection('menu')}>
              {tCommon('back')}
            </Button>
          </div>
        ) : null}

        {section === 'archive' ? (
          <div className="grid gap-4">
            <p className="m-0 text-sm text-ink-muted">
              {archived ? t('manageRestoreHint') : t('manageArchiveHint')}
            </p>
            <ArchiveEntityButton
              kind="record"
              entityId={props.record.id}
              entityName={props.record.title}
              archived={archived}
              redirectOnArchive={redirectParent}
            />
            <Button type="button" variant="secondary" onClick={() => setSection('menu')}>
              {tCommon('back')}
            </Button>
          </div>
        ) : null}

        {section === 'delete' ? (
          <div className="grid gap-4">
            <p className="m-0 text-sm text-ink-muted">{t('manageDeleteHint')}</p>
            <PurgeEntityButton
              kind="record"
              entityId={props.record.id}
              entityName={props.record.title}
              redirectOnPurge={redirectParent}
              extraHint={gitManaged ? tArchive('deleteHintRecordGitManaged') : null}
            />
            <Button type="button" variant="secondary" onClick={() => setSection('menu')}>
              {tCommon('back')}
            </Button>
          </div>
        ) : null}
      </Modal>
    </>
  );
}
