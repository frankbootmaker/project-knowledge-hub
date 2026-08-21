'use client';

import type { DragEvent, ReactNode, RefObject } from 'react';
import { useCallback, useEffect, useId, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Button, Select, useToast } from './ui';
import { cn } from '../lib/cn';
import {
  deliveryScheduleSurfaceClass,
  deliveryScheduleTone,
  todayYmd,
  type DeliveryScheduleTone,
} from '../lib/delivery-schedule';
import { UserAvatar } from './UserAvatar';
import { downloadAuthenticatedExport } from '../lib/download-export';
import {
  hoursCost,
  resolveRatePerson,
  toHours,
  type RatePerson,
} from '../lib/task-costing';
import { formatMoney } from '../lib/project-currency';

const SCHEDULE_LEGEND: DeliveryScheduleTone[] = [
  'onTrack',
  'atRisk',
  'overdue',
  'completed',
];

export type BoardTask = {
  id: string;
  title: string;
  status: string;
  dueDate: string | null;
  forecastHours?: string | number | null;
  actualHours?: string | number | null;
  milestoneId: string | null;
  sprintId?: string | null;
  storyPoints?: number | null;
  humanKey?: string | null;
  userStoryTitle?: string | null;
  currentOwnerUserId?: string | null;
  currentOwner?: {
    userId: string;
    displayName: string;
    avatarUrl?: string | null;
  } | null;
  raci: Array<{
    userId: string;
    role: string;
    displayName: string;
    avatarUrl?: string | null;
  }>;
};

/** Person who needs to act — current owner, else Responsible (R). */
function actionablePerson(task: BoardTask) {
  if (task.currentOwner?.userId) return task.currentOwner;
  const responsible = task.raci.find((entry) => entry.role === 'R');
  if (!responsible) return null;
  return {
    userId: responsible.userId,
    displayName: responsible.displayName,
    avatarUrl: responsible.avatarUrl ?? null,
  };
}

export type BoardMilestone = {
  id: string;
  title: string;
  status: string;
  targetDate: string | null;
  humanKey?: string | null;
};

export type BoardMetaFilters = {
  issueId: boolean;
  story: boolean;
  milestone: boolean;
  owner: boolean;
  accountable: boolean;
  dueDate: boolean;
  storyPoints: boolean;
};

export type BoardExportHandle = {
  exportPdf: () => void;
};

export const DEFAULT_BOARD_META_FILTERS: BoardMetaFilters = {
  issueId: true,
  story: true,
  milestone: true,
  owner: true,
  accountable: true,
  dueDate: true,
  storyPoints: false,
};

const DEFAULT_META_FILTERS = DEFAULT_BOARD_META_FILTERS;

const BOARD_COLUMNS = ['todo', 'in_progress', 'blocked', 'done', 'cancelled'] as const;
type BoardColumn = (typeof BOARD_COLUMNS)[number];

const MILESTONE_STATUSES = ['planned', 'active', 'done', 'cancelled'] as const;

/** Map milestone lifecycle onto board columns (no blocked state). */
function milestoneBoardColumn(status: string): BoardColumn {
  if (status === 'active') return 'in_progress';
  if (status === 'done') return 'done';
  if (status === 'cancelled') return 'cancelled';
  return 'todo';
}

function boardColumnToMilestoneStatus(column: string): string {
  if (column === 'in_progress' || column === 'blocked') return 'active';
  if (column === 'done') return 'done';
  if (column === 'cancelled') return 'cancelled';
  return 'planned';
}

function readMetaFilters(storageKey: string): BoardMetaFilters {
  try {
    const raw = window.sessionStorage.getItem(storageKey);
    if (!raw) return DEFAULT_META_FILTERS;
    const parsed = JSON.parse(raw) as Partial<BoardMetaFilters>;
    return {
      issueId: parsed.issueId ?? true,
      story: parsed.story ?? true,
      milestone: parsed.milestone ?? true,
      owner: parsed.owner ?? true,
      accountable: parsed.accountable ?? true,
      dueDate: parsed.dueDate ?? true,
      storyPoints: parsed.storyPoints ?? false,
    };
  } catch {
    return DEFAULT_META_FILTERS;
  }
}

export function boardMetaStorageKey(projectId: string): string {
  return `kh-board-meta:${projectId}`;
}

export function readBoardMetaFilters(projectId: string): BoardMetaFilters {
  return readMetaFilters(boardMetaStorageKey(projectId));
}

