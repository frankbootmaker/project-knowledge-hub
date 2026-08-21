'use client';

import { useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  Badge,
  Button,
  ErrorText,
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

const STATUSES = ['planned', 'active', 'done', 'cancelled'] as const;

type EffortTask = {
  id: string;
  status: string;
  epicId: string | null;
  userStoryId: string | null;
  forecastHours: string | number | null;
  actualHours: string | number | null;
  currentOwnerUserId: string | null;
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

type Milestone = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  startDate?: string | null;
  targetDate?: string | null;
  humanKey?: string | null;
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
  currency = 'EUR',
  ratePeople = [],
  canMutate,
  onSaved,
  onDeleted,
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
  currency?: string;
  ratePeople?: RatePerson[];
  canMutate: boolean;
  onSaved: (
    kind: AgileKind,
    item: Epic | Story | Milestone,
  ) => void;
  onDeleted: (kind: AgileKind, id: string) => void;
}) {
  const t = useTranslations('delivery');
  const tBudget = useTranslations('budget');
  const tCommon = useTranslations('common');
  const tArchive = useTranslations('archive');
  const tRecords = useTranslations('records');
  const locale = useLocale();
  const { pushToast } = useToast();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState('planned');
  const [epicId, setEpicId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [humanKey, setHumanKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteAcknowledged, setDeleteAcknowledged] = useState(false);
  const [linkedDocuments, setLinkedDocuments] = useState<LinkedDocument[]>([]);

  useEffect(() => {
    if (!open || !kind || !itemId) {
      setConfirmDelete(false);
      setDeleteAcknowledged(false);
      setError(null);
      setLinkedDocuments([]);
      setHumanKey(null);
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
        setLinkedDocuments(payload.documentLinks ?? []);
      })
      .catch(() => setLinkedDocuments([]));
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
      const body =
        kind === 'epic'
          ? {
              title: title.trim(),
              description: description.trim() || null,
              status,
              startDate: startDate || null,
              endDate: endDate || null,
            }
          : kind === 'story'
            ? {
                title: title.trim(),
                description: description.trim() || null,
                status,
                epicId,
                startDate: startDate || null,
                endDate: endDate || null,
              }
            : {
                title: title.trim(),
                description: description.trim() || null,
                status,
                startDate: startDate || null,
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
      onSaved(kind, saved);
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
      size="md"
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
      <div className="kh-ops-form-grid">
        {effortRollup ? (
          <div className="kh-ops-inset text-sm">
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
        <Field label={t('filterStatus')}>
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
        {kind === 'milestone' ? (
          <div className="kh-ops-form-grid">
            <Field label={t('startDate')}>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                disabled={pending || !canMutate || confirmDelete}
              />
            </Field>
            <Field label={t('targetDate')}>
              <Input
                type="date"
                value={targetDate}
                onChange={(e) => setTargetDate(e.target.value)}
                disabled={pending || !canMutate || confirmDelete}
              />
            </Field>
          </div>
        ) : (
          <div className="kh-ops-form-grid">
            <Field label={t('startDate')}>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                disabled={pending || !canMutate || confirmDelete}
              />
            </Field>
            <Field label={t('endDate')}>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                disabled={pending || !canMutate || confirmDelete}
              />
            </Field>
          </div>
        )}
        <Field label={t('description')}>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={pending || !canMutate || confirmDelete}
            rows={4}
          />
        </Field>
        <div className="rounded-md border border-line bg-panel-solid p-3">
          <p className="mt-0 mb-2 text-sm font-semibold">{t('linkedDocuments')}</p>
          {linkedDocuments.length === 0 ? (
            <p className="m-0 text-sm text-ink-muted">{t('linkedDocumentsEmpty')}</p>
          ) : (
            <ul className="m-0 grid list-none gap-1 p-0">
              {linkedDocuments.map((doc) => (
                <li key={doc.knowledgeRecordId} className="text-sm">
                  <Badge>{tRecords(`typeLabels.${doc.recordType}`)}</Badge>{' '}
                  {doc.title}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Modal>
  );
}
