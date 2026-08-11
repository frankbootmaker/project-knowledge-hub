'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  CatalogueSection,
  type CatalogueListItem,
} from './CatalogueSection';
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
  ProjectDeliveryTimeline,
  type TimelineExportHandle,
} from './ProjectDeliveryTimeline';
import { ProjectDeliveryTree } from './ProjectDeliveryTree';
import { ProjectScrumView, type ScrumExportHandle } from './ProjectScrumView';
import { ProjectAgileManageModal } from './ProjectAgileManageModal';
import { ProjectTaskManageModal } from './ProjectTaskManageModal';
import { UserAvatar } from './UserAvatar';
import {
  Badge,
  Button,
  ErrorText,
  Field,
  Input,
  Modal,
  Select,
  useToast,
} from './ui';
import { cn } from '../lib/cn';
import {
  deliveryScheduleSurfaceClass,
  deliveryScheduleTone,
  todayYmd,
} from '../lib/delivery-schedule';
import { parseHoursInput, type RatePerson } from '../lib/task-costing';

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

const MILESTONE_STATUSES = ['planned', 'active', 'done', 'cancelled'] as const;
const EPIC_STATUSES = MILESTONE_STATUSES;
const STORY_STATUSES = MILESTONE_STATUSES;
const TASK_STATUSES = ['todo', 'in_progress', 'blocked', 'done', 'cancelled'] as const;
const VIEW_MODES = ['list', 'tree', 'board', 'calendar', 'timeline', 'scrum'] as const;
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
  members: Member[];
  currency?: string;
  ratePeople?: RatePerson[];
}) {
  const t = useTranslations('delivery');
  const tCommon = useTranslations('common');
  const tWorkspaces = useTranslations('workspaces');
  const router = useRouter();
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
  }

  const wideModalOpen =
    viewMode === 'board' ||
    viewMode === 'calendar' ||
    viewMode === 'timeline' ||
    viewMode === 'scrum';

  function closeWideModal() {
    changeViewMode('list');
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

  const items: CatalogueListItem[] = useMemo(() => {
    const epicItems: CatalogueListItem[] = epics.map((epic) => ({
      id: `epic:${epic.id}`,
      title: epic.title,
      primaryBadge: epic.humanKey ?? t('kindEpic'),
      secondaryBadge: t(`milestoneStatus.${epic.status}`),
      subtitle:
        epic.startDate || epic.endDate
          ? `${t('startDate')}: ${epic.startDate ?? '…'} · ${t('endDate')}: ${epic.endDate ?? '…'}`
          : null,
      updatedAt: epic.updatedAt ?? epic.createdAt ?? null,
      searchText: [
        epic.title,
        epic.humanKey ?? '',
        epic.description ?? '',
        epic.status,
        'epic',
        epic.startDate ?? '',
        epic.endDate ?? '',
      ]
        .join(' ')
        .toLowerCase(),
      filterValue: `epic:${epic.status}`,
      filterLabel: `${t('kindEpic')} · ${t(`milestoneStatus.${epic.status}`)}`,
    }));

    const storyItems: CatalogueListItem[] = stories.map((story) => {
      const epicLabel = epicTitleById.get(story.epicId) ?? null;
      return {
        id: `story:${story.id}`,
        title: story.title,
        primaryBadge: story.humanKey ?? t('kindStory'),
        secondaryBadge: t(`milestoneStatus.${story.status}`),
        subtitle: [
          epicLabel ? `${t('kindEpic')}: ${epicLabel}` : null,
          story.startDate || story.endDate
            ? `${t('startDate')}: ${story.startDate ?? '…'} · ${t('endDate')}: ${story.endDate ?? '…'}`
            : null,
        ]
          .filter(Boolean)
          .join(' · ') || null,
        updatedAt: story.updatedAt ?? story.createdAt ?? null,
        searchText: [
          story.title,
          story.humanKey ?? '',
          story.description ?? '',
          story.status,
          'story',
          epicLabel ?? '',
          story.startDate ?? '',
          story.endDate ?? '',
        ]
          .join(' ')
          .toLowerCase(),
        filterValue: `story:${story.status}`,
        filterLabel: `${t('kindStory')} · ${t(`milestoneStatus.${story.status}`)}`,
      };
    });

    const milestoneItems: CatalogueListItem[] = milestones.map((milestone) => ({
      id: `milestone:${milestone.id}`,
      title: milestone.title,
      primaryBadge: milestone.humanKey ?? t('kindMilestone'),
      secondaryBadge: t(`milestoneStatus.${milestone.status}`),
      subtitle: [
        milestone.startDate
          ? `${t('startDate')}: ${milestone.startDate}`
          : null,
        milestone.targetDate
          ? `${t('targetDate')}: ${milestone.targetDate}`
          : null,
      ]
        .filter(Boolean)
        .join(' · ') || null,
      updatedAt: milestone.updatedAt ?? milestone.createdAt ?? null,
      searchText: [
        milestone.title,
        milestone.humanKey ?? '',
        milestone.description ?? '',
        milestone.status,
        'milestone',
        milestone.startDate ?? '',
        milestone.targetDate ?? '',
      ]
        .join(' ')
        .toLowerCase(),
      filterValue: `milestone:${milestone.status}`,
      filterLabel: `${t('kindMilestone')} · ${t(`milestoneStatus.${milestone.status}`)}`,
    }));

    const taskItems: CatalogueListItem[] = tasks.map((task) => {
      const raciLine =
        task.raci.length > 0
          ? task.raci.map((entry) => `${entry.role}: ${entry.displayName}`).join(' · ')
          : null;
      const ownerLabel = task.currentOwner?.displayName ?? null;
      return {
        id: `task:${task.id}`,
        title: task.title,
        primaryBadge: task.humanKey ?? t('kindTask'),
        secondaryBadge: t(`taskStatus.${task.status}`),
        subtitle: [
          task.epicTitle,
          task.userStoryTitle,
          task.dueDate ? `${t('dueDate')}: ${task.dueDate}` : null,
          raciLine,
        ]
          .filter(Boolean)
          .join(' · ') || null,
        updatedAt: task.updatedAt ?? task.createdAt ?? null,
        searchText: [
          task.title,
          task.humanKey ?? '',
          task.description ?? '',
          task.status,
          'task',
          task.dueDate ?? '',
          task.epicTitle ?? '',
          task.userStoryTitle ?? '',
          ownerLabel ?? '',
          raciLine ?? '',
        ]
          .join(' ')
          .toLowerCase(),
        filterValue: `task:${task.status}`,
        filterLabel: `${t('kindTask')} · ${t(`taskStatus.${task.status}`)}`,
      };
    });

    return [...epicItems, ...storyItems, ...milestoneItems, ...taskItems];
  }, [epics, stories, milestones, tasks, epicTitleById, t]);

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
        milestoneId: task.milestoneId,
        sprintId: task.sprintId ?? null,
        storyPoints: task.storyPoints ?? null,
        humanKey: task.humanKey ?? null,
        userStoryTitle: task.userStoryTitle,
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

  function viewSwitcher(activeMode: ViewMode) {
    return (
      <div
        className="inline-flex max-w-full overflow-x-auto rounded-md border border-line p-0.5"
        role="group"
        aria-label={t('viewModeLabel')}
      >
        {VIEW_MODES.map((mode) => (
          <Button
            key={mode}
            type="button"
            variant={activeMode === mode ? 'primary' : 'secondary'}
            className={cn(
              'h-8 shrink-0 rounded-sm px-2 text-xs sm:px-2.5',
              activeMode === mode
                ? ''
                : 'border-transparent bg-transparent shadow-none',
            )}
            aria-pressed={activeMode === mode}
            onClick={() => changeViewMode(mode)}
          >
            {t(`viewMode.${mode}`)}
          </Button>
        ))}
      </div>
    );
  }

  return (
    <>
      <CollapsibleSection
        id="project-delivery"
        storageKey={`project:${projectId}:delivery`}
        title={t('title')}
        defaultOpen
      >
      {error && !createOpen && !wideModalOpen && !manageTaskId && !manageAgile ? (
        <div className="mb-3">
          <ErrorText>{error}</ErrorText>
        </div>
      ) : null}

      <CatalogueSection
        className="mb-2"
        title={t('title')}
        showTitle={false}
        items={items}
        emptyLabel={t('empty')}
        searchPlaceholder={t('searchPlaceholder')}
        filterLabel={t('filterStatus')}
        filterAllLabel={tWorkspaces('sectionFilterAll')}
        createLabel={t('addItem')}
        canCreate={canMutate}
        showList={viewMode === 'list'}
        extraActions={viewSwitcher(wideModalOpen ? 'list' : viewMode)}
        onCreate={() => {
          resetCreateForm();
          setCreateOpen(true);
        }}
        renderItem={(item) => {
          const parsed = parseItemId(item.id);
          const statusOptions =
            parsed?.kind === 'task'
              ? TASK_STATUSES
              : parsed?.kind === 'milestone'
                ? MILESTONE_STATUSES
                : parsed?.kind === 'epic'
                  ? EPIC_STATUSES
                  : parsed?.kind === 'story'
                    ? STORY_STATUSES
                    : [];
          const epic =
            parsed?.kind === 'epic'
              ? epics.find((row) => row.id === parsed.entityId)
              : undefined;
          const story =
            parsed?.kind === 'story'
              ? stories.find((row) => row.id === parsed.entityId)
              : undefined;
          const milestone =
            parsed?.kind === 'milestone'
              ? milestones.find((row) => row.id === parsed.entityId)
              : undefined;
          const task =
            parsed?.kind === 'task'
              ? tasks.find((row) => row.id === parsed.entityId)
              : undefined;
          const currentStatus =
            epic?.status ?? story?.status ?? milestone?.status ?? task?.status;
          const scheduleTone =
            milestone || task
              ? deliveryScheduleTone({
                  status: (milestone ?? task)!.status,
                  date: milestone?.targetDate ?? task?.dueDate,
                  today: todayYmd(),
                })
              : null;

          return (
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  {item.primaryBadge ? (
                    <Badge tone="brand">{item.primaryBadge}</Badge>
                  ) : null}
                  <span className="font-semibold">{item.title}</span>
                  {task?.currentOwner ? (
                    <span title={task.currentOwner.displayName}>
                      <UserAvatar
                        displayName={task.currentOwner.displayName}
                        avatarUrl={task.currentOwner.avatarUrl}
                        size="xs"
                      />
                    </span>
                  ) : null}
                  {!canMutate && item.secondaryBadge ? (
                    <Badge>{item.secondaryBadge}</Badge>
                  ) : null}
                  {scheduleTone ? (
                    <span
                      className={cn(
                        'inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold tracking-wide',
                        deliveryScheduleSurfaceClass(scheduleTone),
                      )}
                    >
                      <span className="sm:hidden">{t(`scheduleToneShort.${scheduleTone}`)}</span>
                      <span className="hidden sm:inline">
                        {t(`scheduleTone.${scheduleTone}`)}
                      </span>
                    </span>
                  ) : null}
                </div>
                {item.subtitle ? (
                  <p className="mt-2 mb-0 text-sm break-words text-ink-muted">
                    {item.subtitle}
                  </p>
                ) : null}
              </div>
              <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
                {parsed?.kind === 'task' ? (
                  <Button
                    type="button"
                    variant="secondary"
                    className="w-full sm:w-auto"
                    onClick={() => setManageTaskId(parsed.entityId)}
                  >
                    {t('manage')}
                  </Button>
                ) : null}
                {parsed?.kind === 'epic' ||
                parsed?.kind === 'story' ||
                parsed?.kind === 'milestone' ? (
                  <Button
                    type="button"
                    variant="secondary"
                    className="w-full sm:w-auto"
                    onClick={() => {
                      if (
                        parsed.kind !== 'epic' &&
                        parsed.kind !== 'story' &&
                        parsed.kind !== 'milestone'
                      ) {
                        return;
                      }
                      setManageAgile({
                        kind: parsed.kind,
                        id: parsed.entityId,
                      });
                    }}
                  >
                    {t('manage')}
                  </Button>
                ) : null}
                {canMutate && parsed && currentStatus ? (
                  <Select
                    className="w-full sm:w-auto sm:max-w-[11rem]"
                    value={currentStatus}
                    disabled={pending}
                    aria-label={t('filterStatus')}
                    onChange={(e) => void updateStatus(item.id, e.target.value)}
                  >
                    {statusOptions.map((status) => (
                      <option key={status} value={status}>
                        {parsed.kind === 'task'
                          ? t(`taskStatus.${status}`)
                          : t(`milestoneStatus.${status}`)}
                      </option>
                    ))}
                  </Select>
                ) : null}
              </div>
            </div>
          );
        }}
      />

      {viewMode === 'tree' ? (
        <div className="mt-3">
          <ProjectDeliveryTree
            epics={epics}
            stories={stories}
            tasks={tasks}
            onManageTask={(taskId) => setManageTaskId(taskId)}
            onManageEpic={(epicId) => setManageAgile({ kind: 'epic', id: epicId })}
            onManageStory={(storyId) =>
              setManageAgile({ kind: 'story', id: storyId })
            }
          />
        </div>
      ) : null}

      {viewMode === 'list' ? (
        <p className="mt-3 mb-0 text-xs text-ink-muted">
          {canMutate ? t('raciHint') : t('readOnlyHint')}
        </p>
      ) : null}
      </CollapsibleSection>

      <Modal
        open={wideModalOpen}
        onClose={closeWideModal}
        title={t('title')}
        description={t('wideModalDescription')}
        size="full"
        bodyClassName="!block overflow-auto"
        footer={
          <div className="flex w-full flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
            {viewSwitcher(viewMode)}
            <div className="flex flex-wrap items-center gap-2 sm:justify-end">
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
              <Button type="button" variant="secondary" onClick={closeWideModal}>
                {t('closeWideView')}
              </Button>
            </div>
          </div>
        }
      >
        {error ? (
          <div className="mb-3">
            <ErrorText>{error}</ErrorText>
          </div>
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
      </Modal>

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
            <div className="grid gap-3 sm:grid-cols-2">
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
            <div className="grid gap-3 sm:grid-cols-2">
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
              <div className="grid gap-3 sm:grid-cols-2">
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
              <div className="grid gap-3 sm:grid-cols-2">
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
