'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { LinkedKnowledgeRecord } from './LinkedKnowledgeRecord';
import { Button, Input, Modal, Select } from './ui';

export type DeliveryDocumentRecord = {
  id: string;
  title: string;
  slug: string;
  humanKey?: string | null;
  recordType?: string | null;
};

const PAGE_SIZES = [5, 10, 25, 50] as const;
type PageSize = (typeof PAGE_SIZES)[number];

function isPageSize(value: number): value is PageSize {
  return (PAGE_SIZES as readonly number[]).includes(value);
}

export async function saveDeliveryDocumentLinks(input: {
  projectId: string;
  entityType: 'epic' | 'user_story' | 'milestone' | 'task' | 'sprint';
  entityId: string;
  recordIds: string[];
}): Promise<void> {
  const response = await fetch(
    `/api/v1/projects/${input.projectId}/delivery-document-links`,
    {
      method: 'PUT',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        Origin: window.location.origin,
      },
      body: JSON.stringify({
        entityType: input.entityType,
        entityId: input.entityId,
        recordIds: input.recordIds,
      }),
    },
  );
  const payload = (await response.json().catch(() => ({}))) as {
    error?: { message?: string };
  };
  if (!response.ok) {
    throw new Error(payload.error?.message || 'Failed to update documents');
  }
}

