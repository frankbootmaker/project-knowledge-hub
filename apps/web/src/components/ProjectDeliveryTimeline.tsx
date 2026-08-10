'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { Badge, Button } from './ui';
import { cn } from '../lib/cn';

type Epic = {
  id: string;
  title: string;
  status: string;
  startDate: string | null;
  endDate: string | null;
};

type Story = {
  id: string;
  epicId: string;
  title: string;
  status: string;
  startDate: string | null;
  endDate: string | null;
};

type Milestone = {
  id: string;
  title: string;
  status: string;
  startDate: string | null;
  targetDate: string | null;
};

type Task = {
  id: string;
  title: string;
  status: string;
  dueDate: string | null;
};

function parseYmd(value: string): number {
  const parts = value.split('-').map(Number);
  const y = parts[0] ?? 1970;
  const m = parts[1] ?? 1;
  const d = parts[2] ?? 1;
  return Date.UTC(y, m - 1, d);
}

function formatYmd(ms: number): string {
  const date = new Date(ms);
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addDays(ms: number, days: number): number {
  return ms + days * 86_400_000;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function ProjectDeliveryTimeline({
  projectStartDate,
  projectEndDate,
  epics,
  stories,
  milestones,
  tasks,
  onManageEpic,
  onManageStory,
  onManageMilestone,
  onManageTask,
}: {
  projectStartDate: string | null;
  projectEndDate: string | null;
  epics: Epic[];
  stories: Story[];
  milestones: Milestone[];
  tasks: Task[];
  onManageEpic: (id: string) => void;
  onManageStory: (id: string) => void;
  onManageMilestone: (id: string) => void;
  onManageTask: (id: string) => void;
}) {
  const t = useTranslations('delivery');

  const { rangeStart, rangeEnd, ticks } = useMemo(() => {
    const candidates: string[] = [];
    if (projectStartDate) candidates.push(projectStartDate);
    if (projectEndDate) candidates.push(projectEndDate);
    for (const epic of epics) {
      if (epic.startDate) candidates.push(epic.startDate);
      if (epic.endDate) candidates.push(epic.endDate);
    }
    for (const story of stories) {
      if (story.startDate) candidates.push(story.startDate);
      if (story.endDate) candidates.push(story.endDate);
    }
    for (const milestone of milestones) {
      if (milestone.startDate) candidates.push(milestone.startDate);
      if (milestone.targetDate) candidates.push(milestone.targetDate);
    }
    for (const task of tasks) {
      if (task.dueDate) candidates.push(task.dueDate);
    }

    let startMs: number;
    let endMs: number;
    if (candidates.length === 0) {
      const today = Date.UTC(
        new Date().getUTCFullYear(),
        new Date().getUTCMonth(),
        new Date().getUTCDate(),
      );
      startMs = addDays(today, -14);
      endMs = addDays(today, 60);
    } else {
      const values = candidates.map(parseYmd);
      startMs = Math.min(...values);
      endMs = Math.max(...values);
      if (endMs <= startMs) {
        endMs = addDays(startMs, 30);
      }
    }

    const spanDays = Math.max(1, Math.round((endMs - startMs) / 86_400_000));
    const tickCount = Math.min(8, Math.max(4, Math.ceil(spanDays / 14) + 1));
    const tickList = Array.from({ length: tickCount }, (_, index) => {
      const ratio = index / (tickCount - 1);
      return formatYmd(startMs + (endMs - startMs) * ratio);
    });

    return {
      rangeStart: startMs,
      rangeEnd: endMs,
      ticks: tickList,
    };
  }, [projectStartDate, projectEndDate, epics, stories, milestones, tasks]);

  const span = Math.max(1, rangeEnd - rangeStart);

  function barStyle(start: string | null, end: string | null) {
    if (!start && !end) return null;
    const startMs = parseYmd(start ?? end!);
    const endMs = parseYmd(end ?? start!);
    const left = ((startMs - rangeStart) / span) * 100;
    const width = Math.max(1.2, ((endMs - startMs) / span) * 100);
    return {
      left: `${clamp(left, 0, 100)}%`,
      width: `${clamp(width, 1.2, 100 - clamp(left, 0, 100))}%`,
    };
  }

  function markerStyle(date: string) {
    const left = ((parseYmd(date) - rangeStart) / span) * 100;
    return { left: `${clamp(left, 0, 100)}%` };
  }

  const scheduledEpics = epics.filter((epic) => epic.startDate || epic.endDate);
  const unscheduledEpics = epics.filter(
    (epic) => !epic.startDate && !epic.endDate,
  );
  const unscheduledStories = stories.filter(
    (story) => !story.startDate && !story.endDate,
  );
  const unscheduledMilestones = milestones.filter(
    (milestone) => !milestone.startDate && !milestone.targetDate,
  );
  const taskMarkers = tasks.filter((task) => task.dueDate);

  const above = scheduledEpics.filter((_, index) => index % 2 === 0);
  const below = scheduledEpics.filter((_, index) => index % 2 === 1);

  function epicLane(epic: Epic, side: 'above' | 'below') {
    const style = barStyle(epic.startDate, epic.endDate);
    if (!style) return null;
    const epicStories = stories.filter(
      (story) =>
        story.epicId === epic.id && (story.startDate || story.endDate),
    );
    return (
      <div
        key={epic.id}
        className={cn('relative mb-4 min-h-12', side === 'below' && 'mt-4')}
      >
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="border-0 bg-transparent p-0 text-left text-sm font-semibold text-ink underline-offset-2 hover:underline"
            onClick={() => onManageEpic(epic.id)}
          >
            {epic.title}
          </button>
          <Badge>{t(`milestoneStatus.${epic.status}`)}</Badge>
        </div>
        <div className="relative h-8">
          <button
            type="button"
            className={cn(
              'absolute top-1 h-6 rounded-md border border-brand/40 bg-brand/20 px-2 text-left text-xs font-medium text-ink',
              'hover:bg-brand/30',
            )}
            style={style}
            title={`${epic.startDate ?? '…'} → ${epic.endDate ?? '…'}`}
            onClick={() => onManageEpic(epic.id)}
          >
            <span className="block truncate">{epic.title}</span>
          </button>
          {epicStories.map((story) => {
            const storyStyle = barStyle(story.startDate, story.endDate);
            if (!storyStyle) return null;
            return (
              <button
                key={story.id}
                type="button"
                className={cn(
                  'absolute top-9 h-5 rounded border border-line bg-panel-solid px-1.5 text-left text-[11px] text-ink',
                  'hover:border-brand/50',
                )}
                style={storyStyle}
                title={story.title}
                onClick={() => onManageStory(story.id)}
              >
                <span className="block truncate">{story.title}</span>
              </button>
            );
          })}
        </div>
        {epicStories.length > 0 ? <div className="h-6" /> : null}
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <p className="m-0 text-sm text-ink-muted">{t('timelineHint')}</p>

      <div className="overflow-x-auto rounded-md border border-line bg-panel-solid p-3">
        <div className="min-w-[48rem]">
          <div className="relative mb-2 h-6">
            {ticks.map((tick) => (
              <div
                key={tick}
                className="absolute top-0 -translate-x-1/2 text-[11px] text-ink-muted"
                style={markerStyle(tick)}
              >
                {tick}
              </div>
            ))}
          </div>

          <div className="relative">
            {above.map((epic) => epicLane(epic, 'above'))}

            <div className="relative my-2 h-10">
              <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-line" />
              {projectStartDate ? (
                <div
                  className="absolute top-0 h-full w-px bg-brand/50"
                  style={markerStyle(projectStartDate)}
                  title={t('timelineProjectStart')}
                />
              ) : null}
              {projectEndDate ? (
                <div
                  className="absolute top-0 h-full w-px bg-brand/50"
                  style={markerStyle(projectEndDate)}
                  title={t('timelineProjectEnd')}
                />
              ) : null}
              {milestones
                .filter((milestone) => milestone.targetDate)
                .map((milestone) => (
                  <button
                    key={milestone.id}
                    type="button"
                    className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rotate-45 border border-warn bg-warn/80"
                    style={markerStyle(milestone.targetDate!)}
                    title={`${milestone.title} (${milestone.targetDate})`}
                    aria-label={milestone.title}
                    onClick={() => onManageMilestone(milestone.id)}
                  />
                ))}
              {taskMarkers.map((task) => (
                <button
                  key={task.id}
                  type="button"
                  className="absolute top-[calc(50%+10px)] size-2 -translate-x-1/2 rounded-full bg-ink-muted"
                  style={markerStyle(task.dueDate!)}
                  title={`${task.title} (${task.dueDate})`}
                  aria-label={task.title}
                  onClick={() => onManageTask(task.id)}
                />
              ))}
            </div>

            {below.map((epic) => epicLane(epic, 'below'))}

            {scheduledEpics.length === 0 ? (
              <p className="m-0 py-4 text-center text-sm text-ink-muted">
                {t('timelineNoBars')}
              </p>
            ) : null}
          </div>
        </div>
      </div>

      {unscheduledEpics.length > 0 ||
      unscheduledStories.length > 0 ||
      unscheduledMilestones.length > 0 ? (
        <div className="rounded-md border border-line p-3">
          <p className="mt-0 mb-2 text-sm font-semibold">
            {t('timelineUnscheduled')}
          </p>
          <ul className="m-0 grid list-none gap-2 p-0">
            {unscheduledEpics.map((epic) => (
              <li
                key={epic.id}
                className="flex flex-wrap items-center justify-between gap-2"
              >
                <span className="text-sm">
                  <Badge tone="brand">{t('kindEpic')}</Badge> {epic.title}
                </span>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => onManageEpic(epic.id)}
                >
                  {t('manage')}
                </Button>
              </li>
            ))}
            {unscheduledStories.map((story) => (
              <li
                key={story.id}
                className="flex flex-wrap items-center justify-between gap-2"
              >
                <span className="text-sm">
                  <Badge tone="brand">{t('kindStory')}</Badge> {story.title}
                </span>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => onManageStory(story.id)}
                >
                  {t('manage')}
                </Button>
              </li>
            ))}
            {unscheduledMilestones.map((milestone) => (
              <li
                key={milestone.id}
                className="flex flex-wrap items-center justify-between gap-2"
              >
                <span className="text-sm">
                  <Badge tone="brand">{t('kindMilestone')}</Badge>{' '}
                  {milestone.title}
                </span>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => onManageMilestone(milestone.id)}
                >
                  {t('manage')}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
