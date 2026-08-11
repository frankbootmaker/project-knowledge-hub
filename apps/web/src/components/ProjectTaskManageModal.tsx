'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
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
  raidSeverityTone,
  useToast,
} from './ui';
import { cn } from '../lib/cn';
import {
  deliveryScheduleSurfaceClass,
  deliveryScheduleTone,
  todayYmd,
} from '../lib/delivery-schedule';
import { formatMoney } from '../lib/project-currency';
import {
  hoursCost,
  parseHoursInput,
  resolveRatePerson,
  type RatePerson,
} from '../lib/task-costing';

type RaciEntry = {
  userId: string;
  displayName: string;
  email: string;
  role: 'R' | 'A' | 'C' | 'I';
};

type TaskOwner = {
  userId: string;
  displayName: string;
  email: string;
};

type TaskDetail = {
  id: string;
  projectId: string;
  title: string;
  description: string | null;
  status: string;
  dueDate: string | null;
  forecastHours: string | null;
  actualHours: string | null;
  milestoneId: string | null;
  userStoryId: string | null;
  userStoryTitle: string | null;
  epicId: string | null;
  epicTitle: string | null;
  currentOwnerUserId: string | null;
  currentOwner: TaskOwner | null;
  raci: RaciEntry[];
};

type Activity = {
  id: string;
  type: string;
  body: string | null;
  actorDisplayName: string | null;
  createdAt: string;
  metadata: Record<string, unknown> | null;
};

type Member = {
  userId: string;
  displayName: string;
  email: string;
};

type Epic = { id: string; title: string };
type Story = { id: string; epicId: string; title: string };
type Milestone = { id: string; title: string };

type LinkedRaid = {
  id: string;
  kind: string;
  title: string;
  status: string;
  severity: string;
  humanKey?: string | null;
};

type LinkedDocument = {
  knowledgeRecordId: string;
  title: string;
  recordType: string;
  slug: string;
};

const TASK_STATUSES = ['todo', 'in_progress', 'blocked', 'done', 'cancelled'] as const;

