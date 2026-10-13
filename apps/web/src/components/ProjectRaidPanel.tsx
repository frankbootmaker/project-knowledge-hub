'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { CollapsibleSection } from './CollapsibleSection';
import { ProjectRaidList } from './ProjectRaidList';
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
import { LinkedKnowledgeRecord } from './LinkedKnowledgeRecord';

export type RaidItem = {
  id: string;
  kind: string;
  title: string;
  description: string | null;
  status: string;
  severity: string;
  probability?: string | null;
  impact?: string | null;
  ownerUserId: string | null;
  owner: { userId: string; displayName: string; email: string } | null;
  dueDate: string | null;
  sortOrder: number;
  humanKey?: string | null;
  transferredToRaidItemId?: string | null;
  transferredFromRaidItemId?: string | null;
  transferredToHumanKey?: string | null;
  transferredFromHumanKey?: string | null;
  archivedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
  tasks: Array<{
    id: string;
    title: string;
    status: string;
    humanKey?: string | null;
    itemType?: 'task' | 'bug' | null;
  }>;
  deliveryItems?: Array<{
    entityType: 'epic' | 'user_story' | 'milestone';
    id: string;
    title: string;
    status: string;
    humanKey: string | null;
  }>;
  records?: Array<{
    id: string;
    title: string;
    slug: string;
    recordType: string;
    humanKey?: string | null;
  }>;
};

type TaskOption = {
  id: string;
  title: string;
  status: string;
  humanKey?: string | null;
  itemType?: string | null;
};
type DeliveryOption = {
  id: string;
  title: string;
  status: string;
  humanKey?: string | null;
};
type ItemEntityType = 'epic' | 'user_story' | 'milestone' | 'task';
type ItemTypeFilter = 'all' | ItemEntityType | 'bug';
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

function itemKey(entityType: ItemEntityType, id: string): string {
  return `${entityType}:${id}`;
}

function splitItemKeys(keys: string[]): {
  taskIds: string[];
  deliveryItems: Array<{ entityType: 'epic' | 'user_story' | 'milestone'; entityId: string }>;
} {
  const taskIds: string[] = [];
  const deliveryItems: Array<{
    entityType: 'epic' | 'user_story' | 'milestone';
    entityId: string;
  }> = [];
  for (const key of keys) {
    const splitAt = key.indexOf(':');
    if (splitAt < 0) continue;
    const entityType = key.slice(0, splitAt);
    const entityId = key.slice(splitAt + 1);
    if (entityType === 'task') taskIds.push(entityId);
    else if (
      entityType === 'epic' ||
      entityType === 'user_story' ||
      entityType === 'milestone'
    ) {
      deliveryItems.push({ entityType, entityId });
    }
  }
  return { taskIds, deliveryItems };
}
type PickerKind = 'tasks' | 'documents';
type RecordOption = {
  id: string;
  title: string;
  slug: string;
  humanKey?: string | null;
  recordType?: string | null;
};
type Member = { userId: string; displayName: string; email: string };

const DOCUMENT_PAGE_SIZE_OPTIONS = [5, 10, 25, 50] as const;
const DEFAULT_DOCUMENT_PAGE_SIZE = 5;
type DocumentPageSize = (typeof DOCUMENT_PAGE_SIZE_OPTIONS)[number];

function isDocumentPageSize(value: number): value is DocumentPageSize {
  return (DOCUMENT_PAGE_SIZE_OPTIONS as readonly number[]).includes(value);
}

const KINDS = ['risk', 'assumption', 'issue', 'dependency'] as const;
const STATUSES = [
  'open',
  'mitigating',
  'accepted',
  'closed',
  'cancelled',
] as const;
const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;

