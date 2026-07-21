'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { PurgeEntityButton } from './PurgeEntityButton';
import {
  ManageDetailRow,
  ManageMenuItem,
} from './manage-menu-shared';
import { Button, ErrorText, Modal, Panel } from './ui';

export type ImportManageDetails = {
  id: string;
  title: string;
  contentFormat: string;
  sourceProvider: string | null;
  generatedByModel: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt?: string;
  linkedRecordCount: number;
};

type Section = 'menu' | 'details' | 'archive' | 'delete';

export function ConversationImportManageMenu(props: {
  workspaceSlug: string;
  conversationImport: ImportManageDetails;
  canMutate: boolean;
  canPurge: boolean;
}) {
  const t = useTranslations('imports');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<Section>('menu');
  const [archiving, setArchiving] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);

  const archived = Boolean(props.conversationImport.archivedAt);
  const redirectParent = `/workspaces/${props.workspaceSlug}/imports`;

  function close() {
    setOpen(false);
    setSection('menu');
    setArchiveError(null);
  }

  function sectionTitle(): string {
    if (section === 'menu') return t('manageTitle');
    if (section === 'details') return t('manageDetails');
    if (section === 'delete') return t('manageDelete');
    return t('manageArchive');
  }

  async function archiveImport() {
    setArchiving(true);
    setArchiveError(null);
    try {
      const response = await fetch(
        `/api/v1/conversation-imports/${props.conversationImport.id}/archive`,
        {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            Origin: window.location.origin,
          },
        },
      );
      if (!response.ok) {
        const payload = (await response.json()) as { error?: { message?: string } };
        throw new Error(payload.error?.message ?? t('failedArchive'));
      }
      router.refresh();
      setSection('menu');
    } catch (err) {
      setArchiveError(err instanceof Error ? err.message : t('failedArchive'));
    } finally {
      setArchiving(false);
    }
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
            {props.canMutate && !archived ? (
              <ManageMenuItem
                title={t('manageArchive')}
                hint={t('manageArchiveHint')}
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
              <ManageDetailRow
                label={t('detailsId')}
                value={props.conversationImport.id}
                mono
              />
              <ManageDetailRow
                label={t('contentFormat')}
                value={props.conversationImport.contentFormat}
              />
              <ManageDetailRow
                label={t('sourceProvider')}
                value={props.conversationImport.sourceProvider || tCommon('none')}
              />
              <ManageDetailRow
                label={t('generatedByModel')}
                value={props.conversationImport.generatedByModel || tCommon('none')}
              />
              <ManageDetailRow
                label={t('linkedDraftCount')}
                value={String(props.conversationImport.linkedRecordCount)}
              />
              <ManageDetailRow
                label={t('detailsCreated')}
                value={new Date(props.conversationImport.createdAt).toLocaleString()}
              />
              <ManageDetailRow
                label={tCommon('status')}
                value={archived ? t('archivedBadge') : t('statusActive')}
              />
            </dl>
            <Button type="button" variant="secondary" onClick={() => setSection('menu')}>
              {tCommon('back')}
            </Button>
          </div>
        ) : null}

        {section === 'archive' ? (
          <div className="grid gap-4">
            <p className="m-0 text-sm text-ink-muted">{t('manageArchiveHint')}</p>
            <Panel variant="inset" className="grid w-full max-w-md gap-3">
              <p className="m-0 text-sm text-danger">
                {t('confirmArchive', { name: props.conversationImport.title })}
              </p>
              {archiveError ? <ErrorText>{archiveError}</ErrorText> : null}
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="danger"
                  disabled={archiving}
                  onClick={() => void archiveImport()}
                >
                  {archiving ? t('archiving') : t('archiveButton')}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={archiving}
                  onClick={() => {
                    setArchiveError(null);
                    setSection('menu');
                  }}
                >
                  {tCommon('cancel')}
                </Button>
              </div>
            </Panel>
            <Button type="button" variant="secondary" onClick={() => setSection('menu')}>
              {tCommon('back')}
            </Button>
          </div>
        ) : null}

        {section === 'delete' ? (
          <div className="grid gap-4">
            <p className="m-0 text-sm text-ink-muted">{t('manageDeleteHint')}</p>
            <PurgeEntityButton
              kind="import"
              entityId={props.conversationImport.id}
              entityName={props.conversationImport.title}
              redirectOnPurge={redirectParent}
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