export function DeliveryDocumentsEditor({
  records,
  linkedRecords = [],
  linkedIds,
  onChange,
  canEdit,
  disabled = false,
  onPickerOpenChange,
}: {
  records: DeliveryDocumentRecord[];
  linkedRecords?: DeliveryDocumentRecord[];
  linkedIds: string[];
  onChange: (recordIds: string[]) => void;
  canEdit: boolean;
  disabled?: boolean;
  onPickerOpenChange?: (open: boolean) => void;
}) {
  const t = useTranslations('raid');
  const tRecords = useTranslations('records');
  const tCommon = useTranslations('common');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [addIds, setAddIds] = useState<string[]>([]);
  const [removeIds, setRemoveIds] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(5);

  function recordTypeLabel(recordType: string): string {
    const key = `typeLabels.${recordType}` as 'typeLabels.note';
    return tRecords.has(key) ? tRecords(key) : recordType;
  }

  function setOpen(open: boolean) {
    setPickerOpen(open);
    onPickerOpenChange?.(open);
    if (open) {
      setQuery('');
      setTypeFilter('all');
      setAddIds([]);
      setPage(1);
    }
  }

  const catalog = new Map(records.map((record) => [record.id, record]));
  for (const record of linkedRecords) {
    if (!catalog.has(record.id)) catalog.set(record.id, record);
  }
  const linked = linkedIds
    .map((id) => catalog.get(id))
    .filter((row): row is DeliveryDocumentRecord => Boolean(row));
  const documentTypes = [...new Set(
    records.map((row) => row.recordType).filter((type): type is string => Boolean(type)),
  )].sort((left, right) => recordTypeLabel(left).localeCompare(recordTypeLabel(right)));
  const needle = query.trim().toLowerCase();
  const available = records.filter((row) => {
    if (linkedIds.includes(row.id)) return false;
    if (typeFilter !== 'all' && row.recordType !== typeFilter) return false;
    if (!needle) return true;
    const typeLabel = row.recordType ? recordTypeLabel(row.recordType) : '';
    return `${row.humanKey ?? ''} ${row.title} ${typeLabel}`.toLowerCase().includes(needle);
  });
  const totalPages = Math.max(1, Math.ceil(available.length / pageSize) || 1);
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const pageStart = (currentPage - 1) * pageSize;
  const pageItems = available.slice(pageStart, pageStart + pageSize);
  const editable = canEdit && !disabled;

  return (
    <>
      <div className="grid gap-3">
        {editable ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
              {t('documentsAdd')}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={removeIds.length === 0}
              onClick={() => {
                onChange(linkedIds.filter((id) => !removeIds.includes(id)));
                setRemoveIds([]);
              }}
            >
              {t('documentsRemove')}
            </Button>
          </div>
        ) : null}
        {linked.length === 0 ? (
          <p className="m-0 text-sm text-ink-muted">{t('documentsReadOnlyEmpty')}</p>
        ) : (
          <ul className="m-0 grid list-none gap-2 p-0">
            {linked.map((row) => (
              <li key={row.id} className="kh-ops-linked-row kh-ops-linked-row-start">
                {editable ? (
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={removeIds.includes(row.id)}
                    onChange={() => {
                      setRemoveIds((prev) => (
                        prev.includes(row.id)
                          ? prev.filter((id) => id !== row.id)
                          : [...prev, row.id]
                      ));
                    }}
                    aria-label={t('documentsSelect', { title: row.title })}
                  />
                ) : null}
                <span>
                  {row.humanKey ? (
                    <span className="text-ink-muted">{row.humanKey} · </span>
                  ) : null}
                  {row.slug ? (
                    <LinkedKnowledgeRecord slug={row.slug} title={row.title} />
                  ) : (
                    row.title
                  )}
                  {row.recordType ? (
                    <span className="text-ink-muted"> · {recordTypeLabel(row.recordType)}</span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <Modal
        open={pickerOpen}
        onClose={() => setOpen(false)}
        size="wide"
        title={t('documentsAddTitle')}
        description={t('documentsAddDescription')}
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              {tCommon('cancel')}
            </Button>
            <Button
              type="button"
              disabled={addIds.length === 0}
              onClick={() => {
                onChange([...new Set([...linkedIds, ...addIds])]);
                setOpen(false);
              }}
            >
              {t('documentsAddConfirm')}
            </Button>
          </>
        }
      >
        <div className="grid gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(1);
              }}
              placeholder={t('documentSearch')}
              data-modal-initial-focus
              className="min-w-[12rem] flex-1"
            />
            <Select
              value={typeFilter}
              onChange={(event) => {
                setTypeFilter(event.target.value);
                setPage(1);
              }}
              aria-label={t('itemsTypeFilter')}
              className="h-10 min-h-10 w-auto min-w-[9rem] py-1.5 text-xs"
            >
              <option value="all">{t('itemsTypeAll')}</option>
              {documentTypes.map((type) => (
                <option key={type} value={type}>
                  {recordTypeLabel(type)}
                </option>
              ))}
            </Select>
          </div>
          {available.length === 0 ? (
            <p className="m-0 text-sm text-ink-muted">
              {t(
                needle || typeFilter !== 'all'
                  ? 'documentsNoneToAdd'
                  : records.length === 0
                    ? 'documentsEmpty'
                    : 'documentsAllLinked',
              )}
            </p>
          ) : (
            <>
              <ul className="m-0 grid list-none gap-2 p-0">
                {pageItems.map((row) => (
                  <li key={row.id}>
                    <label className="flex items-start gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={addIds.includes(row.id)}
                        onChange={() => {
                          setAddIds((prev) => (
                            prev.includes(row.id)
                              ? prev.filter((id) => id !== row.id)
                              : [...prev, row.id]
                          ));
                        }}
                      />
                      <span>
                        {row.humanKey ? (
                          <span className="text-ink-muted">{row.humanKey} · </span>
                        ) : null}
                        {row.title}
                        {row.recordType ? (
                          <span className="text-ink-muted"> · {recordTypeLabel(row.recordType)}</span>
                        ) : null}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
                <p className="m-0 text-xs text-ink-muted">
                  {t('documentsShowing', {
                    from: available.length === 0 ? 0 : pageStart + 1,
                    to: Math.min(pageStart + pageSize, available.length),
                    total: available.length,
                  })}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <Select
                    value={String(pageSize)}
                    onChange={(event) => {
                      const parsed = Number(event.target.value);
                      setPageSize(isPageSize(parsed) ? parsed : 5);
                      setPage(1);
                    }}
                    aria-label={t('documentsPageSize')}
                    className="h-10 min-h-10 w-auto min-w-[9rem] py-1.5 text-xs"
                  >
                    {PAGE_SIZES.map((size) => (
                      <option key={size} value={String(size)}>
                        {t('documentsPageSizeOption', { count: size })}
                      </option>
                    ))}
                  </Select>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={currentPage <= 1}
                    onClick={() => setPage(Math.max(1, currentPage - 1))}
                  >
                    {t('documentsPrevPage')}
                  </Button>
                  <span className="text-xs text-ink-muted">{currentPage} / {totalPages}</span>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={currentPage >= totalPages}
                    onClick={() => setPage(Math.min(totalPages, currentPage + 1))}
                  >
                    {t('documentsNextPage')}
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </Modal>
    </>
  );
}
