'use client';

import type { DragEvent } from 'react';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Badge, Button, Select } from './ui';
import { cn } from '../lib/cn';
import {
  deliveryScheduleSurfaceClass,
  deliveryScheduleTone,
  todayYmd,
} from '../lib/delivery-schedule';
import { DeliveryScheduleLegend } from './DeliveryScheduleLegend';

export type BoardTask = {
  id: string;
  title: string;
  status: string;
  dueDate: string | null;
  milestoneId: string | null;
  userStoryTitle?: string | null;
  currentOwner?: { displayName: string } | null;
  raci: Array<{ role: string; displayName: string }>;
};

export type BoardMilestone = {
  id: string;
  title: string;
  status: string;
  targetDate: string | null;
};

const BOARD_COLUMNS = ['todo', 'in_progress', 'blocked', 'done', 'cancelled'] as const;
type BoardColumn = (typeof BOARD_COLUMNS)[number];

function BoardTaskCard({
  task,
  milestoneLabel,
  today,
  canMutate,
  pending,
  showStatusSelect,
  onTaskStatusChange,
  onManageTask,
}: {
  task: BoardTask;
  milestoneLabel: string | null;
  today: string;
  canMutate: boolean;
  pending: boolean;
  showStatusSelect: boolean;
  onTaskStatusChange: (taskId: string, status: string) => void;
  onManageTask?: (taskId: string) => void;
}) {
  const t = useTranslations('delivery');
  const accountable = task.raci.find((entry) => entry.role === 'A');
  const tone = deliveryScheduleTone({
    status: task.status,
    date: task.dueDate,
    today,
  });

  return (
    <article
      draggable={canMutate && !pending && !showStatusSelect}
      onDragStart={(event) => {
        event.dataTransfer.setData('text/kh-task-id', task.id);
        event.dataTransfer.effectAllowed = 'move';
      }}
      className={cn(
        'rounded-md border p-3 shadow-sm',
        deliveryScheduleSurfaceClass(tone),
        canMutate && !pending && !showStatusSelect && 'cursor-grab active:cursor-grabbing',
      )}
    >
      <p className="m-0 text-sm font-medium text-ink">{task.title}</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {task.dueDate ? (
          <span className="text-xs opacity-80">{task.dueDate}</span>
        ) : null}
        {task.userStoryTitle ? (
          <Badge tone="brand">{task.userStoryTitle}</Badge>
        ) : null}
        {milestoneLabel ? <Badge>{milestoneLabel}</Badge> : null}
        {task.currentOwner ? (
          <Badge tone="neutral">{task.currentOwner.displayName}</Badge>
        ) : null}
        {accountable ? (
          <Badge tone="neutral">A: {accountable.displayName}</Badge>
        ) : null}
      </div>
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
  milestoneTitles,
  today,
  canMutate,
  pending,
  compact,
  showStatusSelect,
  onDrop,
  onTaskStatusChange,
  onManageTask,
}: {
  status: BoardColumn;
  tasks: BoardTask[];
  milestoneTitles: Map<string, string>;
  today: string;
  canMutate: boolean;
  pending: boolean;
  compact: boolean;
  showStatusSelect: boolean;
  onDrop: (status: string, event: DragEvent<HTMLDivElement>) => void;
  onTaskStatusChange: (taskId: string, status: string) => void;
  onManageTask?: (taskId: string) => void;
}) {
  const t = useTranslations('delivery');

  return (
    <div
      className={cn(
        'flex flex-col rounded-lg border border-line bg-neutral-soft/40',
        compact ? 'w-full' : 'w-[min(17.5rem,85vw)] shrink-0 snap-start md:w-[17.5rem]',
      )}
      onDragOver={(event) => {
        if (canMutate && !showStatusSelect) event.preventDefault();
      }}
      onDrop={(event) => onDrop(status, event)}
    >
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
        <h3 className="m-0 text-sm font-semibold">{t(`taskStatus.${status}`)}</h3>
        <span className="text-xs text-ink-muted">{tasks.length}</span>
      </div>
      <div
        className={cn(
          'flex flex-col gap-2 p-2',
          compact ? 'min-h-[8rem]' : 'min-h-[12rem]',
        )}
      >
        {tasks.length === 0 ? (
          <p className="m-0 px-1 py-6 text-center text-xs text-ink-muted">
            {showStatusSelect ? t('boardEmptyColumnMobile') : t('boardEmptyColumn')}
          </p>
        ) : (
          tasks.map((task) => (
            <BoardTaskCard
              key={task.id}
              task={task}
              milestoneLabel={
                task.milestoneId
                  ? (milestoneTitles.get(task.milestoneId) ?? null)
                  : null
              }
              today={today}
              canMutate={canMutate}
              pending={pending}
              showStatusSelect={showStatusSelect}
              onTaskStatusChange={onTaskStatusChange}
              onManageTask={onManageTask}
            />
          ))
        )}
      </div>
    </div>
  );
}

