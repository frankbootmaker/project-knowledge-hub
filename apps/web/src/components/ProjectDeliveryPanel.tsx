'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { CollapsibleSection } from './CollapsibleSection';
import {
  ProjectDeliveryBoard,
  type BoardExportHandle,
} from './ProjectDeliveryBoard';
import {
  ProjectDeliveryCalendar,
  type CalendarExportHandle,
} from './ProjectDeliveryCalendar';
import {
  ProjectDeliveryList,
  type DeliveryListKind,
  type DeliveryListRow,
} from './ProjectDeliveryList';
import {
  ProjectDeliveryTimeline,
  type TimelineExportHandle,
} from './ProjectDeliveryTimeline';
import { ProjectDeliveryTree } from './ProjectDeliveryTree';
import { ProjectScrumView, type ScrumExportHandle } from './ProjectScrumView';
import { ProjectAgileManageModal } from './ProjectAgileManageModal';
import { ProjectTaskManageModal } from './ProjectTaskManageModal';
import {
  Button,
  ErrorText,
  Field,
  Input,
  Modal,
  Select,
  useToast,
} from './ui';
import { formatMoney } from '../lib/project-currency';
import {
  hoursCost,
  parseHoursInput,
  resolveRatePerson,
  toHours,
  type RatePerson,
} from '../lib/task-costing';

type Milestone = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  startDate: string | null;
  targetDate: string | null;
  sortOrder: number;
  humanKey?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

type Epic = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  startDate: string | null;
  endDate: string | null;
  sortOrder: number;
  humanKey?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

