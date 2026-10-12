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
  }>;
  records?: Array<{
    id: string;
    title: string;
    slug: string;
    recordType: string;
    humanKey?: string | null;
  }>;
};

type TaskOption = { id: string; title: string; status: string };
type RecordOption = {
  id: string;
  title: string;
  slug: string;
  humanKey?: string | null;
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
  records,
  members,
  initialOpenRaidId = null,
}: {
  projectId: string;
  canMutate: boolean;
  initialRaidItems: RaidItem[];
  tasks: TaskOption[];
  records: RecordOption[];
  members: Member[];
  initialOpenRaidId?: string | null;
}) {
  const t = useTranslations('raid');
  const tCommon = useTranslations('common');
  const tArchive = useTranslations('archive');
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
  const [taskIds, setTaskIds] = useState<string[]>([]);
  const [recordIds, setRecordIds] = useState<string[]>([]);
  const [removeIds, setRemoveIds] = useState<string[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [addIds, setAddIds] = useState<string[]>([]);
  const [recordQuery, setRecordQuery] = useState('');
  const [addPage, setAddPage] = useState(1);
  const [addPageSize, setAddPageSize] = useState<DocumentPageSize>(
    DEFAULT_DOCUMENT_PAGE_SIZE,
  );
  const [raidTab, setRaidTab] = useState<'details' | 'documents'>('details');

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
    setTaskIds(seed?.tasks.map((task) => task.id) ?? []);
    setRecordIds(seed?.records?.map((record) => record.id) ?? []);
    setRemoveIds([]);
    setAddOpen(false);
    setAddIds([]);
    setRecordQuery('');
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

  function toggleTask(taskId: string) {
    setTaskIds((prev) =>
      prev.includes(taskId)
        ? prev.filter((id) => id !== taskId)
        : [...prev, taskId],
    );
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

  function toggleAdd(recordId: string) {
    setAddIds((prev) =>
      prev.includes(recordId)
        ? prev.filter((id) => id !== recordId)
        : [...prev, recordId],
    );
  }

  function closeAddPicker() {
    setAddOpen(false);
    setAddIds([]);
    setRecordQuery('');
    setAddPage(1);
  }

  function confirmAddDocuments() {
    setRecordIds((prev) => [...new Set([...prev, ...addIds])]);
    closeAddPicker();
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
          taskIds,
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
          body: JSON.stringify({ taskIds }),
        },
      );
      const linksPayload = (await linksResponse.json().catch(() => ({}))) as {
        raidItem?: RaidItem;
        error?: { message?: string };
      };
      if (!linksResponse.ok || !linksPayload.raidItem) {
        throw new Error(linksPayload.error?.message || t('failedUpdate'));
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
        <Field label={t('linkedTasks')}>
          <div className="kh-ops-scope-checks max-h-48 overflow-auto">
            {tasks.length === 0 ? (
              <p className="m-0 text-sm text-ink-muted">{t('noTasks')}</p>
            ) : (
              <ul className="m-0 grid list-none gap-1 p-0">
                {tasks.map((task) => (
                  <li key={task.id}>
                    <label className="flex items-start gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={taskIds.includes(task.id)}
                        disabled={disabled}
                        onChange={() => toggleTask(task.id)}
                      />
                      <span>
                        {task.title}{' '}
                        <span className="text-ink-muted">({task.status})</span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Field>
      </div>
    );
  }

  function recordCatalog(): RecordOption[] {
    const catalog = new Map<string, RecordOption>();
    for (const record of records) catalog.set(record.id, record);
    for (const record of managing?.records ?? []) {
      if (!catalog.has(record.id)) catalog.set(record.id, record);
    }
    return [...catalog.values()];
  }

  function addDocumentsPicker() {
    const needle = recordQuery.trim().toLowerCase();
    const available = recordCatalog().filter((record) => {
      if (recordIds.includes(record.id)) return false;
      if (!needle) return true;
      const haystack = `${record.humanKey ?? ''} ${record.title}`.toLowerCase();
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
        <Input
          value={recordQuery}
          onChange={(event) => {
            setRecordQuery(event.target.value);
            setAddPage(1);
          }}
          placeholder={t('documentSearch')}
          data-modal-initial-focus
        />
        {available.length === 0 ? (
          <p className="m-0 text-sm text-ink-muted">
            {t(
              needle
                ? 'documentsNoneToAdd'
                : recordCatalog().length === 0
                  ? 'documentsEmpty'
                  : 'documentsAllLinked',
            )}
          </p>
        ) : (
          <>
            <ul className="m-0 grid list-none gap-2 p-0">
              {pageItems.map((record) => (
                <li key={record.id}>
                  <label className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={addIds.includes(record.id)}
                      onChange={() => toggleAdd(record.id)}
                    />
                    <span>
                      {record.humanKey ? (
                        <span className="text-ink-muted">{record.humanKey} · </span>
                      ) : null}
                      {record.title}
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
                  aria-label={t('documentsAddTitle')}
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

  function documentsPane(disabled: boolean) {
    const catalog = recordCatalog();
    const linked = catalog.filter((record) => recordIds.includes(record.id));
    const editable = canMutate && !disabled;
    return (
      <div className="grid gap-3">
        {editable ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="secondary" onClick={() => {
              setAddIds([]);
              setRecordQuery('');
              setAddPage(1);
              setAddOpen(true);
            }}
            >
              {t('documentsAdd')}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={removeIds.length === 0}
              onClick={deleteSelectedDocuments}
            >
              {t('documentsRemove')}
            </Button>
          </div>
        ) : null}
        {linked.length === 0 ? (
          <p className="m-0 text-sm text-ink-muted">{t('documentsReadOnlyEmpty')}</p>
        ) : (
          <ul className="m-0 grid list-none gap-2 p-0">
            {linked.map((record) => (
              <li key={record.id} className="kh-ops-linked-row kh-ops-linked-row-start">
                {editable ? (
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={removeIds.includes(record.id)}
                    onChange={() => toggleRemove(record.id)}
                    aria-label={t('documentsSelect', { title: record.title })}
                  />
                ) : null}
                <span>
                  {record.humanKey ? (
                    <span className="text-ink-muted">{record.humanKey} · </span>
                  ) : null}
                  <LinkedKnowledgeRecord slug={record.slug} title={record.title} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  function tabbedForm(disabled: boolean, options?: { managing?: boolean }) {
    return (
      <div>
        <div className="kh-ops-modal-tabs" role="tablist">
          {(['details', 'documents'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={raidTab === tab}
              className={raidTab === tab ? 'active' : undefined}
              onClick={() => setRaidTab(tab)}
            >
              {tab === 'details' ? t('tabDetails') : t('tabDocuments')}
            </button>
          ))}
        </div>
        <section
          className={`kh-ops-modal-pane${raidTab === 'details' ? ' active' : ''}`}
        >
          {formFields(disabled, options)}
        </section>
        <section
          className={`kh-ops-modal-pane${raidTab === 'documents' ? ' active' : ''}`}
        >
          {documentsPane(disabled)}
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
        closeOnEscape={!addOpen}
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
        closeOnEscape={!addOpen}
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
        open={addOpen}
        onClose={closeAddPicker}
        title={t('documentsAddTitle')}
        description={t('documentsAddDescription')}
        footer={
          <>
            <Button type="button" variant="secondary" onClick={closeAddPicker}>
              {tCommon('cancel')}
            </Button>
            <Button
              type="button"
              disabled={addIds.length === 0}
              onClick={confirmAddDocuments}
            >
              {t('documentsAddConfirm')}
            </Button>
          </>
        }
      >
        {addDocumentsPicker()}
      </Modal>
    </>
  );
}
