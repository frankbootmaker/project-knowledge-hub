'use client';

import { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  CatalogueSection,
  type CatalogueListItem,
} from './CatalogueSection';
import { ProjectDeliveryBoard } from './ProjectDeliveryBoard';
import { ProjectDeliveryCalendar } from './ProjectDeliveryCalendar';
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

type Milestone = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  targetDate: string | null;
  sortOrder: number;
  createdAt?: string;
  updatedAt?: string;
};

type RaciEntry = {
  userId: string;
  displayName: string;
  email: string;
  role: 'R' | 'A' | 'C' | 'I';
};

type Task = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  dueDate: string | null;
  milestoneId: string | null;
  raci: RaciEntry[];
  createdAt?: string;
  updatedAt?: string;
};

type Member = {
  userId: string;
  displayName: string;
  email: string;
};

const MILESTONE_STATUSES = ['planned', 'active', 'done', 'cancelled'] as const;
const TASK_STATUSES = ['todo', 'in_progress', 'blocked', 'done', 'cancelled'] as const;
const VIEW_MODES = ['list', 'board', 'calendar'] as const;
type ViewMode = (typeof VIEW_MODES)[number];

type DeliveryKind = 'milestone' | 'task';

function parseItemId(id: string): { kind: DeliveryKind; entityId: string } | null {
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
  canMutate,
  initialMilestones,
  initialTasks,
  members,
}: {
  projectId: string;
  workspaceId: string;
  canMutate: boolean;
  initialMilestones: Milestone[];
  initialTasks: Task[];
  members: Member[];
}) {
  const t = useTranslations('delivery');
  const tCommon = useTranslations('common');
  const tWorkspaces = useTranslations('workspaces');
  const router = useRouter();
  const { pushToast } = useToast();

  const [milestones, setMilestones] = useState(initialMilestones);
  const [tasks, setTasks] = useState(initialTasks);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('list');

  const [title, setTitle] = useState('');
  const [isMilestone, setIsMilestone] = useState(false);
  const [dateValue, setDateValue] = useState('');
  const [taskMilestoneId, setTaskMilestoneId] = useState('');
  const [taskAccountable, setTaskAccountable] = useState('');
  const [taskResponsible, setTaskResponsible] = useState('');

  function changeViewMode(mode: ViewMode) {
    setViewMode(mode);
    try {
      window.sessionStorage.setItem(`kh-delivery-view:${projectId}`, mode);
    } catch {
      /* ignore */
    }
  }

  const wideModalOpen = viewMode === 'board' || viewMode === 'calendar';

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

  const items: CatalogueListItem[] = useMemo(() => {
    const milestoneItems: CatalogueListItem[] = milestones.map((milestone) => ({
      id: `milestone:${milestone.id}`,
      title: milestone.title,
      primaryBadge: t('kindMilestone'),
      secondaryBadge: t(`milestoneStatus.${milestone.status}`),
      subtitle: milestone.targetDate
        ? `${t('targetDate')}: ${milestone.targetDate}`
        : null,
      updatedAt: milestone.updatedAt ?? milestone.createdAt ?? null,
      searchText: [
        milestone.title,
        milestone.description ?? '',
        milestone.status,
        'milestone',
        milestone.targetDate ?? '',
      ]
        .join(' ')
        .toLowerCase(),
      filterValue: `milestone:${milestone.status}`,
      filterLabel: `${t('kindMilestone')} · ${t(`milestoneStatus.${milestone.status}`)}`,
    }));

    const taskItems: CatalogueListItem[] = tasks.map((task) => {
      const milestoneLabel = task.milestoneId
        ? milestoneTitleById.get(task.milestoneId)
        : null;
      const raciLine =
        task.raci.length > 0
          ? task.raci.map((entry) => `${entry.role}: ${entry.displayName}`).join(' · ')
          : null;
      return {
        id: `task:${task.id}`,
        title: task.title,
        primaryBadge: t('kindTask'),
        secondaryBadge: t(`taskStatus.${task.status}`),
        subtitle: [
          task.dueDate ? `${t('dueDate')}: ${task.dueDate}` : null,
          milestoneLabel ? `${t('milestoneOptional')}: ${milestoneLabel}` : null,
          raciLine,
        ]
          .filter(Boolean)
          .join(' · ') || null,
        updatedAt: task.updatedAt ?? task.createdAt ?? null,
        searchText: [
          task.title,
          task.description ?? '',
          task.status,
          'task',
          task.dueDate ?? '',
          milestoneLabel ?? '',
          raciLine ?? '',
        ]
          .join(' ')
          .toLowerCase(),
        filterValue: `task:${task.status}`,
        filterLabel: `${t('kindTask')} · ${t(`taskStatus.${task.status}`)}`,
      };
    });

    return [...milestoneItems, ...taskItems];
  }, [milestones, tasks, milestoneTitleById, t]);

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
        })),
      ...tasks
        .filter((task) => task.dueDate)
        .map((task) => ({
          id: `task:${task.id}`,
          kind: 'task' as const,
          title: task.title,
          date: task.dueDate!,
          status: task.status,
        })),
    ],
    [milestones, tasks],
  );

  function resetCreateForm() {
    setTitle('');
    setIsMilestone(false);
    setDateValue('');
    setTaskMilestoneId('');
    setTaskAccountable('');
    setTaskResponsible('');
    setError(null);
  }

  function closeCreateModal() {
    if (pending) return;
    setCreateOpen(false);
    resetCreateForm();
  }

  async function submitCreate() {
    if (!title.trim()) return;
    setPending(true);
    setError(null);
    try {
      if (isMilestone) {
        const response = await fetch(`/api/v1/projects/${projectId}/milestones`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: title.trim(),
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
            milestoneId: taskMilestoneId || null,
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
      setError(
        err instanceof Error
          ? err.message
          : isMilestone
            ? t('failedCreateMilestone')
            : t('failedCreateTask'),
      );
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
      if (parsed.kind === 'milestone') {
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
    <div className="mb-8">
      {error && !createOpen && !wideModalOpen ? (
        <div className="mb-3">
          <ErrorText>{error}</ErrorText>
        </div>
      ) : null}

      <CatalogueSection
        className="mb-2"
        title={t('title')}
        items={items}
        emptyLabel={t('empty')}
        searchPlaceholder={t('searchPlaceholder')}
        filterLabel={t('filterStatus')}
        filterAllLabel={tWorkspaces('sectionFilterAll')}
        createLabel={t('addItem')}
        canCreate={canMutate}
        extraActions={viewSwitcher(wideModalOpen ? 'list' : viewMode)}
        onCreate={() => {
          resetCreateForm();
          setCreateOpen(true);
        }}
        renderItem={(item) => {
          const parsed = parseItemId(item.id);
          const statusOptions =
            parsed?.kind === 'milestone' ? MILESTONE_STATUSES : TASK_STATUSES;
          const milestone =
            parsed?.kind === 'milestone'
              ? milestones.find((row) => row.id === parsed.entityId)
              : undefined;
          const task =
            parsed?.kind === 'task'
              ? tasks.find((row) => row.id === parsed.entityId)
              : undefined;
          const currentStatus = milestone?.status ?? task?.status;
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
                  <span className="font-semibold">{item.title}</span>
                  {item.primaryBadge ? (
                    <Badge tone="brand">{item.primaryBadge}</Badge>
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
                      {parsed.kind === 'milestone'
                        ? t(`milestoneStatus.${status}`)
                        : t(`taskStatus.${status}`)}
                    </option>
                  ))}
                </Select>
              ) : null}
            </div>
          );
        }}
      />

      <p className="mt-3 mb-0 text-xs text-ink-muted">
        {canMutate ? t('raciHint') : t('readOnlyHint')}
      </p>

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
            tasks={tasks}
            milestones={milestones}
            milestoneTitles={milestoneTitleById}
            canMutate={canMutate}
            pending={pending}
            onTaskStatusChange={(taskId, status) =>
              void updateStatus(`task:${taskId}`, status)
            }
          />
        ) : null}
        {viewMode === 'calendar' ? (
          <ProjectDeliveryCalendar items={calendarItems} />
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
              disabled={pending || !title.trim()}
              onClick={() => void submitCreate()}
            >
              {isMilestone ? t('addMilestone') : t('addTask')}
            </Button>
          </>
        }
      >
        <div className="grid gap-3">
          {error ? <ErrorText>{error}</ErrorText> : null}
          <Field label={t('itemTitle')}>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={pending}
              data-modal-initial-focus
            />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isMilestone}
              disabled={pending}
              onChange={(e) => setIsMilestone(e.target.checked)}
            />
            <span>{t('isMilestone')}</span>
          </label>
          <Field label={isMilestone ? t('targetDate') : t('dueDate')}>
            <Input
              type="date"
              value={dateValue}
              onChange={(e) => setDateValue(e.target.value)}
              disabled={pending}
            />
          </Field>
          {!isMilestone ? (
            <>
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
    </div>
  );
}
