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
  type RefObject,
} from 'react';
import { useTranslations } from 'next-intl';
import { Badge, Button, Field, Input, useToast } from './ui';
import { cn } from '../lib/cn';
import { downloadAuthenticatedExport } from '../lib/download-export';
import {
  deliveryScheduleSurfaceClass,
  deliveryScheduleTone,
  todayYmd,
  type DeliveryScheduleTone,
} from '../lib/delivery-schedule';

type Epic = {
  id: string;
  title: string;
  status: string;
  startDate: string | null;
  endDate: string | null;
  humanKey?: string | null;
};

type Story = {
  id: string;
  epicId: string;
  title: string;
  status: string;
  startDate: string | null;
  endDate: string | null;
  humanKey?: string | null;
};

type Milestone = {
  id: string;
  title: string;
  status: string;
  startDate: string | null;
  targetDate: string | null;
  humanKey?: string | null;
};

type Task = {
  id: string;
  title: string;
  status: string;
  dueDate: string | null;
  humanKey?: string | null;
};

type AxisMarker = {
  id: string;
  kind: 'milestone' | 'task';
  title: string;
  date: string;
  status: string;
  humanKey?: string | null;
  onOpen: () => void;
};

type TagOffset = { dx: number; dy: number };

function ItemMetaRow({
  issueId,
  date,
  showIssueIds,
  showDueDates,
  className,
}: {
  issueId?: string | null;
  date?: string | null;
  showIssueIds: boolean;
  showDueDates: boolean;
  className?: string;
}) {
  const id = showIssueIds && issueId ? issueId : null;
  const due = showDueDates && date ? date : null;
  if (!id && !due) return null;
  if (id && due) {
    return (
      <span
        className={cn(
          'flex w-full min-w-0 items-center justify-between gap-1',
          className,
        )}
      >
        <span className="min-w-0 truncate">{id}</span>
        <span className="shrink-0 tabular-nums">{due}</span>
      </span>
    );
  }
  return (
    <span className={cn('block truncate', className)}>{id ?? due}</span>
  );
}

type TimelineFilters = {
  epics: boolean;
  stories: boolean;
  milestones: boolean;
  tasks: boolean;
};

type TimelineWindow = {
  from: string;
  to: string;
};

const DEFAULT_RIB_Y = 96;
const DRAG_CLICK_THRESHOLD = 4;
const DEFAULT_FILTERS: TimelineFilters = {
  epics: true,
  stories: true,
  milestones: true,
  tasks: true,
};

function readFilters(storageKey: string): TimelineFilters {
  try {
    const raw = window.sessionStorage.getItem(storageKey);
    if (!raw) return DEFAULT_FILTERS;
    const parsed = JSON.parse(raw) as Partial<TimelineFilters>;
    return {
      epics: parsed.epics ?? true,
      stories: parsed.stories ?? true,
      milestones: parsed.milestones ?? true,
      tasks: parsed.tasks ?? true,
    };
  } catch {
    return DEFAULT_FILTERS;
  }
}

function writeFilters(storageKey: string, filters: TimelineFilters): void {
  try {
    window.sessionStorage.setItem(storageKey, JSON.stringify(filters));
  } catch {
    /* ignore */
  }
}

function readWindow(storageKey: string): TimelineWindow {
  try {
    const raw = window.sessionStorage.getItem(storageKey);
    if (!raw) return { from: '', to: '' };
    const parsed = JSON.parse(raw) as Partial<TimelineWindow>;
    return {
      from: typeof parsed.from === 'string' ? parsed.from : '',
      to: typeof parsed.to === 'string' ? parsed.to : '',
    };
  } catch {
    return { from: '', to: '' };
  }
}

function writeWindow(storageKey: string, windowRange: TimelineWindow): void {
  try {
    window.sessionStorage.setItem(storageKey, JSON.stringify(windowRange));
  } catch {
    /* ignore */
  }
}

function readGrid(storageKey: string): boolean {
  try {
    const raw = window.sessionStorage.getItem(storageKey);
    if (raw === null) return true;
    return raw === '1';
  } catch {
    return true;
  }
}

function writeGrid(storageKey: string, enabled: boolean): void {
  try {
    window.sessionStorage.setItem(storageKey, enabled ? '1' : '0');
  } catch {
    /* ignore */
  }
}

function readStatusColors(storageKey: string): boolean {
  try {
    const raw = window.sessionStorage.getItem(storageKey);
    if (raw === null) return false;
    return raw === '1';
  } catch {
    return false;
  }
}

function writeStatusColors(storageKey: string, enabled: boolean): void {
  try {
    window.sessionStorage.setItem(storageKey, enabled ? '1' : '0');
  } catch {
    /* ignore */
  }
}

