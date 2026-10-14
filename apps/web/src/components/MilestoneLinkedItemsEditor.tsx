'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Input, Modal, Select } from './ui';

const PAGE_SIZE_OPTIONS = [5, 10, 25, 50] as const;
const DEFAULT_PAGE_SIZE = 5;
type PageSize = (typeof PAGE_SIZE_OPTIONS)[number];

export type MilestoneLinkEntityType = 'epic' | 'user_story' | 'task';
type ItemTypeFilter = 'all' | 'epic' | 'user_story' | 'task' | 'bug';

export type MilestoneLinkChoice = {
  id: string;
  entityType: MilestoneLinkEntityType;
  entityId: string;
  title: string;
  humanKey: string | null;
  status: string;
  itemType?: 'task' | 'bug' | null;
  completionPercent?: number | null;
};

function isPageSize(value: number): value is PageSize {
  return (PAGE_SIZE_OPTIONS as readonly number[]).includes(value);
}

export function milestoneLinkKey(
  entityType: MilestoneLinkEntityType,
  entityId: string,
): string {
  return `${entityType}:${entityId}`;
}

export function MilestoneLinkedItemsEditor({
  items,
  linkedIds,
  onChange,
  canEdit,
  disabled,
  onPickerOpenChange,
}: {
  items: MilestoneLinkChoice[];
  linkedIds: string[];
  onChange: (ids: string[]) => void;
  canEdit: boolean;
  disabled: boolean;
  onPickerOpenChange?: (open: boolean) => void;
}) {
  const t = useTranslations('raid');
  const tDelivery = useTranslations('delivery');
  const tCommon = useTranslations('common');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState('');
  const [addIds, setAddIds] = useState<string[]>([]);
  const [removeIds, setRemoveIds] = useState<string[]>([]);
  const [itemTypeFilter, setItemTypeFilter] = useState<ItemTypeFilter>('all');
  const [addPage, setAddPage] = useState(1);
  const [addPageSize, setAddPageSize] = useState<PageSize>(DEFAULT_PAGE_SIZE);

  const byId = useMemo(() => {
    const map = new Map<string, MilestoneLinkChoice>();
    for (const item of items) map.set(item.id, item);
    return map;
  }, [items]);

  function setOpen(next: boolean) {
    setPickerOpen(next);
    onPickerOpenChange?.(next);
  }

  function openPicker() {
    setAddIds([]);
    setPickerQuery('');
    setItemTypeFilter('all');
    setAddPage(1);
    setOpen(true);
  }

  function closePicker() {
    setOpen(false);
    setAddIds([]);
    setAddPage(1);
  }

  function confirmPicker() {
    if (addIds.length === 0) return;
    const next = new Set(linkedIds);
    for (const id of addIds) next.add(id);
    onChange([...next]);
    setRemoveIds([]);
    closePicker();
  }

  function deleteSelected() {
    if (removeIds.length === 0) return;
    const drop = new Set(removeIds);
    onChange(linkedIds.filter((id) => !drop.has(id)));
    setRemoveIds([]);
  }

  function filterKind(row: MilestoneLinkChoice): ItemTypeFilter {
    if (row.entityType === 'task') return row.itemType === 'bug' ? 'bug' : 'task';
    return row.entityType;
  }

  function kindLabel(row: MilestoneLinkChoice): string {
    const kind = filterKind(row);
    if (kind === 'epic') return t('itemsTypeEpic');
    if (kind === 'user_story') return t('itemsTypeStory');
    if (kind === 'bug') return t('itemsTypeBug');
    return t('itemsTypeTask');
  }

  function statusLabel(row: MilestoneLinkChoice): string {
    if (row.entityType === 'task') return tDelivery(`taskStatus.${row.status}`);
    return tDelivery(`milestoneStatus.${row.status}`);
  }

  const linked = linkedIds
    .map((id) => byId.get(id))
    .filter((row): row is MilestoneLinkChoice => Boolean(row));
  const editable = canEdit && !disabled;

  const needle = pickerQuery.trim().toLowerCase();
  const available = items.filter((row) => {
    if (linkedIds.includes(row.id)) return false;
    if (itemTypeFilter !== 'all' && filterKind(row) !== itemTypeFilter) return false;
    if (!needle) return true;
    const haystack = `${row.humanKey ?? ''} ${row.title} ${statusLabel(row)} ${kindLabel(row)}`.toLowerCase();
    return haystack.includes(needle);
  });
  const totalPages = Math.max(1, Math.ceil(available.length / addPageSize) || 1);
  const currentPage = Math.min(Math.max(1, addPage), totalPages);
  const pageStart = (currentPage - 1) * addPageSize;
  const pageItems = available.slice(pageStart, pageStart + addPageSize);
  const rangeFrom = available.length === 0 ? 0 : pageStart + 1;
  const rangeTo = Math.min(pageStart + addPageSize, available.length);

  return (
    <div className="grid gap-3">
      {editable ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="secondary" onClick={openPicker}>
            {t('documentsAdd')}
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={removeIds.length === 0}
            onClick={deleteSelected}
          >
            {t('documentsRemove')}
          </Button>
        </div>
      ) : null}
      {linked.length === 0 ? (
        <p className="m-0 text-sm text-ink-muted">{t('tasksReadOnlyEmpty')}</p>
      ) : (
        <ul className="m-0 grid list-none gap-2 p-0">
          {linked.map((row) => (
            <li key={row.id} className="kh-ops-linked-row kh-ops-linked-row-start">
              {editable ? (
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={removeIds.includes(row.id)}
                  onChange={() =>
                    setRemoveIds((prev) =>
                      prev.includes(row.id)
                        ? prev.filter((id) => id !== row.id)
                        : [...prev, row.id],
                    )
                  }
                  aria-label={t('documentsSelect', { title: row.title })}
                />
              ) : null}
              <span>
                {row.humanKey ? (
                  <span className="text-ink-muted">{row.humanKey} · </span>
                ) : null}
                {row.title}
                <span className="text-ink-muted"> · {kindLabel(row)}</span>
                <span className="text-ink-muted"> ({statusLabel(row)})</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      <Modal
        open={pickerOpen}
        onClose={closePicker}
        size="wide"
        title={t('tasksAddTitle')}
        description={t('tasksAddDescription')}
        footer={
          <>
            <Button type="button" variant="secondary" onClick={closePicker}>
              {tCommon('cancel')}
            </Button>
            <Button type="button" disabled={addIds.length === 0} onClick={confirmPicker}>
              {t('documentsAddConfirm')}
            </Button>
          </>
        }
      >
        <div className="grid gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={pickerQuery}
              onChange={(event) => {
                setPickerQuery(event.target.value);
                setAddPage(1);
              }}
              placeholder={t('taskSearch')}
              data-modal-initial-focus
              className="min-w-[12rem] flex-1"
            />
            <Select
              value={itemTypeFilter}
              onChange={(event) => {
                setItemTypeFilter(event.target.value as ItemTypeFilter);
                setAddPage(1);
              }}
              aria-label={t('itemsTypeFilter')}
              className="h-10 min-h-10 w-auto min-w-[9rem] py-1.5 text-xs"
            >
              <option value="all">{t('itemsTypeAll')}</option>
              <option value="epic">{t('itemsTypeEpic')}</option>
              <option value="user_story">{t('itemsTypeStory')}</option>
              <option value="task">{t('itemsTypeTask')}</option>
              <option value="bug">{t('itemsTypeBug')}</option>
            </Select>
          </div>
          {available.length === 0 ? (
            <p className="m-0 text-sm text-ink-muted">
              {t(
                needle
                  ? 'tasksNoneToAdd'
                  : items.length === 0
                    ? 'noTasks'
                    : itemTypeFilter !== 'all'
                      ? 'tasksNoneToAdd'
                      : 'tasksAllLinked',
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
                        onChange={() =>
                          setAddIds((prev) =>
                            prev.includes(row.id)
                              ? prev.filter((id) => id !== row.id)
                              : [...prev, row.id],
                          )
                        }
                      />
                      <span>
                        {row.humanKey ? (
                          <span className="text-ink-muted">{row.humanKey} · </span>
                        ) : null}
                        {row.title}
                        <span className="text-ink-muted"> · {kindLabel(row)}</span>
                        <span className="text-ink-muted"> ({statusLabel(row)})</span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
                <p className="m-0 text-xs text-ink-muted">
                  {t('documentsShowing', {
                    from: rangeFrom,
                    to: rangeTo,
                    total: available.length,
                  })}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <Select
                    value={String(addPageSize)}
                    onChange={(event) => {
                      const parsed = Number(event.target.value);
                      setAddPageSize(isPageSize(parsed) ? parsed : DEFAULT_PAGE_SIZE);
                      setAddPage(1);
                    }}
                    aria-label={t('documentsPageSize')}
                    className="h-10 min-h-10 w-auto min-w-[9rem] py-1.5 text-xs"
                  >
                    {PAGE_SIZE_OPTIONS.map((size) => (
                      <option key={size} value={String(size)}>
                        {t('documentsPageSizeOption', { count: size })}
                      </option>
                    ))}
                  </Select>
                  <nav className="flex flex-wrap items-center gap-2" aria-label={t('tasksAddTitle')}>
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={currentPage <= 1}
                      onClick={() => setAddPage(Math.max(1, currentPage - 1))}
                    >
                      {t('documentsPrevPage')}
                    </Button>
                    <span className="text-xs text-ink-muted" aria-current="page">
                      {currentPage} / {totalPages}
                    </span>
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={currentPage >= totalPages}
                      onClick={() => setAddPage(Math.min(totalPages, currentPage + 1))}
                    >
                      {t('documentsNextPage')}
                    </Button>
                  </nav>
                </div>
              </div>
            </>
          )}
        </div>
      </Modal>
    </div>
  );
}
