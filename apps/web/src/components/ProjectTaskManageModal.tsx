'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  TASK_COMPLETION_PERCENTS,
  addCalendarDays,
  statusForTaskCompletionChange,
  type TaskStatus,
} from '@project-knowledge-hub/domain';
import {
  Badge,
  Button,
  ErrorText,
  Field,
  DELIVERY_ITEM_MODAL_SIZE,
  Input,
  Modal,
  Select,
  Switch,
  Textarea,
  raidSeverityTone,
  useToast,
} from './ui';
import {
  deliveryScheduleTone,
  todayYmd,
} from '../lib/delivery-schedule';
import { formatPercentLabel } from '../lib/delivery-completion';
import { formatMoney } from '../lib/project-currency';
import {
  hoursCost,
  parseHoursInput,
  resolveRatePerson,
  type RatePerson,
} from '../lib/task-costing';
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
import { DeliveryDependenciesEditor } from './DeliveryDependenciesEditor';
import {
  DeliveryRaciEditor,
  saveDeliveryRaci,
  type RaciAssignment,
} from './DeliveryRaciEditor';
import { raciDraftIssues, sameRaciDraft, type RaciDraftIssue } from '../lib/raci-draft';

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
  completionPercent?: number | null;
  startDate: string | null;
  dueDate: string | null;
  durationDays?: number | null;
  forecastHours: string | null;
  actualHours: string | null;
  milestoneId: string | null;
  userStoryId: string | null;
  userStoryTitle: string | null;
  epicId: string | null;
  epicTitle: string | null;
  currentOwnerUserId: string | null;
  currentOwner: TaskOwner | null;
  tokensUsed: number | null;
  tokensInput?: number | null;
  tokensOutput?: number | null;
  tokensCache?: number | null;
  modelId?: string | null;
  pricingTier?: string | null;
  usageOccurredAt?: string | null;
  billingPeriod?: string | null;
  aiSystemId: string | null;
  humanKey?: string | null;
  itemType?: 'task' | 'bug';
  severity?: string | null;
  foundIn?: string | null;
  foundInNote?: string | null;
  stepsToReproduce?: string | null;
  expectedBehavior?: string | null;
  actualBehavior?: string | null;
  resolution?: string | null;
  regression?: boolean;
  affectedSystemId?: string | null;
  duplicateOfTaskId?: string | null;
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
const BUG_SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
const BUG_FOUND_IN = ['development', 'test', 'staging', 'production'] as const;
const BUG_RESOLUTIONS = [
  'fixed',
  'duplicate',
  'wont_fix',
  'cannot_reproduce',
  'works_as_designed',
] as const;

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
  systems = [],
  bugOptions = [],
  records = [],
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
  systems?: Array<{ id: string; name: string }>;
  bugOptions?: Array<{ id: string; title: string; humanKey?: string | null }>;
  records?: DeliveryDocumentRecord[];
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
  const [taskTab, setTaskTab] = useState<
    | 'details'
    | 'ai'
    | 'raci'
    | 'handoff'
    | 'activity'
    | 'documents'
    | 'media'
    | 'dependencies'
  >('details');
  const [comment, setComment] = useState('');
  const [handoffTo, setHandoffTo] = useState('');
  const [handoffNote, setHandoffNote] = useState('');
  const [title, setTitle] = useState('');
  const [status, setStatus] = useState('todo');
  const [completionPercent, setCompletionPercent] = useState('0');
  const [startDate, setStartDate] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [durationDays, setDurationDays] = useState('');
  const [scheduleDriven, setScheduleDriven] = useState(false);
  const [forecastHours, setForecastHours] = useState('');
  const [actualHours, setActualHours] = useState('');
  const [description, setDescription] = useState('');
  const [milestoneId, setMilestoneId] = useState('');
  const [userStoryId, setUserStoryId] = useState('');
  const [tokensUsed, setTokensUsed] = useState('');
  const [tokensInput, setTokensInput] = useState('');
  const [tokensOutput, setTokensOutput] = useState('');
  const [tokensCache, setTokensCache] = useState('');
  const [modelId, setModelId] = useState('');
  const [pricingTier, setPricingTier] = useState('');
  const [usageOccurredAt, setUsageOccurredAt] = useState('');
  const [billingPeriod, setBillingPeriod] = useState('');
  const [aiSystemId, setAiSystemId] = useState('');
  const [severity, setSeverity] = useState('medium');
  const [foundIn, setFoundIn] = useState('');
  const [foundInNote, setFoundInNote] = useState('');
  const [stepsToReproduce, setStepsToReproduce] = useState('');
  const [expectedBehavior, setExpectedBehavior] = useState('');
  const [actualBehavior, setActualBehavior] = useState('');
  const [resolution, setResolution] = useState('');
  const [regression, setRegression] = useState(false);
  const [affectedSystemId, setAffectedSystemId] = useState('');
  const [duplicateOfTaskId, setDuplicateOfTaskId] = useState('');
  const [linkedRaid, setLinkedRaid] = useState<LinkedRaid[]>([]);
  const [linkedDocuments, setLinkedDocuments] = useState<LinkedDocument[]>([]);
  const [documentIds, setDocumentIds] = useState<string[]>([]);
  const [mediaDrafts, setMediaDrafts] = useState<ItemMediaDraft[] | null>(null);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [documentPickerOpen, setDocumentPickerOpen] = useState(false);
  const [raciPickerOpen, setRaciPickerOpen] = useState(false);
  const [raciEntries, setRaciEntries] = useState<RaciAssignment[]>([]);
  const tRaid = useTranslations('raid');

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
    setTaskTab('details');
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
      setRaciEntries(loaded.raci);
      setTitle(loaded.title);
      setStatus(loaded.status);
      setCompletionPercent(
        String(
          loaded.status === 'done'
            ? 100
            : loaded.status === 'cancelled'
              ? 0
              : (loaded.completionPercent ?? 0),
        ),
      );
      setStartDate(loaded.startDate ?? '');
      setDueDate(loaded.dueDate ?? '');
      setDurationDays(
        loaded.durationDays == null ? '' : String(loaded.durationDays),
      );
      setForecastHours(
        loaded.forecastHours != null ? String(loaded.forecastHours) : '',
      );
      setActualHours(
        loaded.actualHours != null ? String(loaded.actualHours) : '',
      );
      setDescription(loaded.description ?? '');
      setMilestoneId(loaded.milestoneId ?? '');
      setUserStoryId(loaded.userStoryId ?? '');
      setTokensUsed(
        loaded.tokensUsed != null ? String(loaded.tokensUsed) : '',
      );
      setTokensInput(
        loaded.tokensInput != null ? String(loaded.tokensInput) : '',
      );
      setTokensOutput(
        loaded.tokensOutput != null ? String(loaded.tokensOutput) : '',
      );
      setTokensCache(
        loaded.tokensCache != null ? String(loaded.tokensCache) : '',
      );
      setModelId(loaded.modelId ?? '');
      setPricingTier(loaded.pricingTier ?? '');
      setUsageOccurredAt(
        loaded.usageOccurredAt ? loaded.usageOccurredAt.slice(0, 10) : '',
      );
      setBillingPeriod(loaded.billingPeriod ?? '');
      setAiSystemId(loaded.aiSystemId ?? '');
      setSeverity(loaded.severity ?? 'medium');
      setFoundIn(loaded.foundIn ?? '');
      setFoundInNote(loaded.foundInNote ?? '');
      setStepsToReproduce(loaded.stepsToReproduce ?? '');
      setExpectedBehavior(loaded.expectedBehavior ?? '');
      setActualBehavior(loaded.actualBehavior ?? '');
      setResolution(loaded.resolution ?? '');
      setRegression(loaded.regression ?? false);
      setAffectedSystemId(loaded.affectedSystemId ?? '');
      setDuplicateOfTaskId(loaded.duplicateOfTaskId ?? '');

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
        const links = docsPayload.documentLinks ?? [];
        setLinkedDocuments(links);
        setDocumentIds(links.map((doc) => doc.knowledgeRecordId));
      } else {
        setLinkedDocuments([]);
        setDocumentIds([]);
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
          const loadedWorkspaceId = projectPayload.project?.workspaceId ?? null;
          setWorkspaceId(loadedWorkspaceId);
          if (loadedWorkspaceId) {
            const memRes = await fetch(`/api/v1/workspaces/${loadedWorkspaceId}/members`);
            if (memRes.ok) {
              const memPayload = (await memRes.json()) as { members: Member[] };
              setMembers(memPayload.members ?? []);
            }
          }
        }
      }
      const projectRes = await fetch(`/api/v1/projects/${loaded.projectId}`);
      if (projectRes.ok) {
        const projectPayload = (await projectRes.json()) as {
          project?: { workspaceId?: string };
        };
        setWorkspaceId(projectPayload.project?.workspaceId ?? null);
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

  function parseTokenInput(raw: string): number | null | 'invalid' {
    const trimmed = raw.trim();
    if (trimmed === '') return null;
    if (!/^\d+$/.test(trimmed)) return 'invalid';
    const value = Number(trimmed);
    if (!Number.isSafeInteger(value) || value > 2147483647) return 'invalid';
    return value;
  }

  function aiUsagePayload(): {
    tokensUsed: number | null;
    tokensInput: number | null;
    tokensOutput: number | null;
    tokensCache: number | null;
    modelId: string | null;
    pricingTier: string | null;
    usageOccurredAt: string | null;
    billingPeriod: string | null;
  } | null {
    const input = parseTokenInput(tokensInput);
    const output = parseTokenInput(tokensOutput);
    const cache = parseTokenInput(tokensCache);
    const total = parseTokenInput(tokensUsed);
    if (
      input === 'invalid' ||
      output === 'invalid' ||
      cache === 'invalid' ||
      total === 'invalid'
    ) {
      setError(t('tokensInvalid'));
      return null;
    }
    const breakdown = input != null || output != null || cache != null;
    const sum = (input ?? 0) + (output ?? 0) + (cache ?? 0);
    if (breakdown && total != null && total !== sum) {
      setError(t('tokensBreakdownMismatch'));
      return null;
    }
    const period = billingPeriod.trim();
    if (period && !/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
      setError(t('billingPeriodInvalid'));
      return null;
    }
    return {
      tokensInput: input,
      tokensOutput: output,
      tokensCache: cache,
      tokensUsed: total,
      modelId: modelId.trim() || null,
      pricingTier: pricingTier.trim() || null,
      usageOccurredAt: usageOccurredAt || null,
      billingPeriod: period || null,
    };
  }

  function raciIssueLabel(issue: RaciDraftIssue): string {
    if (issue === 'exactly_one_accountable') return t('raciExactlyOne');
    if (issue === 'duplicate_person_role') return t('raciDuplicateRole');
    return t('raciDuplicatePerson');
  }

  async function saveFields() {
    if (!taskId || !canMutate) return;
    const raciDirty = Boolean(task && !sameRaciDraft(raciEntries, task.raci));
    if (raciDirty) {
      const issue = raciDraftIssues(raciEntries)[0];
      if (issue) {
        setError(raciIssueLabel(issue));
        return;
      }
    }
    setPending(true);
    setError(null);
    const usage = aiUsagePayload();
    if (!usage) {
      setPending(false);
      return;
    }
    try {
      const response = await fetch(`/api/v1/project-tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          status,
          completionPercent:
            status === 'cancelled' ? null : Number(completionPercent || 0),
          startDate: startDate || null,
          dueDate: dueDate || null,
          durationDays:
            durationDays.trim() === '' ? null : Number(durationDays),
          forecastHours: parseHoursInput(forecastHours),
          actualHours: parseHoursInput(actualHours),
          description: description.trim() || null,
          milestoneId: milestoneId || null,
          userStoryId: userStoryId || null,
          ...usage,
          aiSystemId: aiSystemId.trim() || null,
          ...(task?.itemType === 'bug'
            ? {
                severity: severity || 'medium',
                foundIn: foundIn || null,
                foundInNote: foundInNote.trim() || null,
                stepsToReproduce: stepsToReproduce.trim() || null,
                expectedBehavior: expectedBehavior.trim() || null,
                actualBehavior: actualBehavior.trim() || null,
                resolution: resolution || null,
                regression,
                affectedSystemId: affectedSystemId || null,
                duplicateOfTaskId:
                  resolution === 'duplicate' ? duplicateOfTaskId || null : null,
              }
            : {}),
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        task?: TaskDetail;
        error?: { message?: string };
      };
      if (!response.ok || !payload.task) {
        throw new Error(payload.error?.message || t('failedUpdateTask'));
      }
      let savedTask = payload.task;
      if (task?.projectId) {
        await saveDeliveryDocumentLinks({
          projectId: task.projectId,
          entityType: 'task',
          entityId: taskId,
          recordIds: documentIds,
        });
        if (mediaDrafts) {
          await saveItemMediaLinks({
            projectId: task.projectId,
            entityType: 'task',
            entityId: taskId,
            links: mediaDrafts,
          });
        }
      }
      if (raciDirty) {
        const raci = await saveDeliveryRaci({
          taskId,
          entries: raciEntries,
        });
        savedTask = { ...savedTask, raci };
        setRaciEntries(raci);
      }
      setTask(savedTask);
      onUpdated?.(savedTask);
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
      title={
        task
          ? [task.itemType === 'bug' ? t('kindBug') : null, task.humanKey, task.title]
              .filter(Boolean)
              .join(' · ')
          : t('manageTask')
      }
      description={t('manageTaskDescription')}
      size={DELIVERY_ITEM_MODAL_SIZE}
      closeOnEscape={!documentPickerOpen && !raciPickerOpen}
      tabs={
        task ? (
          <div className="kh-ops-modal-tabs" role="tablist">
            {(
              [
                ['details', t('tabDetails')],
                ['ai', t('tabAi')],
                ['raci', t('tabRaci')],
                ['handoff', t('tabHandoff')],
                ['activity', t('tabActivity')],
                ['documents', t('tabDocuments')],
                ['media', t('tabMedia')],
                ['dependencies', t('tabDependencies')],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={taskTab === id}
                className={taskTab === id ? 'active' : undefined}
                onClick={() => setTaskTab(id)}
              >
                {label}
              </button>
            ))}
          </div>
        ) : null
      }
      footer={
        <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center">
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
                <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center">
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
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center">
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
        <div className="grid gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {task.itemType === 'bug' ? <Badge>{t('kindBug')}</Badge> : null}
            {task.humanKey ? (
              <Badge tone="brand">{task.humanKey}</Badge>
            ) : null}
            {task.itemType === 'bug' && severity ? (
              <Badge tone={raidSeverityTone(severity)}>
                {tRaid(`severity.${severity}`)}
              </Badge>
            ) : null}
            {scheduleTone ? (
              <span className="kh-ops-type-chip" data-tone={scheduleTone}>
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

          <section
            className={`kh-ops-modal-pane${taskTab === 'details' ? ' active' : ''}`}
          >
            <div className="kh-ops-form-grid">
              <Field className="kh-ops-field-span" label={t('taskTitle')}>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  disabled={pending || !canMutate}
                  data-modal-initial-focus
                />
              </Field>
              <Field label={t('statusField')}>
                <Select
                  value={status}
                  onChange={(event) => {
                    const next = event.target.value;
                    setStatus(next);
                    if (next === 'done') setCompletionPercent('100');
                    else if (next === 'cancelled') setCompletionPercent('0');
                    else if (completionPercent === '') setCompletionPercent('0');
                  }}
                  disabled={pending || !canMutate}
                >
                  {TASK_STATUSES.map((value) => (
                    <option key={value} value={value}>
                      {t(`taskStatus.${value}`)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('completionField')}>
                <Select
                  value={completionPercent || '0'}
                  onChange={(event) => {
                    const next = event.target.value;
                    const value = Number(next);
                    setCompletionPercent(next);
                    setStatus((current) =>
                      statusForTaskCompletionChange({
                        status: current as TaskStatus,
                        requested: value,
                        existing: completionPercent === '' ? null : Number(completionPercent),
                      }),
                    );
                  }}
                  disabled={
                    pending || !canMutate || status === 'done' || status === 'cancelled'
                  }
                >
                  {TASK_COMPLETION_PERCENTS.map((value) => (
                    <option key={value} value={String(value)}>
                      {formatPercentLabel(value, locale)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field className="kh-ops-field-row-start" label={t('startDate')}>
                <Input
                  type="date"
                  value={startDate}
                  onChange={(event) => {
                    const next = event.target.value;
                    setStartDate(next);
                    const days = Number(durationDays);
                    if (next && durationDays.trim() !== '' && Number.isInteger(days)) {
                      setDueDate(addCalendarDays(next, days));
                    }
                  }}
                  disabled={pending || !canMutate || scheduleDriven}
                />
              </Field>
              <Field label={t('durationDays')}>
                <Input
                  type="number"
                  min={0}
                  max={3650}
                  step={1}
                  value={durationDays}
                  onChange={(event) => {
                    const next = event.target.value;
                    setDurationDays(next);
                    const days = Number(next);
                    if (startDate && next.trim() !== '' && Number.isInteger(days) && days >= 0) {
                      setDueDate(addCalendarDays(startDate, days));
                    }
                  }}
                  disabled={pending || !canMutate}
                />
              </Field>
              <Field label={t('dueDate')}>
                <Input
                  type="date"
                  value={dueDate}
                  onChange={(event) => setDueDate(event.target.value)}
                  disabled={pending || !canMutate || durationDays.trim() !== ''}
                />
              </Field>
              {scheduleDriven ? (
                <p className="kh-ops-field-span m-0 text-xs text-ink-muted">
                  {t('startComputed')}
                </p>
              ) : null}
              {durationDays.trim() !== '' ? (
                <p className="kh-ops-field-span m-0 text-xs text-ink-muted">
                  {t('durationHint')}
                </p>
              ) : null}
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
              <p className="kh-ops-field-span m-0 text-xs text-ink-muted">
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
              <Field className="kh-ops-field-span" label={t('description')}>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  disabled={pending || !canMutate}
                  rows={4}
                />
              </Field>
              {task.itemType === 'bug' ? (
                <>
                  <Field label={t('severity')}>
                    <Select
                      value={severity}
                      onChange={(e) => setSeverity(e.target.value)}
                      disabled={pending || !canMutate}
                    >
                      {BUG_SEVERITIES.map((value) => (
                        <option key={value} value={value}>
                          {tRaid(`severity.${value}`)}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label={t('foundIn')}>
                    <Select
                      value={foundIn}
                      onChange={(e) => setFoundIn(e.target.value)}
                      disabled={pending || !canMutate}
                    >
                      <option value="">{t('noAffectedSystem')}</option>
                      {BUG_FOUND_IN.map((value) => (
                        <option key={value} value={value}>
                          {t(`foundInValue.${value}`)}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label={t('foundInNote')}>
                    <Input
                      value={foundInNote}
                      maxLength={200}
                      onChange={(e) => setFoundInNote(e.target.value)}
                      disabled={pending || !canMutate}
                    />
                  </Field>
                  <Field className="kh-ops-field-span" label={t('stepsToReproduce')}>
                    <Textarea
                      value={stepsToReproduce}
                      rows={3}
                      onChange={(e) => setStepsToReproduce(e.target.value)}
                      disabled={pending || !canMutate}
                    />
                  </Field>
                  <Field label={t('expectedBehavior')}>
                    <Textarea
                      value={expectedBehavior}
                      rows={3}
                      onChange={(e) => setExpectedBehavior(e.target.value)}
                      disabled={pending || !canMutate}
                    />
                  </Field>
                  <Field label={t('actualBehavior')}>
                    <Textarea
                      value={actualBehavior}
                      rows={3}
                      onChange={(e) => setActualBehavior(e.target.value)}
                      disabled={pending || !canMutate}
                    />
                  </Field>
                  <Switch
                    id="bug-regression-edit"
                    checked={regression}
                    onCheckedChange={setRegression}
                    label={t('regression')}
                    disabled={pending || !canMutate}
                  />
                  <Field label={t('affectedSystem')}>
                    <Select
                      value={affectedSystemId}
                      onChange={(e) => setAffectedSystemId(e.target.value)}
                      disabled={pending || !canMutate}
                    >
                      <option value="">{t('noAffectedSystem')}</option>
                      {systems.map((system) => (
                        <option key={system.id} value={system.id}>
                          {system.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label={t('resolution')}>
                    <Select
                      value={resolution}
                      onChange={(e) => {
                        setResolution(e.target.value);
                        if (e.target.value !== 'duplicate') {
                          setDuplicateOfTaskId('');
                        }
                      }}
                      disabled={pending || !canMutate}
                    >
                      <option value="">{t('noDuplicate')}</option>
                      {BUG_RESOLUTIONS.map((value) => (
                        <option key={value} value={value}>
                          {t(`resolutionValue.${value}`)}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  {resolution === 'duplicate' ? (
                    <Field label={t('duplicateOf')}>
                      <Select
                        value={duplicateOfTaskId}
                        onChange={(e) => setDuplicateOfTaskId(e.target.value)}
                        disabled={pending || !canMutate}
                      >
                        <option value="">{t('noDuplicate')}</option>
                        {bugOptions
                          .filter((bug) => bug.id !== task.id)
                          .map((bug) => (
                            <option key={bug.id} value={bug.id}>
                              {bug.humanKey ? `${bug.humanKey} · ` : ''}
                              {bug.title}
                            </option>
                          ))}
                      </Select>
                    </Field>
                  ) : null}
                  {status === 'done' || status === 'cancelled' ? (
                    resolution ? null : (
                      <p className="kh-ops-field-span m-0 text-xs text-ink-muted">
                        {t('resolutionHint')}
                      </p>
                    )
                  ) : null}
                </>
              ) : null}
            </div>
          </section>

          <section className={`kh-ops-modal-pane${taskTab === 'ai' ? ' active' : ''}`}>
            {canMutate ||
            tokensUsed.trim() !== '' ||
            task.tokensUsed != null ||
            tokensInput.trim() !== '' ||
            tokensOutput.trim() !== '' ||
            tokensCache.trim() !== '' ||
            modelId.trim() !== '' ||
            pricingTier.trim() !== '' ||
            usageOccurredAt.trim() !== '' ||
            billingPeriod.trim() !== '' ||
            aiSystemId.trim() !== '' ||
            task.aiSystemId ? (
              <div className="kh-ops-form-grid">
                <p className="kh-ops-field-span m-0 text-xs text-ink-muted">
                  {t('tokensBreakdownHint')}
                </p>
                <Field label={t('tokensInput')}>
                  <Input
                    type="number"
                    min="0"
                    step="1"
                    value={tokensInput}
                    onChange={(e) => setTokensInput(e.target.value)}
                    disabled={pending || !canMutate}
                  />
                </Field>
                <Field label={t('tokensOutput')}>
                  <Input
                    type="number"
                    min="0"
                    step="1"
                    value={tokensOutput}
                    onChange={(e) => setTokensOutput(e.target.value)}
                    disabled={pending || !canMutate}
                  />
                </Field>
                <Field label={t('tokensCache')}>
                  <Input
                    type="number"
                    min="0"
                    step="1"
                    value={tokensCache}
                    onChange={(e) => setTokensCache(e.target.value)}
                    disabled={pending || !canMutate}
                  />
                </Field>
                <Field label={t('tokensUsed')}>
                  <Input
                    type="number"
                    min="0"
                    step="1"
                    value={tokensUsed}
                    onChange={(e) => setTokensUsed(e.target.value)}
                    disabled={pending || !canMutate}
                    placeholder={t('tokensUsedPlaceholder')}
                  />
                </Field>
                <Field label={t('aiModelId')}>
                  <Input
                    value={modelId}
                    onChange={(e) => setModelId(e.target.value)}
                    disabled={pending || !canMutate}
                    maxLength={80}
                    placeholder={t('aiModelIdPlaceholder')}
                  />
                </Field>
                <Field label={t('aiPricingTier')}>
                  <Input
                    value={pricingTier}
                    onChange={(e) => setPricingTier(e.target.value)}
                    disabled={pending || !canMutate}
                    maxLength={32}
                    placeholder={t('aiPricingTierPlaceholder')}
                  />
                </Field>
                <Field label={t('usageOccurredAt')}>
                  <Input
                    type="date"
                    value={usageOccurredAt}
                    onChange={(e) => setUsageOccurredAt(e.target.value)}
                    disabled={pending || !canMutate}
                  />
                </Field>
                <Field label={t('billingPeriod')}>
                  <Input
                    type="month"
                    value={billingPeriod}
                    onChange={(e) => setBillingPeriod(e.target.value)}
                    disabled={pending || !canMutate}
                  />
                </Field>
                <Field className="kh-ops-field-span" label={t('aiSystemId')}>
                  <Input
                    value={aiSystemId}
                    onChange={(e) => setAiSystemId(e.target.value)}
                    disabled={pending || !canMutate}
                    placeholder={t('aiSystemIdPlaceholder')}
                  />
                </Field>
              </div>
            ) : (
              <p className="m-0 text-sm text-ink-muted">{t('aiEmpty')}</p>
            )}
          </section>

          <section
            className={`kh-ops-modal-pane${taskTab === 'raci' ? ' active' : ''}`}
          >
            <p className="m-0 text-sm text-ink-muted">
              {task.currentOwner
                ? `${t('currentOwner')}: ${task.currentOwner.displayName} (${task.currentOwner.email})`
                : t('unassigned')}
            </p>
            <DeliveryRaciEditor
              projectId={task.projectId}
              entries={raciEntries}
              members={members}
              canEdit={canMutate}
              disabled={pending}
              onChange={setRaciEntries}
              onPickerOpenChange={setRaciPickerOpen}
            />
            <div>
              <p className="mt-0 mb-2 text-sm font-semibold">{t('linkedRaid')}</p>
              {linkedRaid.length === 0 ? (
                <p className="m-0 text-sm text-ink-muted">{t('linkedRaidEmpty')}</p>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {linkedRaid.map((item) => (
                    <Badge key={item.id} tone={raidSeverityTone(item.severity)}>
                      {item.humanKey ? `${item.humanKey} · ` : ''}
                      {tRaid(`kind.${item.kind}`)}: {item.title}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </section>

          <section
            className={`kh-ops-modal-pane${taskTab === 'handoff' ? ' active' : ''}`}
          >
            {canMutate ? (
              <div className="kh-ops-form-grid">
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
                <Field className="kh-ops-field-span" label={t('handoffNote')}>
                  <Input
                    value={handoffNote}
                    onChange={(e) => setHandoffNote(e.target.value)}
                    disabled={pending}
                  />
                </Field>
                <div className="kh-ops-field-span">
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={pending || !handoffTo}
                    onClick={() => void submitHandoff()}
                  >
                    {t('handoff')}
                  </Button>
                </div>
              </div>
            ) : (
              <p className="m-0 text-sm text-ink-muted">{t('unassigned')}</p>
            )}
          </section>

          <section
            className={`kh-ops-modal-pane${taskTab === 'activity' ? ' active' : ''}`}
          >
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
            <div className="kh-ops-activity-thread">
              {activities.length === 0 ? (
                <p className="m-0 text-sm text-ink-muted">{t('activityEmpty')}</p>
              ) : (
                activities.map((activity) => (
                  <article key={activity.id} className="kh-ops-activity-item">
                    <strong>
                      {activity.actorDisplayName ?? t('activityUnknownActor')} ·{' '}
                      {activityLabel(activity)}
                    </strong>
                    <small>
                      {new Date(activity.createdAt).toLocaleString()}
                    </small>
                    {activity.body ? (
                      <p className="mt-2 mb-0 text-sm whitespace-pre-wrap">
                        {activity.body}
                      </p>
                    ) : null}
                  </article>
                ))
              )}
            </div>
          </section>

          <section
            className={`kh-ops-modal-pane${taskTab === 'documents' ? ' active' : ''}`}
          >
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
              disabled={pending}
              onPickerOpenChange={setDocumentPickerOpen}
            />
          </section>

          <section className={`kh-ops-modal-pane${taskTab === 'media' ? ' active' : ''}`}>
            {task ? (
              <DeliveryMediaEditor
                projectId={task.projectId}
                workspaceId={workspaceId}
                entityType="task"
                entityId={task.id}
                canEdit={canMutate}
                disabled={pending}
                onDraftsChange={setMediaDrafts}
              />
            ) : null}
          </section>

          <section
            className={`kh-ops-modal-pane${taskTab === 'dependencies' ? ' active' : ''}`}
          >
            <DeliveryDependenciesEditor
              projectId={task.projectId}
              entityType="task"
              entityId={task.id}
              canEdit={canMutate && !pending}
              onScheduleDriven={setScheduleDriven}
              onScheduled={(write) => {
                if (write) {
                  setStartDate(write.startDate ?? '');
                  setDueDate(write.finishDate ?? '');
                  setDurationDays(
                    write.durationDays == null ? '' : String(write.durationDays),
                  );
                }
                onUpdated?.({
                  ...task,
                  startDate: write?.startDate ?? task.startDate,
                  dueDate: write?.finishDate ?? task.dueDate,
                  durationDays: write?.durationDays ?? task.durationDays ?? null,
                });
              }}
            />
          </section>
        </div>
      )}
    </Modal>
  );
}
