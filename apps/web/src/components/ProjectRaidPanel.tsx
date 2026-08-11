'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  CatalogueSection,
  type CatalogueListItem,
} from './CatalogueSection';
import { CollapsibleSection } from './CollapsibleSection';
import {
  Badge,
  Button,
  ErrorText,
  Field,
  Input,
  Modal,
  Panel,
  Select,
  Textarea,
  raidSeverityTone,
  useToast,
} from './ui';

export type RaidItem = {
  id: string;
  kind: string;
  title: string;
  description: string | null;
  status: string;
  severity: string;
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
};

type TaskOption = { id: string; title: string; status: string };
type Member = { userId: string; displayName: string; email: string };

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
  members,
}: {
  projectId: string;
  canMutate: boolean;
  initialRaidItems: RaidItem[];
  tasks: TaskOption[];
  members: Member[];
}) {
  const t = useTranslations('raid');
  const tCommon = useTranslations('common');
  const tWorkspaces = useTranslations('workspaces');
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
  const [ownerUserId, setOwnerUserId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [taskIds, setTaskIds] = useState<string[]>([]);

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
    setOwnerUserId(seed?.ownerUserId ?? '');
    setDueDate(seed?.dueDate ?? '');
    setTaskIds(seed?.tasks.map((task) => task.id) ?? []);
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

  const catalogueItems: CatalogueListItem[] = useMemo(
    () =>
      items.map((item) => ({
        id: item.id,
        title: item.title,
        primaryBadge: item.humanKey ?? t(`kind.${item.kind}`),
        secondaryBadge: t(`status.${item.status}`),
        subtitle: [
          t(`kind.${item.kind}`),
          t(`severity.${item.severity}`),
          item.owner?.displayName
            ? `${t('owner')}: ${item.owner.displayName}`
            : null,
          item.dueDate ? `${t('dueDate')}: ${item.dueDate}` : null,
          item.tasks.length > 0
            ? t('linkedTasksCount', { count: item.tasks.length })
            : null,
        ]
          .filter(Boolean)
          .join(' · '),
        updatedAt: item.updatedAt ?? item.createdAt ?? null,
        searchText: [
          item.title,
          item.humanKey ?? '',
          item.description ?? '',
          item.kind,
          item.status,
          item.severity,
          item.owner?.displayName ?? '',
          ...item.tasks.map((task) => task.title),
        ]
          .join(' ')
          .toLowerCase(),
        filterValue: `${item.kind}:${item.status}`,
        filterLabel: `${t(`kind.${item.kind}`)} · ${t(`status.${item.status}`)}`,
      })),
    [items, t],
  );

  function toggleTask(taskId: string) {
    setTaskIds((prev) =>
      prev.includes(taskId)
        ? prev.filter((id) => id !== taskId)
        : [...prev, taskId],
    );
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
          ownerUserId: ownerUserId || null,
          dueDate: dueDate || null,
          taskIds,
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

      setItems((prev) =>
        prev.map((item) =>
          item.id === manageId ? linksPayload.raidItem! : item,
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
          <Panel variant="inset" className="border-brand/30 bg-brand/5">
            <p className="m-0 text-sm text-ink">
              {t('transferredFromBanner', {
                key: managing.transferredFromHumanKey,
              })}
            </p>
          </Panel>
        ) : null}
        {options?.managing && managing?.transferredToHumanKey ? (
          <Panel variant="inset" className="border-brand/30 bg-brand/5">
            <p className="m-0 text-sm text-ink">
              {t('transferredToBanner', {
                key: managing.transferredToHumanKey,
              })}
            </p>
          </Panel>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
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
        <div className="grid gap-3 sm:grid-cols-2">
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
          <div className="max-h-48 overflow-auto rounded-md border border-line p-2">
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

  return (
    <>
      <CollapsibleSection
        storageKey={`project:${projectId}:raid`}
        title={t('title')}
        defaultOpen
      >
        {error && !createOpen && !manageId ? (
          <div className="mb-3">
            <ErrorText>{error}</ErrorText>
          </div>
        ) : null}

        <CatalogueSection
          className="mb-2"
          title={t('title')}
          showTitle={false}
          items={catalogueItems}
          emptyLabel={t('empty')}
          searchPlaceholder={t('searchPlaceholder')}
          filterLabel={t('filterLabel')}
          filterAllLabel={tWorkspaces('sectionFilterAll')}
          createLabel={t('addItem')}
          canCreate={canMutate}
          onCreate={() => {
            resetForm();
            setCreateOpen(true);
          }}
          renderItem={(item) => {
            const raid = items.find((row) => row.id === item.id);
            return (
              <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {raid?.humanKey ? (
                      <Badge tone="brand" className="font-mono">
                        {raid.humanKey}
                      </Badge>
                    ) : item.primaryBadge ? (
                      <Badge tone="brand">{item.primaryBadge}</Badge>
                    ) : null}
                    <span className="font-semibold">{item.title}</span>
                    {raid ? (
                      <Badge>{t(`kind.${raid.kind}`)}</Badge>
                    ) : null}
                    {item.secondaryBadge ? (
                      <Badge>{item.secondaryBadge}</Badge>
                    ) : null}
                    {raid ? (
                      <Badge tone={raidSeverityTone(raid.severity)}>
                        {t(`severity.${raid.severity}`)}
                      </Badge>
                    ) : null}
                  </div>
                  {item.subtitle ? (
                    <p className="mt-2 mb-0 text-sm text-ink-muted">
                      {item.subtitle}
                    </p>
                  ) : null}
                  {raid && raid.tasks.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {raid.tasks.map((task) => (
                        <Badge key={task.id}>{task.title}</Badge>
                      ))}
                    </div>
                  ) : null}
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  className="w-full sm:w-auto"
                  onClick={() => setManageId(item.id)}
                >
                  {t('manage')}
                </Button>
              </div>
            );
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
        size="md"
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
        {formFields(pending)}
      </Modal>

      <Modal
        open={Boolean(manageId)}
        onClose={() => setManageId(null)}
        title={title.trim() || t('manageItem')}
        description={t('manageDescription')}
        size="md"
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
          <Panel
            variant="inset"
            className="mb-3 grid gap-3 border-brand/40 bg-brand/5"
          >
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
          </Panel>
        ) : null}
        {confirmDelete ? (
          <Panel
            variant="inset"
            className="mb-3 grid gap-3 border-danger/40 bg-danger/5"
          >
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
          </Panel>
        ) : null}
        {formFields(pending || confirmDelete || Boolean(confirmTransfer) || !canMutate, {
          managing: true,
        })}
      </Modal>
    </>
  );
}