function readDueDates(storageKey: string): boolean {
  try {
    const raw = window.sessionStorage.getItem(storageKey);
    if (raw === null) return false;
    return raw === '1';
  } catch {
    return false;
  }
}

function writeDueDates(storageKey: string, enabled: boolean): void {
  try {
    window.sessionStorage.setItem(storageKey, enabled ? '1' : '0');
  } catch {
    /* ignore */
  }
}

function readIssueIds(storageKey: string): boolean {
  try {
    const raw = window.sessionStorage.getItem(storageKey);
    if (raw === null) return true;
    return raw === '1';
  } catch {
    return true;
  }
}

function writeIssueIds(storageKey: string, enabled: boolean): void {
  try {
    window.sessionStorage.setItem(storageKey, enabled ? '1' : '0');
  } catch {
    /* ignore */
  }
}

function scheduleMarkerDotClass(
  tone: DeliveryScheduleTone,
  kind: 'milestone' | 'task',
): string {
  const fill =
    tone === 'completed'
      ? 'border-brand bg-brand'
      : tone === 'overdue'
        ? 'border-danger bg-danger'
        : tone === 'atRisk'
          ? 'border-warn bg-warn'
          : tone === 'onTrack'
            ? 'border-accent bg-accent'
            : 'border-line bg-ink-muted';
  return kind === 'milestone'
    ? cn('size-3 rotate-45 border', fill)
    : cn('size-2.5 rounded-full border', fill);
}

const ZOOM_FACTOR = 0.7;
const MIN_ZOOM_SPAN_MS = 3 * 86_400_000;

function buildTimelineTicks(
  startMs: number,
  endMs: number,
): { labelTicks: string[]; gridTicks: string[] } {
  const spanDays = Math.max(1, Math.round((endMs - startMs) / 86_400_000));

  let gridStepDays: number;
  if (spanDays <= 16) gridStepDays = 1;
  else if (spanDays <= 45) gridStepDays = 2;
  else if (spanDays <= 90) gridStepDays = 7;
  else if (spanDays <= 180) gridStepDays = 14;
  else gridStepDays = Math.max(14, Math.ceil(spanDays / 10));

  const gridTicks: string[] = [];
  for (
    let ms = startMs;
    ms <= endMs && gridTicks.length < 62;
    ms = addDays(ms, gridStepDays)
  ) {
    gridTicks.push(formatYmd(ms));
  }
  const endLabel = formatYmd(endMs);
  if (gridTicks[gridTicks.length - 1] !== endLabel) {
    gridTicks.push(endLabel);
  }

  const targetLabels = Math.min(12, Math.max(4, gridTicks.length));
  const labelStride = Math.max(1, Math.ceil(gridTicks.length / targetLabels));
  const labelTicks = gridTicks.filter(
    (_, index) =>
      index === 0 ||
      index === gridTicks.length - 1 ||
      index % labelStride === 0,
  );

  return { labelTicks, gridTicks };
}

function ZoomInIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      className="size-4 shrink-0"
      fill="none"
    >
      <circle
        cx="11"
        cy="11"
        r="6.25"
        stroke="currentColor"
        strokeWidth="1.75"
      />
      <path
        d="M15.5 15.5 20 20M11 8.25v5.5M8.25 11h5.5"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ZoomOutIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      className="size-4 shrink-0"
      fill="none"
    >
      <circle
        cx="11"
        cy="11"
        r="6.25"
        stroke="currentColor"
        strokeWidth="1.75"
      />
      <path
        d="M15.5 15.5 20 20M8.25 11h5.5"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
}

function GridIcon({ active }: { active: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      className="size-4 shrink-0"
      fill="none"
    >
      <rect
        x="4"
        y="4"
        width="16"
        height="16"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.75"
      />
      <path
        d="M4 9.5h16M4 14.5h16M9.5 4v16M14.5 4v16"
        stroke="currentColor"
        strokeWidth="1.75"
        opacity={active ? 1 : 0.45}
      />
    </svg>
  );
}

function ResetViewIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      className="size-4 shrink-0"
      fill="none"
    >
      <path
        d="M4.5 9V4.5H9M15 4.5h4.5V9M19.5 15v4.5H15M9 19.5H4.5V15"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect
        x="8"
        y="8"
        width="8"
        height="8"
        rx="1"
        stroke="currentColor"
        strokeWidth="1.75"
      />
    </svg>
  );
}

/** Inclusive overlap of [start,end] with [winStart, winEnd] in ms. */
function rangeOverlaps(
  startMs: number,
  endMs: number,
  winStart: number,
  winEnd: number,
): boolean {
  return startMs <= winEnd && endMs >= winStart;
}

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
    <div className="relative">
      <button
        type="button"
        className="kh-ops-help-btn"
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
          className="kh-ops-popover max-w-xl"
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

export type TimelineExportHandle = {
  exportPdf: () => void;
};