function writeMetaFilters(storageKey: string, filters: BoardMetaFilters): void {
  try {
    window.sessionStorage.setItem(storageKey, JSON.stringify(filters));
  } catch {
    /* ignore */
  }
}

function BoardMetaTag({
  label,
  value,
  leading,
  title,
}: {
  label: string;
  value: string;
  leading?: ReactNode;
  title?: string;
}) {
  return (
    <div
      className="max-w-full border border-line bg-panel-solid px-1.5 py-0.5 text-left text-[10px] leading-snug text-ink"
      title={title ?? `${label}: ${value}`}
    >
      <span className="mb-0.5 block font-mono text-[9px] font-semibold uppercase tracking-wide text-ink-muted">
        {label}
      </span>
      <span className="flex min-w-0 items-center gap-1">
        {leading}
        <span className="block truncate">{value}</span>
      </span>
    </div>
  );
}

function BoardMetaHelp() {
  const t = useTranslations('delivery');
  const panelId = useId();
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        className="inline-flex size-6 shrink-0 items-center justify-center rounded-full border border-line text-xs font-semibold text-ink-muted hover:bg-brand-soft hover:text-ink"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={t('boardMetaHelp')}
        title={t('boardMetaHelp')}
        onClick={() => setOpen((current) => !current)}
      >
        ?
      </button>
      {open ? (
        <div
          id={panelId}
          role="note"
          className="absolute left-0 top-full z-10 mt-2 grid w-max max-w-sm gap-2 rounded-md border border-line bg-panel-solid px-2.5 py-2 text-xs text-ink-muted shadow-sm"
        >
          <p className="m-0">{t('boardMetaHint')}</p>
          <ul
            className="m-0 flex list-none flex-wrap items-center gap-2 p-0"
            aria-label={t('scheduleLegendLabel')}
          >
            {SCHEDULE_LEGEND.map((tone) => (
              <li
                key={tone}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium',
                  deliveryScheduleSurfaceClass(tone),
                )}
              >
                <span>{t(`scheduleTone.${tone}`)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function BoardMilestoneCard({
  milestone,
  today,
  meta,
  canMutate,
  pending,
  showStatusSelect,
  onMilestoneStatusChange,
  onManageMilestone,
}: {
  milestone: BoardMilestone;
  today: string;
  meta: BoardMetaFilters;
  canMutate: boolean;
  pending: boolean;
  showStatusSelect: boolean;
  onMilestoneStatusChange?: (milestoneId: string, status: string) => void;
  onManageMilestone?: (milestoneId: string) => void;
}) {
  const t = useTranslations('delivery');
  const tone = deliveryScheduleTone({
    status: milestone.status,
    date: milestone.targetDate,
    today,
  });
  const showDue = meta.dueDate && Boolean(milestone.targetDate);
  const showIssueId = meta.issueId && Boolean(milestone.humanKey);

  return (
    <article
      draggable={canMutate && !pending && !showStatusSelect}
      onDragStart={(event) => {
        event.dataTransfer.setData('text/kh-milestone-id', milestone.id);
        event.dataTransfer.effectAllowed = 'move';
      }}
      className={cn(
        'kh-ops-task-card',
        canMutate &&
          !pending &&
          !showStatusSelect &&
          'cursor-grab active:cursor-grabbing',
      )}
    >
      <div className="kh-ops-task-top">
        <span className="kh-ops-task-id">
          {showIssueId ? milestone.humanKey! : t('kindMilestone')}
        </span>
        <span
          className={cn(
            'inline-flex items-center border px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-wide uppercase',
            deliveryScheduleSurfaceClass(tone),
          )}
        >
          {t(`scheduleToneShort.${tone}`)}
        </span>
      </div>
      <h3>{milestone.title}</h3>
      {showDue ? (
        <div className="kh-ops-task-meta">
          <span>{t('dueDate')}</span>
          <b>{milestone.targetDate}</b>
        </div>
      ) : null}
      {onManageMilestone ? (
        <Button
          type="button"
          variant="secondary"
          className="mt-3 h-8 w-full px-2 text-xs"
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onManageMilestone(milestone.id);
          }}
        >
          {t('manage')}
        </Button>
      ) : null}
      {showStatusSelect && canMutate && onMilestoneStatusChange ? (
        <Select
          className="mt-3 w-full"
          value={milestone.status}
          disabled={pending}
          aria-label={t('boardMoveStatus')}
          onChange={(event) =>
            onMilestoneStatusChange(milestone.id, event.target.value)
          }
        >
          {MILESTONE_STATUSES.map((status) => (
            <option key={status} value={status}>
              {t(`milestoneStatus.${status}`)}
            </option>
          ))}
        </Select>
      ) : null}
    </article>
  );
}

export function BoardTaskCard({
  task,
  milestoneLabel,
  today,
  meta,
  canMutate,
  pending,
  showStatusSelect,
  onTaskStatusChange,
  onManageTask,
  actions,
  currency = 'EUR',
  ratePeople = [],
}: {
  task: BoardTask;
  milestoneLabel: string | null;
  today: string;
  meta: BoardMetaFilters;
  canMutate: boolean;
  pending: boolean;
  showStatusSelect: boolean;
  onTaskStatusChange: (taskId: string, status: string) => void;
  onManageTask?: (taskId: string) => void;
  actions?: ReactNode;
  currency?: string;
  ratePeople?: RatePerson[];
}) {
  const t = useTranslations('delivery');
  const locale = useLocale();
  const accountable = task.raci.find((entry) => entry.role === 'A');
  const actor = actionablePerson(task);
  const tone = deliveryScheduleTone({
    status: task.status,
    date: task.dueDate,
    today,
  });
  const showStory = meta.story && Boolean(task.userStoryTitle);
  const showMilestone = meta.milestone && Boolean(milestoneLabel);
  const showAccountable = meta.accountable && Boolean(accountable);
  const showOwner = meta.owner && Boolean(actor);
  const showDue = meta.dueDate && Boolean(task.dueDate);
  const showPoints =
    meta.storyPoints &&
    task.storyPoints != null &&
    Number.isFinite(task.storyPoints);
  const showIssueId = meta.issueId && Boolean(task.humanKey);
  const forecast = toHours(task.forecastHours);
  const rates = new Map(ratePeople.map((person) => [person.userId, person]));
  const ratePerson = resolveRatePerson(
    task.currentOwnerUserId ?? task.currentOwner?.userId,
    task.raci,
    rates,
  );
  const cost = hoursCost(forecast, ratePerson?.hourlyRate);
  const hasMeta =
    showStory ||
    showMilestone ||
    showAccountable ||
    showOwner ||
    showDue ||
    showPoints ||
    forecast != null;
  const canDrag = canMutate && !pending && !showStatusSelect;

  return (
    <article
      draggable={canDrag}
      onDragStart={(event) => {
        event.dataTransfer.setData('text/kh-task-id', task.id);
        event.dataTransfer.effectAllowed = 'move';
      }}
      className={cn(
        'kh-ops-task-card',
        canDrag && 'cursor-grab active:cursor-grabbing',
      )}
    >
      <div className="kh-ops-task-top">
        <span className="kh-ops-task-id">
          {showIssueId ? task.humanKey : t('kindTask')}
        </span>
        <span
          className={cn(
            'inline-flex items-center border px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-wide uppercase',
            deliveryScheduleSurfaceClass(tone),
          )}
        >
          {t(`scheduleToneShort.${tone}`)}
        </span>
      </div>
      <h3>{task.title}</h3>
      {hasMeta ? (
        <div className="kh-ops-task-meta">
          {showOwner && actor ? (
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <UserAvatar
                displayName={actor.displayName}
                avatarUrl={actor.avatarUrl}
                size="xs"
              />
              <span className="truncate">{actor.displayName}</span>
            </span>
          ) : (
            <span />
          )}
          {forecast != null ? (
            <b>
              {forecast}h
              {cost != null ? ` · ${formatMoney(cost, currency, locale)}` : ''}
            </b>
          ) : null}
          {showDue ? <span>{task.dueDate}</span> : <span />}
          {showPoints ? (
            <span className="kh-ops-points">{task.storyPoints} PT</span>
          ) : null}
        </div>
      ) : null}
      {showStory || showMilestone || showAccountable ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {showStory ? (
            <BoardMetaTag label={t('kindStory')} value={task.userStoryTitle!} />
          ) : null}
          {showMilestone ? (
            <BoardMetaTag label={t('kindMilestone')} value={milestoneLabel!} />
          ) : null}
          {showAccountable ? (
            <BoardMetaTag
              label={t('accountable')}
              value={accountable!.displayName}
            />
          ) : null}
        </div>
      ) : null}
      {onManageTask ? (
        <Button
          type="button"
          variant="secondary"
          className="mt-3 h-8 w-full px-2 text-xs"
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onManageTask(task.id);
          }}
        >
          {t('manage')}
        </Button>
      ) : null}
      {actions}
      {showStatusSelect && canMutate ? (
        <Select
          className="mt-3 w-full"
          value={task.status}
          disabled={pending}
          aria-label={t('boardMoveStatus')}
          onChange={(event) => onTaskStatusChange(task.id, event.target.value)}
        >
          {BOARD_COLUMNS.map((status) => (
            <option key={status} value={status}>
              {t(`taskStatus.${status}`)}
            </option>
          ))}
        </Select>
      ) : null}
    </article>
  );
}

