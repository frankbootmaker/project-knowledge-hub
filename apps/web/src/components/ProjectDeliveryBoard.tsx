'use client';

import type { DragEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Badge } from './ui';
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
  raci: Array<{ role: string; displayName: string }>;
};

export type BoardMilestone = {
  id: string;
  title: string;
  status: string;
  targetDate: string | null;
};

const BOARD_COLUMNS = ['todo', 'in_progress', 'blocked', 'done', 'cancelled'] as const;

export function ProjectDeliveryBoard({
  tasks,
  milestones,
  milestoneTitles,
  canMutate,
  pending,
  onTaskStatusChange,
}: {
  tasks: BoardTask[];
  milestones: BoardMilestone[];
  milestoneTitles: Map<string, string>;
  canMutate: boolean;
  pending: boolean;
  onTaskStatusChange: (taskId: string, status: string) => void;
}) {
  const t = useTranslations('delivery');
  const today = todayYmd();

  function onDrop(status: string, event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const taskId = event.dataTransfer.getData('text/kh-task-id');
    if (!taskId || !canMutate || pending) return;
    onTaskStatusChange(taskId, status);
  }

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
                <span className="truncate font-medium">{milestone.title}</span>
                <Badge>{t(`milestoneStatus.${milestone.status}`)}</Badge>
                {milestone.targetDate ? (
                  <span className="text-xs opacity-80">{milestone.targetDate}</span>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}

      <div className="flex gap-3 overflow-x-auto pb-2">
        {BOARD_COLUMNS.map((status) => {
          const columnTasks = tasks.filter((task) => task.status === status);
          return (
            <div
              key={status}
              className="flex w-[17.5rem] shrink-0 flex-col rounded-lg border border-line bg-neutral-soft/40"
              onDragOver={(event) => {
                if (canMutate) event.preventDefault();
              }}
              onDrop={(event) => onDrop(status, event)}
            >
              <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
                <h3 className="m-0 text-sm font-semibold">
                  {t(`taskStatus.${status}`)}
                </h3>
                <span className="text-xs text-ink-muted">{columnTasks.length}</span>
              </div>
              <div className="flex min-h-[12rem] flex-col gap-2 p-2">
                {columnTasks.length === 0 ? (
                  <p className="m-0 px-1 py-6 text-center text-xs text-ink-muted">
                    {t('boardEmptyColumn')}
                  </p>
                ) : (
                  columnTasks.map((task) => {
                    const accountable = task.raci.find((entry) => entry.role === 'A');
                    const milestoneLabel = task.milestoneId
                      ? milestoneTitles.get(task.milestoneId)
                      : null;
                    const tone = deliveryScheduleTone({
                      status: task.status,
                      date: task.dueDate,
                      today,
                    });
                    return (
                      <article
                        key={task.id}
                        draggable={canMutate && !pending}
                        onDragStart={(event) => {
                          event.dataTransfer.setData('text/kh-task-id', task.id);
                          event.dataTransfer.effectAllowed = 'move';
                        }}
                        className={cn(
                          'rounded-md border p-3 shadow-sm',
                          deliveryScheduleSurfaceClass(tone),
                          canMutate && !pending && 'cursor-grab active:cursor-grabbing',
                        )}
                      >
                        <p className="m-0 text-sm font-medium text-ink">{task.title}</p>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {task.dueDate ? (
                            <span className="text-xs opacity-80">{task.dueDate}</span>
                          ) : null}
                          {milestoneLabel ? (
                            <Badge>{milestoneLabel}</Badge>
                          ) : null}
                          {accountable ? (
                            <Badge tone="neutral">A: {accountable.displayName}</Badge>
                          ) : null}
                        </div>
                      </article>
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
      </div>
      {canMutate ? (
        <p className="m-0 text-xs text-ink-muted">{t('boardDragHint')}</p>
      ) : null}
    </div>
  );
}
