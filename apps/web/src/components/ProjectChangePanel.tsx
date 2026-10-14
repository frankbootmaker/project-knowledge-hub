'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { CollapsibleSection } from './CollapsibleSection';
import { ProjectChangeList } from './ProjectChangeList';
import { LinkedKnowledgeRecord } from './LinkedKnowledgeRecord';
import {
  DeliveryMediaEditor,
  saveItemMediaLinks,
  type ItemMediaDraft,
} from './DeliveryMediaEditor';
import {
  Button,
  DELIVERY_ITEM_MODAL_SIZE,
  ErrorText,
  Field,
  Input,
  Modal,
  Select,
  Textarea,
  useToast,
} from './ui';

export type ChangeDeliveryLink = {
  entityType: string;
  entityId: string;
  entityTitle: string | null;
};

export type ChangeRecordLink = {
  id: string;
  title: string;
  slug: string;
  humanKey?: string | null;
  recordType?: string | null;
};

export type ChangeItem = {
  id: string;
  kind: string;
  title: string;
  description: string | null;
  rationale: string | null;
  status: string;
  requestedByUserId: string | null;
  requestedBy: { userId: string; displayName: string; email: string } | null;
  approvedByUserId: string | null;
  approvedBy: { userId: string; displayName: string; email: string } | null;
  requestedAt: string;
  decidedAt: string | null;
  effectiveDate: string | null;
  baselineStartBefore: string | null;
  baselineStartAfter: string | null;
  baselineEndBefore: string | null;
  baselineEndAfter: string | null;
  knowledgeRecordId: string | null;
  knowledgeRecordTitle: string | null;
  records?: ChangeRecordLink[];
  sortOrder: number;
  humanKey?: string | null;
  createdAt?: string;
  updatedAt?: string;
  deliveryLinks: ChangeDeliveryLink[];
};

type Member = { userId: string; displayName: string; email: string };
type ItemEntityType = 'epic' | 'user_story' | 'milestone' | 'task';
type ItemTypeFilter = 'all' | ItemEntityType | 'bug';
type DeliveryOption = {
  id: string;
  title: string;
  status: string;
  humanKey?: string | null;
  itemType?: 'task' | 'bug' | null;
};
type RecordOption = {
  id: string;
  title: string;
  slug: string;
  humanKey?: string | null;
  recordType?: string | null;
};
type LinkRow = {
  id: string;
  title: string;
  humanKey?: string | null;
  status?: string | null;
  slug?: string | null;
  entityType?: ItemEntityType;
  itemType?: string | null;
  recordType?: string | null;
};
type PickerKind = 'tasks' | 'documents';
type ChangeTab = 'details' | 'tasks' | 'documents' | 'media';

const KINDS = ['scope', 'timeline', 'stakeholder', 'budget', 'other'] as const;
const STATUSES = [
  'proposed',
  'approved',
  'rejected',
  'implemented',
  'cancelled',
] as const;
const DOCUMENT_PAGE_SIZE_OPTIONS = [5, 10, 25, 50] as const;
const DEFAULT_DOCUMENT_PAGE_SIZE = 5;
type DocumentPageSize = (typeof DOCUMENT_PAGE_SIZE_OPTIONS)[number];

function isDocumentPageSize(value: number): value is DocumentPageSize {
  return (DOCUMENT_PAGE_SIZE_OPTIONS as readonly number[]).includes(value);
}

function itemKey(entityType: string, id: string): string {
  return `${entityType}:${id}`;
}

function deliveryLinksFromKeys(keys: string[]): Array<{
  entityType: ItemEntityType;
  entityId: string;
}> {
  const links: Array<{ entityType: ItemEntityType; entityId: string }> = [];
  for (const key of keys) {
    const splitAt = key.indexOf(':');
    if (splitAt < 0) continue;
    const entityType = key.slice(0, splitAt);
    const entityId = key.slice(splitAt + 1);
    if (
      entityType === 'epic'
      || entityType === 'user_story'
      || entityType === 'milestone'
      || entityType === 'task'
    ) {
      links.push({ entityType, entityId });
    }
  }
  return links;
}

