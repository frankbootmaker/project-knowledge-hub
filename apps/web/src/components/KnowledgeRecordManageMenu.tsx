'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { downloadAuthenticatedExport } from '../lib/download-export';
import { ArchiveEntityButton } from './ArchiveEntityButton';
import { PurgeEntityButton } from './PurgeEntityButton';
import {
  ManageDetailRow,
  ManageMenuItem,
  ManageMenuLink,
} from './manage-menu-shared';
import { Button, Modal, lifecycleLabel, useToast } from './ui';

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
  reviewedByUser?: {
    id: string;
    displayName: string;
    email: string;
  } | null;
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

type Section = 'menu' | 'details' | 'export' | 'archive' | 'delete';
type ExportFormat = 'pdf' | 'docx' | 'xlsx' | 'md';

type StylePackOption = {
  id: string;
  label: string;
  builtin: boolean;
};

export function KnowledgeRecordManageMenu(props: {
  workspaceSlug: string;
  workspaceId: string;
  record: RecordManageDetails;
  canMutate: boolean;
  canPurge: boolean;
  /** When set, Edit opens the wide editor modal instead of navigating. */
  onEdit?: () => void;
}) {
  const t = useTranslations('records');
  const tCommon = useTranslations('common');
  const tArchive = useTranslations('archive');
  const locale = useLocale();
  const { pushToast } = useToast();
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<Section>('menu');
  const [exportPending, setExportPending] = useState(false);
  const [stylePacks, setStylePacks] = useState<StylePackOption[]>([
    { id: 'blank', label: 'Blank', builtin: true },
  ]);
  const [stylePackId, setStylePackId] = useState('blank');

  const archived = Boolean(props.record.archivedAt);
  const gitManaged = props.record.sourceOfTruthMode === 'git_managed';
  const redirectParent = `/workspaces/${props.workspaceSlug}`;
  const editHref = `/workspaces/${props.workspaceSlug}/records/${props.record.slug}/edit`;
  const historyHref = `/workspaces/${props.workspaceSlug}/records/${props.record.slug}/history`;

  useEffect(() => {
    if (!open || section !== 'export') {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(
          `/api/v1/doc-factory/style-packs?workspaceId=${props.workspaceId}`,
          { credentials: 'include' },
        );
        if (!response.ok || cancelled) {
          return;
        }
        const body = (await response.json()) as {
          stylePacks: StylePackOption[];
        };
        if (!cancelled && body.stylePacks.length > 0) {
          setStylePacks(body.stylePacks);
        }
      } catch {
        // Keep Blank default when the list cannot load.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, section, props.workspaceId]);

  function close() {
    setOpen(false);
    setSection('menu');
  }

  function sectionTitle(): string {
    if (section === 'menu') return t('manageTitle');
    if (section === 'details') return t('manageDetails');
    if (section === 'export') return t('manageExport');
    if (section === 'delete') return t('manageDelete');
    return archived ? t('manageRestore') : t('manageArchive');
  }

  async function exportRecord(format: ExportFormat) {
    setExportPending(true);
    try {
      const styleQuery =
        format === 'pdf' || format === 'docx'
          ? `&stylePackId=${encodeURIComponent(stylePackId)}`
          : '';
      await downloadAuthenticatedExport(
        `/api/v1/knowledge-records/${props.record.id}/export?format=${format}&locale=${encodeURIComponent(locale)}${styleQuery}`,
        `${props.record.slug}.${format}`,
      );
      pushToast(t('exportOk', { format: format.toUpperCase() }));
      close();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : t('exportFailed');
      pushToast(message, 'danger');
    } finally {
      setExportPending(false);
    }
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
            <ManageMenuItem
              title={t('manageExport')}
              hint={t('manageExportHint')}
              onClick={() => setSection('export')}
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

        {section === 'export' ? (
          <ul className="m-0 grid list-none gap-2 p-0">
            <li className="grid gap-1 rounded-md border border-line bg-surface px-3 py-2">
              <label
                className="text-xs font-medium text-ink-muted"
                htmlFor="export-style-pack"
              >
                {t('exportStylePack')}
              </label>
              <select
                id="export-style-pack"
                className="rounded border border-line bg-canvas px-2 py-1.5 text-sm text-ink"
                value={stylePackId}
                disabled={exportPending}
                onChange={(event) => setStylePackId(event.target.value)}
              >
                {stylePacks.map((pack) => (
                  <option key={pack.id} value={pack.id}>
                    {pack.label}
                    {pack.builtin ? ` (${t('exportStylePackBlank')})` : ''}
                  </option>
                ))}
              </select>
              <p className="m-0 text-xs text-ink-muted">{t('exportStylePackHint')}</p>
            </li>
            <ManageMenuItem
              title={t('exportPdf')}
              hint={t('exportPdfHint')}
              disabled={exportPending}
              onClick={() => void exportRecord('pdf')}
            />
            <ManageMenuItem
              title={t('exportDocx')}
              hint={t('exportDocxHint')}
              disabled={exportPending}
              onClick={() => void exportRecord('docx')}
            />
            <ManageMenuItem
              title={t('exportXlsx')}
              hint={t('exportXlsxHint')}
              disabled={exportPending}
              onClick={() => void exportRecord('xlsx')}
            />
            <ManageMenuItem
              title={t('exportMarkdown')}
              hint={t('exportMarkdownHint')}
              disabled={exportPending}
              onClick={() => void exportRecord('md')}
            />
            <li>
              <Button
                type="button"
                variant="secondary"
                disabled={exportPending}
                onClick={() => setSection('menu')}
              >
                {tCommon('back')}
              </Button>
            </li>
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
                value={lifecycleLabel(props.record.lifecycleStatus, t)}
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
                value={
                  props.record.reviewedByUser
                    ? props.record.reviewedByUser.email
                      ? `${props.record.reviewedByUser.displayName} (${props.record.reviewedByUser.email})`
                      : props.record.reviewedByUser.displayName
                    : (props.record.reviewedBy ?? tCommon('emDash'))
                }
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
