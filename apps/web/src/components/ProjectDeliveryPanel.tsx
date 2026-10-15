'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { TASK_COMPLETION_PERCENTS, addCalendarDays } from '@project-knowledge-hub/domain';
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
import { ProjectDeliveryGantt } from './ProjectDeliveryGantt';
import { ProjectDeliveryTree } from './ProjectDeliveryTree';
import { ProjectScrumView, type ScrumExportHandle } from './ProjectScrumView';
import { ProjectAgileManageModal } from './ProjectAgileManageModal';
import { ProjectTaskManageModal } from './ProjectTaskManageModal';
import type { DeliveryDocumentRecord } from './DeliveryDocumentsEditor';
import {
  deliveryCompletionIndex,
  displayedMilestoneStatus,
  displayedParentCompletion,
  derivedParentDates,
  formatPercentLabel,
  parentStatusFromChildren,
  plannedTargetPercent,
  taskDeliveryCompletion,
} from '../lib/delivery-completion';
import { useLocalToday } from '../lib/use-local-today';
import {
  Button,
  ErrorText,
  Field,
  DELIVERY_ITEM_MODAL_SIZE,
  Input,
  Modal,
  Select,
  Switch,
  Textarea,
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

type MilestoneLink = {
  entityType: 'epic' | 'user_story' | 'task';
  entityId: string;
  title?: string;
  humanKey?: string | null;
  status?: string;
  itemType?: 'task' | 'bug' | null;
  completionPercent?: number | null;
};

type Milestone = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  startDate: string | null;
  targetDate: string | null;
  sortOrder: number;
  humanKey?: string | null;
  completionPercent?: number | null;
  completion?: { percent: number; done: number; total: number } | null;
  linkedItems?: MilestoneLink[];
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
  startDate?: string | null;
  forecastHours: string | null;
  actualHours: string | null;
  storyPoints?: number | null;
  completionPercent?: number | null;
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
  itemType?: 'task' | 'bug';
  createdAt?: string;
  updatedAt?: string;
};

type Member = {
  userId: string;
  displayName: string;
  email: string;
};

const VIEW_MODES = ['board', 'list', 'tree', 'gantt', 'calendar', 'timeline', 'scrum'] as const;
type ViewMode = (typeof VIEW_MODES)[number];

type DeliveryKind = 'epic' | 'story' | 'milestone' | 'task';
type CreateKind = 'task' | 'bug' | 'milestone' | 'epic' | 'story';

type LinkedSystem = { id: string; name: string };