export function ProjectDeliveryTimeline({
  projectId,
  projectName,
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
  exportHandleRef,
  onExportStateChange,
}: {
  projectId: string;
  projectName: string;
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
  exportHandleRef?: RefObject<TimelineExportHandle | null>;
  onExportStateChange?: (
    state: { pending: boolean; canExport: boolean } | null,
  ) => void;
}) {
  const t = useTranslations('delivery');
  const tProjects = useTranslations('projects');
  const { pushToast } = useToast();
  const storageKey = `kh-timeline-tags:${projectId}`;
  const filterKey = `kh-timeline-filters:${projectId}`;
  const windowKey = `kh-timeline-window:${projectId}`;
  const gridKey = `kh-timeline-grid:${projectId}`;
  const statusColorKey = `kh-timeline-status-colors:${projectId}`;
  const dueDatesKey = `kh-timeline-due-dates:${projectId}`;
  const issueIdsKey = `kh-timeline-issue-ids:${projectId}`;
  const { offsets, updateOffset, resetOffsets } = useTagOffsets(storageKey);
  const [filters, setFilters] = useState<TimelineFilters>(DEFAULT_FILTERS);
  const [windowRange, setWindowRange] = useState<TimelineWindow>({
    from: '',
    to: '',
  });
  const [showGrid, setShowGrid] = useState(true);
  const [colorByStatus, setColorByStatus] = useState(false);
  const [showDueDates, setShowDueDates] = useState(false);
  const [showIssueIds, setShowIssueIds] = useState(true);
  const [exportPending, setExportPending] = useState(false);
  const todayDate = todayYmd();

  useEffect(() => {
    setFilters(readFilters(filterKey));
    setWindowRange(readWindow(windowKey));
    setShowGrid(readGrid(gridKey));
    setColorByStatus(readStatusColors(statusColorKey));
    setShowDueDates(readDueDates(dueDatesKey));
    setShowIssueIds(readIssueIds(issueIdsKey));
  }, [filterKey, windowKey, gridKey, statusColorKey, dueDatesKey, issueIdsKey]);

  function toggleFilter(key: keyof TimelineFilters) {
    setFilters((current) => {
      const next = { ...current, [key]: !current[key] };
      writeFilters(filterKey, next);
      return next;
    });
  }

  function toggleStatusColors() {
    setColorByStatus((current) => {
      const next = !current;
      writeStatusColors(statusColorKey, next);
      return next;
    });
  }

  function toggleDueDates() {
    setShowDueDates((current) => {
      const next = !current;
      writeDueDates(dueDatesKey, next);
      return next;
    });
  }

  function toggleIssueIds() {
    setShowIssueIds((current) => {
      const next = !current;
      writeIssueIds(issueIdsKey, next);
      return next;
    });
  }

  function setWindowField(field: keyof TimelineWindow, value: string) {
    setWindowRange((current) => {
      const next = { ...current, [field]: value };
      writeWindow(windowKey, next);
      return next;
    });
  }

  function clearWindow() {
    const next = { from: '', to: '' };
    setWindowRange(next);
    writeWindow(windowKey, next);
  }

  function applyPreset(kind: 'month' | 'next30' | 'project') {
    const today = Date.UTC(
      new Date().getUTCFullYear(),
      new Date().getUTCMonth(),
      new Date().getUTCDate(),
    );
    let next: TimelineWindow;
    if (kind === 'month') {
      const start = Date.UTC(
        new Date().getUTCFullYear(),
        new Date().getUTCMonth(),
        1,
      );
      const end = Date.UTC(
        new Date().getUTCFullYear(),
        new Date().getUTCMonth() + 1,
        0,
      );
      next = { from: formatYmd(start), to: formatYmd(end) };
    } else if (kind === 'next30') {
      next = { from: formatYmd(today), to: formatYmd(addDays(today, 30)) };
    } else {
      next = {
        from: projectStartDate ?? '',
        to: projectEndDate ?? '',
      };
    }
    setWindowRange(next);
    writeWindow(windowKey, next);
  }

  function toggleGrid() {
    setShowGrid((current) => {
      const next = !current;
      writeGrid(gridKey, next);
      return next;
    });
  }

  function zoomWindow(direction: 'in' | 'out') {
    if (windowInvalid) return;
    const factor = direction === 'in' ? ZOOM_FACTOR : 1 / ZOOM_FACTOR;
    const center = (rangeStart + rangeEnd) / 2;
    const currentSpan = Math.max(MIN_ZOOM_SPAN_MS, rangeEnd - rangeStart);
    const autoSpan = Math.max(
      MIN_ZOOM_SPAN_MS,
      autoRange.endMs - autoRange.startMs,
    );
    const maxSpan = Math.max(autoSpan * 4, currentSpan);
    const nextSpan = clamp(currentSpan * factor, MIN_ZOOM_SPAN_MS, maxSpan);
    let nextStart = center - nextSpan / 2;
    let nextEnd = center + nextSpan / 2;
    nextStart = parseYmd(formatYmd(nextStart));
    nextEnd = parseYmd(formatYmd(nextEnd));
    if (nextEnd - nextStart < MIN_ZOOM_SPAN_MS) {
      nextEnd = addDays(nextStart, 3);
    }
    const next = { from: formatYmd(nextStart), to: formatYmd(nextEnd) };
    setWindowRange(next);
    writeWindow(windowKey, next);
  }

  const autoRange = useMemo(() => {
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

    if (candidates.length === 0) {
      const today = Date.UTC(
        new Date().getUTCFullYear(),
        new Date().getUTCMonth(),
        new Date().getUTCDate(),
      );
      return { startMs: addDays(today, -14), endMs: addDays(today, 60) };
    }
    const values = candidates.map(parseYmd);
    const startMs = Math.min(...values);
    let endMs = Math.max(...values);
    if (endMs <= startMs) endMs = addDays(startMs, 30);
    return { startMs, endMs };
  }, [projectStartDate, projectEndDate, epics, stories, milestones, tasks]);

  const {
    rangeStart,
    rangeEnd,
    labelTicks,
    gridTicks,
    windowActive,
    windowInvalid,
  } = useMemo(() => {
    const fromOk = Boolean(windowRange.from);
    const toOk = Boolean(windowRange.to);
    let startMs = autoRange.startMs;
    let endMs = autoRange.endMs;
    let active = false;
    let invalid = false;

    if (fromOk || toOk) {
      const fromMs = fromOk ? parseYmd(windowRange.from) : autoRange.startMs;
      const toMs = toOk ? parseYmd(windowRange.to) : autoRange.endMs;
      if (fromMs > toMs) {
        invalid = true;
      } else {
        startMs = fromMs;
        endMs = toMs;
        active = true;
        if (endMs <= startMs) endMs = addDays(startMs, 1);
      }
    }

    const { labelTicks: nextLabels, gridTicks: nextGrid } = buildTimelineTicks(
      startMs,
      endMs,
    );

    return {
      rangeStart: startMs,
      rangeEnd: endMs,
      labelTicks: nextLabels,
      gridTicks: nextGrid,
      windowActive: active,
      windowInvalid: invalid,
    };
  }, [autoRange, windowRange.from, windowRange.to]);

  const span = Math.max(1, rangeEnd - rangeStart);
  const currentSpan = rangeEnd - rangeStart;
  const autoSpan = Math.max(
    MIN_ZOOM_SPAN_MS,
    autoRange.endMs - autoRange.startMs,
  );
  const maxZoomSpan = Math.max(autoSpan * 4, currentSpan);
  const canZoomIn =
    !windowInvalid && currentSpan > MIN_ZOOM_SPAN_MS + 86_400_000;
  const canZoomOut = !windowInvalid && currentSpan < maxZoomSpan - 86_400_000;
  const todayInRange =
    parseYmd(todayDate) >= rangeStart && parseYmd(todayDate) <= rangeEnd;

  function barStyle(start: string | null, end: string | null) {
    if (!start && !end) return null;
    const itemStart = parseYmd(start ?? end!);
    const itemEnd = parseYmd(end ?? start!);
    if (!rangeOverlaps(itemStart, itemEnd, rangeStart, rangeEnd)) return null;
    const clippedStart = Math.max(itemStart, rangeStart);
    const clippedEnd = Math.min(itemEnd, rangeEnd);
    const left = ((clippedStart - rangeStart) / span) * 100;
    const width = Math.max(
      1.2,
      ((Math.max(clippedStart, clippedEnd) - clippedStart) / span) * 100,
    );
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

  function dateInWindow(date: string): boolean {
    const ms = parseYmd(date);
    return ms >= rangeStart && ms <= rangeEnd;
  }

  const axisMarkers = useMemo(() => {
    const inWindow = (date: string) => {
      const ms = parseYmd(date);
      return ms >= rangeStart && ms <= rangeEnd;
    };
    const items: AxisMarker[] = [];
    if (filters.milestones) {
      for (const milestone of milestones) {
        if (!milestone.targetDate || !inWindow(milestone.targetDate)) {
          continue;
        }
        items.push({
          id: `milestone:${milestone.id}`,
          kind: 'milestone',
          title: milestone.title,
          date: milestone.targetDate,
          status: milestone.status,
          humanKey: milestone.humanKey ?? null,
          onOpen: () => onManageMilestone(milestone.id),
        });
      }
    }
    if (filters.tasks) {
      for (const task of tasks) {
        if (!task.dueDate || !inWindow(task.dueDate)) continue;
        items.push({
          id: `task:${task.id}`,
          kind: 'task',
          title: task.title,
          date: task.dueDate,
          status: task.status,
          humanKey: task.humanKey ?? null,
          onOpen: () => onManageTask(task.id),
        });
      }
    }
    items.sort(
      (a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title),
    );
    return items;
  }, [
    filters.milestones,
    filters.tasks,
    milestones,
    tasks,
    rangeStart,
    rangeEnd,
    onManageMilestone,
    onManageTask,
  ]);

  const scheduledEpics = filters.epics
    ? epics.filter((epic) => {
        if (!epic.startDate && !epic.endDate) return false;
        const start = parseYmd(epic.startDate ?? epic.endDate!);
        const end = parseYmd(epic.endDate ?? epic.startDate!);
        return rangeOverlaps(start, end, rangeStart, rangeEnd);
      })
    : [];
  const standaloneStories =
    filters.stories && !filters.epics
      ? stories.filter((story) => {
          if (!story.startDate && !story.endDate) return false;
          const start = parseYmd(story.startDate ?? story.endDate!);
          const end = parseYmd(story.endDate ?? story.startDate!);
          return rangeOverlaps(start, end, rangeStart, rangeEnd);
        })
      : [];
  const unscheduledEpics = filters.epics
    ? epics.filter((epic) => !epic.startDate && !epic.endDate)
    : [];
  const unscheduledStories = filters.stories
    ? stories.filter((story) => !story.startDate && !story.endDate)
    : [];
  const unscheduledMilestones = filters.milestones
    ? milestones.filter(
        (milestone) => !milestone.startDate && !milestone.targetDate,
      )
    : [];

  const above = scheduledEpics.filter((_, index) => index % 2 === 0);
  const below = scheduledEpics.filter((_, index) => index % 2 === 1);
  const hasCustomOffsets = Object.keys(offsets).length > 0;
  const anyTypeVisible =
    filters.epics || filters.stories || filters.milestones || filters.tasks;

  const exportTimelinePdf = useCallback(async () => {
    if (exportPending || !anyTypeVisible) return;
    setExportPending(true);
    try {
      const title = t('timelineExportTitle', { project: projectName });
      const slug = projectName.replace(/[^\w.-]+/g, '-').toLowerCase();
      await downloadAuthenticatedExport(
        `/api/v1/projects/${projectId}/timeline/export`,
        `${slug}-timeline.pdf`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: window.location.origin,
          },
          body: JSON.stringify({
            title,
            includeEpics: filters.epics,
            includeStories: filters.stories,
            includeMilestones: filters.milestones,
            includeTasks: filters.tasks,
            colorByStatus,
            showDueDates,
            showIssueIds,
            showGrid,
            today: todayDate,
            windowFrom: windowActive ? formatYmd(rangeStart) : null,
            windowTo: windowActive ? formatYmd(rangeEnd) : null,
            tagOffsets: offsets,
            labels: {
              epic: t('kindEpic'),
              story: t('kindStory'),
              milestone: t('kindMilestone'),
              task: t('kindTask'),
              generated: tProjects('reportGenerated'),
              empty: t('timelineExportEmpty'),
              today: t('timelineToday'),
              scheduleOnTrack: t('scheduleTone.onTrack'),
              scheduleAtRisk: t('scheduleTone.atRisk'),
              scheduleOverdue: t('scheduleTone.overdue'),
              scheduleCompleted: t('scheduleTone.completed'),
              scheduleNeutral: t('scheduleTone.neutral'),
            },
          }),
        },
      );
      pushToast(t('timelineExported'));
    } catch (err) {
      pushToast(
        err instanceof Error ? err.message : t('timelineExportFailed'),
        'danger',
      );
    } finally {
      setExportPending(false);
    }
  }, [
    anyTypeVisible,
    colorByStatus,
    exportPending,
    filters.epics,
    filters.milestones,
    filters.stories,
    filters.tasks,
    offsets,
    projectId,
    projectName,
    pushToast,
    rangeEnd,
    rangeStart,
    showDueDates,
    showIssueIds,
    showGrid,
    t,
    tProjects,
    todayDate,
    windowActive,
  ]);

  useEffect(() => {
    if (exportHandleRef) {
      exportHandleRef.current = {
        exportPdf: () => {
          void exportTimelinePdf();
        },
      };
    }
    onExportStateChange?.({
      pending: exportPending,
      canExport: anyTypeVisible,
    });
    return () => {
      if (exportHandleRef) exportHandleRef.current = null;
      onExportStateChange?.(null);
    };
  }, [
    anyTypeVisible,
    exportHandleRef,
    exportPending,
    exportTimelinePdf,
    onExportStateChange,
  ]);

  function epicLane(epic: Epic, side: 'above' | 'below') {
    const style = barStyle(epic.startDate, epic.endDate);
    if (!style) return null;
    const epicStories = filters.stories
      ? stories.filter((story) => {
          if (story.epicId !== epic.id) return false;
          if (!story.startDate && !story.endDate) return false;
          const start = parseYmd(story.startDate ?? story.endDate!);
          const end = parseYmd(story.endDate ?? story.startDate!);
          return rangeOverlaps(start, end, rangeStart, rangeEnd);
        })
      : [];
    const epicTone = colorByStatus
      ? deliveryScheduleTone({
          status: epic.status,
          date: epic.endDate ?? epic.startDate,
          today: todayDate,
        })
      : null;
    const epicHasMeta =
      (showIssueIds && Boolean(epic.humanKey)) ||
      (showDueDates && Boolean(epic.endDate));
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
        <div className={cn('relative', epicHasMeta ? 'h-10' : 'h-8')}>
          <button
            type="button"
            className={cn(
              'kh-ops-time-bar absolute top-1 text-left',
              epicHasMeta ? 'h-8 py-0.5 leading-tight' : 'h-6',
            )}
            data-tone={epicTone ?? undefined}
            style={style}
            title={`${epic.startDate ?? '…'} → ${epic.endDate ?? '…'}`}
            onClick={() => onManageEpic(epic.id)}
          >
            <span className="block truncate">{epic.title}</span>
            <ItemMetaRow
              issueId={epic.humanKey}
              date={epic.endDate}
              showIssueIds={showIssueIds}
              showDueDates={showDueDates}
              className="text-[10px] font-normal opacity-80"
            />
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
            const storyTone = colorByStatus
              ? deliveryScheduleTone({
                  status: story.status,
                  date: story.endDate ?? story.startDate,
                  today: todayDate,
                })
              : null;
            const storyDue = story.endDate ?? story.startDate;
            const storyHasMeta =
              (showIssueIds && Boolean(story.humanKey)) ||
              (showDueDates && Boolean(storyDue));

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
                    'absolute left-0 top-1 z-[1] max-w-[14rem] rounded border px-1.5 text-left text-[11px] shadow-sm',
                    storyHasMeta ? 'h-auto min-h-5 py-0.5' : 'h-5',
                    storyTone
                      ? deliveryScheduleSurfaceClass(storyTone)
                      : 'border-line bg-panel-solid text-ink hover:border-brand/50',
                  )}
                  style={{
                    transform: `translate(calc(-50% + ${offset.dx}px), ${36 + offset.dy}px)`,
                  }}
                  title={
                    colorByStatus
                      ? `${story.title} · ${t(`milestoneStatus.${story.status}`)}${storyDue ? ` (${storyDue})` : ''}`
                      : storyDue
                        ? `${story.title} (${storyDue})`
                        : story.title
                  }
                >
                  <span className="block truncate">{story.title}</span>
                  <ItemMetaRow
                    issueId={story.humanKey}
                    date={storyDue}
                    showIssueIds={showIssueIds}
                    showDueDates={showDueDates}
                    className="text-[9px] opacity-80"
                  />
                </DraggableTag>
              </div>
            );
          })}
        </div>
        {epicStories.length > 0 ? <div className="h-6" /> : null}
      </div>
    );
  }

  function storyLane(story: Story) {
    const style = barStyle(story.startDate, story.endDate);
    if (!style) return null;
    const storyTone = colorByStatus
      ? deliveryScheduleTone({
          status: story.status,
          date: story.endDate ?? story.startDate,
          today: todayDate,
        })
      : null;
    const storyDue = story.endDate ?? story.startDate;
    const storyHasMeta =
      (showIssueIds && Boolean(story.humanKey)) ||
      (showDueDates && Boolean(storyDue));
    return (
      <div key={story.id} className="relative mb-4 min-h-12">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="border-0 bg-transparent p-0 text-left text-sm font-semibold text-ink underline-offset-2 hover:underline"
            onClick={() => onManageStory(story.id)}
          >
            {story.title}
          </button>
          <Badge>{t(`milestoneStatus.${story.status}`)}</Badge>
        </div>
        <div className={cn('relative', storyHasMeta ? 'h-10' : 'h-8')}>
          <button
            type="button"
            className={cn(
              'kh-ops-time-bar absolute top-1 max-w-full text-left',
              storyHasMeta ? 'h-8 py-0.5 leading-tight' : 'h-6',
            )}
            data-tone={storyTone ?? undefined}
            style={style}
            title={
              storyDue ? `${story.title} (${storyDue})` : story.title
            }
            onClick={() => onManageStory(story.id)}
          >
            <span className="block truncate">{story.title}</span>
            <ItemMetaRow
              issueId={story.humanKey}
              date={storyDue}
              showIssueIds={showIssueIds}
              showDueDates={showDueDates}
              className="text-[10px] opacity-80"
            />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <fieldset className="kh-ops-panel m-0 grid gap-2 p-3">
        <legend className="px-1 text-sm font-semibold">
          {t('timelineFilterLabel')}
        </legend>
        <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
          {(
            [
              ['epics', 'kindEpic'],
              ['stories', 'kindStory'],
              ['milestones', 'kindMilestone'],
              ['tasks', 'kindTask'],
            ] as const
          ).map(([key, labelKey]) => (
            <label key={key} className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={filters[key]}
                onChange={() => toggleFilter(key)}
              />
              <span>{t(labelKey)}</span>
            </label>
          ))}
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={colorByStatus}
              onChange={toggleStatusColors}
            />
            <span>{t('timelineStatusColors')}</span>
          </label>
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={showDueDates}
              onChange={toggleDueDates}
            />
            <span>{t('dueDate')}</span>
          </label>
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={showIssueIds}
              onChange={toggleIssueIds}
            />
            <span>{t('timelineIssueIds')}</span>
          </label>
        </div>
      </fieldset>

      <fieldset className="kh-ops-panel m-0 grid gap-3 p-3">
        <legend className="px-1 text-sm font-semibold">
          {t('timelineWindowLabel')}
        </legend>
        <p className="m-0 text-xs text-ink-muted">{t('timelineWindowHint')}</p>
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <Field label={t('timelineWindowFrom')}>
            <Input
              type="date"
              value={windowRange.from}
              onChange={(event) => setWindowField('from', event.target.value)}
            />
          </Field>
          <Field label={t('timelineWindowTo')}>
            <Input
              type="date"
              value={windowRange.to}
              onChange={(event) => setWindowField('to', event.target.value)}
            />
          </Field>
          <Button
            type="button"
            variant="secondary"
            disabled={!windowRange.from && !windowRange.to}
            onClick={clearWindow}
          >
            {t('timelineWindowClear')}
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => applyPreset('month')}
          >
            {t('timelineWindowPresetMonth')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => applyPreset('next30')}
          >
            {t('timelineWindowPresetNext30')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={!projectStartDate && !projectEndDate}
            onClick={() => applyPreset('project')}
          >
            {t('timelineWindowPresetProject')}
          </Button>
        </div>
        {windowInvalid ? (
          <p className="m-0 text-sm text-danger">{t('timelineWindowInvalid')}</p>
        ) : null}
        {windowActive && !windowInvalid ? (
          <p className="m-0 text-xs text-ink-muted">
            {t('timelineWindowActive', {
              from: formatYmd(rangeStart),
              to: formatYmd(rangeEnd),
            })}
          </p>
        ) : null}
      </fieldset>

      {!anyTypeVisible ? (
        <p className="m-0 text-sm text-ink-muted">{t('timelineFilterEmpty')}</p>
      ) : null}

      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          type="button"
          variant="secondary"
          className="!px-2.5"
          disabled={!canZoomOut}
          onClick={() => zoomWindow('out')}
          title={t('timelineZoomOut')}
          aria-label={t('timelineZoomOut')}
        >
          <ZoomOutIcon />
        </Button>
        <Button
          type="button"
          variant="secondary"
          className="!px-2.5"
          disabled={!canZoomIn}
          onClick={() => zoomWindow('in')}
          title={t('timelineZoomIn')}
          aria-label={t('timelineZoomIn')}
        >
          <ZoomInIcon />
        </Button>
        <Button
          type="button"
          variant="secondary"
          className="!px-2.5"
          disabled={!windowRange.from && !windowRange.to}
          onClick={clearWindow}
          title={t('timelineResetView')}
          aria-label={t('timelineResetView')}
        >
          <ResetViewIcon />
        </Button>
        <Button
          type="button"
          variant={showGrid ? 'secondary' : 'ghost'}
          className="!px-2.5"
          aria-pressed={showGrid}
          onClick={toggleGrid}
          title={t('timelineGridToggle')}
          aria-label={t('timelineGridToggle')}
        >
          <GridIcon active={showGrid} />
        </Button>
        <TimelineHintHelp
          onResetPositions={resetOffsets}
          canReset={hasCustomOffsets}
        />
      </div>

      <div className="kh-ops-panel kh-ops-timeline-scroll">
        <div className="kh-ops-timeline-chart">
          <div className="relative mb-2 h-6">
            {labelTicks.map((tick) => (
              <div
                key={tick}
                className="absolute top-0 -translate-x-1/2 text-[11px] text-ink-muted"
                style={markerStyle(tick)}
              >
                {tick}
              </div>
            ))}
            {showGrid && todayInRange ? (
              <div
                className="absolute bottom-0 -translate-x-1/2 text-[10px] font-semibold leading-none text-danger"
                style={markerStyle(todayDate)}
              >
                {t('timelineToday')}
              </div>
            ) : null}
          </div>

          <div className="relative">
            {showGrid ? (
              <div
                className="pointer-events-none absolute inset-0 z-0"
                aria-hidden
              >
                {gridTicks.map((tick) => (
                  <div
                    key={`grid:${tick}`}
                    className="absolute top-0 bottom-0 w-px bg-line/70"
                    style={markerStyle(tick)}
                  />
                ))}
                {todayInRange ? (
                  <div
                    className="absolute top-0 bottom-0 w-0.5 bg-danger"
                    style={markerStyle(todayDate)}
                    title={`${t('timelineToday')}: ${todayDate}`}
                  />
                ) : null}
              </div>
            ) : null}

            {above.map((epic) => epicLane(epic, 'above'))}
            {standaloneStories.map((story) => storyLane(story))}

            <div
              className={cn(
                'relative z-[1] my-2 overflow-visible',
                filters.milestones || filters.tasks ? 'h-80 min-h-[20rem]' : 'h-8',
              )}
            >
              <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-line" />
              {projectStartDate && dateInWindow(projectStartDate) ? (
                <div
                  className="absolute top-0 h-full w-px bg-brand/50"
                  style={markerStyle(projectStartDate)}
                  title={t('timelineProjectStart')}
                />
              ) : null}
              {projectEndDate && dateInWindow(projectEndDate) ? (
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
                const statusLabel =
                  marker.kind === 'milestone'
                    ? t(`milestoneStatus.${marker.status}`)
                    : t(`taskStatus.${marker.status}`);
                const tone = colorByStatus
                  ? deliveryScheduleTone({
                      status: marker.status,
                      date: marker.date,
                      today: todayDate,
                    })
                  : null;
                const offset = offsets[marker.id] ?? { dx: 0, dy: 0 };
                const baseY = aboveSpine ? -DEFAULT_RIB_Y : DEFAULT_RIB_Y;
                const ribX = offset.dx;
                const ribY = baseY + offset.dy;
                const ribLen = Math.max(1, Math.hypot(ribX, ribY));
                const ribAngle = (Math.atan2(ribY, ribX) * 180) / Math.PI;
                const tooltip = [
                  kindLabel,
                  marker.title,
                  colorByStatus ? statusLabel : null,
                  marker.date,
                  showIssueIds ? marker.humanKey : null,
                ]
                  .filter(Boolean)
                  .join(' · ');

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
                        'absolute left-1/2 top-1/2 z-[2] w-max max-w-[11rem] rounded border px-1.5 py-0.5 text-left text-[10px] leading-snug shadow-sm',
                        tone
                          ? deliveryScheduleSurfaceClass(tone)
                          : 'border-line bg-panel-solid text-ink hover:border-brand/50',
                      )}
                      style={{
                        transform: `translate(calc(-50% + ${offset.dx}px), calc(-50% + ${baseY + offset.dy}px))`,
                      }}
                      title={tooltip}
                    >
                      <span
                        className={cn(
                          'mb-0.5 block text-[9px] font-semibold uppercase tracking-wide',
                          tone ? 'opacity-80' : 'text-ink-muted',
                        )}
                      >
                        {colorByStatus
                          ? `${kindLabel} · ${statusLabel}`
                          : kindLabel}
                      </span>
                      <span className="block truncate">{marker.title}</span>
                      <ItemMetaRow
                        issueId={marker.humanKey}
                        date={marker.date}
                        showIssueIds={showIssueIds}
                        showDueDates={showDueDates}
                        className={cn(
                          'mt-0.5 text-[9px]',
                          tone ? 'opacity-80' : 'text-ink-muted',
                        )}
                      />
                    </DraggableTag>
                    <button
                      type="button"
                      className={cn(
                        'absolute left-1/2 top-1/2 z-[3] -translate-x-1/2 -translate-y-1/2',
                        tone
                          ? scheduleMarkerDotClass(tone, marker.kind)
                          : marker.kind === 'milestone'
                            ? 'size-3 rotate-45 border border-warn bg-warn/80'
                            : 'size-2.5 rounded-full bg-ink-muted',
                      )}
                      title={tooltip}
                      aria-label={tooltip}
                      onClick={marker.onOpen}
                    />
                  </div>
                );
              })}
            </div>

            {below.map((epic) => epicLane(epic, 'below'))}

            {anyTypeVisible &&
            scheduledEpics.length === 0 &&
            standaloneStories.length === 0 &&
            axisMarkers.length === 0 ? (
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
        <div className="kh-ops-panel p-3">
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
                  <Badge tone="brand">{epic.humanKey ?? t('kindEpic')}</Badge>{' '}
                  {epic.title}
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
                  <Badge tone="brand">{story.humanKey ?? t('kindStory')}</Badge>{' '}
                  {story.title}
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
                  <Badge tone="brand">
                    {milestone.humanKey ?? t('kindMilestone')}
                  </Badge>{' '}
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
