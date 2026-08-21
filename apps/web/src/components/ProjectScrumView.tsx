'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type RefObject,
} from 'react';
import { useTranslations } from 'next-intl';
import {
  Badge,
  Button,
  Field,
  Input,
  Modal,
  Select,
  Textarea,
  useToast,
} from './ui';
import {
  BoardTaskCard,
  ProjectDeliveryBoard,
  readBoardMetaFilters,
  type BoardMetaFilters,
  type BoardTask,
} from './ProjectDeliveryBoard';
import { todayYmd } from '../lib/delivery-schedule';
import { downloadAuthenticatedExport } from '../lib/download-export';
import type { RatePerson } from '../lib/task-costing';
import {
  BurndownLegendHelp,
  SprintPointBurndownChart,
  type PointBurndownRow,
} from './SprintPointBurndownChart';

export type ScrumSprint = {
  id: string;
  name: string;
  goal: string | null;
  status: string;
  startDate: string | null;
  endDate: string | null;
  capacityPoints: number | null;
  committedPoints: number;
  donePoints: number;
  humanKey?: string | null;
};

export type ScrumExportHandle = {
  exportPdf: () => void;
};

type PlanRow = {
  taskId: string;
  selected: boolean;
  storyPoints: string;
};

type CeremonyStakeholder = {
  id: string;
  displayName: string;
  projectRole: string | null;
};

type Props = {
  projectId: string;
  projectName: string;
  workspaceId: string;
  canMutate: boolean;
  definitionOfDone?: string | null;
  tasks: BoardTask[];
  milestoneTitles?: Map<string, string>;
  onTaskStatusChange: (taskId: string, status: string) => void;
  onOpenTask: (taskId: string) => void;
  onAssignToSprint: (taskId: string, sprintId: string | null) => Promise<void>;
  onRefresh: () => void;
  exportHandleRef?: RefObject<ScrumExportHandle | null>;
  onExportStateChange?: (
    state: { pending: boolean; canExport: boolean } | null,
  ) => void;
  currency?: string;
  ratePeople?: RatePerson[];
};

const TASK_STATUSES = [
  'todo',
  'in_progress',
  'blocked',
  'done',
  'cancelled',
] as const;

const SPRINT_STATUSES = [
  'planned',
  'active',
  'completed',
  'cancelled',
] as const;