function BoardColumnPanel({
  status,
  tasks,
  milestones,
  milestoneTitles,
  today,
  meta,
  canMutate,
  pending,
  compact,
  showStatusSelect,
  onDrop,
  onTaskStatusChange,
  onMilestoneStatusChange,
  onManageTask,
  onManageMilestone,
  currency,
  ratePeople,
}: {
  status: BoardColumn;
  tasks: BoardTask[];
  milestones: BoardMilestone[];
  milestoneTitles: Map<string, string>;
  today: string;
  meta: BoardMetaFilters;
  canMutate: boolean;
  pending: boolean;
  compact: boolean;
  showStatusSelect: boolean;
  onDrop: (status: string, event: DragEvent<HTMLDivElement>) => void;
  onTaskStatusChange: (taskId: string, status: string) => void;
  onMilestoneStatusChange?: (milestoneId: string, status: string) => void;
  onManageTask?: (taskId: string) => void;
  onManageMilestone?: (milestoneId: string) => void;
  currency?: string;
  ratePeople?: RatePerson[];
}) {
  const t = useTranslations('delivery');
  const itemCount = tasks.length + milestones.length;
  const laneHours = tasks.reduce((sum, task) => sum + (toHours(task.forecastHours) ?? 0), 0);
  const laneCount =
    laneHours > 0
      ? `${String(itemCount).padStart(2, '0')} / ${Math.round(laneHours)}h`
      : String(itemCount).padStart(2, '0');

  return (
    <div
      className={cn('kh-ops-lane flex flex-col', compact && 'w-full')}
      onDragOver={(event) => {
        if (canMutate && !showStatusSelect) event.preventDefault();
      }}
      onDrop={(event) => onDrop(status, event)}
    >
      <div className="kh-ops-lane-head">
        <h3 className="m-0">{t(`taskStatus.${status}`)}</h3>
        <span className="kh-ops-lane-count">{laneCount}</span>
      </div>
      <div
        className={cn(
          'flex flex-col',
          compact ? 'min-h-[8rem]' : 'min-h-[12rem]',
        )}
      >
        {itemCount === 0 ? (
          <p className="kh-ops-empty">
            {showStatusSelect
              ? t('boardEmptyColumnMobile')
              : t('boardEmptyColumn')}
          </p>
        ) : (
          <>
            {milestones.map((milestone) => (
              <BoardMilestoneCard
                key={`milestone:${milestone.id}`}
                milestone={milestone}
                today={today}
                meta={meta}
                canMutate={canMutate}
                pending={pending}
                showStatusSelect={showStatusSelect}
                onMilestoneStatusChange={onMilestoneStatusChange}
                onManageMilestone={onManageMilestone}
              />
            ))}
            {tasks.map((task) => (
              <BoardTaskCard
                key={task.id}
                task={task}
                milestoneLabel={
                  task.milestoneId
                    ? (milestoneTitles.get(task.milestoneId) ?? null)
                    : null
                }
                today={today}
                meta={meta}
                canMutate={canMutate}
                pending={pending}
                showStatusSelect={showStatusSelect}
                onTaskStatusChange={onTaskStatusChange}
                onManageTask={onManageTask}
                currency={currency}
                ratePeople={ratePeople}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

export function ProjectDeliveryBoard({
  projectId,
  projectName,
  tasks,
  milestones = [],
  milestoneTitles = new Map(),
  canMutate,
  pending = false,
  onTaskStatusChange,
  onMilestoneStatusChange,
  onManageTask,
  onManageMilestone,
  exportHandleRef,
  onExportStateChange,
  onMetaFiltersChange,
  currency = 'EUR',
  ratePeople = [],
}: {
  projectId: string;
  projectName: string;
  tasks: BoardTask[];
  milestones?: BoardMilestone[];
  milestoneTitles?: Map<string, string>;
  canMutate: boolean;
  pending?: boolean;
  onTaskStatusChange: (taskId: string, status: string) => void;
  onMilestoneStatusChange?: (milestoneId: string, status: string) => void;
  onManageTask?: (taskId: string) => void;
  onManageMilestone?: (milestoneId: string) => void;
  exportHandleRef?: RefObject<BoardExportHandle | null>;
  onExportStateChange?: (
    state: { pending: boolean; canExport: boolean } | null,
  ) => void;
  onMetaFiltersChange?: (meta: BoardMetaFilters) => void;
  currency?: string;
  ratePeople?: RatePerson[];
}) {
  const t = useTranslations('delivery');
  const tProjects = useTranslations('projects');
  const { pushToast } = useToast();
  const today = todayYmd();
  const filterKey = boardMetaStorageKey(projectId);
  const [mobileColumn, setMobileColumn] = useState<BoardColumn>('todo');
  const [meta, setMeta] = useState<BoardMetaFilters>(DEFAULT_META_FILTERS);
  const [exportPending, setExportPending] = useState(false);

  useEffect(() => {
    const next = readMetaFilters(filterKey);
    setMeta(next);
    onMetaFiltersChange?.(next);
  }, [filterKey, onMetaFiltersChange]);

  function toggleMeta(key: keyof BoardMetaFilters) {
    setMeta((current) => {
      const next = { ...current, [key]: !current[key] };
      writeMetaFilters(filterKey, next);
      onMetaFiltersChange?.(next);
      return next;
    });
  }

  const exportBoardPdf = useCallback(async () => {
    if (exportPending) return;
    setExportPending(true);
    try {
      const title = t('boardExportTitle', { project: projectName });
      const slug = projectName.replace(/[^\w.-]+/g, '-').toLowerCase();
      const statusLabels = Object.fromEntries(
        BOARD_COLUMNS.map((status) => [status, t(`taskStatus.${status}`)]),
      );
      const milestoneStatusLabels: Record<string, string> = {};
      for (const milestone of milestones) {
        milestoneStatusLabels[milestone.status] = t(
          `milestoneStatus.${milestone.status}`,
        );
      }
      await downloadAuthenticatedExport(
        `/api/v1/projects/${projectId}/board/export`,
        `${slug}-board.pdf`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: window.location.origin,
          },
          body: JSON.stringify({
            title,
            showIssueId: meta.issueId,
            showStory: meta.story,
            showMilestone: meta.milestone,
            showOwner: meta.owner,
            showAccountable: meta.accountable,
            showDueDate: meta.dueDate,
            showStoryPoints: meta.storyPoints,
            labels: {
              story: t('kindStory'),
              milestone: t('kindMilestone'),
              owner: t('currentOwner'),
              accountable: t('accountable'),
              dueDate: t('dueDate'),
              storyPoints: t('boardMetaStoryPoints'),
              generated: tProjects('reportGenerated'),
              empty: t('boardEmptyColumn'),
              status: statusLabels,
              milestoneStatus: milestoneStatusLabels,
            },
          }),
        },
      );
      pushToast(t('boardExported'));
    } catch (err) {
      pushToast(
        err instanceof Error ? err.message : t('boardExportFailed'),
        'danger',
      );
    } finally {
      setExportPending(false);
    }
  }, [
    exportPending,
    meta,
    milestones,
    projectId,
    projectName,
    pushToast,
    t,
    tProjects,
  ]);

  useEffect(() => {
    if (exportHandleRef) {
      exportHandleRef.current = {
        exportPdf: () => {
          void exportBoardPdf();
        },
      };
    }
    onExportStateChange?.({
      pending: exportPending,
      canExport: true,
    });
    return () => {
      if (exportHandleRef) exportHandleRef.current = null;
      onExportStateChange?.(null);
    };
  }, [exportBoardPdf, exportHandleRef, exportPending, onExportStateChange]);

  function onDrop(status: string, event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    if (!canMutate || pending) return;
    const milestoneId = event.dataTransfer.getData('text/kh-milestone-id');
    if (milestoneId) {
      onMilestoneStatusChange?.(
        milestoneId,
        boardColumnToMilestoneStatus(status),
      );
      return;
    }
    const taskId = event.dataTransfer.getData('text/kh-task-id');
    if (!taskId) return;
    onTaskStatusChange(taskId, status);
  }

  const mobileTasks = tasks.filter((task) => task.status === mobileColumn);
  const mobileMilestones = milestones.filter(
    (milestone) => milestoneBoardColumn(milestone.status) === mobileColumn,
  );
  const metaOptions = [
    ['issueId', 'boardMetaIssueId'],
    ['story', 'kindStory'],
    ['milestone', 'kindMilestone'],
    ['owner', 'currentOwner'],
    ['accountable', 'accountable'],
    ['dueDate', 'dueDate'],
    ['storyPoints', 'boardMetaStoryPoints'],
  ] as const;

  return (
    <div className="grid min-w-0 max-w-full gap-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <fieldset className="m-0 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 border-0 p-0">
          <legend className="sr-only">{t('boardMetaFilterLabel')}</legend>
          {metaOptions.map(([key, labelKey]) => (
            <label
              key={key}
              className="inline-flex items-center gap-1.5 text-xs text-ink"
            >
              <input
                type="checkbox"
                checked={meta[key]}
                onChange={() => toggleMeta(key)}
              />
              <span>{t(labelKey)}</span>
            </label>
          ))}
        </fieldset>
        <BoardMetaHelp />
      </div>

      {/* Mobile: one column at a time with status select on cards */}
      <div className="grid gap-3 md:hidden">
        <div
          className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1"
          role="tablist"
          aria-label={t('boardColumnTabsLabel')}
        >
          {BOARD_COLUMNS.map((status) => {
            const taskCount = tasks.filter(
              (task) => task.status === status,
            ).length;
            const milestoneCount = milestones.filter(
              (milestone) => milestoneBoardColumn(milestone.status) === status,
            ).length;
            const count = taskCount + milestoneCount;
            const active = mobileColumn === status;
            return (
              <button
                key={status}
                type="button"
                role="tab"
                aria-selected={active}
                className={cn(
                  'inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-semibold',
                  active
                    ? 'border-brand bg-brand-soft text-brand'
                    : 'border-line bg-panel text-ink-muted',
                )}
                onClick={() => setMobileColumn(status)}
              >
                {t(`taskStatus.${status}`)}
                <span className="tabular-nums opacity-80">{count}</span>
              </button>
            );
          })}
        </div>
        <BoardColumnPanel
          status={mobileColumn}
          tasks={mobileTasks}
          milestones={mobileMilestones}
          milestoneTitles={milestoneTitles}
          today={today}
          meta={meta}
          canMutate={canMutate}
          pending={pending}
          compact
          showStatusSelect
          onDrop={onDrop}
          onTaskStatusChange={onTaskStatusChange}
          onMilestoneStatusChange={onMilestoneStatusChange}
          onManageTask={onManageTask}
          onManageMilestone={onManageMilestone}
          currency={currency}
          ratePeople={ratePeople}
        />
        {canMutate ? (
          <p className="m-0 text-xs text-ink-muted">{t('boardMobileHint')}</p>
        ) : null}
      </div>

      {/* Desktop / tablet landscape: horizontal kanban with drag */}
      <div className="hidden min-w-0 max-w-full md:block">
        <div className="kh-ops-board">
          {BOARD_COLUMNS.map((status) => (
            <BoardColumnPanel
              key={status}
              status={status}
              tasks={tasks.filter((task) => task.status === status)}
              milestones={milestones.filter(
                (milestone) => milestoneBoardColumn(milestone.status) === status,
              )}
              milestoneTitles={milestoneTitles}
              today={today}
              meta={meta}
              canMutate={canMutate}
              pending={pending}
              compact={false}
              showStatusSelect={false}
              onDrop={onDrop}
              onTaskStatusChange={onTaskStatusChange}
              onMilestoneStatusChange={onMilestoneStatusChange}
              onManageTask={onManageTask}
              onManageMilestone={onManageMilestone}
              currency={currency}
              ratePeople={ratePeople}
            />
          ))}
        </div>
        {canMutate ? (
          <p className="m-0 text-xs text-ink-muted">{t('boardDragHint')}</p>
        ) : null}
      </div>
    </div>
  );
}