export function ProjectDeliveryBoard({
  tasks,
  milestones,
  milestoneTitles,
  canMutate,
  pending,
  onTaskStatusChange,
  onManageTask,
}: {
  tasks: BoardTask[];
  milestones: BoardMilestone[];
  milestoneTitles: Map<string, string>;
  canMutate: boolean;
  pending: boolean;
  onTaskStatusChange: (taskId: string, status: string) => void;
  onManageTask?: (taskId: string) => void;
}) {
  const t = useTranslations('delivery');
  const today = todayYmd();
  const [mobileColumn, setMobileColumn] = useState<BoardColumn>('todo');

  function onDrop(status: string, event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const taskId = event.dataTransfer.getData('text/kh-task-id');
    if (!taskId || !canMutate || pending) return;
    onTaskStatusChange(taskId, status);
  }

  const mobileTasks = tasks.filter((task) => task.status === mobileColumn);

  return (
    <div className="grid gap-4">
      <DeliveryScheduleLegend />

      {milestones.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {milestones.map((milestone) => {
            const tone = deliveryScheduleTone({
              status: milestone.status,
              date: milestone.targetDate,
              today,
            });
            return (
              <div
                key={milestone.id}
                className={cn(
                  'inline-flex max-w-full items-center gap-2 rounded-md border px-3 py-1.5 text-sm',
                  deliveryScheduleSurfaceClass(tone),
                )}
              >
                <Badge tone="brand">{t('kindMilestone')}</Badge>
                <span className="min-w-0 truncate font-medium">{milestone.title}</span>
                <Badge>{t(`milestoneStatus.${milestone.status}`)}</Badge>
                {milestone.targetDate ? (
                  <span className="shrink-0 text-xs opacity-80">{milestone.targetDate}</span>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}

      {/* Mobile: one column at a time with status select on cards */}
      <div className="grid gap-3 md:hidden">
        <div
          className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1"
          role="tablist"
          aria-label={t('boardColumnTabsLabel')}
        >
          {BOARD_COLUMNS.map((status) => {
            const count = tasks.filter((task) => task.status === status).length;
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
          milestoneTitles={milestoneTitles}
          today={today}
          canMutate={canMutate}
          pending={pending}
          compact
          showStatusSelect
          onDrop={onDrop}
          onTaskStatusChange={onTaskStatusChange}
          onManageTask={onManageTask}
        />
        {canMutate ? (
          <p className="m-0 text-xs text-ink-muted">{t('boardMobileHint')}</p>
        ) : null}
      </div>

      {/* Desktop / tablet landscape: horizontal kanban with drag */}
      <div className="hidden md:block">
        <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-2 snap-x snap-mandatory">
          {BOARD_COLUMNS.map((status) => (
            <BoardColumnPanel
              key={status}
              status={status}
              tasks={tasks.filter((task) => task.status === status)}
              milestoneTitles={milestoneTitles}
              today={today}
              canMutate={canMutate}
              pending={pending}
              compact={false}
              showStatusSelect={false}
              onDrop={onDrop}
              onTaskStatusChange={onTaskStatusChange}
              onManageTask={onManageTask}
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