type UserStory = {
  id: string;
  epicId: string;
  title: string;
  description: string | null;
  status: string;
  startDate: string | null;
  endDate: string | null;
  sortOrder: number;
  humanKey?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

type RaciEntry = {
  userId: string;
  displayName: string;
  email: string;
  role: 'R' | 'A' | 'C' | 'I';
  avatarUrl?: string | null;
};

type TaskOwner = {
  userId: string;
  displayName: string;
  email: string;
  avatarUrl?: string | null;
};

type Task = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  dueDate: string | null;
  forecastHours: string | null;
  actualHours: string | null;
  storyPoints?: number | null;
  milestoneId: string | null;
  userStoryId: string | null;
  sprintId?: string | null;
  userStoryTitle: string | null;
  epicId: string | null;
  epicTitle: string | null;
  currentOwnerUserId: string | null;
  currentOwner: TaskOwner | null;
  raci: RaciEntry[];
  humanKey?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

type Member = {
  userId: string;
  displayName: string;
  email: string;
};

const VIEW_MODES = ['board', 'list', 'tree', 'calendar', 'timeline', 'scrum'] as const;
type ViewMode = (typeof VIEW_MODES)[number];

type DeliveryKind = 'epic' | 'story' | 'milestone' | 'task';
type CreateKind = 'task' | 'milestone' | 'epic' | 'story';

function parseItemId(id: string): { kind: DeliveryKind; entityId: string } | null {
  if (id.startsWith('epic:')) {
    return { kind: 'epic', entityId: id.slice('epic:'.length) };
  }
  if (id.startsWith('story:')) {
    return { kind: 'story', entityId: id.slice('story:'.length) };
  }
  if (id.startsWith('milestone:')) {
    return { kind: 'milestone', entityId: id.slice('milestone:'.length) };
  }
  if (id.startsWith('task:')) {
    return { kind: 'task', entityId: id.slice('task:'.length) };
  }
  return null;
}

export function ProjectDeliveryPanel({
  projectId,
  projectName,
  workspaceId,
  canMutate,
  projectStartDate = null,
  projectEndDate = null,
  definitionOfDone = null,
  initialEpics,
  initialStories,
  initialMilestones,
  initialTasks,
  initialOpenTaskId = null,
  members,
  currency = 'EUR',
  ratePeople = [],
}: {
  projectId: string;
  projectName: string;
  workspaceId: string;
  canMutate: boolean;
  projectStartDate?: string | null;
  projectEndDate?: string | null;
  definitionOfDone?: string | null;
  initialEpics: Epic[];
  initialStories: UserStory[];
  initialMilestones: Milestone[];
  initialTasks: Task[];
  /** Open this task's manage modal on mount (e.g. dashboard deep link). */
  initialOpenTaskId?: string | null;
  members: Member[];
  currency?: string;
  ratePeople?: RatePerson[];
}) {
  const t = useTranslations('delivery');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { pushToast } = useToast();

  const [epics, setEpics] = useState(initialEpics);
  const [stories, setStories] = useState(initialStories);
  const [milestones, setMilestones] = useState(initialMilestones);
  const [tasks, setTasks] = useState(initialTasks);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [manageTaskId, setManageTaskId] = useState<string | null>(null);
  const [manageAgile, setManageAgile] = useState<{
    kind: 'epic' | 'story' | 'milestone';
    id: string;
  } | null>(null);
  const [sprintLabels, setSprintLabels] = useState<
    Array<{ id: string; name: string; humanKey?: string | null }>
  >([]);

  useEffect(() => {
    const next = searchParams.get('delivery');
    if (next && (VIEW_MODES as readonly string[]).includes(next)) {
      setViewMode(next as ViewMode);
    }
  }, [searchParams]);

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/v1/projects/${projectId}/sprints`)
      .then(async (response) => {
        if (!response.ok) return;
        const payload = (await response.json()) as {
          sprints: Array<{ id: string; name: string; humanKey?: string | null }>;
        };
        if (!cancelled) setSprintLabels(payload.sprints);
      })
      .catch(() => {
        /* list/tree sprint labels stay empty */
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(() => {
    if (!initialOpenTaskId) return;
    if (!initialTasks.some((task) => task.id === initialOpenTaskId)) return;
    setManageTaskId(initialOpenTaskId);
    try {
      const url = new URL(window.location.href);
      if (!url.searchParams.has('task')) return;
      url.searchParams.delete('task');
      const hash = url.hash || '#project-delivery';
      window.history.replaceState(
        null,
        '',
        `${url.pathname}${url.search}${hash}`,
      );
    } catch {
      /* ignore */
    }
  }, [initialOpenTaskId, initialTasks]);

  const [title, setTitle] = useState('');
  const [createKind, setCreateKind] = useState<CreateKind>('task');
  const [dateValue, setDateValue] = useState('');
  const [startDateValue, setStartDateValue] = useState('');
  const [endDateValue, setEndDateValue] = useState('');
  const [taskMilestoneId, setTaskMilestoneId] = useState('');
  const [taskStoryId, setTaskStoryId] = useState('');
  const [storyEpicId, setStoryEpicId] = useState('');
  const [taskAccountable, setTaskAccountable] = useState('');
  const [taskResponsible, setTaskResponsible] = useState('');
  const [taskForecastHours, setTaskForecastHours] = useState('');
  const [taskActualHours, setTaskActualHours] = useState('');
  const timelineExportRef = useRef<TimelineExportHandle | null>(null);
  const [timelineExportState, setTimelineExportState] = useState<{
    pending: boolean;
    canExport: boolean;
  } | null>(null);
  const onTimelineExportStateChange = useCallback(
    (state: { pending: boolean; canExport: boolean } | null) => {
      setTimelineExportState(state);
    },
    [],
  );
  const boardExportRef = useRef<BoardExportHandle | null>(null);
  const [boardExportState, setBoardExportState] = useState<{
    pending: boolean;
    canExport: boolean;
  } | null>(null);
  const onBoardExportStateChange = useCallback(
    (state: { pending: boolean; canExport: boolean } | null) => {
      setBoardExportState(state);
    },
    [],
  );
  const calendarExportRef = useRef<CalendarExportHandle | null>(null);
  const [calendarExportState, setCalendarExportState] = useState<{
    pending: boolean;
    canExport: boolean;
  } | null>(null);
  const onCalendarExportStateChange = useCallback(
    (state: { pending: boolean; canExport: boolean } | null) => {
      setCalendarExportState(state);
    },
    [],
  );
  const scrumExportRef = useRef<ScrumExportHandle | null>(null);
  const [scrumExportState, setScrumExportState] = useState<{
    pending: boolean;
    canExport: boolean;
  } | null>(null);
  const onScrumExportStateChange = useCallback(
    (state: { pending: boolean; canExport: boolean } | null) => {
      setScrumExportState(state);
    },
    [],
  );

  function changeViewMode(mode: ViewMode) {
    setViewMode(mode);
    try {
      window.sessionStorage.setItem(`kh-delivery-view:${projectId}`, mode);
    } catch {
      /* ignore */
    }
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('delivery', mode);
      url.hash = 'project-delivery';
      window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    } catch {
      /* ignore */
    }
  }

  const refresh = useCallback(() => {
    router.refresh();
  }, [router]);

  const milestoneTitleById = useMemo(() => {
    const map = new Map<string, string>();
    for (const milestone of milestones) {
      map.set(milestone.id, milestone.title);
    }
    return map;
  }, [milestones]);

  const epicTitleById = useMemo(() => {
    const map = new Map<string, string>();
    for (const epic of epics) {
      map.set(epic.id, epic.title);
    }
    return map;
  }, [epics]);

  const sprintTitleById = useMemo(() => {
    const map = new Map<string, string>();
    for (const sprint of sprintLabels) {
      map.set(
        sprint.id,
        sprint.humanKey ? `${sprint.humanKey} · ${sprint.name}` : sprint.name,
      );
    }
    return map;
  }, [sprintLabels]);

  const listRows: DeliveryListRow[] = useMemo(() => {
    const epicRows: DeliveryListRow[] = epics.map((epic) => ({
      id: `epic:${epic.id}`,
      kind: 'epic',
      entityId: epic.id,
      humanKey: epic.humanKey ?? null,
      title: epic.title,
      status: epic.status,
      owner: null,
      sprint: null,
      forecastHours: null,
      actualHours: null,
      storyPoints: null,
      updatedAt: epic.updatedAt ?? epic.createdAt ?? null,
      searchText: [
        epic.title,
        epic.humanKey ?? '',
        epic.description ?? '',
        epic.status,
        'epic',
      ]
        .join(' ')
        .toLowerCase(),
    }));

    const storyRows: DeliveryListRow[] = stories.map((story) => {
      const epicLabel = epicTitleById.get(story.epicId) ?? '';
      return {
        id: `story:${story.id}`,
        kind: 'story',
        entityId: story.id,
        humanKey: story.humanKey ?? null,
        title: story.title,
        status: story.status,
        owner: null,
        sprint: null,
        forecastHours: null,
        actualHours: null,
        storyPoints: null,
        updatedAt: story.updatedAt ?? story.createdAt ?? null,
        searchText: [
          story.title,
          story.humanKey ?? '',
          story.description ?? '',
          story.status,
          'story',
          epicLabel,
        ]
          .join(' ')
          .toLowerCase(),
      };
    });

    const milestoneRows: DeliveryListRow[] = milestones.map((milestone) => ({
      id: `milestone:${milestone.id}`,
      kind: 'milestone',
      entityId: milestone.id,
      humanKey: milestone.humanKey ?? null,
      title: milestone.title,
      status: milestone.status,
      owner: null,
      sprint: null,
      forecastHours: null,
      actualHours: null,
      storyPoints: null,
      updatedAt: milestone.updatedAt ?? milestone.createdAt ?? null,
      searchText: [
        milestone.title,
        milestone.humanKey ?? '',
        milestone.description ?? '',
        milestone.status,
        'milestone',
      ]
        .join(' ')
        .toLowerCase(),
    }));

    const taskRows: DeliveryListRow[] = tasks.map((task) => {
      const ownerLabel = task.currentOwner?.displayName ?? null;
      const sprintLabel = task.sprintId
        ? (sprintTitleById.get(task.sprintId) ?? null)
        : null;
      return {
        id: `task:${task.id}`,
        kind: 'task',
        entityId: task.id,
        humanKey: task.humanKey ?? null,
        title: task.title,
        status: task.status,
        owner: ownerLabel,
        sprint: sprintLabel,
        forecastHours: task.forecastHours,
        actualHours: task.actualHours,
        storyPoints: task.storyPoints ?? null,
        updatedAt: task.updatedAt ?? task.createdAt ?? null,
        searchText: [
          task.title,
          task.humanKey ?? '',
          task.description ?? '',
          task.status,
          'task',
          ownerLabel ?? '',
          sprintLabel ?? '',
          task.epicTitle ?? '',
          task.userStoryTitle ?? '',
        ]
          .join(' ')
          .toLowerCase(),
      };
    });

    return [...epicRows, ...storyRows, ...milestoneRows, ...taskRows];
  }, [epics, stories, milestones, tasks, epicTitleById, sprintTitleById]);

  const calendarItems = useMemo(
    () => [
      ...milestones
        .filter((milestone) => milestone.targetDate)
        .map((milestone) => ({
          id: `milestone:${milestone.id}`,
          kind: 'milestone' as const,
          title: milestone.title,
          date: milestone.targetDate!,
          status: milestone.status,
          humanKey: milestone.humanKey ?? null,
        })),
      ...tasks
        .filter((task) => task.dueDate)
        .map((task) => ({
          id: `task:${task.id}`,
          kind: 'task' as const,
          title: task.title,
          date: task.dueDate!,
          status: task.status,
          humanKey: task.humanKey ?? null,
          owner: task.currentOwner
            ? {
                displayName: task.currentOwner.displayName,
                avatarUrl: task.currentOwner.avatarUrl ?? null,
              }
            : null,
        })),
    ],
    [milestones, tasks],
  );

  const boardTasks = useMemo(
    () =>
      tasks.map((task) => ({
        id: task.id,
        title: task.title,
        status: task.status,
        dueDate: task.dueDate,
        forecastHours: task.forecastHours,
        actualHours: task.actualHours,
        milestoneId: task.milestoneId,
        sprintId: task.sprintId ?? null,
        storyPoints: task.storyPoints ?? null,
        humanKey: task.humanKey ?? null,
        userStoryTitle: task.userStoryTitle,
        currentOwnerUserId: task.currentOwnerUserId,
        currentOwner: task.currentOwner
          ? {
              userId: task.currentOwner.userId,
              displayName: task.currentOwner.displayName,
              avatarUrl: task.currentOwner.avatarUrl ?? null,
            }
          : null,
        raci: task.raci.map((entry) => ({
          userId: entry.userId,
          role: entry.role,
          displayName: entry.displayName,
          avatarUrl: entry.avatarUrl ?? null,
        })),
      })),
    [tasks],
  );

  const deliveryStats = useMemo(() => {
    const rates = new Map(ratePeople.map((person) => [person.userId, person]));
    const openStatuses = new Set(['todo', 'in_progress', 'blocked']);
    let openWork = 0;
    let inProgress = 0;
    let plannedHours = 0;
    let remaining = 0;
    let cost: number | null = null;
    for (const task of tasks) {
      if (task.status === 'cancelled') continue;
      const forecast = toHours(task.forecastHours) ?? 0;
      const actual = toHours(task.actualHours) ?? 0;
      plannedHours += forecast;
      if (openStatuses.has(task.status)) {
        openWork += 1;
        remaining += Math.max(0, forecast - actual);
        if (task.status === 'in_progress') inProgress += 1;
      }
      const person = resolveRatePerson(
        task.currentOwnerUserId,
        task.raci,
        rates,
      );
      const itemCost = hoursCost(forecast || null, person?.hourlyRate);
      if (itemCost != null) {
        cost = (cost ?? 0) + itemCost;
      }
    }
    return {
      openWork,
      inProgress,
      plannedHours: Math.round(plannedHours * 10) / 10,
      remainingHours: Math.round(remaining * 10) / 10,
      cost: cost == null ? null : Math.round(cost * 100) / 100,
    };
  }, [ratePeople, tasks]);

  function resetCreateForm() {
    setTitle('');
    setCreateKind('task');
    setDateValue('');
    setStartDateValue('');
    setEndDateValue('');
    setTaskMilestoneId('');
    setTaskStoryId('');
    setStoryEpicId('');
    setTaskAccountable('');
    setTaskResponsible('');
    setTaskForecastHours('');
    setTaskActualHours('');
    setError(null);
  }

  function closeCreateModal() {
    if (pending) return;
    setCreateOpen(false);
    resetCreateForm();
  }

  const createSubmitDisabled =
    pending ||
    !title.trim() ||
    (createKind === 'story' && !storyEpicId);

  async function submitCreate() {
    if (!title.trim()) return;
    if (createKind === 'story' && !storyEpicId) return;
    setPending(true);
    setError(null);
    try {
      if (createKind === 'epic') {
        const response = await fetch(`/api/v1/projects/${projectId}/epics`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: title.trim(),
            startDate: startDateValue || null,
            endDate: endDateValue || null,
          }),
        });
        const payload = (await response.json().catch(() => ({}))) as {
          epic?: Epic;
          error?: { message?: string };
        };
        if (!response.ok || !payload.epic) {
          throw new Error(payload.error?.message || t('failedCreateEpic'));
        }
        setEpics((prev) => [...prev, payload.epic!]);
        pushToast(t('epicCreated'), 'success');
      } else if (createKind === 'story') {
        const response = await fetch(`/api/v1/projects/${projectId}/user-stories`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: title.trim(),
            epicId: storyEpicId,
            startDate: startDateValue || null,
            endDate: endDateValue || null,
          }),
        });
        const payload = (await response.json().catch(() => ({}))) as {
          userStory?: UserStory;
          error?: { message?: string };
        };
        if (!response.ok || !payload.userStory) {
          throw new Error(payload.error?.message || t('failedCreateStory'));
        }
        setStories((prev) => [...prev, payload.userStory!]);
        pushToast(t('storyCreated'), 'success');
      } else if (createKind === 'milestone') {
        const response = await fetch(`/api/v1/projects/${projectId}/milestones`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: title.trim(),
            startDate: startDateValue || null,
            targetDate: dateValue || null,
          }),
        });
        const payload = (await response.json().catch(() => ({}))) as {
          milestone?: Milestone;
          error?: { message?: string };
        };
        if (!response.ok || !payload.milestone) {
          throw new Error(payload.error?.message || t('failedCreateMilestone'));
        }
        setMilestones((prev) => [...prev, payload.milestone!]);
        pushToast(t('milestoneCreated'), 'success');
      } else {
        const raci: Array<{ userId: string; role: 'R' | 'A' | 'C' | 'I' }> = [];
        if (taskAccountable) {
          raci.push({ userId: taskAccountable, role: 'A' });
        }
        if (taskResponsible && taskResponsible !== taskAccountable) {
          raci.push({ userId: taskResponsible, role: 'R' });
        } else if (taskResponsible && !taskAccountable) {
          raci.push({ userId: taskResponsible, role: 'R' });
        }

        const response = await fetch(`/api/v1/projects/${projectId}/tasks`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: title.trim(),
            dueDate: dateValue || null,
            forecastHours: parseHoursInput(taskForecastHours),
            actualHours: parseHoursInput(taskActualHours),
            milestoneId: taskMilestoneId || null,
            userStoryId: taskStoryId || null,
            raci: raci.length > 0 ? raci : undefined,
          }),
        });
        const payload = (await response.json().catch(() => ({}))) as {
          task?: Task;
          error?: { message?: string };
        };
        if (!response.ok || !payload.task) {
          throw new Error(payload.error?.message || t('failedCreateTask'));
        }
        setTasks((prev) => [...prev, payload.task!]);
        pushToast(t('taskCreated'), 'success');
      }

      setCreateOpen(false);
      resetCreateForm();
      refresh();
    } catch (err) {
      const fallback =
        createKind === 'epic'
          ? t('failedCreateEpic')
          : createKind === 'story'
            ? t('failedCreateStory')
            : createKind === 'milestone'
              ? t('failedCreateMilestone')
              : t('failedCreateTask');
      setError(err instanceof Error ? err.message : fallback);
    } finally {
      setPending(false);
    }
  }

  async function updateStatus(itemId: string, status: string) {
    const parsed = parseItemId(itemId);
    if (!parsed) return;
    setPending(true);
    setError(null);
    try {
      if (parsed.kind === 'epic') {
        const response = await fetch(`/api/v1/project-epics/${parsed.entityId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status }),
        });
        const payload = (await response.json().catch(() => ({}))) as {
          epic?: Epic;
          error?: { message?: string };
        };
        if (!response.ok || !payload.epic) {
          throw new Error(payload.error?.message || t('failedUpdateEpic'));
        }
        setEpics((prev) =>
          prev.map((item) =>
            item.id === parsed.entityId ? payload.epic! : item,
          ),
        );
      } else if (parsed.kind === 'story') {
        const response = await fetch(
          `/api/v1/project-user-stories/${parsed.entityId}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status }),
          },
        );
        const payload = (await response.json().catch(() => ({}))) as {
          userStory?: UserStory;
          error?: { message?: string };
        };
        if (!response.ok || !payload.userStory) {
          throw new Error(payload.error?.message || t('failedUpdateStory'));
        }
        setStories((prev) =>
          prev.map((item) =>
            item.id === parsed.entityId ? payload.userStory! : item,
          ),
        );
      } else if (parsed.kind === 'milestone') {
        const response = await fetch(
          `/api/v1/project-milestones/${parsed.entityId}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status }),
          },
        );
        const payload = (await response.json().catch(() => ({}))) as {
          milestone?: Milestone;
          error?: { message?: string };
        };
        if (!response.ok || !payload.milestone) {
          throw new Error(payload.error?.message || t('failedUpdateMilestone'));
        }
        setMilestones((prev) =>
          prev.map((item) =>
            item.id === parsed.entityId ? payload.milestone! : item,
          ),
        );
      } else {
        const response = await fetch(`/api/v1/project-tasks/${parsed.entityId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status }),
        });
        const payload = (await response.json().catch(() => ({}))) as {
          task?: Task;
          error?: { message?: string };
        };
        if (!response.ok || !payload.task) {
          throw new Error(payload.error?.message || t('failedUpdateTask'));
        }
        setTasks((prev) =>
          prev.map((item) =>
            item.id === parsed.entityId ? payload.task! : item,
          ),
        );
      }
      refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t('failedUpdateTask'),
      );
    } finally {
      setPending(false);
    }
  }

  function createSubmitLabel() {
    if (createKind === 'epic') return t('addEpic');
    if (createKind === 'story') return t('addStory');
    if (createKind === 'milestone') return t('addMilestone');
    return t('addTask');
  }

  function formatHoursLabel(value: number): string {
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value)}h`;
  }

  function onListManage(kind: DeliveryListKind, entityId: string) {
    if (kind === 'task') {
      setManageTaskId(entityId);
      return;
    }
    setManageAgile({ kind, id: entityId });
  }

  const showDeliveryStats =
    viewMode === 'board' || viewMode === 'list' || viewMode === 'tree';

  return (
    <>
      <CollapsibleSection
        id="project-delivery"
        storageKey={`project:${projectId}:delivery`}
        title={t('title')}
        defaultOpen
      >
      {error && !createOpen && !manageTaskId && !manageAgile ? (
        <div className="mb-3">
          <ErrorText>{error}</ErrorText>
        </div>
      ) : null}

      {showDeliveryStats ? (
        <div className="kh-ops-stats">
          <article className="kh-ops-stat">
            <div className="kh-ops-stat-label">{t('statsOpenWork')}</div>
            <div className="kh-ops-stat-value">{deliveryStats.openWork}</div>
            <div className="kh-ops-stat-note">
              {t('statsOpenWorkNote', { count: deliveryStats.inProgress })}
            </div>
          </article>
          <article className="kh-ops-stat">
            <div className="kh-ops-stat-label">{t('statsPlannedHours')}</div>
            <div className="kh-ops-stat-value">
              {formatHoursLabel(deliveryStats.plannedHours)}
            </div>
            <div className="kh-ops-stat-note">
              {t('statsRemainingHours', {
                hours: formatHoursLabel(deliveryStats.remainingHours),
              })}
            </div>
          </article>
          {deliveryStats.cost != null ? (
            <article className="kh-ops-stat">
              <div className="kh-ops-stat-label">{t('statsDeliveryCost')}</div>
              <div className="kh-ops-stat-value">
                {formatMoney(deliveryStats.cost, currency, locale)}
              </div>
              <div className="kh-ops-stat-note">{t('statsDeliveryCostNote')}</div>
            </article>
          ) : null}
        </div>
      ) : null}

      <div
        className="kh-ops-delivery-modes"
        role="group"
        aria-label={t('viewModeLabel')}
      >
        {VIEW_MODES.map((mode) => (
          <button
            key={mode}
            type="button"
            aria-pressed={viewMode === mode}
            onClick={() => changeViewMode(mode)}
          >
            {t(`viewMode.${mode}`)}
          </button>
        ))}
      </div>

      <div className="kh-ops-toolbar">
        <div className="flex flex-wrap items-center gap-2">
          {viewMode === 'timeline' ? (
            <Button
              type="button"
              variant="secondary"
              disabled={
                !timelineExportState?.canExport ||
                Boolean(timelineExportState?.pending)
              }
              onClick={() => timelineExportRef.current?.exportPdf()}
            >
              {timelineExportState?.pending
                ? t('timelineExportingPdf')
                : t('timelineExportPdf')}
            </Button>
          ) : null}
          {viewMode === 'board' ? (
            <Button
              type="button"
              variant="secondary"
              disabled={
                !boardExportState?.canExport ||
                Boolean(boardExportState?.pending)
              }
              onClick={() => boardExportRef.current?.exportPdf()}
            >
              {boardExportState?.pending
                ? t('boardExportingPdf')
                : t('boardExportPdf')}
            </Button>
          ) : null}
          {viewMode === 'calendar' ? (
            <Button
              type="button"
              variant="secondary"
              disabled={
                !calendarExportState?.canExport ||
                Boolean(calendarExportState?.pending)
              }
              onClick={() => calendarExportRef.current?.exportPdf()}
            >
              {calendarExportState?.pending
                ? t('calendarExportingPdf')
                : t('calendarExportPdf')}
            </Button>
          ) : null}
          {viewMode === 'scrum' ? (
            <Button
              type="button"
              variant="secondary"
              disabled={
                !scrumExportState?.canExport ||
                Boolean(scrumExportState?.pending)
              }
              onClick={() => scrumExportRef.current?.exportPdf()}
            >
              {scrumExportState?.pending
                ? t('scrumExportingPdf')
                : t('scrumExportPdf')}
            </Button>
          ) : null}
        </div>
        {canMutate ? (
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              resetCreateForm();
              setCreateOpen(true);
            }}
          >
            {t('addItem')}
          </Button>
        ) : null}
      </div>

      {viewMode === 'list' ? (
        <ProjectDeliveryList
          rows={listRows}
          canMutate={canMutate}
          pending={pending}
          onManage={onListManage}
          onStatusChange={(kind, entityId, status) =>
            void updateStatus(`${kind}:${entityId}`, status)
          }
        />
      ) : null}

      {viewMode === 'tree' ? (
        <ProjectDeliveryTree
          epics={epics}
          stories={stories}
          tasks={tasks.map((task) => ({
            ...task,
            sprintLabel: task.sprintId
              ? (sprintTitleById.get(task.sprintId) ?? null)
              : null,
          }))}
          onManageTask={(taskId) => setManageTaskId(taskId)}
          onManageEpic={(epicId) => setManageAgile({ kind: 'epic', id: epicId })}
          onManageStory={(storyId) =>
            setManageAgile({ kind: 'story', id: storyId })
          }
        />
      ) : null}

      {viewMode === 'board' ? (
        <ProjectDeliveryBoard
          projectId={projectId}
          projectName={projectName}
          tasks={boardTasks}
          milestones={milestones}
          milestoneTitles={milestoneTitleById}
          canMutate={canMutate}
          pending={pending}
          currency={currency}
          ratePeople={ratePeople}
          exportHandleRef={boardExportRef}
          onExportStateChange={onBoardExportStateChange}
          onTaskStatusChange={(taskId, status) =>
            void updateStatus(`task:${taskId}`, status)
          }
          onMilestoneStatusChange={(milestoneId, status) =>
            void updateStatus(`milestone:${milestoneId}`, status)
          }
          onManageTask={(taskId) => setManageTaskId(taskId)}
          onManageMilestone={(milestoneId) =>
            setManageAgile({ kind: 'milestone', id: milestoneId })
          }
        />
      ) : null}

      {viewMode === 'scrum' ? (
        <ProjectScrumView
          projectId={projectId}
          projectName={projectName}
          workspaceId={workspaceId}
          canMutate={canMutate}
          definitionOfDone={definitionOfDone}
          tasks={boardTasks}
          milestoneTitles={milestoneTitleById}
          currency={currency}
          ratePeople={ratePeople}
          exportHandleRef={scrumExportRef}
          onExportStateChange={onScrumExportStateChange}
          onTaskStatusChange={(taskId, status) =>
            void updateStatus(`task:${taskId}`, status)
          }
          onOpenTask={(taskId) => setManageTaskId(taskId)}
          onAssignToSprint={async (taskId, sprintId) => {
            setPending(true);
            setError(null);
            try {
              const response = await fetch(`/api/v1/project-tasks/${taskId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sprintId }),
              });
              if (!response.ok) {
                const payload = (await response.json().catch(() => null)) as {
                  message?: string;
                } | null;
                throw new Error(payload?.message ?? t('failedUpdateTask'));
              }
              const payload = (await response.json()) as { task: Task };
              setTasks((current) =>
                current.map((task) =>
                  task.id === taskId ? { ...task, ...payload.task } : task,
                ),
              );
              refresh();
            } catch (err) {
              setError(
                err instanceof Error ? err.message : t('failedUpdateTask'),
              );
            } finally {
              setPending(false);
            }
          }}
          onRefresh={refresh}
        />
      ) : null}

      {viewMode === 'calendar' ? (
        <ProjectDeliveryCalendar
          projectId={projectId}
          projectName={projectName}
          items={calendarItems}
          exportHandleRef={calendarExportRef}
          onExportStateChange={onCalendarExportStateChange}
        />
      ) : null}

      {viewMode === 'timeline' ? (
        <ProjectDeliveryTimeline
          projectId={projectId}
          projectName={projectName}
          projectStartDate={projectStartDate}
          projectEndDate={projectEndDate}
          epics={epics}
          stories={stories}
          milestones={milestones}
          tasks={tasks}
          exportHandleRef={timelineExportRef}
          onExportStateChange={onTimelineExportStateChange}
          onManageEpic={(epicId) =>
            setManageAgile({ kind: 'epic', id: epicId })
          }
          onManageStory={(storyId) =>
            setManageAgile({ kind: 'story', id: storyId })
          }
          onManageMilestone={(milestoneId) =>
            setManageAgile({ kind: 'milestone', id: milestoneId })
          }
          onManageTask={(taskId) => setManageTaskId(taskId)}
        />
      ) : null}

      {viewMode === 'list' ? (
        <p className="mt-3 mb-0 text-xs text-ink-muted">
          {canMutate ? t('raciHint') : t('readOnlyHint')}
        </p>
      ) : null}
      </CollapsibleSection>

      <Modal
        open={createOpen}
        onClose={closeCreateModal}
        title={t('addItem')}
        description={t('modalDescription')}
        size="md"
        footer={
          <>
            <Button
              type="button"
              variant="secondary"
              disabled={pending}
              onClick={closeCreateModal}
            >
              {tCommon('cancel')}
            </Button>
            <Button
              type="button"
              disabled={createSubmitDisabled}
              onClick={() => void submitCreate()}
            >
              {createSubmitLabel()}
            </Button>
          </>
        }
      >
        <div className="grid gap-3">
          {error ? <ErrorText>{error}</ErrorText> : null}
          <Field label={t('createKind')}>
            <Select
              value={createKind}
              onChange={(e) => setCreateKind(e.target.value as CreateKind)}
              disabled={pending}
              data-modal-initial-focus
            >
              <option value="task">{t('createKindTask')}</option>
              <option value="milestone">{t('createKindMilestone')}</option>
              <option value="epic">{t('createKindEpic')}</option>
              <option value="story">{t('createKindStory')}</option>
            </Select>
          </Field>
          <Field label={t('itemTitle')}>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={pending}
            />
          </Field>
          {createKind === 'milestone' ? (
            <div className="kh-ops-form-grid">
              <Field label={t('startDate')}>
                <Input
                  type="date"
                  value={startDateValue}
                  onChange={(e) => setStartDateValue(e.target.value)}
                  disabled={pending}
                />
              </Field>
              <Field label={t('targetDate')}>
                <Input
                  type="date"
                  value={dateValue}
                  onChange={(e) => setDateValue(e.target.value)}
                  disabled={pending}
                />
              </Field>
            </div>
          ) : null}
          {createKind === 'epic' ? (
            <div className="kh-ops-form-grid">
              <Field label={t('startDate')}>
                <Input
                  type="date"
                  value={startDateValue}
                  onChange={(e) => setStartDateValue(e.target.value)}
                  disabled={pending}
                />
              </Field>
              <Field label={t('endDate')}>
                <Input
                  type="date"
                  value={endDateValue}
                  onChange={(e) => setEndDateValue(e.target.value)}
                  disabled={pending}
                />
              </Field>
            </div>
          ) : null}
          {createKind === 'story' ? (
            <>
              <Field label={t('selectEpic')}>
                <Select
                  value={storyEpicId}
                  onChange={(e) => setStoryEpicId(e.target.value)}
                  disabled={pending}
                >
                  <option value="">{t('selectEpic')}</option>
                  {epics.map((epic) => (
                    <option key={epic.id} value={epic.id}>
                      {epic.title}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="kh-ops-form-grid">
                <Field label={t('startDate')}>
                  <Input
                    type="date"
                    value={startDateValue}
                    onChange={(e) => setStartDateValue(e.target.value)}
                    disabled={pending}
                  />
                </Field>
                <Field label={t('endDate')}>
                  <Input
                    type="date"
                    value={endDateValue}
                    onChange={(e) => setEndDateValue(e.target.value)}
                    disabled={pending}
                  />
                </Field>
              </div>
            </>
          ) : null}
          {createKind === 'task' ? (
            <>
              <Field label={t('dueDate')}>
                <Input
                  type="date"
                  value={dateValue}
                  onChange={(e) => setDateValue(e.target.value)}
                  disabled={pending}
                />
              </Field>
              <div className="kh-ops-form-grid">
                <Field label={t('forecastHours')}>
                  <Input
                    type="number"
                    min="0"
                    step="0.25"
                    value={taskForecastHours}
                    onChange={(e) => setTaskForecastHours(e.target.value)}
                    disabled={pending}
                  />
                </Field>
                <Field label={t('actualHours')}>
                  <Input
                    type="number"
                    min="0"
                    step="0.25"
                    value={taskActualHours}
                    onChange={(e) => setTaskActualHours(e.target.value)}
                    disabled={pending}
                  />
                </Field>
              </div>
              <Field label={t('milestoneOptional')}>
                <Select
                  value={taskMilestoneId}
                  onChange={(e) => setTaskMilestoneId(e.target.value)}
                  disabled={pending}
                >
                  <option value="">{t('noMilestone')}</option>
                  {milestones.map((milestone) => (
                    <option key={milestone.id} value={milestone.id}>
                      {milestone.title}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('storyOptional')}>
                <Select
                  value={taskStoryId}
                  onChange={(e) => setTaskStoryId(e.target.value)}
                  disabled={pending}
                >
                  <option value="">{t('noStory')}</option>
                  {stories.map((story) => {
                    const epicLabel = epicTitleById.get(story.epicId);
                    return (
                      <option key={story.id} value={story.id}>
                        {epicLabel ? `${epicLabel} · ` : ''}
                        {story.title}
                      </option>
                    );
                  })}
                </Select>
              </Field>
              <Field label={t('accountable')}>
                <Select
                  value={taskAccountable}
                  onChange={(e) => setTaskAccountable(e.target.value)}
                  disabled={pending}
                >
                  <option value="">{t('unassigned')}</option>
                  {members.map((member) => (
                    <option key={member.userId} value={member.userId}>
                      {member.displayName} ({member.email})
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('responsible')}>
                <Select
                  value={taskResponsible}
                  onChange={(e) => setTaskResponsible(e.target.value)}
                  disabled={pending}
                >
                  <option value="">{t('unassigned')}</option>
                  {members.map((member) => (
                    <option key={member.userId} value={member.userId}>
                      {member.displayName} ({member.email})
                    </option>
                  ))}
                </Select>
              </Field>
            </>
          ) : null}
        </div>
      </Modal>

      <ProjectTaskManageModal
        open={Boolean(manageTaskId)}
        onClose={() => setManageTaskId(null)}
        taskId={manageTaskId}
        canMutate={canMutate}
        members={members}
        epics={epics}
        stories={stories}
        milestones={milestones}
        currency={currency}
        ratePeople={ratePeople}
        onUpdated={(updated) => {
          setTasks((prev) =>
            prev.map((item) =>
              item.id === updated.id
                ? {
                    ...item,
                    ...updated,
                    currentOwner: updated.currentOwner,
                  }
                : item,
            ),
          );
          refresh();
        }}
        onDeleted={(taskId) => {
          setTasks((prev) => prev.filter((item) => item.id !== taskId));
          refresh();
        }}
      />

      <ProjectAgileManageModal
        open={Boolean(manageAgile)}
        onClose={() => setManageAgile(null)}
        kind={manageAgile?.kind ?? null}
        itemId={manageAgile?.id ?? null}
        projectId={projectId}
        epics={epics}
        stories={stories}
        milestones={milestones}
        tasks={tasks}
        currency={currency}
        ratePeople={ratePeople}
        canMutate={canMutate}
        onSaved={(kind, item) => {
          if (kind === 'epic') {
            const epic = item as Epic;
            setEpics((prev) =>
              prev.map((row) => (row.id === epic.id ? { ...row, ...epic } : row)),
            );
            setTasks((prev) =>
              prev.map((task) =>
                task.epicId === epic.id
                  ? { ...task, epicTitle: epic.title }
                  : task,
              ),
            );
          } else if (kind === 'story') {
            const story = item as UserStory;
            setStories((prev) =>
              prev.map((row) =>
                row.id === story.id ? { ...row, ...story } : row,
              ),
            );
            const epicTitle = epicTitleById.get(story.epicId) ?? null;
            setTasks((prev) =>
              prev.map((task) =>
                task.userStoryId === story.id
                  ? {
                      ...task,
                      userStoryTitle: story.title,
                      epicId: story.epicId,
                      epicTitle,
                    }
                  : task,
              ),
            );
          } else {
            const milestone = item as Milestone;
            setMilestones((prev) =>
              prev.map((row) =>
                row.id === milestone.id ? { ...row, ...milestone } : row,
              ),
            );
          }
          refresh();
        }}
        onDeleted={(kind, id) => {
          if (kind === 'milestone') {
            return;
          }
          if (kind === 'epic') {
            const removedStoryIds = new Set(
              stories.filter((story) => story.epicId === id).map((s) => s.id),
            );
            setEpics((prev) => prev.filter((row) => row.id !== id));
            setStories((prev) => prev.filter((row) => row.epicId !== id));
            setTasks((prev) =>
              prev.map((task) =>
                task.epicId === id ||
                (task.userStoryId && removedStoryIds.has(task.userStoryId))
                  ? {
                      ...task,
                      userStoryId: null,
                      userStoryTitle: null,
                      epicId: null,
                      epicTitle: null,
                    }
                  : task,
              ),
            );
          } else {
            setStories((prev) => prev.filter((row) => row.id !== id));
            setTasks((prev) =>
              prev.map((task) =>
                task.userStoryId === id
                  ? {
                      ...task,
                      userStoryId: null,
                      userStoryTitle: null,
                      epicId: null,
                      epicTitle: null,
                    }
                  : task,
              ),
            );
          }
          refresh();
        }}
      />
    </>
  );
}
