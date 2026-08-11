'use client';

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
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

type AxisMarker = {
  id: string;
  kind: 'milestone' | 'task';
  title: string;
  date: string;
  onOpen: () => void;
};

type TagOffset = { dx: number; dy: number };

const DEFAULT_RIB_Y = 52;
const DRAG_CLICK_THRESHOLD = 4;

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

function readOffsets(storageKey: string): Record<string, TagOffset> {
  try {
    const raw = window.sessionStorage.getItem(storageKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, TagOffset>;
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed;
  } catch {
    return {};
  }
}

function writeOffsets(
  storageKey: string,
  offsets: Record<string, TagOffset>,
): void {
  try {
    window.sessionStorage.setItem(storageKey, JSON.stringify(offsets));
  } catch {
    /* ignore */
  }
}

function useTagOffsets(storageKey: string) {
  const [offsets, setOffsets] = useState<Record<string, TagOffset>>({});

  useEffect(() => {
    setOffsets(readOffsets(storageKey));
  }, [storageKey]);

  const updateOffset = useCallback(
    (id: string, next: TagOffset) => {
      setOffsets((current) => {
        const merged = { ...current, [id]: next };
        writeOffsets(storageKey, merged);
        return merged;
      });
    },
    [storageKey],
  );

  const resetOffsets = useCallback(() => {
    setOffsets({});
    writeOffsets(storageKey, {});
  }, [storageKey]);

  return { offsets, updateOffset, resetOffsets };
}

function TimelineHintHelp({
  onResetPositions,
  canReset,
}: {
  onResetPositions: () => void;
  canReset: boolean;
}) {
  const t = useTranslations('delivery');
  const panelId = useId();
  const [open, setOpen] = useState(false);

  return (
    <div className="flex flex-wrap items-start gap-2">
      <button
        type="button"
        className="inline-flex size-6 shrink-0 items-center justify-center rounded-full border border-line text-xs font-semibold text-ink-muted hover:bg-brand-soft hover:text-ink"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={t('timelineLegendHelp')}
        title={t('timelineLegendHelp')}
        onClick={() => setOpen((current) => !current)}
      >
        ?
      </button>
      {open ? (
        <div
          id={panelId}
          role="note"
          className="grid max-w-xl gap-2 rounded-md border border-line bg-panel-solid px-2.5 py-2 text-xs text-ink-muted"
        >
          <p className="m-0">{t('timelineHint')}</p>
          <p className="m-0">{t('timelineDragHint')}</p>
          <ul className="m-0 flex list-none flex-wrap items-center gap-3 p-0">
            <li className="inline-flex items-center gap-1.5">
              <span
                className="size-2.5 rotate-45 border border-warn bg-warn/80"
                aria-hidden
              />
              <span>{t('kindMilestone')}</span>
            </li>
            <li className="inline-flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-ink-muted" aria-hidden />
              <span>{t('kindTask')}</span>
            </li>
          </ul>
          {canReset ? (
            <div>
              <Button
                type="button"
                variant="secondary"
                onClick={onResetPositions}
              >
                {t('timelineResetTags')}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function DraggableTag({
  tagId,
  offset,
  onOffsetChange,
  onOpen,
  className,
  style,
  title,
  children,
}: {
  tagId: string;
  offset: TagOffset;
  onOffsetChange: (id: string, offset: TagOffset) => void;
  onOpen: () => void;
  className?: string;
  style?: React.CSSProperties;
  title?: string;
  children: ReactNode;
}) {
  const t = useTranslations('delivery');
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    origin: TagOffset;
    moved: boolean;
  } | null>(null);

  function onPointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      origin: offset,
      moved: false,
    };
  }

  function onPointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = drag.origin.dx + (event.clientX - drag.startX);
    const dy = drag.origin.dy + (event.clientY - drag.startY);
    if (
      !drag.moved &&
      Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) >=
        DRAG_CLICK_THRESHOLD
    ) {
      drag.moved = true;
    }
    if (drag.moved) {
      onOffsetChange(tagId, { dx, dy });
    }
  }

  function onPointerUp(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      /* ignore */
    }
    const wasClick = !drag.moved;
    dragRef.current = null;
    if (wasClick) onOpen();
  }

  return (
    <button
      type="button"
      className={cn(
        'cursor-grab touch-none active:cursor-grabbing',
        className,
      )}
      style={style}
      title={title ?? t('timelineDragHint')}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {children}
    </button>
  );
}

export function ProjectDeliveryTimeline({
  projectId,
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
  projectId: string;
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
  const storageKey = `kh-timeline-tags:${projectId}`;
  const { offsets, updateOffset, resetOffsets } = useTagOffsets(storageKey);

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

  function markerLeftPct(date: string): number {
    return clamp(((parseYmd(date) - rangeStart) / span) * 100, 0, 100);
  }

  function markerStyle(date: string) {
    return { left: `${markerLeftPct(date)}%` };
  }

  const axisMarkers = useMemo(() => {
    const items: AxisMarker[] = [];
    for (const milestone of milestones) {
      if (!milestone.targetDate) continue;
      items.push({
        id: `milestone:${milestone.id}`,
        kind: 'milestone',
        title: milestone.title,
        date: milestone.targetDate,
        onOpen: () => onManageMilestone(milestone.id),
      });
    }
    for (const task of tasks) {
      if (!task.dueDate) continue;
      items.push({
        id: `task:${task.id}`,
        kind: 'task',
        title: task.title,
        date: task.dueDate,
        onOpen: () => onManageTask(task.id),
      });
    }
    items.sort(
      (a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title),
    );
    return items;
  }, [milestones, tasks, onManageMilestone, onManageTask]);

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

  const above = scheduledEpics.filter((_, index) => index % 2 === 0);
  const below = scheduledEpics.filter((_, index) => index % 2 === 1);
  const hasCustomOffsets = Object.keys(offsets).length > 0;

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
            const tagId = `story:${story.id}`;
            const offset = offsets[tagId] ?? { dx: 0, dy: 0 };
            const midDate = formatYmd(
              (parseYmd(story.startDate ?? story.endDate!) +
                parseYmd(story.endDate ?? story.startDate!)) /
                2,
            );
            const midLeft = markerLeftPct(midDate);
            const barLeft = Number.parseFloat(storyStyle.left);
            const barWidth = Number.parseFloat(storyStyle.width);
            const anchorLeft = clamp(midLeft, barLeft, barLeft + barWidth);
            const ribX = offset.dx;
            const ribY = 36 + offset.dy;
            const ribLen = Math.max(1, Math.hypot(ribX, ribY));
            const ribAngle = (Math.atan2(ribY, ribX) * 180) / Math.PI;

            return (
              <div
                key={story.id}
                className="absolute top-0 h-full"
                style={{ left: `${anchorLeft}%` }}
              >
                <div
                  className="pointer-events-none absolute left-0 top-1 h-px origin-left bg-line-strong/70"
                  style={{
                    width: ribLen,
                    transform: `rotate(${ribAngle}deg)`,
                  }}
                  aria-hidden
                />
                <DraggableTag
                  tagId={tagId}
                  offset={offset}
                  onOffsetChange={updateOffset}
                  onOpen={() => onManageStory(story.id)}
                  className={cn(
                    'absolute left-0 top-1 z-[1] h-5 max-w-[14rem] rounded border border-line bg-panel-solid px-1.5 text-left text-[11px] text-ink shadow-sm',
                    'hover:border-brand/50',
                  )}
                  style={{
                    transform: `translate(calc(-50% + ${offset.dx}px), ${36 + offset.dy}px)`,
                  }}
                  title={story.title}
                >
                  <span className="block truncate">{story.title}</span>
                </DraggableTag>
              </div>
            );
          })}
        </div>
        {epicStories.length > 0 ? <div className="h-6" /> : null}
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <TimelineHintHelp
        onResetPositions={resetOffsets}
        canReset={hasCustomOffsets}
      />

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

            <div className="relative my-2 h-52 overflow-visible">
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

              {axisMarkers.map((marker, index) => {
                const aboveSpine = index % 2 === 0;
                const kindLabel =
                  marker.kind === 'milestone'
                    ? t('kindMilestone')
                    : t('kindTask');
                const offset = offsets[marker.id] ?? { dx: 0, dy: 0 };
                const baseY = aboveSpine ? -DEFAULT_RIB_Y : DEFAULT_RIB_Y;
                const ribX = offset.dx;
                const ribY = baseY + offset.dy;
                const ribLen = Math.max(1, Math.hypot(ribX, ribY));
                const ribAngle = (Math.atan2(ribY, ribX) * 180) / Math.PI;

                return (
                  <div
                    key={marker.id}
                    className="absolute top-1/2 z-[1] -translate-x-1/2 -translate-y-1/2"
                    style={markerStyle(marker.date)}
                  >
                    <div
                      className="pointer-events-none absolute left-1/2 top-1/2 h-px origin-left bg-line-strong"
                      style={{
                        width: ribLen,
                        transform: `rotate(${ribAngle}deg)`,
                      }}
                      aria-hidden
                    />
                    <DraggableTag
                      tagId={marker.id}
                      offset={offset}
                      onOffsetChange={updateOffset}
                      onOpen={marker.onOpen}
                      className={cn(
                        'absolute left-1/2 top-1/2 z-[2] w-max max-w-[11rem] rounded border border-line bg-panel-solid px-1.5 py-0.5 text-left text-[10px] leading-snug text-ink shadow-sm',
                        'hover:border-brand/50',
                      )}
                      style={{
                        transform: `translate(calc(-50% + ${offset.dx}px), calc(-50% + ${baseY + offset.dy}px))`,
                      }}
                      title={`${kindLabel}: ${marker.title} (${marker.date})`}
                    >
                      <span className="mb-0.5 block text-[9px] font-semibold uppercase tracking-wide text-ink-muted">
                        {kindLabel}
                      </span>
                      <span className="block truncate">{marker.title}</span>
                    </DraggableTag>
                    <button
                      type="button"
                      className={cn(
                        'absolute left-1/2 top-1/2 z-[3] -translate-x-1/2 -translate-y-1/2',
                        marker.kind === 'milestone'
                          ? 'size-3 rotate-45 border border-warn bg-warn/80'
                          : 'size-2.5 rounded-full bg-ink-muted',
                      )}
                      title={`${kindLabel}: ${marker.title} (${marker.date})`}
                      aria-label={`${kindLabel}: ${marker.title}`}
                      onClick={marker.onOpen}
                    />
                  </div>
                );
              })}
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