export function ProjectRaidPanel({
  projectId,
  canMutate,
  initialRaidItems,
  tasks,
  epics,
  stories,
  milestones,
  records,
  members,
  initialOpenRaidId = null,
}: {
  projectId: string;
  canMutate: boolean;
  initialRaidItems: RaidItem[];
  tasks: TaskOption[];
  epics: DeliveryOption[];
  stories: DeliveryOption[];
  milestones: DeliveryOption[];
  records: RecordOption[];
  members: Member[];
  initialOpenRaidId?: string | null;
}) {
  const t = useTranslations('raid');
  const tRecords = useTranslations('records');
  const tCommon = useTranslations('common');
  const tArchive = useTranslations('archive');
  const tDelivery = useTranslations('delivery');
  const router = useRouter();
  const { pushToast } = useToast();

  const [items, setItems] = useState(initialRaidItems);
  useEffect(() => {
    setItems(initialRaidItems);
  }, [initialRaidItems]);

  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [manageId, setManageId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteAcknowledged, setDeleteAcknowledged] = useState(false);
  const [confirmTransfer, setConfirmTransfer] = useState<
    'issue' | 'risk' | null
  >(null);

  const [kind, setKind] = useState<string>('risk');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState('open');
  const [severity, setSeverity] = useState('medium');
  const [probability, setProbability] = useState('');
  const [impact, setImpact] = useState('');
  const [ownerUserId, setOwnerUserId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [itemKeys, setItemKeys] = useState<string[]>([]);
  const [itemTypeFilter, setItemTypeFilter] = useState<ItemTypeFilter>('all');
  const [documentTypeFilter, setDocumentTypeFilter] = useState('all');
  const [recordIds, setRecordIds] = useState<string[]>([]);
  const [removeIds, setRemoveIds] = useState<string[]>([]);
  const [taskRemoveIds, setTaskRemoveIds] = useState<string[]>([]);
  const [picker, setPicker] = useState<PickerKind | null>(null);
  const [addIds, setAddIds] = useState<string[]>([]);
  const [pickerQuery, setPickerQuery] = useState('');
  const [addPage, setAddPage] = useState(1);
  const [addPageSize, setAddPageSize] = useState<DocumentPageSize>(
    DEFAULT_DOCUMENT_PAGE_SIZE,
  );
  const [raidTab, setRaidTab] = useState<'details' | 'tasks' | 'documents'>('details');

  const refresh = useCallback(() => {
    router.refresh();
  }, [router]);

  const managing = manageId
    ? items.find((item) => item.id === manageId) ?? null
    : null;

  function resetForm(seed?: RaidItem | null) {
    setKind(seed?.kind ?? 'risk');
    setTitle(seed?.title ?? '');
    setDescription(seed?.description ?? '');
    setStatus(seed?.status ?? 'open');
    setSeverity(seed?.severity ?? 'medium');
    setProbability(seed?.probability ?? '');
    setImpact(seed?.impact ?? '');
    setOwnerUserId(seed?.ownerUserId ?? '');
    setDueDate(seed?.dueDate ?? '');
    setItemKeys([
      ...(seed?.tasks.map((task) => itemKey('task', task.id)) ?? []),
      ...(seed?.deliveryItems?.map((item) => itemKey(item.entityType, item.id)) ?? []),
    ]);
    setItemTypeFilter('all');
    setDocumentTypeFilter('all');
    setRecordIds(seed?.records?.map((record) => record.id) ?? []);
    setRemoveIds([]);
    setTaskRemoveIds([]);
    setPicker(null);
    setAddIds([]);
    setPickerQuery('');
    setAddPage(1);
    setAddPageSize(DEFAULT_DOCUMENT_PAGE_SIZE);
    setRaidTab('details');
    setConfirmDelete(false);
    setDeleteAcknowledged(false);
    setConfirmTransfer(null);
    setError(null);
  }

  useEffect(() => {
    if (manageId && managing) {
      resetForm(managing);
    }
  }, [manageId, managing?.id]);

  useEffect(() => {
    if (!initialOpenRaidId) return;
    if (!initialRaidItems.some((item) => item.id === initialOpenRaidId)) return;
    setManageId(initialOpenRaidId);
  }, [initialOpenRaidId, initialRaidItems]);

  function taskStatusLabel(status: string, entityType?: string): string {
    if (entityType && entityType !== 'task') {
      if (
        status === 'planned' ||
        status === 'active' ||
        status === 'done' ||
        status === 'cancelled'
      ) {
        return tDelivery(`milestoneStatus.${status}`);
      }
      return status;
    }
    if (
      status === 'todo' ||
      status === 'in_progress' ||
      status === 'blocked' ||
      status === 'done' ||
      status === 'cancelled'
    ) {
      return tDelivery(`taskStatus.${status}`);
    }
    return status;
  }

  function toggleRemove(recordId: string) {
    setRemoveIds((prev) =>
      prev.includes(recordId)
        ? prev.filter((id) => id !== recordId)
        : [...prev, recordId],
    );
  }

  function deleteSelectedDocuments() {
    setRecordIds((prev) => prev.filter((id) => !removeIds.includes(id)));
    setRemoveIds([]);
  }

  function toggleTaskRemove(taskId: string) {
    setTaskRemoveIds((prev) =>
      prev.includes(taskId)
        ? prev.filter((id) => id !== taskId)
        : [...prev, taskId],
    );
  }

  function deleteSelectedTasks() {
    setItemKeys((prev) => prev.filter((id) => !taskRemoveIds.includes(id)));
    setTaskRemoveIds([]);
  }

  function toggleAdd(recordId: string) {
    setAddIds((prev) =>
      prev.includes(recordId)
        ? prev.filter((id) => id !== recordId)
        : [...prev, recordId],
    );
  }

  function openPicker(kind: PickerKind) {
    setAddIds([]);
    setPickerQuery('');
    setAddPage(1);
    setItemTypeFilter('all');
    setDocumentTypeFilter('all');
    setPicker(kind);
  }

  function closePicker() {
    setPicker(null);
    setAddIds([]);
    setPickerQuery('');
    setAddPage(1);
  }

  function confirmPicker() {
    if (picker === 'tasks') {
      setItemKeys((prev) => [...new Set([...prev, ...addIds])]);
    } else {
      setRecordIds((prev) => [...new Set([...prev, ...addIds])]);
    }
    closePicker();
  }

  async function submitCreate() {
    if (!canMutate || !title.trim()) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/projects/${projectId}/raid-items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind,
          title: title.trim(),
          description: description.trim() || null,
          status,
          severity,
          probability: probability || null,
          impact: impact || null,
          ownerUserId: ownerUserId || null,
          dueDate: dueDate || null,
          ...splitItemKeys(itemKeys),
          recordIds,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        raidItem?: RaidItem;
        error?: { message?: string };
      };
      if (!response.ok || !payload.raidItem) {
        throw new Error(payload.error?.message || t('failedCreate'));
      }
      setItems((prev) => [...prev, payload.raidItem!]);
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
      const patchResponse = await fetch(
        `/api/v1/project-raid-items/${manageId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            kind,
            title: title.trim(),
            description: description.trim() || null,
            status,
            severity,
            probability: probability || null,
            impact: impact || null,
            ownerUserId: ownerUserId || null,
            dueDate: dueDate || null,
          }),
        },
      );
      const patchPayload = (await patchResponse.json().catch(() => ({}))) as {
        raidItem?: RaidItem;
        error?: { message?: string };
      };
      if (!patchResponse.ok || !patchPayload.raidItem) {
        throw new Error(patchPayload.error?.message || t('failedUpdate'));
      }

      const linksResponse = await fetch(
        `/api/v1/project-raid-items/${manageId}/tasks`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taskIds: splitItemKeys(itemKeys).taskIds }),
        },
      );
      const linksPayload = (await linksResponse.json().catch(() => ({}))) as {
        raidItem?: RaidItem;
        error?: { message?: string };
      };
      if (!linksResponse.ok || !linksPayload.raidItem) {
        throw new Error(linksPayload.error?.message || t('failedUpdate'));
      }

      const deliveryResponse = await fetch(
        `/api/v1/project-raid-items/${manageId}/delivery-items`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: splitItemKeys(itemKeys).deliveryItems }),
        },
      );
      const deliveryPayload = (await deliveryResponse.json().catch(() => ({}))) as {
        raidItem?: RaidItem;
        error?: { message?: string };
      };
      if (!deliveryResponse.ok || !deliveryPayload.raidItem) {
        throw new Error(deliveryPayload.error?.message || t('failedUpdate'));
      }

      const recordsResponse = await fetch(
        `/api/v1/project-raid-items/${manageId}/records`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ recordIds }),
        },
      );
      const recordsPayload = (await recordsResponse.json().catch(() => ({}))) as {
        raidItem?: RaidItem;
        error?: { message?: string };
      };
      if (!recordsResponse.ok || !recordsPayload.raidItem) {
        throw new Error(recordsPayload.error?.message || t('failedUpdate'));
      }

      setItems((prev) =>
        prev.map((item) =>
          item.id === manageId ? recordsPayload.raidItem! : item,
        ),
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
      const response = await fetch(`/api/v1/project-raid-items/${manageId}`, {
        method: 'DELETE',
      });
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

  async function submitTransfer(targetKind: 'issue' | 'risk') {
    if (!canMutate || !manageId) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/v1/project-raid-items/${manageId}/transfer`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ targetKind }),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        source?: RaidItem;
        target?: RaidItem;
        error?: { message?: string };
      };
      if (!response.ok || !payload.source || !payload.target) {
        throw new Error(payload.error?.message || t('failedTransfer'));
      }
      setItems((prev) => {
        const withoutSource = prev.filter((item) => item.id !== manageId);
        return [...withoutSource, payload.target!];
      });
      setManageId(payload.target.id);
      setConfirmTransfer(null);
      pushToast(
        t('transferred', {
          source: payload.source.humanKey ?? payload.source.title,
          target: payload.target.humanKey ?? payload.target.title,
        }),
        'success',
      );
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('failedTransfer'));
    } finally {
      setPending(false);
    }
  }

  function formFields(disabled: boolean, options?: { managing?: boolean }) {
    const lockedOpposite =
      options?.managing && (kind === 'risk' || kind === 'issue')
        ? kind === 'risk'
          ? 'issue'
          : 'risk'
        : null;
    return (
      <div className="grid gap-3">
        {error ? <ErrorText>{error}</ErrorText> : null}
        {options?.managing && managing?.humanKey ? (
          <p className="m-0 font-mono text-sm text-ink-muted">
            {managing.humanKey}
          </p>
        ) : null}
        {options?.managing && managing?.transferredFromHumanKey ? (
          <p className="kh-ops-status-row m-0">
            {t('transferredFromBanner', {
              key: managing.transferredFromHumanKey,
            })}
          </p>
        ) : null}
        {options?.managing && managing?.transferredToHumanKey ? (
          <p className="kh-ops-status-row m-0">
            {t('transferredToBanner', {
              key: managing.transferredToHumanKey,
            })}
          </p>
        ) : null}
        <div className="kh-ops-form-grid">
          <Field label={t('kindLabel')}>
            <Select
              value={kind}
              onChange={(e) => setKind(e.target.value)}
              disabled={disabled}
            >
              {KINDS.map((value) => (
                <option
                  key={value}
                  value={value}
                  disabled={lockedOpposite === value}
                >
                  {t(`kind.${value}`)}
                  {lockedOpposite === value ? ` (${t('useTransfer')})` : ''}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('statusLabel')}>
            <Select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
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
            onChange={(e) => setTitle(e.target.value)}
            disabled={disabled}
            data-modal-initial-focus
          />
        </Field>
        <div className="kh-ops-form-grid">
          <Field label={t('severityLabel')}>
            <Select
              value={severity}
              onChange={(e) => setSeverity(e.target.value)}
              disabled={disabled}
            >
              {SEVERITIES.map((value) => (
                <option key={value} value={value}>
                  {t(`severity.${value}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('probabilityLabel')}>
            <Select
              value={probability}
              onChange={(e) => setProbability(e.target.value)}
              disabled={disabled}
            >
              <option value="">{t('ratingNone')}</option>
              {SEVERITIES.map((value) => (
                <option key={value} value={value}>
                  {t(`severity.${value}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('impactLabel')}>
            <Select
              value={impact}
              onChange={(e) => setImpact(e.target.value)}
              disabled={disabled}
            >
              <option value="">{t('ratingNone')}</option>
              {SEVERITIES.map((value) => (
                <option key={value} value={value}>
                  {t(`severity.${value}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('dueDate')}>
            <Input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              disabled={disabled}
            />
          </Field>
        </div>
        <Field label={t('owner')}>
          <Select
            value={ownerUserId}
            onChange={(e) => setOwnerUserId(e.target.value)}
            disabled={disabled}
          >
            <option value="">{t('unassigned')}</option>
            {members.map((member) => (
              <option key={member.userId} value={member.userId}>
                {member.displayName} ({member.email})
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('description')}>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={disabled}
            rows={4}
          />
        </Field>
      </div>
    );
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
    return [...catalog.values()];
  }

  function taskRows(): LinkRow[] {
    const catalog = new Map<string, LinkRow>();
    const add = (
      entityType: ItemEntityType,
      row: {
        id: string;
        title: string;
        status?: string | null;
        humanKey?: string | null;
        itemType?: string | null;
      },
    ) => {
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
    for (const item of managing?.deliveryItems ?? []) add(item.entityType, item);
    for (const task of managing?.tasks ?? []) add('task', task);
    return [...catalog.values()];
  }

  function itemFilterKind(row: LinkRow): ItemTypeFilter {
    if (row.entityType === 'task') return row.itemType === 'bug' ? 'bug' : 'task';
    return row.entityType ?? 'task';
  }

  function itemKindLabel(row: LinkRow): string | null {
    const kind = itemFilterKind(row);
    if (kind === 'all') return null;
    if (kind === 'epic') return t('itemsTypeEpic');
    if (kind === 'user_story') return t('itemsTypeStory');
    if (kind === 'bug') return t('itemsTypeBug');
    if (kind === 'milestone') return t('itemsTypeMilestone');
    return t('itemsTypeTask');
  }

  function recordTypeLabel(recordType: string): string {
    const key = `typeLabels.${recordType}` as 'typeLabels.note';
    return tRecords.has(key) ? tRecords(key) : recordType;
  }

  function linkPicker() {
    const tasksMode = picker === 'tasks';
    const catalog = tasksMode ? taskRows() : recordRows();
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
                        <span className="text-ink-muted"> ({taskStatusLabel(row.status, row.entityType)})</span>
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

  function linkedPane(
    kind: PickerKind,
    disabled: boolean,
  ) {
    const tasksMode = kind === 'tasks';
    const catalog = tasksMode ? taskRows() : recordRows();
    const linkedIds = tasksMode ? itemKeys : recordIds;
    const selectedRemoveIds = tasksMode ? taskRemoveIds : removeIds;
    const linked = catalog.filter((row) => linkedIds.includes(row.id));
    const editable = canMutate && !disabled;
    return (
      <div className="grid gap-3">
        {editable ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="secondary" onClick={() => openPicker(kind)}>
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
                    onChange={() =>
                      tasksMode ? toggleTaskRemove(row.id) : toggleRemove(row.id)
                    }
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
                    <span className="text-ink-muted"> ({taskStatusLabel(row.status, row.entityType)})</span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  function tabbedForm(disabled: boolean, options?: { managing?: boolean }) {
    const tabs = ['details', 'tasks', 'documents'] as const;
    return (
      <div>
        <div className="kh-ops-modal-tabs" role="tablist">
          {tabs.map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={raidTab === tab}
              className={raidTab === tab ? 'active' : undefined}
              onClick={() => setRaidTab(tab)}
            >
              {tab === 'details'
                ? t('tabDetails')
                : tab === 'tasks'
                  ? t('tabItems')
                  : t('tabDocuments')}
            </button>
          ))}
        </div>
        <section
          className={`kh-ops-modal-pane${raidTab === 'details' ? ' active' : ''}`}
        >
          {formFields(disabled, options)}
        </section>
        <section
          className={`kh-ops-modal-pane${raidTab === 'tasks' ? ' active' : ''}`}
        >
          {linkedPane('tasks', disabled)}
        </section>
        <section
          className={`kh-ops-modal-pane${raidTab === 'documents' ? ' active' : ''}`}
        >
          {linkedPane('documents', disabled)}
        </section>
      </div>
    );
  }

  return (
    <>
      <CollapsibleSection
        id="project-raid"
        storageKey={`project:${projectId}:raid`}
        title={t('title')}
        defaultOpen
      >
        {error && !createOpen && !manageId ? (
          <div className="mb-3">
            <ErrorText>{error}</ErrorText>
          </div>
        ) : null}

        <ProjectRaidList
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
        onClose={() => setCreateOpen(false)}
        title={t('addItem')}
        description={t('modalDescription')}
        size={DELIVERY_ITEM_MODAL_SIZE}
        closeOnEscape={!picker}
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
        onClose={() => setManageId(null)}
        title={title.trim() || t('manageItem')}
        description={t('manageDescription')}
        size={DELIVERY_ITEM_MODAL_SIZE}
        closeOnEscape={!picker}
        footer={
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              {canMutate &&
              managing &&
              !managing.transferredToRaidItemId &&
              (managing.kind === 'risk' || managing.kind === 'issue') ? (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={pending || confirmDelete || Boolean(confirmTransfer)}
                  onClick={() =>
                    setConfirmTransfer(
                      managing.kind === 'risk' ? 'issue' : 'risk',
                    )
                  }
                >
                  {managing.kind === 'risk' ? t('moveToIssue') : t('moveToRisk')}
                </Button>
              ) : null}
              {canMutate ? (
                !confirmDelete ? (
                  <>
                    <Button
                      type="button"
                      variant="danger"
                      disabled={pending || Boolean(confirmTransfer)}
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
                  disabled={
                    pending ||
                    !title.trim() ||
                    confirmDelete ||
                    Boolean(confirmTransfer)
                  }
                  onClick={() => void submitUpdate()}
                >
                  {t('saveItem')}
                </Button>
              ) : null}
            </div>
          </div>
        }
      >
        {confirmTransfer ? (
          <div className="kh-ops-inset mb-3 grid gap-3">
            <p className="m-0 text-sm font-semibold text-ink">
              {confirmTransfer === 'issue'
                ? t('confirmMoveToIssue')
                : t('confirmMoveToRisk')}
            </p>
            <p className="m-0 text-sm text-ink-muted">{t('transferHint')}</p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="secondary"
                disabled={pending}
                onClick={() => setConfirmTransfer(null)}
              >
                {tCommon('cancel')}
              </Button>
              <Button
                type="button"
                disabled={pending}
                onClick={() => void submitTransfer(confirmTransfer)}
              >
                {confirmTransfer === 'issue'
                  ? t('moveToIssue')
                  : t('moveToRisk')}
              </Button>
            </div>
          </div>
        ) : null}
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
                onChange={(e) => setDeleteAcknowledged(e.target.checked)}
              />
              <span>{tArchive('deleteAcknowledge')}</span>
            </label>
          </div>
        ) : null}
        {tabbedForm(pending || confirmDelete || Boolean(confirmTransfer) || !canMutate, {
          managing: true,
        })}
      </Modal>

      <Modal
        open={picker !== null}
        onClose={closePicker}
        size="wide"
        title={t(picker === 'tasks' ? 'tasksAddTitle' : 'documentsAddTitle')}
        description={t(
          picker === 'tasks' ? 'tasksAddDescription' : 'documentsAddDescription',
        )}
        footer={
          <>
            <Button type="button" variant="secondary" onClick={closePicker}>
              {tCommon('cancel')}
            </Button>
            <Button
              type="button"
              disabled={addIds.length === 0}
              onClick={confirmPicker}
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
