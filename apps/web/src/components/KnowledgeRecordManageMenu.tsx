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
  recordType: string;
  lifecycleStatus: string;
  sourceOfTruthMode: string;
  currentVersionNumber: number;
  createdAt?: string;
  updatedAt: string;
  archivedAt: string | null;
  tags: Array<{ name: string }>;
};

type Section = 'menu' | 'details' | 'archive' | 'delete';

export function KnowledgeRecordManageMenu(props: {
  workspaceSlug: string;
  record: RecordManageDetails;
  canMutate: boolean;
  canPurge: boolean;
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
              <ManageMenuLink
                href={editHref}
                title={t('manageEdit')}
                hint={t('manageEditHint')}
                onClick={close}
              />
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
                label={tCommon('tags')}
                value={
                  props.record.tags.length > 0
                    ? props.record.tags.map((tag) => tag.name).join(', ')
                    : tCommon('none')
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