export function ProjectChangePanel({
  projectId,
  canMutate,
  initialChangeItems,
  members,
  epics,
  stories,
  milestones,
  tasks,
  records,
}: {
  projectId: string;
  canMutate: boolean;
  initialChangeItems: ChangeItem[];
  members: Member[];
  epics: DeliveryOption[];
  stories: DeliveryOption[];
  milestones: DeliveryOption[];
  tasks: DeliveryOption[];
  records: RecordOption[];
}) {
  const t = useTranslations('changes');
  const tRecords = useTranslations('records');
  const tCommon = useTranslations('common');
  const tArchive = useTranslations('archive');
  const tDelivery = useTranslations('delivery');
  const router = useRouter();
  const { pushToast } = useToast();

  const [items, setItems] = useState(initialChangeItems);
  useEffect(() => {
    setItems(initialChangeItems);
  }, [initialChangeItems]);

  useEffect(() => {
    void fetch(`/api/v1/projects/${projectId}`)
      .then(async (response) => {
        if (!response.ok) return;
        const payload = (await response.json()) as {
          project?: { workspaceId?: string };
        };
        setWorkspaceId(payload.project?.workspaceId ?? null);
      })
      .catch(() => setWorkspaceId(null));
  }, [projectId]);

  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [manageId, setManageId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteAcknowledged, setDeleteAcknowledged] = useState(false);
  const [changeTab, setChangeTab] = useState<ChangeTab>('details');
  const [mediaDrafts, setMediaDrafts] = useState<ItemMediaDraft[] | null>(null);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);

  const [kind, setKind] = useState<string>('scope');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [rationale, setRationale] = useState('');
  const [status, setStatus] = useState('proposed');
  const [requestedByUserId, setRequestedByUserId] = useState('');
  const [approvedByUserId, setApprovedByUserId] = useState('');
  const [effectiveDate, setEffectiveDate] = useState('');
  const [baselineStartBefore, setBaselineStartBefore] = useState('');
  const [baselineStartAfter, setBaselineStartAfter] = useState('');
  const [baselineEndBefore, setBaselineEndBefore] = useState('');
  const [baselineEndAfter, setBaselineEndAfter] = useState('');
  const [itemKeys, setItemKeys] = useState<string[]>([]);
  const [recordIds, setRecordIds] = useState<string[]>([]);
  const [itemTypeFilter, setItemTypeFilter] = useState<ItemTypeFilter>('all');
  const [documentTypeFilter, setDocumentTypeFilter] = useState('all');
  const [removeIds, setRemoveIds] = useState<string[]>([]);
  const [taskRemoveIds, setTaskRemoveIds] = useState<string[]>([]);
  const [picker, setPicker] = useState<PickerKind | null>(null);
  const [pickerQuery, setPickerQuery] = useState('');
  const [addIds, setAddIds] = useState<string[]>([]);
  const [addPage, setAddPage] = useState(1);
  const [addPageSize, setAddPageSize] = useState<DocumentPageSize>(
    DEFAULT_DOCUMENT_PAGE_SIZE,
  );

  const refresh = useCallback(() => {
    router.refresh();
  }, [router]);

  const managing = manageId
    ? items.find((item) => item.id === manageId) ?? null
    : null;

  function resetForm(seed?: ChangeItem | null) {
    setKind(seed?.kind ?? 'scope');
    setTitle(seed?.title ?? '');
    setDescription(seed?.description ?? '');
    setRationale(seed?.rationale ?? '');
    setStatus(seed?.status ?? 'proposed');
    setRequestedByUserId(seed?.requestedByUserId ?? '');
    setApprovedByUserId(seed?.approvedByUserId ?? '');
    setEffectiveDate(seed?.effectiveDate ?? '');
    setBaselineStartBefore(seed?.baselineStartBefore ?? '');
    setBaselineStartAfter(seed?.baselineStartAfter ?? '');
    setBaselineEndBefore(seed?.baselineEndBefore ?? '');
    setBaselineEndAfter(seed?.baselineEndAfter ?? '');
    setItemKeys(
      seed?.deliveryLinks.map((link) => itemKey(link.entityType, link.entityId)) ?? [],
    );
    const seededRecords = seed?.records?.map((record) => record.id)
      ?? (seed?.knowledgeRecordId ? [seed.knowledgeRecordId] : []);
    setRecordIds(seededRecords);
    setItemTypeFilter('all');
    setDocumentTypeFilter('all');
    setRemoveIds([]);
    setTaskRemoveIds([]);
    setPicker(null);
    setPickerQuery('');
    setAddIds([]);
    setAddPage(1);
    setAddPageSize(DEFAULT_DOCUMENT_PAGE_SIZE);
    setChangeTab('details');
    setConfirmDelete(false);
    setDeleteAcknowledged(false);
    setError(null);
  }

  useEffect(() => {
    if (manageId && managing) {
      resetForm(managing);
    }
  }, [manageId, managing?.id]);

  function taskStatusLabel(value: string, entityType?: string): string {
    if (entityType && entityType !== 'task') {
      if (
        value === 'planned'
        || value === 'active'
        || value === 'done'
        || value === 'cancelled'
      ) {
        return tDelivery(`milestoneStatus.${value}`);
      }
      return value;
    }
    if (
      value === 'todo'
      || value === 'in_progress'
      || value === 'blocked'
      || value === 'done'
      || value === 'cancelled'
    ) {
      return tDelivery(`taskStatus.${value}`);
    }
    return value;
  }

  function recordTypeLabel(recordType: string): string {
    const key = `typeLabels.${recordType}` as 'typeLabels.note';
    return tRecords.has(key) ? tRecords(key) : recordType;
  }

  function openPicker(kindToOpen: PickerKind) {
    setPickerQuery('');
    setAddIds([]);
    setAddPage(1);
    setItemTypeFilter('all');
    setDocumentTypeFilter('all');
    setPicker(kindToOpen);
  }

  function toggleAdd(id: string) {
    setAddIds((prev) => (
      prev.includes(id) ? prev.filter((row) => row !== id) : [...prev, id]
    ));
  }

  function confirmAdd() {
    if (picker === 'tasks') {
      setItemKeys((prev) => [...new Set([...prev, ...addIds])]);
      setTaskRemoveIds([]);
    } else if (picker === 'documents') {
      setRecordIds((prev) => [...new Set([...prev, ...addIds])]);
      setRemoveIds([]);
    }
    setPicker(null);
    setAddIds([]);
  }

  function deleteSelectedTasks() {
    setItemKeys((prev) => prev.filter((id) => !taskRemoveIds.includes(id)));
    setTaskRemoveIds([]);
  }

  function deleteSelectedDocuments() {
    setRecordIds((prev) => prev.filter((id) => !removeIds.includes(id)));
    setRemoveIds([]);
  }

  function payloadBody() {
    return {
      kind,
      title: title.trim(),
      description: description.trim() || null,
      rationale: rationale.trim() || null,
      status,
      requestedByUserId: requestedByUserId || null,
      approvedByUserId: approvedByUserId || null,
      effectiveDate: effectiveDate || null,
      baselineStartBefore: baselineStartBefore || null,
      baselineStartAfter: baselineStartAfter || null,
      baselineEndBefore: baselineEndBefore || null,
      baselineEndAfter: baselineEndAfter || null,
      recordIds,
      deliveryLinks: deliveryLinksFromKeys(itemKeys),
    };
  }

  async function submitCreate() {
    if (!canMutate || !title.trim()) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/v1/projects/${projectId}/change-items`,
        {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            Origin: window.location.origin,
          },
          body: JSON.stringify(payloadBody()),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        changeItem?: ChangeItem;
        error?: { message?: string };
      };
      if (!response.ok || !payload.changeItem) {
        throw new Error(payload.error?.message || t('failedCreate'));
      }
      if (mediaDrafts && mediaDrafts.length > 0) {
        await saveItemMediaLinks({
          projectId,
          entityType: 'change',
          entityId: payload.changeItem.id,
          links: mediaDrafts,
        });
      }
      setItems((prev) => [...prev, payload.changeItem!]);
      setCreateOpen(false);
      resetForm();
      pushToast(t('created'), 'success');
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('failedCreate'));
    } finally {
      setPending(false);
    }
  }

  async function submitUpdate() {
    if (!canMutate || !manageId || !title.trim()) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/v1/project-change-items/${manageId}`,
        {
          method: 'PATCH',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            Origin: window.location.origin,
          },
          body: JSON.stringify(payloadBody()),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        changeItem?: ChangeItem;
        error?: { message?: string };
      };
      if (!response.ok || !payload.changeItem) {
        throw new Error(payload.error?.message || t('failedUpdate'));
      }
      if (mediaDrafts && manageId) {
        await saveItemMediaLinks({
          projectId,
          entityType: 'change',
          entityId: manageId,
          links: mediaDrafts,
        });
      }
      setItems((prev) =>
        prev.map((item) => (item.id === manageId ? payload.changeItem! : item)),
      );
      setManageId(null);
      pushToast(t('updated'), 'success');
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('failedUpdate'));
    } finally {
      setPending(false);
    }
  }

  async function submitDelete() {
    if (!canMutate || !manageId || !deleteAcknowledged) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/v1/project-change-items/${manageId}`,
        {
          method: 'DELETE',
          credentials: 'include',
          headers: { Origin: window.location.origin },
        },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(payload.error?.message || t('failedDelete'));
      }
      setItems((prev) => prev.filter((item) => item.id !== manageId));
      setManageId(null);
      pushToast(t('deleted'), 'success');
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('failedDelete'));
    } finally {
      setPending(false);
      setConfirmDelete(false);
      setDeleteAcknowledged(false);
    }
  }

  function recordRows(): LinkRow[] {
    const catalog = new Map<string, LinkRow>();
    for (const record of records) {
      catalog.set(record.id, {
        id: record.id,
        title: record.title,
        humanKey: record.humanKey,
        slug: record.slug,
        recordType: record.recordType,
      });
    }
    for (const record of managing?.records ?? []) {
      if (!catalog.has(record.id)) {
        catalog.set(record.id, {
          id: record.id,
          title: record.title,
          humanKey: record.humanKey,
          slug: record.slug,
          recordType: record.recordType,
        });
      }
    }
    if (managing?.knowledgeRecordId && !catalog.has(managing.knowledgeRecordId)) {
      catalog.set(managing.knowledgeRecordId, {
        id: managing.knowledgeRecordId,
        title: managing.knowledgeRecordTitle ?? managing.knowledgeRecordId,
        slug: '',
      });
    }
    return [...catalog.values()];
  }

  function itemRows(): LinkRow[] {
    const catalog = new Map<string, LinkRow>();
    const add = (entityType: ItemEntityType, row: DeliveryOption) => {
      const key = itemKey(entityType, row.id);
      if (catalog.has(key)) return;
      catalog.set(key, {
        id: key,
        title: row.title,
        humanKey: row.humanKey,
        status: row.status,
        entityType,
        itemType: row.itemType,
      });
    };
    for (const epic of epics) add('epic', epic);
    for (const story of stories) add('user_story', story);
    for (const milestone of milestones) add('milestone', milestone);
    for (const task of tasks) add('task', task);
    for (const link of managing?.deliveryLinks ?? []) {
      const key = itemKey(link.entityType, link.entityId);
      if (catalog.has(key)) continue;
      catalog.set(key, {
        id: key,
        title: link.entityTitle ?? link.entityId,
        entityType: link.entityType as ItemEntityType,
      });
    }
    return [...catalog.values()];
  }

  function itemFilterKind(row: LinkRow): ItemTypeFilter {
    if (row.entityType === 'task') return row.itemType === 'bug' ? 'bug' : 'task';
    return row.entityType ?? 'task';
  }

  function itemKindLabel(row: LinkRow): string | null {
    const kindName = itemFilterKind(row);
    if (kindName === 'all') return null;
    if (kindName === 'epic') return t('itemsTypeEpic');
    if (kindName === 'user_story') return t('itemsTypeStory');
    if (kindName === 'bug') return t('itemsTypeBug');
    if (kindName === 'milestone') return t('itemsTypeMilestone');
    return t('itemsTypeTask');
  }

  function linkPicker() {
    const tasksMode = picker === 'tasks';
    const catalog = tasksMode ? itemRows() : recordRows();
    const linkedIds = tasksMode ? itemKeys : recordIds;
    const needle = pickerQuery.trim().toLowerCase();
    const available = catalog.filter((row) => {
      if (linkedIds.includes(row.id)) return false;
      if (tasksMode && itemTypeFilter !== 'all' && itemFilterKind(row) !== itemTypeFilter) {
        return false;
      }
      if (!tasksMode && documentTypeFilter !== 'all' && row.recordType !== documentTypeFilter) {
        return false;
      }
      if (!needle) return true;
      const statusLabel = row.status ? taskStatusLabel(row.status, row.entityType) : '';
      const typeLabel = row.recordType ? recordTypeLabel(row.recordType) : '';
      const haystack = `${row.humanKey ?? ''} ${row.title} ${statusLabel} ${typeLabel}`.toLowerCase();
      return haystack.includes(needle);
    });
    const totalPages = Math.max(1, Math.ceil(available.length / addPageSize) || 1);
    const currentPage = Math.min(Math.max(1, addPage), totalPages);
    const pageStart = (currentPage - 1) * addPageSize;
    const pageItems = available.slice(pageStart, pageStart + addPageSize);
    const rangeFrom = available.length === 0 ? 0 : pageStart + 1;
    const rangeTo = Math.min(pageStart + addPageSize, available.length);
    const documentTypes = [...new Set(
      catalog.map((row) => row.recordType).filter((type): type is string => Boolean(type)),
    )].sort((left, right) => recordTypeLabel(left).localeCompare(recordTypeLabel(right)));

    return (
      <div className="grid gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={pickerQuery}
            onChange={(event) => {
              setPickerQuery(event.target.value);
              setAddPage(1);
            }}
            placeholder={t(tasksMode ? 'taskSearch' : 'documentSearch')}
            data-modal-initial-focus
            className="min-w-[12rem] flex-1"
          />
          {tasksMode ? (
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
              <option value="milestone">{t('itemsTypeMilestone')}</option>
            </Select>
          ) : (
            <Select
              value={documentTypeFilter}
              onChange={(event) => {
                setDocumentTypeFilter(event.target.value);
                setAddPage(1);
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
          )}
        </div>
        {available.length === 0 ? (
          <p className="m-0 text-sm text-ink-muted">
            {t(
              needle
                ? tasksMode
                  ? 'tasksNoneToAdd'
                  : 'documentsNoneToAdd'
                : catalog.length === 0
                  ? tasksMode
                    ? 'noTasks'
                    : 'documentsEmpty'
                  : tasksMode && itemTypeFilter !== 'all'
                    ? 'tasksNoneToAdd'
                    : !tasksMode && documentTypeFilter !== 'all'
                      ? 'documentsNoneToAdd'
                      : tasksMode
                        ? 'tasksAllLinked'
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
                      onChange={() => toggleAdd(row.id)}
                    />
                    <span>
                      {row.humanKey ? (
                        <span className="text-ink-muted">{row.humanKey} · </span>
                      ) : null}
                      {row.title}
                      {tasksMode ? (
                        <span className="text-ink-muted"> · {itemKindLabel(row)}</span>
                      ) : row.recordType ? (
                        <span className="text-ink-muted"> · {recordTypeLabel(row.recordType)}</span>
                      ) : null}
                      {row.status ? (
                        <span className="text-ink-muted">
                          {' '}
                          ({taskStatusLabel(row.status, row.entityType)})
                        </span>
                      ) : null}
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
                    setAddPageSize(
                      isDocumentPageSize(parsed) ? parsed : DEFAULT_DOCUMENT_PAGE_SIZE,
                    );
                    setAddPage(1);
                  }}
                  aria-label={t('documentsPageSize')}
                  className="h-10 min-h-10 w-auto min-w-[9rem] py-1.5 text-xs"
                >
                  {DOCUMENT_PAGE_SIZE_OPTIONS.map((size) => (
                    <option key={size} value={String(size)}>
                      {t('documentsPageSizeOption', { count: size })}
                    </option>
                  ))}
                </Select>
                <nav
                  className="flex flex-wrap items-center gap-2"
                  aria-label={t(tasksMode ? 'tasksAddTitle' : 'documentsAddTitle')}
                >
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
    );
  }

  function linkedPane(kindName: PickerKind, disabled: boolean) {
    const tasksMode = kindName === 'tasks';
    const catalog = tasksMode ? itemRows() : recordRows();
    const linkedIds = tasksMode ? itemKeys : recordIds;
    const selectedRemoveIds = tasksMode ? taskRemoveIds : removeIds;
    const linked = catalog.filter((row) => linkedIds.includes(row.id));
    const editable = canMutate && !disabled;
    return (
      <div className="grid gap-3">
        {editable ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="secondary" onClick={() => openPicker(kindName)}>
              {t('documentsAdd')}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={selectedRemoveIds.length === 0}
              onClick={tasksMode ? deleteSelectedTasks : deleteSelectedDocuments}
            >
              {t('documentsRemove')}
            </Button>
          </div>
        ) : null}
        {linked.length === 0 ? (
          <p className="m-0 text-sm text-ink-muted">
            {t(tasksMode ? 'tasksReadOnlyEmpty' : 'documentsReadOnlyEmpty')}
          </p>
        ) : (
          <ul className="m-0 grid list-none gap-2 p-0">
            {linked.map((row) => (
              <li key={row.id} className="kh-ops-linked-row kh-ops-linked-row-start">
                {editable ? (
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={selectedRemoveIds.includes(row.id)}
                    onChange={() => {
                      const setter = tasksMode ? setTaskRemoveIds : setRemoveIds;
                      setter((prev) => (
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
                  {tasksMode ? (
                    <span className="text-ink-muted"> · {itemKindLabel(row)}</span>
                  ) : row.recordType ? (
                    <span className="text-ink-muted"> · {recordTypeLabel(row.recordType)}</span>
                  ) : null}
                  {row.status ? (
                    <span className="text-ink-muted">
                      {' '}
                      ({taskStatusLabel(row.status, row.entityType)})
                    </span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  function formFields(disabled: boolean) {
    return (
      <div className="grid gap-3">
        <div className="kh-ops-form-grid">
          <Field label={t('kindLabel')}>
            <Select
              value={kind}
              onChange={(event) => setKind(event.target.value)}
              disabled={disabled}
            >
              {KINDS.map((value) => (
                <option key={value} value={value}>
                  {t(`kind.${value}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('statusLabel')}>
            <Select
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              disabled={disabled}
            >
              {STATUSES.map((value) => (
                <option key={value} value={value}>
                  {t(`status.${value}`)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label={t('itemTitle')}>
          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            disabled={disabled}
            data-modal-initial-focus
          />
        </Field>
        <Field label={t('description')}>
          <Textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            disabled={disabled}
            rows={3}
          />
        </Field>
        <Field label={t('rationale')}>
          <Textarea
            value={rationale}
            onChange={(event) => setRationale(event.target.value)}
            disabled={disabled}
            rows={3}
          />
        </Field>
        <div className="kh-ops-form-grid">
          <Field label={t('requestedBy')}>
            <Select
              value={requestedByUserId}
              onChange={(event) => setRequestedByUserId(event.target.value)}
              disabled={disabled}
            >
              <option value="">{t('unassigned')}</option>
              {members.map((member) => (
                <option key={member.userId} value={member.userId}>
                  {member.displayName}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('approvedBy')}>
            <Select
              value={approvedByUserId}
              onChange={(event) => setApprovedByUserId(event.target.value)}
              disabled={disabled}
            >
              <option value="">{t('unassigned')}</option>
              {members.map((member) => (
                <option key={member.userId} value={member.userId}>
                  {member.displayName}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label={t('effectiveDate')}>
          <Input
            type="date"
            value={effectiveDate}
            onChange={(event) => setEffectiveDate(event.target.value)}
            disabled={disabled}
          />
        </Field>
        {kind === 'timeline' ? (
          <div className="kh-ops-form-grid">
            <Field label={t('baselineStartBefore')}>
              <Input
                type="date"
                value={baselineStartBefore}
                onChange={(event) => setBaselineStartBefore(event.target.value)}
                disabled={disabled}
              />
            </Field>
            <Field label={t('baselineStartAfter')}>
              <Input
                type="date"
                value={baselineStartAfter}
                onChange={(event) => setBaselineStartAfter(event.target.value)}
                disabled={disabled}
              />
            </Field>
            <Field label={t('baselineEndBefore')}>
              <Input
                type="date"
                value={baselineEndBefore}
                onChange={(event) => setBaselineEndBefore(event.target.value)}
                disabled={disabled}
              />
            </Field>
            <Field label={t('baselineEndAfter')}>
              <Input
                type="date"
                value={baselineEndAfter}
                onChange={(event) => setBaselineEndAfter(event.target.value)}
                disabled={disabled}
              />
            </Field>
          </div>
        ) : null}
      </div>
    );
  }

  function itemTabs() {
    const tabs = ['details', 'tasks', 'documents', 'media'] as const;
    return (
      <div className="kh-ops-modal-tabs" role="tablist">
        {tabs.map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={changeTab === tab}
            className={changeTab === tab ? 'active' : undefined}
            onClick={() => setChangeTab(tab)}
          >
            {tab === 'details'
              ? t('tabDetails')
              : tab === 'tasks'
                ? t('tabItems')
                : tab === 'documents'
                  ? t('tabDocuments')
                  : tDelivery('tabMedia')}
          </button>
        ))}
      </div>
    );
  }

  function tabbedForm(disabled: boolean) {
    return (
      <>
        {error ? (
          <div className="mb-3">
            <ErrorText>{error}</ErrorText>
          </div>
        ) : null}
        <section className={`kh-ops-modal-pane${changeTab === 'details' ? ' active' : ''}`}>
          {formFields(disabled)}
        </section>
        <section className={`kh-ops-modal-pane${changeTab === 'tasks' ? ' active' : ''}`}>
          {linkedPane('tasks', disabled)}
        </section>
        <section className={`kh-ops-modal-pane${changeTab === 'documents' ? ' active' : ''}`}>
          {linkedPane('documents', disabled)}
        </section>
        <section className={`kh-ops-modal-pane${changeTab === 'media' ? ' active' : ''}`}>
          <DeliveryMediaEditor
            projectId={projectId}
            workspaceId={workspaceId}
            entityType="change"
            entityId={manageId}
            canEdit={canMutate && !disabled}
            onDraftsChange={setMediaDrafts}
          />
        </section>
      </>
    );
  }

  return (
    <>
      <CollapsibleSection
        id="project-change"
        storageKey={`project:${projectId}:changes`}
        title={t('title')}
        defaultOpen
      >
        {error && !createOpen && !manageId ? (
          <div className="mb-3">
            <ErrorText>{error}</ErrorText>
          </div>
        ) : null}

        <ProjectChangeList
          items={items}
          canMutate={canMutate}
          onManage={(id) => setManageId(id)}
          onCreate={() => {
            resetForm();
            setCreateOpen(true);
          }}
        />
        <p className="mt-3 mb-0 text-xs text-ink-muted">
          {canMutate ? t('hint') : t('readOnlyHint')}
        </p>
      </CollapsibleSection>

      <Modal
        open={createOpen}
        onClose={() => {
          setPicker(null);
          setCreateOpen(false);
        }}
        title={t('addItem')}
        description={t('modalDescription')}
        size={DELIVERY_ITEM_MODAL_SIZE}
        closeOnEscape={!picker}
        tabs={itemTabs()}
        footer={
          <>
            <Button
              type="button"
              variant="secondary"
              disabled={pending}
              onClick={() => setCreateOpen(false)}
            >
              {tCommon('cancel')}
            </Button>
            <Button
              type="button"
              disabled={pending || !title.trim()}
              onClick={() => void submitCreate()}
            >
              {t('addItem')}
            </Button>
          </>
        }
      >
        {tabbedForm(pending)}
      </Modal>

      <Modal
        open={Boolean(manageId)}
        onClose={() => {
          setPicker(null);
          setManageId(null);
        }}
        title={title.trim() || t('manageItem')}
        description={t('manageDescription')}
        size={DELIVERY_ITEM_MODAL_SIZE}
        closeOnEscape={!picker}
        tabs={itemTabs()}
        footer={
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <div>
              {canMutate ? (
                !confirmDelete ? (
                  <>
                    <Button
                      type="button"
                      variant="danger"
                      disabled={pending}
                      onClick={() => {
                        setConfirmDelete(true);
                        setDeleteAcknowledged(false);
                      }}
                    >
                      {t('deleteItem')}
                    </Button>
                    <p className="m-0 text-xs text-ink-muted">{t('deleteItemNote')}</p>
                  </>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={pending}
                      onClick={() => {
                        setConfirmDelete(false);
                        setDeleteAcknowledged(false);
                      }}
                    >
                      {tCommon('cancel')}
                    </Button>
                    <Button
                      type="button"
                      variant="danger"
                      disabled={pending || !deleteAcknowledged}
                      onClick={() => void submitDelete()}
                    >
                      {t('confirmDelete')}
                    </Button>
                  </div>
                )
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setManageId(null)}
              >
                {tCommon('cancel')}
              </Button>
              {canMutate ? (
                <Button
                  type="button"
                  disabled={pending || !title.trim() || confirmDelete}
                  onClick={() => void submitUpdate()}
                >
                  {t('saveItem')}
                </Button>
              ) : null}
            </div>
          </div>
        }
      >
        {confirmDelete ? (
          <div className="kh-ops-confirm mb-3">
            <p className="m-0 text-sm font-semibold text-danger">
              {t('confirmDeleteTitle', {
                title: title.trim() || t('title'),
              })}
            </p>
            <p className="m-0 text-sm text-danger">{t('deleteHint')}</p>
            <label className="flex items-start gap-2 text-sm text-ink">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={deleteAcknowledged}
                disabled={pending}
                onChange={(event) => setDeleteAcknowledged(event.target.checked)}
              />
              <span>{tArchive('deleteAcknowledge')}</span>
            </label>
          </div>
        ) : null}
        {tabbedForm(pending || confirmDelete || !canMutate)}
      </Modal>

      <Modal
        open={Boolean(picker)}
        onClose={() => setPicker(null)}
        size="wide"
        title={t(picker === 'tasks' ? 'tasksAddTitle' : 'documentsAddTitle')}
        description={t(
          picker === 'tasks' ? 'tasksAddDescription' : 'documentsAddDescription',
        )}
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => setPicker(null)}>
              {tCommon('cancel')}
            </Button>
            <Button
              type="button"
              disabled={addIds.length === 0}
              onClick={confirmAdd}
            >
              {t('documentsAddConfirm')}
            </Button>
          </>
        }
      >
        {picker ? linkPicker() : null}
      </Modal>
    </>
  );
}