export function ProjectScrumView({
  projectId,
  projectName,
  workspaceId,
  canMutate,
  definitionOfDone = null,
  tasks,
  milestoneTitles = new Map(),
  onTaskStatusChange,
  onOpenTask,
  onAssignToSprint,
  onRefresh,
  exportHandleRef,
  onExportStateChange,
  currency = 'EUR',
  ratePeople = [],
}: Props) {
  const t = useTranslations('delivery');
  const tCommon = useTranslations('common');
  const tStakeholders = useTranslations('stakeholders');
  const tProjects = useTranslations('projects');
  const { pushToast } = useToast();
  const today = todayYmd();
  const [boardMeta, setBoardMeta] = useState<BoardMetaFilters>(() =>
    readBoardMetaFilters(projectId),
  );
  const [exportPending, setExportPending] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportIncludeBurndown, setExportIncludeBurndown] = useState(true);
  const [exportIncludeBoard, setExportIncludeBoard] = useState(true);
  const [exportIncludeBacklog, setExportIncludeBacklog] = useState(true);
  const [sprints, setSprints] = useState<ScrumSprint[]>([]);
  const [selectedSprintId, setSelectedSprintId] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [ceremonyOpen, setCeremonyOpen] = useState<
    null | 'sprint_retrospective' | 'sprint_review'
  >(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [name, setName] = useState('');
  const [goal, setGoal] = useState('');
  const [capacity, setCapacity] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [ceremonyTitle, setCeremonyTitle] = useState('');
  const [ceremonySummary, setCeremonySummary] = useState('');
  const [reviewDemo, setReviewDemo] = useState('');
  const [reviewFeedback, setReviewFeedback] = useState('');
  const [reviewOutcomes, setReviewOutcomes] = useState('');
  const [ceremonyStakeholders, setCeremonyStakeholders] = useState<
    CeremonyStakeholder[]
  >([]);
  const [selectedAttendeeIds, setSelectedAttendeeIds] = useState<string[]>([]);
  const [reviewGuests, setReviewGuests] = useState<string[]>([]);
  const [guestDraft, setGuestDraft] = useState('');
  const [stakeholdersLoading, setStakeholdersLoading] = useState(false);
  const [retroWentWell, setRetroWentWell] = useState('');
  const [retroImprove, setRetroImprove] = useState('');
  const [retroActions, setRetroActions] = useState('');
  const [planRows, setPlanRows] = useState<PlanRow[]>([]);
  const [wizardActivate, setWizardActivate] = useState(false);
  const [burndown, setBurndown] = useState<{
    committedPoints: number;
    startDate: string | null;
    endDate: string | null;
    points: PointBurndownRow[];
  } | null>(null);

  const loadSprints = useCallback(async () => {
    const response = await fetch(`/api/v1/projects/${projectId}/sprints`);
    if (!response.ok) {
      setError(t('scrumLoadFailed'));
      return;
    }
    const payload = (await response.json()) as { sprints: ScrumSprint[] };
    setSprints(payload.sprints);
    setSelectedSprintId((current) => {
      if (current && payload.sprints.some((sprint) => sprint.id === current)) {
        return current;
      }
      const active = payload.sprints.find((sprint) => sprint.status === 'active');
      return active?.id ?? payload.sprints[0]?.id ?? '';
    });
  }, [projectId, t]);

  useEffect(() => {
    void loadSprints();
  }, [loadSprints]);

  const selected = sprints.find((sprint) => sprint.id === selectedSprintId) ?? null;
  const sprintTasks = useMemo(
    () =>
      tasks.filter((task) =>
        selectedSprintId ? task.sprintId === selectedSprintId : false,
      ),
    [tasks, selectedSprintId],
  );
  const backlogTasks = useMemo(
    () =>
      tasks.filter((task) => !task.sprintId && task.status !== 'cancelled'),
    [tasks],
  );

  const exportSectionsSelected =
    exportIncludeBurndown || exportIncludeBoard || exportIncludeBacklog;

  const exportScrumPdf = useCallback(async () => {
    if (exportPending || !selected || !exportSectionsSelected) return;
    setExportPending(true);
    try {
      const title = t('scrumExportTitle', {
        project: projectName,
        sprint: selected.humanKey
          ? `${selected.humanKey} · ${selected.name}`
          : selected.name,
      });
      const slug = projectName.replace(/[^\w.-]+/g, '-').toLowerCase();
      const sprintSlug = (selected.humanKey ?? selected.name)
        .replace(/[^\w.-]+/g, '-')
        .toLowerCase();
      const statusLabels = Object.fromEntries(
        TASK_STATUSES.map((status) => [status, t(`taskStatus.${status}`)]),
      );
      const sprintStatusLabels = Object.fromEntries(
        SPRINT_STATUSES.map((status) => [
          status,
          t(`scrumStatus.${status}`),
        ]),
      );
      await downloadAuthenticatedExport(
        `/api/v1/project-sprints/${selected.id}/export`,
        `${slug}-scrum-${sprintSlug}.pdf`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: window.location.origin,
          },
          body: JSON.stringify({
            title,
            includeBurndown: exportIncludeBurndown,
            includeBoard: exportIncludeBoard,
            includeBacklog: exportIncludeBacklog,
            showIssueId: boardMeta.issueId,
            showStory: boardMeta.story,
            showMilestone: boardMeta.milestone,
            showOwner: boardMeta.owner,
            showAccountable: boardMeta.accountable,
            showDueDate: boardMeta.dueDate,
            showStoryPoints: boardMeta.storyPoints,
            labels: {
              story: t('kindStory'),
              milestone: t('kindMilestone'),
              owner: t('currentOwner'),
              accountable: t('accountable'),
              dueDate: t('dueDate'),
              storyPoints: t('boardMetaStoryPoints'),
              generated: tProjects('reportGenerated'),
              empty: t('boardEmptyColumn'),
              backlog: t('scrumBacklog'),
              sprintBoard: t('scrumExportBoard'),
              burndown: t('scrumBurndown'),
              burndownEmpty: t('scrumBurndownEmpty'),
              goal: t('scrumGoal'),
              capacity: t('scrumCapacity'),
              window: t('scrumExportWindow'),
              status: statusLabels,
              sprintStatus: sprintStatusLabels,
            },
          }),
        },
      );
      setExportOpen(false);
      pushToast(t('scrumExported'));
    } catch (err) {
      pushToast(
        err instanceof Error ? err.message : t('scrumExportFailed'),
        'danger',
      );
    } finally {
      setExportPending(false);
    }
  }, [
    boardMeta,
    exportIncludeBacklog,
    exportIncludeBoard,
    exportIncludeBurndown,
    exportPending,
    exportSectionsSelected,
    projectName,
    pushToast,
    selected,
    t,
    tProjects,
  ]);

  useEffect(() => {
    if (exportHandleRef) {
      exportHandleRef.current = {
        exportPdf: () => {
          if (!selected) return;
          setExportOpen(true);
        },
      };
    }
    onExportStateChange?.({
      pending: exportPending,
      canExport: Boolean(selected),
    });
    return () => {
      if (exportHandleRef) exportHandleRef.current = null;
      onExportStateChange?.(null);
    };
  }, [
    exportHandleRef,
    exportPending,
    onExportStateChange,
    selected,
  ]);

  useEffect(() => {
    if (!selectedSprintId) {
      setBurndown(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const response = await fetch(
        `/api/v1/project-sprints/${selectedSprintId}/burndown`,
      );
      if (!response.ok || cancelled) return;
      const payload = (await response.json()) as {
        burndown: {
          committedPoints: number;
          startDate: string | null;
          endDate: string | null;
          points: PointBurndownRow[];
        };
      };
      if (!cancelled) setBurndown(payload.burndown);
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedSprintId, sprintTasks]);

  function openWizard() {
    setPlanRows(
      backlogTasks.map((task) => ({
        taskId: task.id,
        selected: false,
        storyPoints:
          task.storyPoints != null && task.storyPoints > 0
            ? String(task.storyPoints)
            : '',
      })),
    );
    setCapacity(
      selected?.capacityPoints != null ? String(selected.capacityPoints) : '',
    );
    setWizardActivate(selected?.status === 'planned');
    setWizardOpen(true);
    setError(null);
  }

  async function createSprint() {
    if (!name.trim()) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/projects/${projectId}/sprints`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          goal: goal.trim() || null,
          capacityPoints: capacity ? Number(capacity) : null,
          startDate: startDate || null,
          endDate: endDate || null,
        }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          message?: string;
        } | null;
        throw new Error(payload?.message ?? t('scrumCreateFailed'));
      }
      const created = (await response.json()) as { sprint: ScrumSprint };
      setCreateOpen(false);
      setName('');
      setGoal('');
      setCapacity('');
      setStartDate('');
      setEndDate('');
      await loadSprints();
      setSelectedSprintId(created.sprint.id);
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('scrumCreateFailed'));
    } finally {
      setPending(false);
    }
  }

  async function submitWizard() {
    if (!selected) return;
    setPending(true);
    setError(null);
    try {
      const selectedRows = planRows.filter((row) => row.selected);
      for (const row of selectedRows) {
        const points = row.storyPoints ? Number(row.storyPoints) : null;
        const response = await fetch(`/api/v1/project-tasks/${row.taskId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sprintId: selected.id,
            storyPoints:
              points != null && Number.isFinite(points) ? points : null,
          }),
        });
        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as {
            message?: string;
          } | null;
          throw new Error(payload?.message ?? t('failedUpdateTask'));
        }
      }

      const capacityPoints = capacity ? Number(capacity) : null;
      const sprintPatch: Record<string, unknown> = {
        capacityPoints:
          capacityPoints != null && Number.isFinite(capacityPoints)
            ? capacityPoints
            : null,
      };
      if (wizardActivate && selected.status === 'planned') {
        sprintPatch.status = 'active';
      }
      const sprintResponse = await fetch(
        `/api/v1/project-sprints/${selected.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(sprintPatch),
        },
      );
      if (!sprintResponse.ok) {
        const payload = (await sprintResponse.json().catch(() => null)) as {
          message?: string;
        } | null;
        throw new Error(payload?.message ?? t('scrumUpdateFailed'));
      }

      setWizardOpen(false);
      await loadSprints();
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('scrumUpdateFailed'));
    } finally {
      setPending(false);
    }
  }

  function formatTaskBullet(task: BoardTask) {
    const key = task.humanKey ? `${task.humanKey} · ` : '';
    const points =
      task.storyPoints != null && Number.isFinite(task.storyPoints)
        ? ` (${task.storyPoints} pts)`
        : '';
    return `- ${key}${task.title}${points}`;
  }

  function sprintContextLines(sprint: ScrumSprint) {
    const lines = [
      `- Sprint: ${(sprint.humanKey ? `${sprint.humanKey} · ` : '') + sprint.name}`,
      `- Project: ${projectName}`,
    ];
    if (sprint.goal?.trim()) lines.push(`- Sprint goal: ${sprint.goal.trim()}`);
    if (sprint.startDate || sprint.endDate) {
      lines.push(
        `- Window: ${[sprint.startDate, sprint.endDate].filter(Boolean).join(' → ')}`,
      );
    }
    lines.push(
      `- Points: ${sprint.committedPoints} committed` +
        (sprint.capacityPoints != null ? ` / ${sprint.capacityPoints} capacity` : '') +
        ` · ${sprint.donePoints} done`,
    );
    return lines.join('\n');
  }

  function resetCeremonyForm() {
    setCeremonyTitle('');
    setCeremonySummary('');
    setReviewDemo('');
    setReviewFeedback('');
    setReviewOutcomes('');
    setSelectedAttendeeIds([]);
    setReviewGuests([]);
    setGuestDraft('');
    setRetroWentWell('');
    setRetroImprove('');
    setRetroActions('');
  }

  async function loadCeremonyStakeholders() {
    setStakeholdersLoading(true);
    try {
      const response = await fetch(`/api/v1/projects/${projectId}/stakeholders`);
      if (!response.ok) {
        setCeremonyStakeholders([]);
        return;
      }
      const payload = (await response.json()) as {
        stakeholders: Array<{
          id: string;
          kind: string;
          displayName: string;
          projectRole: string | null;
        }>;
      };
      setCeremonyStakeholders(
        payload.stakeholders
          .filter((row) => row.kind === 'person')
          .map((row) => ({
            id: row.id,
            displayName: row.displayName,
            projectRole: row.projectRole,
          }))
          .sort((a, b) => a.displayName.localeCompare(b.displayName)),
      );
    } catch {
      setCeremonyStakeholders([]);
    } finally {
      setStakeholdersLoading(false);
    }
  }

  function openCeremony(recordType: 'sprint_retrospective' | 'sprint_review') {
    if (!selected) return;
    setCeremonyOpen(recordType);
    setCeremonyTitle(
      recordType === 'sprint_retrospective'
        ? t('scrumCeremonyDefaultRetro', { sprint: selected.name })
        : t('scrumCeremonyDefaultReview', { sprint: selected.name }),
    );
    setCeremonySummary(
      selected.goal?.trim() ||
        t('scrumCeremonySummaryDefault', {
          committed: selected.committedPoints,
          done: selected.donePoints,
        }),
    );

    if (recordType === 'sprint_review') {
      const doneTasks = sprintTasks.filter((task) => task.status === 'done');
      const unfinished = sprintTasks.filter(
        (task) => task.status !== 'done' && task.status !== 'cancelled',
      );
      setReviewDemo(
        doneTasks.length > 0
          ? doneTasks.map(formatTaskBullet).join('\n')
          : '',
      );
      setReviewFeedback('');
      setReviewOutcomes(
        [
          t('scrumReviewAcceptedHeading'),
          ...(doneTasks.length > 0
            ? doneTasks.map(formatTaskBullet)
            : ['-']),
          '',
          t('scrumReviewCarryHeading'),
          ...(unfinished.length > 0
            ? unfinished.map(formatTaskBullet)
            : ['-']),
        ].join('\n'),
      );
      setSelectedAttendeeIds([]);
      setReviewGuests([]);
      setGuestDraft('');
      void loadCeremonyStakeholders();
    } else {
      setRetroWentWell('');
      setRetroImprove('');
      setRetroActions('');
    }
    setError(null);
  }

  function toggleAttendee(id: string) {
    setSelectedAttendeeIds((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
  }

  function addGuestsFromDraft() {
    const parts = guestDraft
      .split(/[,;\n]/)
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length === 0) return;
    setReviewGuests((current) => {
      const seen = new Set(current.map((name) => name.toLowerCase()));
      const next = [...current];
      for (const name of parts) {
        const key = name.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        next.push(name);
      }
      return next;
    });
    setGuestDraft('');
  }

  function removeGuest(name: string) {
    setReviewGuests((current) => current.filter((item) => item !== name));
  }

  function formatStakeholderRole(role: string | null) {
    switch (role) {
      case 'sponsor':
      case 'owner':
      case 'product_owner':
      case 'tech_lead':
      case 'contributor':
      case 'stakeholder':
      case 'other':
        return tStakeholders(`projectRole.${role}`);
      default:
        return role;
    }
  }

  function formatAttendeesMarkdown() {
    const selectedPeople = ceremonyStakeholders.filter((row) =>
      selectedAttendeeIds.includes(row.id),
    );
    const lines: string[] = [];
    if (selectedPeople.length > 0) {
      lines.push(`### ${t('scrumReviewAttendeeStakeholders')}`, '');
      for (const person of selectedPeople) {
        const role = formatStakeholderRole(person.projectRole);
        lines.push(
          role
            ? `- ${person.displayName} (${role})`
            : `- ${person.displayName}`,
        );
      }
      lines.push('');
    }
    if (reviewGuests.length > 0) {
      lines.push(`### ${t('scrumReviewAttendeeGuests')}`, '');
      for (const guest of reviewGuests) {
        lines.push(`- ${guest}`);
      }
      lines.push('');
    }
    return lines.length > 0 ? lines.join('\n').trimEnd() : '-';
  }

  function buildCeremonyMarkdown(
    recordType: 'sprint_retrospective' | 'sprint_review',
    title: string,
    sprint: ScrumSprint,
  ) {
    const context = `## ${t('scrumCeremonyContext')}\n\n${sprintContextLines(sprint)}`;
    if (recordType === 'sprint_review') {
      return [
        `# ${title}`,
        '',
        context,
        '',
        `## ${t('scrumReviewDemo')}`,
        '',
        reviewDemo.trim() || '-',
        '',
        `## ${t('scrumReviewFeedback')}`,
        '',
        reviewFeedback.trim() || '-',
        '',
        `## ${t('scrumReviewOutcomes')}`,
        '',
        reviewOutcomes.trim() || '-',
        '',
        `## ${t('scrumReviewAttendees')}`,
        '',
        formatAttendeesMarkdown(),
        '',
      ].join('\n');
    }
    return [
      `# ${title}`,
      '',
      context,
      '',
      `## ${t('scrumRetroWentWell')}`,
      '',
      retroWentWell.trim() || '-',
      '',
      `## ${t('scrumRetroImprove')}`,
      '',
      retroImprove.trim() || '-',
      '',
      `## ${t('scrumRetroActions')}`,
      '',
      retroActions.trim() || '-',
      '',
    ].join('\n');
  }

  async function createCeremony() {
    if (!selected || !ceremonyOpen || !ceremonyTitle.trim()) return;
    setPending(true);
    setError(null);
    try {
      const title = ceremonyTitle.trim();
      const summary = ceremonySummary.trim() || null;
      const contentMarkdown = buildCeremonyMarkdown(
        ceremonyOpen,
        title,
        selected,
      );
      const createResponse = await fetch('/api/v1/knowledge-records', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId,
          projectId,
          title,
          summary,
          recordType: ceremonyOpen,
          contentMarkdown,
          lifecycleStatus: 'draft',
        }),
      });
      if (!createResponse.ok) {
        const payload = (await createResponse.json().catch(() => null)) as {
          message?: string;
        } | null;
        throw new Error(payload?.message ?? t('scrumCeremonyFailed'));
      }
      const created = (await createResponse.json()) as {
        knowledgeRecord: { id: string };
      };
      const linkResponse = await fetch(
        `/api/v1/knowledge-records/${created.knowledgeRecord.id}/delivery-links`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            links: [{ entityType: 'sprint', entityId: selected.id }],
          }),
        },
      );
      if (!linkResponse.ok) {
        const payload = (await linkResponse.json().catch(() => null)) as {
          message?: string;
        } | null;
        throw new Error(payload?.message ?? t('scrumCeremonyFailed'));
      }
      setCeremonyOpen(null);
      resetCeremonyForm();
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('scrumCeremonyFailed'));
    } finally {
      setPending(false);
    }
  }

  async function setSprintStatus(status: string) {
    if (!selected) return;
    setPending(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { status };
      if (status === 'completed' || status === 'cancelled') {
        body.unfinishedDestination = 'backlog';
      }
      const response = await fetch(`/api/v1/project-sprints/${selected.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          message?: string;
        } | null;
        throw new Error(payload?.message ?? t('scrumUpdateFailed'));
      }
      await loadSprints();
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('scrumUpdateFailed'));
    } finally {
      setPending(false);
    }
  }

  const velocity = useMemo(() => {
    const completed = sprints.filter((sprint) => sprint.status === 'completed');
    if (completed.length === 0) return null;
    const recent = completed.slice(-5);
    const avg =
      recent.reduce((sum, sprint) => sum + sprint.donePoints, 0) / recent.length;
    return Math.round(avg * 10) / 10;
  }, [sprints]);

  const plannedPoints = planRows
    .filter((row) => row.selected)
    .reduce((sum, row) => sum + (Number(row.storyPoints) || 0), 0);

  const remainingPoints = selected
    ? Math.max(0, selected.committedPoints - selected.donePoints)
    : 0;
  const sprintDaysLeft = selected?.endDate
    ? Math.max(
        0,
        Math.round(
          (Date.parse(`${selected.endDate}T00:00:00Z`) -
            Date.parse(`${today}T00:00:00Z`)) /
            86_400_000,
        ),
      )
    : null;
  const sprintDateLabel = selected
    ? [selected.startDate, selected.endDate].filter(Boolean).join(' — ')
    : '';

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label={t('scrumSprint')}>
          <Select
            value={selectedSprintId}
            onChange={(event) => setSelectedSprintId(event.target.value)}
          >
            {sprints.length === 0 ? (
              <option value="">{t('scrumNoSprints')}</option>
            ) : (
              sprints.map((sprint) => (
                <option key={sprint.id} value={sprint.id}>
                  {(sprint.humanKey ? `${sprint.humanKey} · ` : '') + sprint.name}{' '}
                  ({sprint.status})
                </option>
              ))
            )}
          </Select>
        </Field>
        {canMutate ? (
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setName('');
              setGoal('');
              setCapacity('');
              setStartDate('');
              setEndDate('');
              setCreateOpen(true);
              setError(null);
            }}
          >
            {t('scrumNewSprint')}
          </Button>
        ) : null}
        {canMutate && selected && selected.status !== 'completed' ? (
          <Button type="button" disabled={pending} onClick={openWizard}>
            {t('scrumPlanWizard')}
          </Button>
        ) : null}
        {canMutate && selected ? (
          <Button
            type="button"
            variant="secondary"
            disabled={pending}
            onClick={() => openCeremony('sprint_review')}
          >
            {t('scrumCreateReview')}
          </Button>
        ) : null}
        {canMutate && selected ? (
          <Button
            type="button"
            variant="secondary"
            disabled={pending}
            onClick={() => openCeremony('sprint_retrospective')}
          >
            {t('scrumCreateRetro')}
          </Button>
        ) : null}
        {canMutate && selected?.status === 'planned' ? (
          <Button
            type="button"
            disabled={pending}
            onClick={() => void setSprintStatus('active')}
          >
            {t('scrumActivate')}
          </Button>
        ) : null}
        {canMutate && selected?.status === 'active' ? (
          <Button
            type="button"
            variant="secondary"
            disabled={pending}
            onClick={() => void setSprintStatus('completed')}
          >
            {t('scrumClose')}
          </Button>
        ) : null}
      </div>

      {selected ? (
        <div className="kh-ops-sprint-head">
          <div className="kh-ops-sprint-goal">
            <small>{t('scrumGoal')}</small>
            <strong>{selected.goal?.trim() || selected.name}</strong>
          </div>
          <div className="kh-ops-sprint-metric">
            <small>{t('scrumExportWindow')}</small>
            <strong>{sprintDateLabel || '—'}</strong>
          </div>
          <div className="kh-ops-sprint-metric">
            <small>{t('scrumRemainingPoints')}</small>
            <strong>
              {remainingPoints} / {selected.committedPoints} pt
            </strong>
          </div>
          <div className="kh-ops-sprint-metric">
            <small>{t('scrumDaysLeft')}</small>
            <strong>{sprintDaysLeft == null ? '—' : sprintDaysLeft}</strong>
          </div>
        </div>
      ) : null}

      {velocity != null ? (
        <p className="mb-3 mt-0 text-xs text-ink-muted">
          {t('scrumVelocity', { value: velocity })}
        </p>
      ) : null}

      {definitionOfDone?.trim() ? (
        <section className="kh-ops-panel">
          <div className="kh-ops-panel-head">
            <h2 className="kh-ops-panel-title">{t('scrumDoD')}</h2>
          </div>
          <pre className="m-0 whitespace-pre-wrap px-4 py-3 font-sans text-sm text-ink">
            {definitionOfDone}
          </pre>
        </section>
      ) : null}

      {selected && burndown ? (
        <section className="kh-ops-panel">
          <div className="kh-ops-panel-head">
            <h2 className="kh-ops-panel-title">{t('scrumBurndown')}</h2>
            <BurndownLegendHelp />
          </div>
          <div className="p-3">
          <SprintPointBurndownChart
            committedPoints={burndown.committedPoints}
            startDate={burndown.startDate}
            endDate={burndown.endDate}
            points={burndown.points}
          />
          </div>
        </section>
      ) : null}

      {error && !createOpen && ceremonyOpen == null && !wizardOpen ? (
        <p className="text-sm text-danger">{error}</p>
      ) : null}

      <div className="grid min-w-0 gap-4">
        <div className="min-w-0 overflow-x-auto">
          {selected ? (
            <ProjectDeliveryBoard
              projectId={projectId}
              projectName={projectName}
              tasks={sprintTasks}
              milestoneTitles={milestoneTitles}
              canMutate={canMutate}
              currency={currency}
              ratePeople={ratePeople}
              onTaskStatusChange={onTaskStatusChange}
              onManageTask={onOpenTask}
              onMetaFiltersChange={setBoardMeta}
            />
          ) : (
            <p className="text-sm text-ink-muted">{t('scrumPickOrCreate')}</p>
          )}
        </div>

        <section className="kh-ops-lane w-full max-w-sm">
            <div className="kh-ops-lane-head">
              <h3 className="m-0">{t('scrumBacklog')}</h3>
              <span className="kh-ops-lane-count">{backlogTasks.length}</span>
            </div>
            {backlogTasks.length === 0 ? (
              <p className="kh-ops-empty">{t('scrumBacklogEmpty')}</p>
            ) : (
              <ul className="m-0 flex list-none flex-col p-0">
                {backlogTasks.map((task) => (
                  <li key={task.id} className="min-w-0">
                    <BoardTaskCard
                      task={task}
                      milestoneLabel={
                        task.milestoneId
                          ? (milestoneTitles.get(task.milestoneId) ?? null)
                          : null
                      }
                      today={today}
                      meta={boardMeta}
                      canMutate={false}
                      pending={pending}
                      showStatusSelect={false}
                      onTaskStatusChange={onTaskStatusChange}
                      onManageTask={onOpenTask}
                      currency={currency}
                      ratePeople={ratePeople}
                      actions={
                        canMutate &&
                        selected &&
                        selected.status !== 'completed' ? (
                          <Button
                            type="button"
                            variant="secondary"
                            className="mt-2 h-8 w-full px-2 text-xs"
                            disabled={pending}
                            onClick={() =>
                              void onAssignToSprint(task.id, selected.id)
                            }
                          >
                            {t('scrumAddToSprint')}
                          </Button>
                        ) : null
                      }
                    />
                  </li>
                ))}
              </ul>
            )}
        </section>
      </div>

      <Modal
        open={exportOpen}
        onClose={() => {
          if (!exportPending) setExportOpen(false);
        }}
        title={t('scrumExportPdf')}
        description={t('scrumExportHint')}
      >
        <div className="grid gap-3">
          <p className="m-0 text-sm text-ink-muted">{t('scrumExportSections')}</p>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={exportIncludeBurndown}
              disabled={exportPending}
              onChange={(event) =>
                setExportIncludeBurndown(event.target.checked)
              }
              data-modal-initial-focus
            />
            {t('scrumBurndown')}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={exportIncludeBoard}
              disabled={exportPending}
              onChange={(event) => setExportIncludeBoard(event.target.checked)}
            />
            {t('scrumExportBoard')}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={exportIncludeBacklog}
              disabled={exportPending}
              onChange={(event) =>
                setExportIncludeBacklog(event.target.checked)
              }
            />
            {t('scrumBacklog')}
          </label>
          {!exportSectionsSelected ? (
            <p className="m-0 text-sm text-danger">{t('scrumExportSelectOne')}</p>
          ) : null}
          <div className="flex gap-2">
            <Button
              type="button"
              disabled={
                exportPending || !selected || !exportSectionsSelected
              }
              onClick={() => void exportScrumPdf()}
            >
              {exportPending ? t('scrumExportingPdf') : t('scrumExportPdf')}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={exportPending}
              onClick={() => setExportOpen(false)}
            >
              {tCommon('cancel')}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title={t('scrumNewSprint')}
      >
        <div className="grid gap-3">
          <Field label={tCommon('name')}>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              data-modal-initial-focus
            />
          </Field>
          <Field label={t('scrumGoal')}>
            <Textarea
              value={goal}
              onChange={(event) => setGoal(event.target.value)}
              rows={2}
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label={t('scrumCapacity')}>
              <Input
                type="number"
                min={0}
                value={capacity}
                onChange={(event) => setCapacity(event.target.value)}
              />
            </Field>
            <Field label={t('startDate')}>
              <Input
                type="date"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
              />
            </Field>
            <Field label={t('endDate')}>
              <Input
                type="date"
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
              />
            </Field>
          </div>
          {error && createOpen ? (
            <p className="m-0 text-sm text-danger">{error}</p>
          ) : null}
          <div className="flex gap-2">
            <Button
              type="button"
              disabled={pending || !name.trim()}
              onClick={() => void createSprint()}
            >
              {tCommon('create')}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setCreateOpen(false)}
            >
              {tCommon('cancel')}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={ceremonyOpen != null}
        onClose={() => {
          setCeremonyOpen(null);
          resetCeremonyForm();
        }}
        title={
          ceremonyOpen === 'sprint_retrospective'
            ? t('scrumCreateRetro')
            : t('scrumCreateReview')
        }
        description={
          ceremonyOpen === 'sprint_retrospective'
            ? t('scrumRetroHint')
            : t('scrumReviewHint')
        }
        size="lg"
      >
        <div className="grid gap-3">
          <Field label={tCommon('title')}>
            <Input
              value={ceremonyTitle}
              onChange={(event) => setCeremonyTitle(event.target.value)}
              data-modal-initial-focus
            />
          </Field>
          <Field label={tCommon('summary')}>
            <Input
              value={ceremonySummary}
              onChange={(event) => setCeremonySummary(event.target.value)}
            />
          </Field>

          {ceremonyOpen === 'sprint_review' ? (
            <>
              <Field label={t('scrumReviewDemo')}>
                <Textarea
                  value={reviewDemo}
                  onChange={(event) => setReviewDemo(event.target.value)}
                  rows={5}
                  placeholder={t('scrumReviewDemoPlaceholder')}
                />
              </Field>
              <Field label={t('scrumReviewFeedback')}>
                <Textarea
                  value={reviewFeedback}
                  onChange={(event) => setReviewFeedback(event.target.value)}
                  rows={4}
                  placeholder={t('scrumReviewFeedbackPlaceholder')}
                />
              </Field>
              <Field label={t('scrumReviewOutcomes')}>
                <Textarea
                  value={reviewOutcomes}
                  onChange={(event) => setReviewOutcomes(event.target.value)}
                  rows={5}
                  placeholder={t('scrumReviewOutcomesPlaceholder')}
                />
              </Field>
              <div className="grid gap-2">
                <p className="m-0 text-sm font-medium">{t('scrumReviewAttendees')}</p>
                <p className="m-0 text-xs text-ink-muted">
                  {t('scrumReviewAttendeesHint')}
                </p>
                <div className="grid gap-2">
                  <p className="m-0 text-xs font-medium uppercase tracking-wide text-ink-muted">
                    {t('scrumReviewAttendeeStakeholders')}
                  </p>
                  {stakeholdersLoading ? (
                    <p className="m-0 text-sm text-ink-muted">{tCommon('loading')}</p>
                  ) : ceremonyStakeholders.length === 0 ? (
                    <p className="m-0 text-sm text-ink-muted">
                      {t('scrumReviewNoStakeholders')}
                    </p>
                  ) : (
                    <ul className="m-0 grid max-h-48 list-none gap-1 overflow-y-auto rounded-md border border-line p-2">
                      {ceremonyStakeholders.map((person) => {
                        const role = formatStakeholderRole(person.projectRole);
                        const checked = selectedAttendeeIds.includes(person.id);
                        return (
                          <li key={person.id}>
                            <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-neutral-soft/60">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleAttendee(person.id)}
                              />
                              <span className="min-w-0 flex-1 font-medium">
                                {person.displayName}
                              </span>
                              {role ? (
                                <Badge tone="neutral">{role}</Badge>
                              ) : null}
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
                <div className="grid gap-2">
                  <p className="m-0 text-xs font-medium uppercase tracking-wide text-ink-muted">
                    {t('scrumReviewAttendeeGuests')}
                  </p>
                  {reviewGuests.length > 0 ? (
                    <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
                      {reviewGuests.map((guest) => (
                        <li key={guest}>
                          <span className="inline-flex items-center gap-1 rounded-md border border-line bg-neutral-soft/40 px-2 py-1 text-sm">
                            {guest}
                            <button
                              type="button"
                              className="text-ink-muted hover:text-ink"
                              aria-label={t('scrumReviewRemoveGuest', {
                                name: guest,
                              })}
                              onClick={() => removeGuest(guest)}
                            >
                              ×
                            </button>
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <div className="flex flex-wrap items-end gap-2">
                    <div className="min-w-[12rem] flex-1">
                      <Field label={t('scrumReviewGuestName')}>
                        <Input
                          value={guestDraft}
                          onChange={(event) => setGuestDraft(event.target.value)}
                          placeholder={t('scrumReviewGuestPlaceholder')}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault();
                              addGuestsFromDraft();
                            }
                          }}
                        />
                      </Field>
                    </div>
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={!guestDraft.trim()}
                      onClick={addGuestsFromDraft}
                    >
                      {t('scrumReviewAddGuest')}
                    </Button>
                  </div>
                </div>
              </div>
            </>
          ) : null}

          {ceremonyOpen === 'sprint_retrospective' ? (
            <>
              <Field label={t('scrumRetroWentWell')}>
                <Textarea
                  value={retroWentWell}
                  onChange={(event) => setRetroWentWell(event.target.value)}
                  rows={4}
                  placeholder={t('scrumRetroWentWellPlaceholder')}
                />
              </Field>
              <Field label={t('scrumRetroImprove')}>
                <Textarea
                  value={retroImprove}
                  onChange={(event) => setRetroImprove(event.target.value)}
                  rows={4}
                  placeholder={t('scrumRetroImprovePlaceholder')}
                />
              </Field>
              <Field label={t('scrumRetroActions')}>
                <Textarea
                  value={retroActions}
                  onChange={(event) => setRetroActions(event.target.value)}
                  rows={4}
                  placeholder={t('scrumRetroActionsPlaceholder')}
                />
              </Field>
            </>
          ) : null}

          {error && ceremonyOpen ? (
            <p className="m-0 text-sm text-danger">{error}</p>
          ) : null}
          <div className="flex gap-2">
            <Button
              type="button"
              disabled={pending || !ceremonyTitle.trim() || !selected}
              onClick={() => void createCeremony()}
            >
              {tCommon('create')}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setCeremonyOpen(null);
                resetCeremonyForm();
              }}
            >
              {tCommon('cancel')}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        title={t('scrumPlanWizard')}
        description={t('scrumPlanWizardHint')}
      >
        <div className="grid gap-4">
          {definitionOfDone?.trim() ? (
            <div className="rounded-md border border-line px-3 py-2 text-sm">
              <p className="m-0 mb-1 text-xs font-medium uppercase tracking-wide text-ink-muted">
                {t('scrumDoD')}
              </p>
              <pre className="m-0 whitespace-pre-wrap font-sans text-ink">
                {definitionOfDone}
              </pre>
            </div>
          ) : null}

          <Field label={t('scrumCapacity')}>
            <Input
              type="number"
              min={0}
              value={capacity}
              onChange={(event) => setCapacity(event.target.value)}
            />
          </Field>

          <div className="grid gap-2">
            <p className="m-0 text-sm font-medium">{t('scrumPlanSelectBacklog')}</p>
            {planRows.length === 0 ? (
              <p className="m-0 text-sm text-ink-muted">{t('scrumBacklogEmpty')}</p>
            ) : (
              planRows.map((row) => {
                const task = backlogTasks.find((item) => item.id === row.taskId);
                if (!task) return null;
                return (
                  <label
                    key={row.taskId}
                    className="grid grid-cols-[auto_1fr_5rem] items-center gap-2 rounded-md border border-line px-2 py-2 text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={row.selected}
                      onChange={(event) =>
                        setPlanRows((current) =>
                          current.map((item) =>
                            item.taskId === row.taskId
                              ? { ...item, selected: event.target.checked }
                              : item,
                          ),
                        )
                      }
                    />
                    <span>
                      {task.humanKey ? `${task.humanKey} · ` : ''}
                      {task.title}
                    </span>
                    <Input
                      type="number"
                      min={0}
                      placeholder="pts"
                      value={row.storyPoints}
                      onChange={(event) =>
                        setPlanRows((current) =>
                          current.map((item) =>
                            item.taskId === row.taskId
                              ? { ...item, storyPoints: event.target.value }
                              : item,
                          ),
                        )
                      }
                    />
                  </label>
                );
              })
            )}
          </div>

          <p className="m-0 text-sm text-ink-muted">
            {t('scrumPlanCommitted', { points: plannedPoints })}
            {capacity
              ? ` · ${t('scrumCapacity')}: ${capacity}`
              : ''}
          </p>

          {selected?.status === 'planned' ? (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={wizardActivate}
                onChange={(event) => setWizardActivate(event.target.checked)}
              />
              {t('scrumPlanActivate')}
            </label>
          ) : null}

          {error ? <p className="m-0 text-sm text-danger">{error}</p> : null}

          <div className="flex gap-2">
            <Button
              type="button"
              disabled={pending || !selected}
              onClick={() => void submitWizard()}
            >
              {t('scrumPlanApply')}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setWizardOpen(false)}
            >
              {tCommon('cancel')}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