export function ProjectTaskManageModal({
  open,
  onClose,
  taskId,
  canMutate,
  members: membersProp,
  epics: epicsProp,
  stories: storiesProp,
  milestones: milestonesProp,
  currency = 'EUR',
  ratePeople = [],
  onUpdated,
  onDeleted,
}: {
  open: boolean;
  onClose: () => void;
  taskId: string | null;
  canMutate: boolean;
  members?: Member[];
  epics?: Epic[];
  stories?: Story[];
  milestones?: Milestone[];
  currency?: string;
  ratePeople?: RatePerson[];
  onUpdated?: (task: TaskDetail) => void;
  onDeleted?: (taskId: string) => void;
}) {
  const t = useTranslations('delivery');
  const tBudget = useTranslations('budget');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const { pushToast } = useToast();

  const [task, setTask] = useState<TaskDetail | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [members, setMembers] = useState<Member[]>(membersProp ?? []);
  const [epics, setEpics] = useState<Epic[]>(epicsProp ?? []);
  const [stories, setStories] = useState<Story[]>(storiesProp ?? []);
  const [milestones, setMilestones] = useState<Milestone[]>(milestonesProp ?? []);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [comment, setComment] = useState('');
  const [handoffTo, setHandoffTo] = useState('');
  const [handoffNote, setHandoffNote] = useState('');
  const [title, setTitle] = useState('');
  const [status, setStatus] = useState('todo');
  const [dueDate, setDueDate] = useState('');
  const [forecastHours, setForecastHours] = useState('');
  const [actualHours, setActualHours] = useState('');
  const [description, setDescription] = useState('');
  const [milestoneId, setMilestoneId] = useState('');
  const [userStoryId, setUserStoryId] = useState('');
  const [linkedRaid, setLinkedRaid] = useState<LinkedRaid[]>([]);
  const [linkedDocuments, setLinkedDocuments] = useState<LinkedDocument[]>([]);
  const tRaid = useTranslations('raid');
  const tRecords = useTranslations('records');

  const rateMap = useMemo(() => {
    const map = new Map<string, RatePerson>();
    for (const person of ratePeople) {
      map.set(person.userId, person);
    }
    return map;
  }, [ratePeople]);

  const load = useCallback(async () => {
    if (!taskId) return;
    setError(null);
    try {
      const [taskRes, actRes, raidRes] = await Promise.all([
        fetch(`/api/v1/project-tasks/${taskId}`),
        fetch(`/api/v1/project-tasks/${taskId}/activities`),
        fetch(`/api/v1/project-tasks/${taskId}/raid-items`),
      ]);
      const taskPayload = (await taskRes.json().catch(() => ({}))) as {
        task?: TaskDetail;
        error?: { message?: string };
      };
      if (!taskRes.ok || !taskPayload.task) {
        throw new Error(taskPayload.error?.message || t('failedLoadTask'));
      }
      const loaded = taskPayload.task;
      setTask(loaded);
      setTitle(loaded.title);
      setStatus(loaded.status);
      setDueDate(loaded.dueDate ?? '');
      setForecastHours(
        loaded.forecastHours != null ? String(loaded.forecastHours) : '',
      );
      setActualHours(
        loaded.actualHours != null ? String(loaded.actualHours) : '',
      );
      setDescription(loaded.description ?? '');
      setMilestoneId(loaded.milestoneId ?? '');
      setUserStoryId(loaded.userStoryId ?? '');

      const actPayload = (await actRes.json().catch(() => ({}))) as {
        activities?: Activity[];
      };
      setActivities(actPayload.activities ?? []);

      if (raidRes.ok) {
        const raidPayload = (await raidRes.json()) as { raidItems?: LinkedRaid[] };
        setLinkedRaid(raidPayload.raidItems ?? []);
      } else {
        setLinkedRaid([]);
      }

      const docsRes = await fetch(
        `/api/v1/projects/${loaded.projectId}/delivery-document-links?entityType=task&entityId=${taskId}`,
      );
      if (docsRes.ok) {
        const docsPayload = (await docsRes.json()) as {
          documentLinks?: LinkedDocument[];
        };
        setLinkedDocuments(docsPayload.documentLinks ?? []);
      } else {
        setLinkedDocuments([]);
      }

      if (!membersProp || !epicsProp || !storiesProp || !milestonesProp) {
        const [epicRes, storyRes, mileRes, memberRes] = await Promise.all([
          fetch(`/api/v1/projects/${loaded.projectId}/epics`),
          fetch(`/api/v1/projects/${loaded.projectId}/user-stories`),
          fetch(`/api/v1/projects/${loaded.projectId}/milestones`),
          fetch(
            // workspace members — resolve via project context from task page props when absent
            `/api/v1/projects/${loaded.projectId}`,
          ),
        ]);
        if (!epicsProp && epicRes.ok) {
          const payload = (await epicRes.json()) as { epics: Epic[] };
          setEpics(payload.epics ?? []);
        }
        if (!storiesProp && storyRes.ok) {
          const payload = (await storyRes.json()) as { userStories: Story[] };
          setStories(payload.userStories ?? []);
        }
        if (!milestonesProp && mileRes.ok) {
          const payload = (await mileRes.json()) as { milestones: Milestone[] };
          setMilestones(payload.milestones ?? []);
        }
        if (!membersProp && memberRes.ok) {
          const projectPayload = (await memberRes.json()) as {
            project?: { workspaceId?: string };
          };
          const workspaceId = projectPayload.project?.workspaceId;
          if (workspaceId) {
            const memRes = await fetch(`/api/v1/workspaces/${workspaceId}/members`);
            if (memRes.ok) {
              const memPayload = (await memRes.json()) as { members: Member[] };
              setMembers(memPayload.members ?? []);
            }
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('failedLoadTask'));
    }
  }, [
    taskId,
    t,
    membersProp,
    epicsProp,
    storiesProp,
    milestonesProp,
  ]);

  useEffect(() => {
    if (!open || !taskId) {
      setTask(null);
      setActivities([]);
      setComment('');
      setHandoffTo('');
      setHandoffNote('');
      setError(null);
      setConfirmDelete(false);
      setLinkedRaid([]);
      setLinkedDocuments([]);
      return;
    }
    setConfirmDelete(false);
    if (membersProp) setMembers(membersProp);
    if (epicsProp) setEpics(epicsProp);
    if (storiesProp) setStories(storiesProp);
    if (milestonesProp) setMilestones(milestonesProp);
    void load();
  }, [open, taskId, load, membersProp, epicsProp, storiesProp, milestonesProp]);

  const storiesForSelect = userStoryId
    ? stories
    : stories;
  const selectedStory = stories.find((story) => story.id === userStoryId);
  const epicLabel = selectedStory
    ? epics.find((epic) => epic.id === selectedStory.epicId)?.title
    : task?.epicTitle;

  async function saveFields() {
    if (!taskId || !canMutate) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/project-tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          status,
          dueDate: dueDate || null,
          forecastHours: parseHoursInput(forecastHours),
          actualHours: parseHoursInput(actualHours),
          description: description.trim() || null,
          milestoneId: milestoneId || null,
          userStoryId: userStoryId || null,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        task?: TaskDetail;
        error?: { message?: string };
      };
      if (!response.ok || !payload.task) {
        throw new Error(payload.error?.message || t('failedUpdateTask'));
      }
      setTask(payload.task);
      onUpdated?.(payload.task);
      pushToast(t('taskUpdated'), 'success');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('failedUpdateTask'));
    } finally {
      setPending(false);
    }
  }

  async function submitComment() {
    if (!taskId || !canMutate || !comment.trim()) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/project-tasks/${taskId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: comment.trim() }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(payload.error?.message || t('failedComment'));
      }
      setComment('');
      pushToast(t('commentAdded'), 'success');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('failedComment'));
    } finally {
      setPending(false);
    }
  }

  async function submitHandoff() {
    if (!taskId || !canMutate || !handoffTo) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/project-tasks/${taskId}/handoff`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          toUserId: handoffTo,
          note: handoffNote.trim() || null,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        task?: TaskDetail;
        error?: { message?: string };
      };
      if (!response.ok || !payload.task) {
        throw new Error(payload.error?.message || t('failedHandoff'));
      }
      setTask(payload.task);
      onUpdated?.(payload.task);
      setHandoffTo('');
      setHandoffNote('');
      pushToast(t('handoffDone'), 'success');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('failedHandoff'));
    } finally {
      setPending(false);
    }
  }

  async function remove() {
    if (!taskId || !canMutate) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/project-tasks/${taskId}`, {
        method: 'DELETE',
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(payload.error?.message || t('failedDeleteTask'));
      }
      onDeleted?.(taskId);
      pushToast(t('taskDeleted'), 'success');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('failedDeleteTask'));
    } finally {
      setPending(false);
      setConfirmDelete(false);
    }
  }

  function activityLabel(activity: Activity): string {
    switch (activity.type) {
      case 'created':
        return t('activity.created');
      case 'status_changed':
        return t('activity.statusChanged');
      case 'comment':
        return t('activity.comment');
      case 'handoff':
        return t('activity.handoff');
      case 'raci_changed':
        return t('activity.raciChanged');
      case 'fields_updated':
        return t('activity.fieldsUpdated');
      case 'owner_set':
        return t('activity.ownerSet');
      default:
        return activity.type;
    }
  }

  const scheduleTone = task
    ? deliveryScheduleTone({
        status: task.status,
        date: task.dueDate,
        today: todayYmd(),
      })
    : null;

  const ratePerson = task
    ? resolveRatePerson(task.currentOwnerUserId, task.raci, rateMap)
    : null;
  const forecastCost = hoursCost(
    parseHoursInput(forecastHours),
    ratePerson?.hourlyRate,
  );
  const actualCost = hoursCost(
    parseHoursInput(actualHours),
    ratePerson?.hourlyRate,
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={task?.title ?? t('manageTask')}
      description={t('manageTaskDescription')}
      size="xl"
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <div>
            {canMutate && task ? (
              !confirmDelete ? (
                <Button
                  type="button"
                  variant="danger"
                  disabled={pending}
                  onClick={() => setConfirmDelete(true)}
                >
                  {t('deleteItem')}
                </Button>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={pending}
                    onClick={() => setConfirmDelete(false)}
                  >
                    {tCommon('cancel')}
                  </Button>
                  <Button
                    type="button"
                    variant="danger"
                    disabled={pending}
                    onClick={() => void remove()}
                  >
                    {t('confirmDeleteTask')}
                  </Button>
                </div>
              )
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              {tCommon('cancel')}
            </Button>
            {canMutate ? (
              <Button
                type="button"
                disabled={pending || !title.trim() || confirmDelete}
                onClick={() => void saveFields()}
              >
                {t('saveTask')}
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
      {confirmDelete ? (
        <p className="mb-3 text-sm font-semibold text-danger">
          {t('deleteTaskHint')}
        </p>
      ) : null}

      {!task ? (
        <p className="m-0 text-sm text-ink-muted">{tCommon('loading')}</p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <div className="grid gap-3">
            <div className="flex flex-wrap items-center gap-2">
              {scheduleTone ? (
                <span
                  className={cn(
                    'inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold',
                    deliveryScheduleSurfaceClass(scheduleTone),
                  )}
                >
                  {t(`scheduleTone.${scheduleTone}`)}
                </span>
              ) : null}
              {epicLabel ? <Badge>{t('kindEpic')}: {epicLabel}</Badge> : null}
              {task.userStoryTitle || selectedStory ? (
                <Badge tone="brand">
                  {t('kindStory')}: {selectedStory?.title ?? task.userStoryTitle}
                </Badge>
              ) : null}
            </div>

            <Field label={t('taskTitle')}>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={pending || !canMutate}
                data-modal-initial-focus
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('filterStatus')}>
                <Select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  disabled={pending || !canMutate}
                >
                  {TASK_STATUSES.map((value) => (
                    <option key={value} value={value}>
                      {t(`taskStatus.${value}`)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('dueDate')}>
                <Input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  disabled={pending || !canMutate}
                />
              </Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('forecastHours')}>
                <Input
                  type="number"
                  min="0"
                  step="0.25"
                  value={forecastHours}
                  onChange={(e) => setForecastHours(e.target.value)}
                  disabled={pending || !canMutate}
                />
              </Field>
              <Field label={t('actualHours')}>
                <Input
                  type="number"
                  min="0"
                  step="0.25"
                  value={actualHours}
                  onChange={(e) => setActualHours(e.target.value)}
                  disabled={pending || !canMutate}
                />
              </Field>
            </div>
            <p className="m-0 text-xs text-ink-muted">
              {ratePerson
                ? ratePerson.hourlyRate != null
                  ? tBudget('rateHint', {
                      name: ratePerson.displayName,
                      rate: formatMoney(ratePerson.hourlyRate, currency, locale),
                      forecast: formatMoney(forecastCost, currency, locale),
                      actual: formatMoney(actualCost, currency, locale),
                    })
                  : tBudget('rateMissing', { name: ratePerson.displayName })
                : tBudget('rateUnresolved')}
            </p>
            <Field label={t('kindStory')}>
              <Select
                value={userStoryId}
                onChange={(e) => setUserStoryId(e.target.value)}
                disabled={pending || !canMutate}
              >
                <option value="">{t('noStory')}</option>
                {storiesForSelect.map((story) => {
                  const epic = epics.find((row) => row.id === story.epicId);
                  return (
                    <option key={story.id} value={story.id}>
                      {epic ? `${epic.title} · ` : ''}
                      {story.title}
                    </option>
                  );
                })}
              </Select>
            </Field>
            <Field label={t('milestoneOptional')}>
              <Select
                value={milestoneId}
                onChange={(e) => setMilestoneId(e.target.value)}
                disabled={pending || !canMutate}
              >
                <option value="">{t('noMilestone')}</option>
                {milestones.map((milestone) => (
                  <option key={milestone.id} value={milestone.id}>
                    {milestone.title}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('description')}>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={pending || !canMutate}
                rows={4}
              />
            </Field>

            <div className="rounded-md border border-line bg-panel-solid p-3">
              <p className="mt-0 mb-2 text-sm font-semibold">{t('linkedRaid')}</p>
              {linkedRaid.length === 0 ? (
                <p className="m-0 text-sm text-ink-muted">{t('linkedRaidEmpty')}</p>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {linkedRaid.map((item) => (
                    <Badge
                      key={item.id}
                      tone={raidSeverityTone(item.severity)}
                    >
                      {item.humanKey ? `${item.humanKey} · ` : ''}
                      {tRaid(`kind.${item.kind}`)}: {item.title}
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-md border border-line bg-panel-solid p-3">
              <p className="mt-0 mb-2 text-sm font-semibold">{t('linkedDocuments')}</p>
              {linkedDocuments.length === 0 ? (
                <p className="m-0 text-sm text-ink-muted">
                  {t('linkedDocumentsEmpty')}
                </p>
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

            <div className="rounded-md border border-line bg-panel-solid p-3">
              <p className="mt-0 mb-2 text-sm font-semibold">{t('currentOwner')}</p>
              <p className="m-0 text-sm text-ink-muted">
                {task.currentOwner
                  ? `${task.currentOwner.displayName} (${task.currentOwner.email})`
                  : t('unassigned')}
              </p>
              {task.raci.length > 0 ? (
                <p className="mt-2 mb-0 text-xs text-ink-muted">
                  {t('raciStanding')}:{' '}
                  {task.raci
                    .map((entry) => `${entry.role}: ${entry.displayName}`)
                    .join(' · ')}
                </p>
              ) : (
                <p className="mt-2 mb-0 text-xs text-ink-muted">{t('noRaci')}</p>
              )}
              {canMutate ? (
                <div className="mt-3 grid gap-2">
                  <Field label={t('handoffTo')}>
                    <Select
                      value={handoffTo}
                      onChange={(e) => setHandoffTo(e.target.value)}
                      disabled={pending}
                    >
                      <option value="">{t('selectMember')}</option>
                      {members.map((member) => (
                        <option key={member.userId} value={member.userId}>
                          {member.displayName} ({member.email})
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label={t('handoffNote')}>
                    <Input
                      value={handoffNote}
                      onChange={(e) => setHandoffNote(e.target.value)}
                      disabled={pending}
                    />
                  </Field>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={pending || !handoffTo}
                    onClick={() => void submitHandoff()}
                  >
                    {t('handoff')}
                  </Button>
                </div>
              ) : null}
            </div>
          </div>

          <div className="grid gap-3">
            <h3 className="m-0 text-base font-semibold">{t('activityTitle')}</h3>
            {canMutate ? (
              <div className="grid gap-2">
                <Textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder={t('commentPlaceholder')}
                  disabled={pending}
                  rows={3}
                />
                <Button
                  type="button"
                  variant="secondary"
                  disabled={pending || !comment.trim()}
                  onClick={() => void submitComment()}
                >
                  {t('addComment')}
                </Button>
              </div>
            ) : null}
            <ul className="m-0 grid list-none gap-2 p-0">
              {activities.length === 0 ? (
                <li className="text-sm text-ink-muted">{t('activityEmpty')}</li>
              ) : (
                activities.map((activity) => (
                  <li
                    key={activity.id}
                    className="rounded-md border border-line bg-panel-solid px-3 py-2"
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="text-sm font-medium">
                        {activityLabel(activity)}
                      </span>
                      <time className="text-xs text-ink-muted">
                        {new Date(activity.createdAt).toLocaleString()}
                      </time>
                    </div>
                    <p className="mt-1 mb-0 text-xs text-ink-muted">
                      {activity.actorDisplayName ?? t('activityUnknownActor')}
                    </p>
                    {activity.body ? (
                      <p className="mt-2 mb-0 text-sm whitespace-pre-wrap">
                        {activity.body}
                      </p>
                    ) : null}
                  </li>
                ))
              )}
            </ul>
          </div>
        </div>
      )}
    </Modal>
  );
}
