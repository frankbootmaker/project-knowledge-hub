'use client';

import { useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  Button,
  ErrorText,
  DELIVERY_ITEM_MODAL_SIZE,
  Field,
  Input,
  Modal,
  Select,
  Textarea,
  useToast,
} from './ui';
import { formatMoney } from '../lib/project-currency';
import {
  hoursCost,
  resolveRatePerson,
  sumEffortRollup,
  type RatePerson,
} from '../lib/task-costing';
import {
  deliveryCompletionIndex,
  displayedParentCompletion,
  formatPercentLabel,
  milestoneCompletion,
  parentDateDetail,
  type MilestoneLinkCompletion,
} from '../lib/delivery-completion';
import {
  DeliveryDocumentsEditor,
  saveDeliveryDocumentLinks,
  type DeliveryDocumentRecord,
} from './DeliveryDocumentsEditor';
import {
  DeliveryMediaEditor,
  saveItemMediaLinks,
  type ItemMediaDraft,
} from './DeliveryMediaEditor';
import {
  DeliveryDependenciesEditor,
  type DeliveryPredecessorRef,
} from './DeliveryDependenciesEditor';
import {
  MilestoneLinkedItemsEditor,
  milestoneLinkKey,
  type MilestoneLinkChoice,
} from './MilestoneLinkedItemsEditor';

const STATUSES = [
  'planned',
  'active',
  'in_progress',
  'blocked',
  'done',
  'cancelled',
] as const;

type EffortTask = {
  id: string;
  title?: string;
  status: string;
  epicId: string | null;
  userStoryId: string | null;
  forecastHours: string | number | null;
  actualHours: string | number | null;
  completionPercent?: number | null;
  startDate?: string | null;
  dueDate?: string | null;
  currentOwnerUserId: string | null;
  humanKey?: string | null;
  itemType?: 'task' | 'bug' | null;
  raci: Array<{ userId: string; role: string }>;
};

type Epic = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  startDate?: string | null;
  endDate?: string | null;
  humanKey?: string | null;
};

type Story = {
  id: string;
  epicId: string;
  title: string;
  description: string | null;
  status: string;
  startDate?: string | null;
  endDate?: string | null;
  humanKey?: string | null;
};

type MilestoneLink = {
  entityType: 'epic' | 'user_story' | 'task';
  entityId: string;
};

type Milestone = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  startDate?: string | null;
  targetDate?: string | null;
  humanKey?: string | null;
  completionPercent?: number | null;
  completion?: { percent: number; done: number; total: number } | null;
  linkedItems?: MilestoneLink[];
};

type LinkedDocument = {
  knowledgeRecordId: string;
  title: string;
  recordType: string;
  slug: string;
};

type AgileKind = 'epic' | 'story' | 'milestone';