function workItemType(value: string | null | undefined): 'task' | 'bug' {
  return value === 'bug' ? 'bug' : 'task';
}

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
  workingCalendar,
  definitionOfDone = null,
  initialEpics,
  initialStories,
  initialMilestones,
  initialTasks,
  initialOpenTaskId = null,
  members,
  currency = 'EUR',
  ratePeople = [],
  systems = [],
  records = [],
}: {
  projectId: string;
  projectName: string;
  workspaceId: string;
  canMutate: boolean;
  projectStartDate?: string | null;
  projectEndDate?: string | null;
  workingCalendar?: {
    hoursPerWorkday?: number | string | null;
    workdaysPerWeek?: number | null;
    nonWorkingDays?: readonly string[] | null;
  };
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
  systems?: LinkedSystem[];
  records?: DeliveryDocumentRecord[];
}) {
  const t = useTranslations('delivery');
  const tRaid = useTranslations('raid');
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
  const [sprintsLoaded, setSprintsLoaded] = useState(false);

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
        if (!response.ok) {
          if (!cancelled) setSprintsLoaded(true);
          return;
        }
        const payload = (await response.json()) as {
          sprints: Array<{ id: string; name: string; humanKey?: string | null }>;
        };
        if (!cancelled) {
          setSprintLabels(payload.sprints);
          setSprintsLoaded(true);
        }
      })
      .catch(() => {
        if (!cancelled) setSprintsLoaded(true);
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
  const [durationDaysValue, setDurationDaysValue] = useState('');
  const [endDateValue, setEndDateValue] = useState('');
  const [taskMilestoneId, setTaskMilestoneId] = useState('');
  const [taskStoryId, setTaskStoryId] = useState('');
  const [storyEpicId, setStoryEpicId] = useState('');
  const [taskAccountable, setTaskAccountable] = useState('');
  const [taskResponsible, setTaskResponsible] = useState('');
  const [taskForecastHours, setTaskForecastHours] = useState('');
  const [taskCompletionPercent, setTaskCompletionPercent] = useState('0');
  const [taskActualHours, setTaskActualHours] = useState('');
  const [bugSeverity, setBugSeverity] = useState('medium');
  const [bugFoundIn, setBugFoundIn] = useState('');
  const [bugFoundInNote, setBugFoundInNote] = useState('');
  const [bugSteps, setBugSteps] = useState('');
  const [bugExpected, setBugExpected] = useState('');
  const [bugActual, setBugActual] = useState('');
  const [bugRegression, setBugRegression] = useState(false);
  const [bugSystemId, setBugSystemId] = useState('');
  const [milestoneNote, setMilestoneNote] = useState('');
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

  const today = useLocalToday();
  const shownDelivery = useMemo(() => {
    const tasksByStory = new Map<string, Task[]>();
    const tasksByEpic = new Map<string, Task[]>();
    const taskById = new Map<string, Task>();
    for (const task of tasks) {
      taskById.set(task.id, task);
      if (task.userStoryId) {
        const list = tasksByStory.get(task.userStoryId) ?? [];
        list.push(task);
        tasksByStory.set(task.userStoryId, list);
      }
      if (task.epicId) {
        const list = tasksByEpic.get(task.epicId) ?? [];
        list.push(task);
        tasksByEpic.set(task.epicId, list);
      }
    }
    const derivedStories = stories.map((story) => {
      const children = tasksByStory.get(story.id) ?? [];
      const dates = derivedParentDates(
        { start: story.startDate, end: story.endDate },
        children.map((task) => ({
          status: task.status,
          start: task.startDate ?? null,
          end: task.dueDate,
        })),
      );
      return {
        ...story,
        status: parentStatusFromChildren(story.status, children),
        startDate: dates.start,
        endDate: dates.end,
      };
    });
    const storyById = new Map(derivedStories.map((story) => [story.id, story]));
    const derivedEpics = epics.map((epic) => {
      const dates = derivedParentDates(
        { start: epic.startDate, end: epic.endDate },
        derivedStories
          .filter((story) => story.epicId === epic.id)
          .map((story) => ({
            status: story.status,
            start: story.startDate,
            end: story.endDate,
          })),
      );
      return {
        ...epic,
        status: parentStatusFromChildren(epic.status, tasksByEpic.get(epic.id) ?? []),
        startDate: dates.start,
        endDate: dates.end,
      };
    });
    const epicById = new Map(derivedEpics.map((epic) => [epic.id, epic]));
    return {
      epics: derivedEpics,
      stories: derivedStories,
      milestones: milestones.map((milestone) => {
        const linkDates = (milestone.linkedItems ?? []).flatMap((link) => {
          if (link.entityType === 'task') {
            const task = taskById.get(link.entityId);
            if (!task) return [];
            return [{
              status: task.status,
              start: task.startDate ?? null,
              end: task.dueDate,
            }];
          }
          if (link.entityType === 'user_story') {
            const story = storyById.get(link.entityId);
            if (!story) return [];
            return [{ status: story.status, start: story.startDate, end: story.endDate }];
          }
          const epic = epicById.get(link.entityId);
          if (!epic) return [];
          return [{ status: epic.status, start: epic.startDate, end: epic.endDate }];
        });
        const dates = derivedParentDates(
          { start: milestone.startDate, end: milestone.targetDate },
          linkDates,
        );
        return {
          ...milestone,
          status: displayedMilestoneStatus(milestone.status, milestone.linkedItems ?? []),
          startDate: dates.start,
          targetDate: dates.end,
        };
      }),
    };
  }, [epics, milestones, stories, tasks]);
  const listRows: DeliveryListRow[] = useMemo(() => {
    const completion = deliveryCompletionIndex(tasks);
    const epicRows: DeliveryListRow[] = shownDelivery.epics.map((epic) => ({
      id: `epic:${epic.id}`,
      kind: 'epic',
      entityId: epic.id,
      humanKey: epic.humanKey ?? null,
      title: epic.title,
      status: epic.status,
      completion: displayedParentCompletion(
        epic.status,
        completion.byEpicId.get(epic.id) ?? null,
      ),
      targetPercent: plannedTargetPercent(epic.startDate, epic.endDate, today),
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

    const storyRows: DeliveryListRow[] = shownDelivery.stories.map((story) => {
      const epicLabel = epicTitleById.get(story.epicId) ?? '';
      return {
        id: `story:${story.id}`,
        kind: 'story',
        entityId: story.id,
        humanKey: story.humanKey ?? null,
        title: story.title,
        status: story.status,
        completion: displayedParentCompletion(
          story.status,
          completion.byStoryId.get(story.id) ?? null,
        ),
        targetPercent: plannedTargetPercent(story.startDate, story.endDate, today),
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

    const milestoneRows: DeliveryListRow[] = shownDelivery.milestones.map((milestone) => ({
      id: `milestone:${milestone.id}`,
      kind: 'milestone',
      entityId: milestone.id,
      humanKey: milestone.humanKey ?? null,
      title: milestone.title,
      status: milestone.status,
      completion: milestone.completion ?? null,
      dueDate: milestone.targetDate,
      targetPercent: null,
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
        itemType: workItemType(task.itemType),
        title: task.title,
        status: task.status,
        completion: taskDeliveryCompletion(task.status, task.completionPercent),
        targetPercent: null,
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
          task.itemType === 'bug' ? 'bug' : 'task',
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
  }, [shownDelivery, tasks, epicTitleById, sprintTitleById, today]);

  const calendarItems = useMemo(
    () => [
      ...shownDelivery.milestones
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
          itemType: workItemType(task.itemType),
          owner: task.currentOwner
            ? {
                displayName: task.currentOwner.displayName,
                avatarUrl: task.currentOwner.avatarUrl ?? null,
              }
            : null,
        })),
    ],
    [shownDelivery.milestones, tasks],
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
        itemType: workItemType(task.itemType),
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
    setDurationDaysValue('');
    setEndDateValue('');
    setTaskMilestoneId('');
    setTaskStoryId('');
    setStoryEpicId('');
    setTaskAccountable('');
    setTaskResponsible('');
    setTaskForecastHours('');
    setTaskActualHours('');
    setTaskCompletionPercent('0');
    setBugSeverity('medium');
    setBugFoundIn('');
    setBugFoundInNote('');
    setBugSteps('');
    setBugExpected('');
    setBugActual('');
    setBugRegression(false);
    setBugSystemId('');
    setMilestoneNote('');
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
            description: milestoneNote.trim() || null,
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
            startDate: startDateValue || null,
            dueDate: dateValue || null,
            durationDays:
              durationDaysValue.trim() === '' ? null : Number(durationDaysValue),
            forecastHours: parseHoursInput(taskForecastHours),
            actualHours: parseHoursInput(taskActualHours),
            completionPercent: Number(taskCompletionPercent),
            milestoneId: taskMilestoneId || null,
            userStoryId: taskStoryId || null,
            raci: raci.length > 0 ? raci : undefined,
            itemType: createKind === 'bug' ? 'bug' : 'task',
            ...(createKind === 'bug'
              ? {
                  severity: bugSeverity || 'medium',
                  foundIn: bugFoundIn || null,
                  foundInNote: bugFoundInNote.trim() || null,
                  stepsToReproduce: bugSteps.trim() || null,
                  expectedBehavior: bugExpected.trim() || null,
                  actualBehavior: bugActual.trim() || null,
                  regression: bugRegression,
                  affectedSystemId: bugSystemId || null,
                }
              : {}),
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
        pushToast(
          createKind === 'bug' ? t('bugCreated') : t('taskCreated'),
          'success',
        );
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
              : createKind === 'bug'
                ? t('failedCreateBug')
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
    if (createKind === 'bug') return t('addBug');
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
    viewMode === 'board' || viewMode === 'list' || viewMode === 'tree' || viewMode === 'gantt';

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
          epics={shownDelivery.epics}
          stories={shownDelivery.stories}
          milestones={shownDelivery.milestones.map((milestone) => ({
            id: milestone.id,
            title: milestone.title,
            status: milestone.status,
            targetDate: milestone.targetDate,
            humanKey: milestone.humanKey ?? null,
            completionPercent: milestone.completionPercent ?? null,
          }))}
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
          onManageMilestone={(milestoneId) =>
            setManageAgile({ kind: 'milestone', id: milestoneId })
          }
          sprintsLoaded={sprintsLoaded}
        />
      ) : null}

      {viewMode === 'gantt' ? (
        <ProjectDeliveryGantt
          projectId={projectId}
          epics={shownDelivery.epics}
          stories={shownDelivery.stories}
          milestones={shownDelivery.milestones}
          tasks={tasks.map((task) => ({
            ...task,
            sprintLabel: task.sprintId
              ? (sprintTitleById.get(task.sprintId) ?? null)
              : null,
          }))}
          workingCalendar={workingCalendar}
          sprintsLoaded={sprintsLoaded}
          onManageTask={(taskId) => setManageTaskId(taskId)}
          onManageEpic={(epicId) => setManageAgile({ kind: 'epic', id: epicId })}
          onManageStory={(storyId) => setManageAgile({ kind: 'story', id: storyId })}
          onManageMilestone={(milestoneId) =>
            setManageAgile({ kind: 'milestone', id: milestoneId })
          }
        />
      ) : null}

      {viewMode === 'board' ? (
        <ProjectDeliveryBoard
          projectId={projectId}
          projectName={projectName}
          tasks={boardTasks}
          milestones={shownDelivery.milestones}
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
          records={records}
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
          onOpenItem={(item) => {
            if (item.kind === 'task') {
              const taskId = item.id.startsWith('task:')
                ? item.id.slice('task:'.length)
                : item.id;
              setManageTaskId(taskId);
              return;
            }
            const milestoneId = item.id.startsWith('milestone:')
              ? item.id.slice('milestone:'.length)
              : item.id;
            setManageAgile({ kind: 'milestone', id: milestoneId });
          }}
        />
      ) : null}

      {viewMode === 'timeline' ? (
        <ProjectDeliveryTimeline
          projectId={projectId}
          projectName={projectName}
          projectStartDate={projectStartDate}
          projectEndDate={projectEndDate}
          epics={shownDelivery.epics}
          stories={shownDelivery.stories}
          milestones={shownDelivery.milestones}
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
        size={DELIVERY_ITEM_MODAL_SIZE}
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
              <option value="bug">{t('createKindBug')}</option>
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
            <>
              <Field label={t('dueDate')}>
                <Input
                  type="date"
                  value={dateValue}
                  onChange={(e) => setDateValue(e.target.value)}
                  disabled={pending}
                />
              </Field>
              <Field label={t('milestoneNote')}>
                <Textarea
                  value={milestoneNote}
                  onChange={(event) => setMilestoneNote(event.target.value)}
                  disabled={pending}
                  rows={4}
                />
              </Field>
            </>
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
          {createKind === 'task' || createKind === 'bug' ? (
            <>
              <div className="kh-ops-form-grid">
                <Field label={t('startDate')}>
                  <Input
                    type="date"
                    value={startDateValue}
                    onChange={(event) => {
                      const next = event.target.value;
                      setStartDateValue(next);
                      const days = Number(durationDaysValue);
                      if (
                        next
                        && durationDaysValue.trim() !== ''
                        && Number.isInteger(days)
                        && days >= 0
                      ) {
                        setDateValue(addCalendarDays(next, days));
                      }
                    }}
                    disabled={pending}
                  />
                </Field>
                <Field label={t('durationDays')}>
                  <Input
                    type="number"
                    min={0}
                    max={3650}
                    step={1}
                    value={durationDaysValue}
                    onChange={(event) => {
                      const next = event.target.value;
                      setDurationDaysValue(next);
                      const days = Number(next);
                      if (
                        startDateValue
                        && next.trim() !== ''
                        && Number.isInteger(days)
                        && days >= 0
                      ) {
                        setDateValue(addCalendarDays(startDateValue, days));
                      }
                    }}
                    disabled={pending}
                  />
                </Field>
                <Field label={t('dueDate')}>
                  <Input
                    type="date"
                    value={dateValue}
                    onChange={(e) => setDateValue(e.target.value)}
                    disabled={pending || durationDaysValue.trim() !== ''}
                  />
                </Field>
              </div>
              {durationDaysValue.trim() !== '' ? (
                <p className="m-0 text-xs text-ink-muted">{t('durationHint')}</p>
              ) : null}
              <Field label={t('completionField')}>
                <Select
                  value={taskCompletionPercent}
                  onChange={(event) => setTaskCompletionPercent(event.target.value)}
                  disabled={pending}
                >
                  {TASK_COMPLETION_PERCENTS.map((value) => (
                    <option key={value} value={String(value)}>
                      {formatPercentLabel(value, locale)}
                    </option>
                  ))}
                </Select>
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
              {createKind === 'bug' ? (
                <>
                  <Field label={t('severity')}>
                    <Select
                      value={bugSeverity}
                      onChange={(e) => setBugSeverity(e.target.value)}
                      disabled={pending}
                    >
                      {(['low', 'medium', 'high', 'critical'] as const).map((value) => (
                        <option key={value} value={value}>
                          {tRaid(`severity.${value}`)}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label={t('foundIn')}>
                    <Select
                      value={bugFoundIn}
                      onChange={(e) => setBugFoundIn(e.target.value)}
                      disabled={pending}
                    >
                      <option value="">{t('noAffectedSystem')}</option>
                      {(['development', 'test', 'staging', 'production'] as const).map(
                        (value) => (
                          <option key={value} value={value}>
                            {t(`foundInValue.${value}`)}
                          </option>
                        ),
                      )}
                    </Select>
                  </Field>
                  <Field label={t('foundInNote')}>
                    <Input
                      value={bugFoundInNote}
                      maxLength={200}
                      onChange={(e) => setBugFoundInNote(e.target.value)}
                      disabled={pending}
                    />
                  </Field>
                  <Field className="kh-ops-field-span" label={t('stepsToReproduce')}>
                    <Textarea
                      value={bugSteps}
                      rows={3}
                      onChange={(e) => setBugSteps(e.target.value)}
                      disabled={pending}
                    />
                  </Field>
                  <Field label={t('expectedBehavior')}>
                    <Textarea
                      value={bugExpected}
                      rows={3}
                      onChange={(e) => setBugExpected(e.target.value)}
                      disabled={pending}
                    />
                  </Field>
                  <Field label={t('actualBehavior')}>
                    <Textarea
                      value={bugActual}
                      rows={3}
                      onChange={(e) => setBugActual(e.target.value)}
                      disabled={pending}
                    />
                  </Field>
                  <Switch
                    id="bug-regression-create"
                    checked={bugRegression}
                    onCheckedChange={setBugRegression}
                    label={t('regression')}
                    disabled={pending}
                  />
                  <Field label={t('affectedSystem')}>
                    <Select
                      value={bugSystemId}
                      onChange={(e) => setBugSystemId(e.target.value)}
                      disabled={pending}
                    >
                      <option value="">{t('noAffectedSystem')}</option>
                      {systems.map((system) => (
                        <option key={system.id} value={system.id}>
                          {system.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </>
              ) : null}
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
        epics={shownDelivery.epics}
        stories={shownDelivery.stories}
        milestones={shownDelivery.milestones}
        currency={currency}
        ratePeople={ratePeople}
        systems={systems}
        records={records}
        bugOptions={tasks
          .filter((item) => item.itemType === 'bug')
          .map((item) => ({
            id: item.id,
            title: item.title,
            humanKey: item.humanKey ?? null,
          }))}
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
        epics={shownDelivery.epics}
        stories={shownDelivery.stories}
        milestones={shownDelivery.milestones}
        tasks={tasks}
        records={records}
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
        onDependenciesChanged={refresh}
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