export function ProjectAgileManageModal({
  open,
  onClose,
  kind,
  itemId,
  projectId,
  epics,
  stories,
  milestones = [],
  tasks = [],
  records = [],
  currency = 'EUR',
  ratePeople = [],
  canMutate,
  onSaved,
  onDeleted,
  onDependenciesChanged,
}: {
  open: boolean;
  onClose: () => void;
  kind: AgileKind | null;
  itemId: string | null;
  projectId: string;
  epics: Epic[];
  stories: Story[];
  milestones?: Milestone[];
  tasks?: EffortTask[];
  records?: DeliveryDocumentRecord[];
  currency?: string;
  ratePeople?: RatePerson[];
  canMutate: boolean;
  onSaved: (
    kind: AgileKind,
    item: Epic | Story | Milestone,
  ) => void;
  onDeleted: (kind: AgileKind, id: string) => void;
  onDependenciesChanged?: () => void;
}) {
  const t = useTranslations('delivery');
  const tBudget = useTranslations('budget');
  const tCommon = useTranslations('common');
  const tArchive = useTranslations('archive');
  const locale = useLocale();
  const { pushToast } = useToast();
  const dateLocks = useMemo(() => {
    if (!itemId || (kind !== 'epic' && kind !== 'story')) {
      return { start: false, end: false };
    }
    const taskSources = (storyId: string) =>
      tasks
        .filter((task) => task.userStoryId === storyId)
        .map((task) => ({
          status: task.status,
          start: task.startDate ?? null,
          end: task.dueDate ?? null,
        }));
    if (kind === 'story') {
      const detail = parentDateDetail({ start: null, end: null }, taskSources(itemId));
      return { start: detail.startDerived, end: detail.endDerived };
    }
    const children = stories
      .filter((story) => story.epicId === itemId)
      .map((story) => {
        const detail = parentDateDetail(
          { start: story.startDate ?? null, end: story.endDate ?? null },
          taskSources(story.id),
        );
        return { status: story.status, start: detail.start, end: detail.end };
      });
    const detail = parentDateDetail({ start: null, end: null }, children);
    return { start: detail.startDerived, end: detail.endDerived };
  }, [itemId, kind, stories, tasks]);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState('planned');
  const [epicId, setEpicId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [predecessorRefs, setPredecessorRefs] = useState<DeliveryPredecessorRef[]>([]);
  const [humanKey, setHumanKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteAcknowledged, setDeleteAcknowledged] = useState(false);
  const [linkedDocuments, setLinkedDocuments] = useState<LinkedDocument[]>([]);
  const [documentIds, setDocumentIds] = useState<string[]>([]);
  const [documentPickerOpen, setDocumentPickerOpen] = useState(false);
  const [agileTab, setAgileTab] = useState<
    'details' | 'linked' | 'documents' | 'media' | 'dependencies'
  >('details');
  const [linkedItemIds, setLinkedItemIds] = useState<string[]>([]);
  const [linkPickerOpen, setLinkPickerOpen] = useState(false);
  const [mediaDrafts, setMediaDrafts] = useState<ItemMediaDraft[] | null>(null);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const parentCompletionLabel = useMemo(() => {
    if ((kind !== 'epic' && kind !== 'story') || !itemId) return null;
    const index = deliveryCompletionIndex(tasks);
    const rollup =
      kind === 'epic'
        ? (index.byEpicId.get(itemId) ?? null)
        : (index.byStoryId.get(itemId) ?? null);
    const shown = displayedParentCompletion(status, rollup);
    if (!shown) return '—';
    return formatPercentLabel(shown.percent, locale);
  }, [itemId, kind, locale, status, tasks]);

  const linkChoices = useMemo<MilestoneLinkChoice[]>(() => {
    const index = deliveryCompletionIndex(tasks);
    const choices: MilestoneLinkChoice[] = [];
    for (const epic of epics) {
      const shown = displayedParentCompletion(
        epic.status,
        index.byEpicId.get(epic.id) ?? null,
      );
      choices.push({
        id: milestoneLinkKey('epic', epic.id),
        entityType: 'epic',
        entityId: epic.id,
        title: epic.title,
        humanKey: epic.humanKey ?? null,
        status: epic.status,
        completionPercent: shown?.percent ?? null,
      });
    }
    for (const story of stories) {
      const shown = displayedParentCompletion(
        story.status,
        index.byStoryId.get(story.id) ?? null,
      );
      choices.push({
        id: milestoneLinkKey('user_story', story.id),
        entityType: 'user_story',
        entityId: story.id,
        title: story.title,
        humanKey: story.humanKey ?? null,
        status: story.status,
        completionPercent: shown?.percent ?? null,
      });
    }
    for (const task of tasks) {
      if (!task.title) continue;
      choices.push({
        id: milestoneLinkKey('task', task.id),
        entityType: 'task',
        entityId: task.id,
        title: task.title,
        humanKey: task.humanKey ?? null,
        status: task.status,
        itemType: task.itemType === 'bug' ? 'bug' : 'task',
        completionPercent: task.completionPercent ?? null,
      });
    }
    return choices;
  }, [epics, stories, tasks]);

  const milestoneCompletionLabel = useMemo(() => {
    if (kind !== 'milestone') return null;
    const byId = new Map(linkChoices.map((row) => [row.id, row]));
    const index = deliveryCompletionIndex(tasks);
    const links: MilestoneLinkCompletion[] = [];
    for (const id of linkedItemIds) {
      const row = byId.get(id);
      if (!row) continue;
      if (row.entityType === 'task') {
        const task = tasks.find((item) => item.id === row.entityId);
        links.push({
          kind: 'task',
          status: task?.status ?? row.status,
          completionPercent: task?.completionPercent ?? null,
        });
        continue;
      }
      const raw =
        row.entityType === 'epic'
          ? index.byEpicId.get(row.entityId)
          : index.byStoryId.get(row.entityId);
      links.push({
        kind: 'parent',
        status: row.status,
        completionPercent: raw?.percent ?? null,
      });
    }
    for (const ref of predecessorRefs) {
      if (ref.entityType === 'task') {
        const task = tasks.find((item) => item.id === ref.id);
        links.push({
          kind: 'task',
          status: task?.status ?? ref.status ?? 'planned',
          completionPercent: task?.completionPercent ?? null,
        });
        continue;
      }
      if (ref.entityType === 'epic' || ref.entityType === 'user_story') {
        const row = ref.entityType === 'epic'
          ? epics.find((item) => item.id === ref.id)
          : stories.find((item) => item.id === ref.id);
        const raw = ref.entityType === 'epic'
          ? index.byEpicId.get(ref.id)
          : index.byStoryId.get(ref.id);
        const status = row?.status ?? ref.status ?? 'planned';
        links.push({
          kind: 'parent',
          status,
          completionPercent: status === 'done' ? 100 : raw?.percent ?? 0,
        });
        continue;
      }
      if (ref.entityType === 'sprint') {
        links.push(ref.status === 'cancelled'
          ? { kind: 'task', status: 'cancelled', completionPercent: 0 }
          : ref.status === 'completed'
            ? { kind: 'task', status: 'done', completionPercent: 100 }
            : { kind: 'task', status: 'in_progress', completionPercent: 0 });
        continue;
      }
      const milestone = milestones.find((item) => item.id === ref.id);
      const status = milestone?.status ?? ref.status ?? 'planned';
      links.push({
        kind: 'parent',
        status,
        completionPercent: status === 'done' || milestone?.completionPercent === 100
          ? 100
          : 0,
      });
    }
    const rollup = milestoneCompletion(links);
    if (!rollup) return '—';
    return formatPercentLabel(rollup.percent, locale);
  }, [epics, kind, linkChoices, linkedItemIds, locale, milestones, predecessorRefs, stories, tasks]);

  useEffect(() => {
    if (!open) return;
    void fetch(`/api/v1/projects/${projectId}`)
      .then(async (response) => {
        if (!response.ok) return;
        const payload = (await response.json()) as {
          project?: { workspaceId?: string };
        };
        setWorkspaceId(payload.project?.workspaceId ?? null);
      })
      .catch(() => setWorkspaceId(null));
  }, [open, projectId]);

  useEffect(() => {
    setPredecessorRefs([]);
  }, [itemId, open]);

  useEffect(() => {
    if (!open || !kind || !itemId) {
      setConfirmDelete(false);
      setDeleteAcknowledged(false);
      setError(null);
      setAgileTab('details');
      setLinkedDocuments([]);
      setDocumentIds([]);
      setHumanKey(null);
      setLinkedItemIds([]);
      return;
    }
    if (kind === 'epic') {
      const epic = epics.find((row) => row.id === itemId);
      if (!epic) return;
      setTitle(epic.title);
      setDescription(epic.description ?? '');
      setStatus(epic.status);
      setEpicId('');
      setStartDate(epic.startDate ?? '');
      setEndDate(epic.endDate ?? '');
      setTargetDate('');
      setHumanKey(epic.humanKey ?? null);
    } else if (kind === 'story') {
      const story = stories.find((row) => row.id === itemId);
      if (!story) return;
      setTitle(story.title);
      setDescription(story.description ?? '');
      setStatus(story.status);
      setEpicId(story.epicId);
      setStartDate(story.startDate ?? '');
      setEndDate(story.endDate ?? '');
      setTargetDate('');
      setHumanKey(story.humanKey ?? null);
    } else {
      const milestone = milestones.find((row) => row.id === itemId);
      if (!milestone) return;
      setTitle(milestone.title);
      setDescription(milestone.description ?? '');
      setStatus(milestone.status);
      setEpicId('');
      setStartDate(milestone.startDate ?? '');
      setEndDate('');
      setTargetDate(milestone.targetDate ?? '');
      setHumanKey(milestone.humanKey ?? null);
      setLinkedItemIds(
        (milestone.linkedItems ?? []).map((item) =>
          milestoneLinkKey(item.entityType, item.entityId),
        ),
      );
    }
    setConfirmDelete(false);
    setDeleteAcknowledged(false);
    setError(null);

    const entityType =
      kind === 'epic' ? 'epic' : kind === 'story' ? 'user_story' : 'milestone';
    void fetch(
      `/api/v1/projects/${projectId}/delivery-document-links?entityType=${entityType}&entityId=${itemId}`,
    )
      .then(async (response) => {
        if (!response.ok) {
          setLinkedDocuments([]);
          return;
        }
        const payload = (await response.json()) as {
          documentLinks?: LinkedDocument[];
        };
        const links = payload.documentLinks ?? [];
        setLinkedDocuments(links);
        setDocumentIds(links.map((doc) => doc.knowledgeRecordId));
      })
      .catch(() => {
        setLinkedDocuments([]);
        setDocumentIds([]);
      });
  }, [open, kind, itemId, epics, stories, milestones, projectId]);

  async function save() {
    if (!kind || !itemId || !canMutate || !title.trim()) return;
    if (kind === 'story' && !epicId) return;
    setPending(true);
    setError(null);
    try {
      const path =
        kind === 'epic'
          ? `/api/v1/project-epics/${itemId}`
          : kind === 'story'
            ? `/api/v1/project-user-stories/${itemId}`
            : `/api/v1/project-milestones/${itemId}`;
      const writableDates = {
        ...(dateLocks.start ? {} : { startDate: startDate || null }),
        ...(dateLocks.end ? {} : { endDate: endDate || null }),
      };
      const body =
        kind === 'epic'
          ? {
              title: title.trim(),
              description: description.trim() || null,
              status,
              ...writableDates,
            }
          : kind === 'story'
            ? {
                title: title.trim(),
                description: description.trim() || null,
                status,
                epicId,
                ...writableDates,
              }
            : {
                title: title.trim(),
                description: description.trim() || null,
                status,
                targetDate: targetDate || null,
              };
      const response = await fetch(path, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        epic?: Epic;
        userStory?: Story;
        milestone?: Milestone;
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(
          payload.error?.message ||
            (kind === 'epic'
              ? t('failedUpdateEpic')
              : kind === 'story'
                ? t('failedUpdateStory')
                : t('failedUpdateMilestone')),
        );
      }
      const saved =
        kind === 'epic'
          ? payload.epic
          : kind === 'story'
            ? payload.userStory
            : payload.milestone;
      if (!saved) {
        throw new Error(
          kind === 'epic'
            ? t('failedUpdateEpic')
            : kind === 'story'
              ? t('failedUpdateStory')
              : t('failedUpdateMilestone'),
        );
      }
      const entityType =
        kind === 'epic' ? 'epic' : kind === 'story' ? 'user_story' : 'milestone';
      await saveDeliveryDocumentLinks({
        projectId,
        entityType,
        entityId: itemId,
        recordIds: documentIds,
      });
      if (mediaDrafts) {
        await saveItemMediaLinks({
          projectId,
          entityType,
          entityId: itemId,
          links: mediaDrafts,
        });
      }
      let savedItem = saved;
      if (kind === 'milestone') {
        const linkResponse = await fetch(
          `/api/v1/project-milestones/${itemId}/item-links`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              items: linkedItemIds.flatMap((id) => {
                const row = linkChoices.find((choice) => choice.id === id);
                if (!row) return [];
                return [{ entityType: row.entityType, entityId: row.entityId }];
              }),
            }),
          },
        );
        const linkPayload = (await linkResponse.json().catch(() => ({}))) as {
          milestone?: Milestone;
          error?: { message?: string };
        };
        if (!linkResponse.ok || !linkPayload.milestone) {
          throw new Error(linkPayload.error?.message || t('failedUpdateMilestone'));
        }
        savedItem = linkPayload.milestone;
      }
      onSaved(kind, savedItem);
      pushToast(
        kind === 'epic'
          ? t('epicUpdated')
          : kind === 'story'
            ? t('storyUpdated')
            : t('milestoneUpdated'),
        'success',
      );
      onClose();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : kind === 'epic'
            ? t('failedUpdateEpic')
            : kind === 'story'
              ? t('failedUpdateStory')
              : t('failedUpdateMilestone'),
      );
    } finally {
      setPending(false);
    }
  }

  async function remove() {
    if (!kind || !itemId || !canMutate || kind === 'milestone') return;
    setPending(true);
    setError(null);
    try {
      const path =
        kind === 'epic'
          ? `/api/v1/project-epics/${itemId}`
          : `/api/v1/project-user-stories/${itemId}`;
      const response = await fetch(path, { method: 'DELETE' });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(
          payload.error?.message ||
            (kind === 'epic' ? t('failedDeleteEpic') : t('failedDeleteStory')),
        );
      }
      onDeleted(kind, itemId);
      pushToast(
        kind === 'epic' ? t('epicDeleted') : t('storyDeleted'),
        'success',
      );
      onClose();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : kind === 'epic'
            ? t('failedDeleteEpic')
            : t('failedDeleteStory'),
      );
    } finally {
      setPending(false);
      setConfirmDelete(false);
    }
  }

  const modalTitle =
    kind === 'epic'
      ? t('manageEpic')
      : kind === 'story'
        ? t('manageStory')
        : kind === 'milestone'
          ? t('manageMilestone')
          : t('manage');

  const modalDescription =
    kind === 'epic'
      ? t('manageEpicDescription')
      : kind === 'story'
        ? t('manageStoryDescription')
        : kind === 'milestone'
          ? t('manageMilestoneDescription')
          : undefined;

  const rateMap = useMemo(() => {
    const map = new Map<string, RatePerson>();
    for (const person of ratePeople) {
      map.set(person.userId, person);
    }
    return map;
  }, [ratePeople]);

  const effortRollup = useMemo(() => {
    if (!kind || !itemId || kind === 'milestone') return null;
    const scoped =
      kind === 'epic'
        ? tasks.filter((task) => task.epicId === itemId)
        : tasks.filter((task) => task.userStoryId === itemId);
    const withCosts = scoped.map((task) => {
      const person = resolveRatePerson(
        task.currentOwnerUserId,
        task.raci,
        rateMap,
      );
      const fh =
        typeof task.forecastHours === 'string'
          ? Number(task.forecastHours)
          : task.forecastHours;
      const ah =
        typeof task.actualHours === 'string'
          ? Number(task.actualHours)
          : task.actualHours;
      return {
        ...task,
        forecastHours: fh,
        actualHours: ah,
        forecastCost: hoursCost(fh, person?.hourlyRate),
        actualCost: hoursCost(ah, person?.hourlyRate),
      };
    });
    return sumEffortRollup(withCosts);
  }, [kind, itemId, tasks, rateMap]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        humanKey
          ? `${humanKey} · ${title.trim() || modalTitle}`
          : title.trim() || modalTitle
      }
      description={modalDescription}
      size={DELIVERY_ITEM_MODAL_SIZE}
      closeOnEscape={!documentPickerOpen && !linkPickerOpen}
      tabs={
        <div className="kh-ops-modal-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={agileTab === 'details'}
            className={agileTab === 'details' ? 'active' : undefined}
            onClick={() => setAgileTab('details')}
          >
            {t('tabDetails')}
          </button>
          {kind === 'milestone' ? (
            <button
              type="button"
              role="tab"
              aria-selected={agileTab === 'linked'}
              className={agileTab === 'linked' ? 'active' : undefined}
              onClick={() => setAgileTab('linked')}
            >
              {t('tabLinkedItems')}
            </button>
          ) : null}
          <button
            type="button"
            role="tab"
            aria-selected={agileTab === 'documents'}
            className={agileTab === 'documents' ? 'active' : undefined}
            onClick={() => setAgileTab('documents')}
          >
            {t('tabDocuments')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={agileTab === 'media'}
            className={agileTab === 'media' ? 'active' : undefined}
            onClick={() => setAgileTab('media')}
          >
            {t('tabMedia')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={agileTab === 'dependencies'}
            className={agileTab === 'dependencies' ? 'active' : undefined}
            onClick={() => setAgileTab('dependencies')}
          >
            {t('tabDependencies')}
          </button>
        </div>
      }
      footer={
        <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center">
            {canMutate && kind && kind !== 'milestone' ? (
              !confirmDelete ? (
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
              ) : (
                <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center">
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
                    onClick={() => void remove()}
                  >
                    {kind === 'epic'
                      ? t('confirmDeleteEpic')
                      : t('confirmDeleteStory')}
                  </Button>
                </div>
              )
            ) : null}
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center">
            <Button type="button" variant="secondary" onClick={onClose}>
              {tCommon('cancel')}
            </Button>
            {canMutate ? (
              <Button
                type="button"
                disabled={
                  pending ||
                  !title.trim() ||
                  (kind === 'story' && !epicId) ||
                  confirmDelete
                }
                onClick={() => void save()}
              >
                {kind === 'epic'
                  ? t('saveEpic')
                  : kind === 'story'
                    ? t('saveStory')
                    : t('saveMilestone')}
              </Button>
            ) : null}
          </div>
        </div>
      }
    >
      {error ? (
        <div className="mb-3">
          <ErrorText>{error}</ErrorText>
        </div>
      ) : null}
      {confirmDelete && kind && kind !== 'milestone' ? (
        <div className="kh-ops-confirm mb-3">
          <p className="m-0 text-sm font-semibold text-danger">
            {kind === 'epic'
              ? t('confirmDeleteEpicTitle', {
                  title: title.trim() || t('kindEpic'),
                })
              : t('confirmDeleteStoryTitle', {
                  title: title.trim() || t('kindStory'),
                })}
          </p>
          <p className="m-0 text-sm text-danger">
            {kind === 'epic' ? t('deleteEpicHint') : t('deleteStoryHint')}
          </p>
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
      <section className={`kh-ops-modal-pane${agileTab === 'details' ? ' active' : ''}`}>
      <div className="kh-ops-form-grid">
        {effortRollup ? (
          <div className="kh-ops-inset kh-ops-field-span text-sm">
            <p className="mt-0 mb-1 text-xs font-medium uppercase tracking-wide text-ink-muted">
              {tBudget('effortRollup')}
            </p>
            <p className="m-0 text-ink">
              {tBudget('effortRollupValues', {
                forecastHours: effortRollup.forecastHours,
                actualHours: effortRollup.actualHours,
                forecastCost: formatMoney(
                  effortRollup.forecastCost,
                  currency,
                  locale,
                ),
                actualCost: formatMoney(
                  effortRollup.actualCost,
                  currency,
                  locale,
                ),
              })}
            </p>
          </div>
        ) : null}
        <Field
          className={kind === 'milestone' ? undefined : 'kh-ops-field-span'}
          label={
            kind === 'epic'
              ? t('epicTitle')
              : kind === 'story'
                ? t('storyTitle')
                : t('milestoneTitle')
          }
        >
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={pending || !canMutate || confirmDelete}
            data-modal-initial-focus
          />
        </Field>
        {kind === 'story' ? (
          <Field label={t('kindEpic')}>
            <Select
              value={epicId}
              onChange={(e) => setEpicId(e.target.value)}
              disabled={pending || !canMutate || confirmDelete}
            >
              <option value="">{t('selectEpic')}</option>
              {epics.map((epic) => (
                <option key={epic.id} value={epic.id}>
                  {epic.title}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        <Field label={t('statusField')}>
          <Select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            disabled={pending || !canMutate || confirmDelete}
          >
            {STATUSES.map((value) => (
              <option key={value} value={value}>
                {t(`milestoneStatus.${value}`)}
              </option>
            ))}
          </Select>
        </Field>
        {kind === 'epic' || kind === 'story' ? (
          <Field label={t('completionField')}>
            <Input value={parentCompletionLabel ?? '—'} readOnly disabled />
          </Field>
        ) : null}
        {kind === 'milestone' ? (
          <>
            <Field label={t('dueDate')}>
              <Input
                type="date"
                value={targetDate}
                onChange={(e) => setTargetDate(e.target.value)}
                disabled={pending || !canMutate || confirmDelete}
              />
            </Field>
            <Field label={t('completionField')}>
              <Input value={milestoneCompletionLabel ?? '—'} readOnly disabled />
            </Field>
          </>
        ) : (
          <>
            <Field className="kh-ops-field-row-start" label={t('startDate')}>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                disabled={pending || !canMutate || confirmDelete || dateLocks.start}
                readOnly={dateLocks.start}
              />
            </Field>
            <Field label={t('endDate')}>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                disabled={pending || !canMutate || confirmDelete || dateLocks.end}
                readOnly={dateLocks.end}
              />
            </Field>
            {dateLocks.start || dateLocks.end ? (
              <p className="kh-ops-field-span m-0 text-xs text-ink-muted">
                {t('datesFromChildren')}
              </p>
            ) : null}
          </>
        )}
        <Field
          className={kind === 'milestone' ? undefined : 'kh-ops-field-span'}
          label={kind === 'milestone' ? t('milestoneNote') : t('description')}
        >
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={pending || !canMutate || confirmDelete}
            rows={4}
          />
        </Field>
      </div>
      </section>
      {kind === 'milestone' ? (
        <section className={`kh-ops-modal-pane${agileTab === 'linked' ? ' active' : ''}`}>
          <MilestoneLinkedItemsEditor
            items={linkChoices}
            linkedIds={linkedItemIds}
            onChange={setLinkedItemIds}
            canEdit={canMutate}
            disabled={pending || confirmDelete}
            onPickerOpenChange={setLinkPickerOpen}
          />
        </section>
      ) : null}
      <section className={`kh-ops-modal-pane${agileTab === 'documents' ? ' active' : ''}`}>
        <DeliveryDocumentsEditor
          records={records}
          linkedRecords={linkedDocuments.map((doc) => ({
            id: doc.knowledgeRecordId,
            title: doc.title,
            slug: doc.slug,
            recordType: doc.recordType,
          }))}
          linkedIds={documentIds}
          onChange={setDocumentIds}
          canEdit={canMutate}
          disabled={pending || confirmDelete}
          onPickerOpenChange={setDocumentPickerOpen}
        />
      </section>
      <section className={`kh-ops-modal-pane${agileTab === 'media' ? ' active' : ''}`}>
        {itemId && kind ? (
          <DeliveryMediaEditor
            projectId={projectId}
            workspaceId={workspaceId}
            entityType={
              kind === 'epic' ? 'epic' : kind === 'story' ? 'user_story' : 'milestone'
            }
            entityId={itemId}
            canEdit={canMutate}
            disabled={pending || confirmDelete}
            onDraftsChange={setMediaDrafts}
          />
        ) : null}
      </section>
      <section
        className={`kh-ops-modal-pane${agileTab === 'dependencies' ? ' active' : ''}`}
      >
        {itemId && kind ? (
          <DeliveryDependenciesEditor
            projectId={projectId}
            entityType={
              kind === 'epic' ? 'epic' : kind === 'story' ? 'user_story' : 'milestone'
            }
            entityId={itemId}
            canEdit={canMutate && !pending && !confirmDelete}
            onPredecessors={setPredecessorRefs}
            onScheduled={(write) => {
              if (write) {
                setStartDate(write.startDate ?? '');
                if (kind === 'milestone') setTargetDate(write.finishDate ?? '');
                else setEndDate(write.finishDate ?? '');
              }
              onDependenciesChanged?.();
            }}
          />
        ) : null}
      </section>
    </Modal>
  );
}
