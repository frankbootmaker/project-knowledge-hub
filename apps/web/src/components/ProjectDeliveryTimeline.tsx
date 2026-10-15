'use client';

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Badge, Button, Field, Input, useToast } from './ui';
import { cn } from '../lib/cn';
import { downloadAuthenticatedExport } from '../lib/download-export';
import {
  deliveryScheduleSurfaceClass,
  deliveryScheduleTone,
  type DeliveryScheduleTone,
} from '../lib/delivery-schedule';
import { formatLocaleDate } from '../lib/locale-date';
import { useLocalToday } from '../lib/use-local-today';
import {
  DAY_MS,
  DEFAULT_TIMELINE_ZOOM_INDEX,
  addDays,
  MARKER_TAG_GAP_PX,
  MARKER_TAG_WIDTH_PX,
  TIMELINE_DATE_FONT_PX,
  timelineMarkerWidthPx,
  TIMELINE_ZOOM_LEVELS,
  buildTimelineTicks,
  pruneCollidingAxisLabels,
  canZoomTimeline,
  clamp,
  formatYmd,
  markerBaseY,
  markerTrackHeightPx,
  nextZoomIndex,
  packMarkerLanes,
  parseYmd,
  scrollLeftForDate,
  timelineDueDate,
  timelineTagShiftX,
  scrollLeftForFraction,
  viewportCenterFraction,
  type MarkerLane,
} from '../lib/timeline-scale';

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
  startDate?: string | null;
  humanKey?: string | null;
  itemType?: 'task' | 'bug';
};

type AxisMarker = {
  id: string;
  kind: 'milestone' | 'task' | 'epic' | 'story';
  itemType?: 'task' | 'bug';
  title: string;
  date: string;
  startDate?: string | null;
  status: string;
  humanKey?: string | null;
  onOpen: () => void;
};

type TagOffset = { dx: number; dy: number };

function StartDateIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className="size-[11px] shrink-0" fill="none">
      <path
        d="M3.5 3v10M3.5 8h7.5M8.5 5.25 11.25 8 8.5 10.75"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function DueDateIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className="size-[11px] shrink-0" fill="none">
      <path
        d="M4.25 2.75v10.5M4.25 3.75h7.25L9.5 6.25l2 2.5H4.25"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ItemMetaRow({
  issueId,
  startDate,
  dueDate,
  showIssueIds,
  showStartDates,
  showDueDates,
  className,
}: {
  issueId?: string | null;
  startDate?: string | null;
  dueDate?: string | null;
  showIssueIds: boolean;
  showStartDates: boolean;
  showDueDates: boolean;
  className?: string;
}) {
  const locale = useLocale();
  const t = useTranslations('delivery');
  const id = showIssueIds && issueId ? issueId : null;
  const start = showStartDates && startDate ? formatLocaleDate(startDate, locale) : null;
  const due = showDueDates && dueDate ? formatLocaleDate(dueDate, locale) : null;
  const dates = [
    start ? { kind: 'start' as const, text: start, label: t('startDate') } : null,
    due ? { kind: 'due' as const, text: due, label: t('dueDate') } : null,
  ].filter((line): line is { kind: 'start' | 'due'; text: string; label: string } => Boolean(line));
  if (!id && dates.length === 0) return null;
  const dateStyle = { fontSize: TIMELINE_DATE_FONT_PX, lineHeight: 1.35 };
  const dateBlock = dates.length > 0 ? (
    <span className="grid">
      {dates.map((line) => (
        <span
          key={line.kind}
          className="flex items-center gap-1 whitespace-nowrap tabular-nums"
          style={dateStyle}
        >
          {line.kind === 'start' ? <StartDateIcon /> : <DueDateIcon />}
          <span className="sr-only">{line.label}</span>
          <span>{line.text}</span>
        </span>
      ))}
    </span>
  ) : null;
  if (id && dateBlock) {
    return (
      <span className={cn('mt-0.5 grid gap-0.5', className)}>
        <span className="kh-ops-key-badge max-w-full truncate">{id}</span>
        {dateBlock}
      </span>
    );
  }
  if (id) {
    return <span className={cn('kh-ops-key-badge max-w-full truncate', className)}>{id}</span>;
  }
  return <span className={className}>{dateBlock}</span>;
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

function readStartDates(storageKey: string): boolean {
  try {
    const raw = window.sessionStorage.getItem(storageKey);
    if (raw === null) return false;
    return raw === '1';
  } catch {
    return false;
  }
}

function writeStartDates(storageKey: string, enabled: boolean): void {
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

function markerShape(kind: AxisMarker['kind']): 'milestone' | 'epic' | 'story' | 'task' {
  if (kind === 'milestone' || kind === 'epic' || kind === 'story') return kind;
  return 'task';
}

function markerShapeClass(kind: AxisMarker['kind']): string {
  if (kind === 'milestone') return 'size-3 rotate-45 border border-warn bg-warn/80';
  if (kind === 'epic') return 'size-3 bg-ink-muted [clip-path:polygon(50%_0,100%_100%,0_100%)]';
  if (kind === 'story') return 'size-2.5 bg-ink-muted';
  return 'size-2.5 rounded-full bg-ink-muted';
}

function scheduleMarkerDotClass(
  tone: DeliveryScheduleTone,
  kind: 'milestone' | 'epic' | 'story' | 'task',
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
  if (kind === 'milestone') return cn('size-3 rotate-45 border', fill);
  if (kind === 'epic') {
    return cn('size-3 [clip-path:polygon(50%_0,100%_100%,0_100%)]', fill);
  }
  if (kind === 'story') return cn('size-2.5 border', fill);
  return cn('size-2.5 rounded-full border', fill);
}

function ZoomInIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="size-4 shrink-0" fill="none">
      <circle cx="11" cy="11" r="6.25" stroke="currentColor" strokeWidth="1.75" />
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
    <svg viewBox="0 0 24 24" aria-hidden className="size-4 shrink-0" fill="none">
      <circle cx="11" cy="11" r="6.25" stroke="currentColor" strokeWidth="1.75" />
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
    <svg viewBox="0 0 24 24" aria-hidden className="size-4 shrink-0" fill="none">
      <rect x="4" y="4" width="16" height="16" rx="1.5" stroke="currentColor" strokeWidth="1.75" />
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
    <svg viewBox="0 0 24 24" aria-hidden className="size-4 shrink-0" fill="none">
      <path
        d="M4.5 9V4.5H9M15 4.5h4.5V9M19.5 15v4.5H15M9 19.5H4.5V15"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect x="8" y="8" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="1.75" />
    </svg>
  );
}

type ScrollAnchor = { kind: 'fraction'; fraction: number } | { kind: 'date'; dateMs: number };

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

function writeOffsets(storageKey: string, offsets: Record<string, TagOffset>): void {
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
        <div id={panelId} role="note" className="kh-ops-popover max-w-xl">
          <p className="m-0">{t('timelineHint')}</p>
          <p className="m-0">{t('timelineDragHint')}</p>
          <ul className="m-0 flex list-none flex-wrap items-center gap-3 p-0">
            <li className="inline-flex items-center gap-1.5">
              <span
                className="size-3 bg-ink-muted [clip-path:polygon(50%_0,100%_100%,0_100%)]"
                aria-hidden
              />
              <span>{t('kindEpic')}</span>
            </li>
            <li className="inline-flex items-center gap-1.5">
              <span className="size-2.5 bg-ink-muted" aria-hidden />
              <span>{t('kindStory')}</span>
            </li>
            <li className="inline-flex items-center gap-1.5">
              <span className="size-2.5 rotate-45 border border-warn bg-warn/80" aria-hidden />
              <span>{t('kindMilestone')}</span>
            </li>
            <li className="inline-flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-ink-muted" aria-hidden />
              <span>{t('kindTask')}</span>
            </li>
          </ul>
          {canReset ? (
            <div>
              <Button type="button" variant="secondary" onClick={onResetPositions}>
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
  dataTone,
  children,
}: {
  tagId: string;
  offset: TagOffset;
  onOffsetChange: (id: string, offset: TagOffset) => void;
  onOpen: () => void;
  className?: string;
  style?: React.CSSProperties;
  title?: string;
  dataTone?: string;
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
      Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) >= DRAG_CLICK_THRESHOLD
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
      className={cn('cursor-grab touch-none active:cursor-grabbing', className)}
      style={style}
      data-tone={dataTone}
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
  onExportStateChange?: (state: { pending: boolean; canExport: boolean } | null) => void;
}) {
  const t = useTranslations('delivery');
  const tProjects = useTranslations('projects');
  const locale = useLocale();
  const { pushToast } = useToast();
  const storageKey = `kh-timeline-tags:${projectId}`;
  const filterKey = `kh-timeline-filters:${projectId}`;
  const windowKey = `kh-timeline-window:${projectId}`;
  const gridKey = `kh-timeline-grid:${projectId}`;
  const statusColorKey = `kh-timeline-status-colors:${projectId}`;
  const dueDatesKey = `kh-timeline-due-dates:${projectId}`;
  const startDatesKey = `kh-timeline-start-dates:${projectId}`;
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
  const [showStartDates, setShowStartDates] = useState(false);
  const [showIssueIds, setShowIssueIds] = useState(true);
  const [exportPending, setExportPending] = useState(false);
  const [zoomIndex, setZoomIndex] = useState(DEFAULT_TIMELINE_ZOOM_INDEX);
  const [scrollGen, setScrollGen] = useState(0);
  const [hydrated, setHydrated] = useState(false);
  const [chartPx, setChartPx] = useState(0);
  const [panning, setPanning] = useState(false);
  const todayDate = useLocalToday();
  const scrollRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<ScrollAnchor>({
    kind: 'date',
    dateMs: parseYmd(todayDate),
  });
  const appliedScrollGen = useRef(-1);
  const panRef = useRef<{
    pointerId: number;
    startX: number;
    startScroll: number;
  } | null>(null);

  useEffect(() => {
    setFilters(readFilters(filterKey));
    setWindowRange(readWindow(windowKey));
    setShowGrid(readGrid(gridKey));
    setColorByStatus(readStatusColors(statusColorKey));
    setShowDueDates(readDueDates(dueDatesKey));
    setShowStartDates(readStartDates(startDatesKey));
    setShowIssueIds(readIssueIds(issueIdsKey));
    setZoomIndex(DEFAULT_TIMELINE_ZOOM_INDEX);
    anchorRef.current = { kind: 'date', dateMs: parseYmd(todayDate) };
    setScrollGen((current) => current + 1);
    setHydrated(true);
  }, [
    dueDatesKey,
    startDatesKey,
    filterKey,
    gridKey,
    issueIdsKey,
    statusColorKey,
    todayDate,
    windowKey,
  ]);

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

  function toggleStartDates() {
    setShowStartDates((current) => {
      const next = !current;
      writeStartDates(startDatesKey, next);
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

  function queueDateScroll() {
    anchorRef.current = { kind: 'date', dateMs: parseYmd(todayDate) };
    setScrollGen((current) => current + 1);
  }

  function setWindowField(field: keyof TimelineWindow, value: string) {
    setWindowRange((current) => {
      const next = { ...current, [field]: value };
      writeWindow(windowKey, next);
      return next;
    });
    queueDateScroll();
  }

  function clearWindow() {
    const next = { from: '', to: '' };
    setWindowRange(next);
    writeWindow(windowKey, next);
    queueDateScroll();
  }

  function applyPreset(kind: 'month' | 'next30' | 'project') {
    const today = Date.UTC(
      new Date().getUTCFullYear(),
      new Date().getUTCMonth(),
      new Date().getUTCDate(),
    );
    let next: TimelineWindow;
    if (kind === 'month') {
      const start = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1);
      const end = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 0);
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
    queueDateScroll();
  }

  function toggleGrid() {
    setShowGrid((current) => {
      const next = !current;
      writeGrid(gridKey, next);
      return next;
    });
  }

  function zoomBy(direction: 'in' | 'out') {
    const next = nextZoomIndex(zoomIndex, direction);
    if (next === null) return;
    const el = scrollRef.current;
    const fraction =
      el && el.scrollWidth > 0
        ? viewportCenterFraction(el.scrollLeft, el.clientWidth, el.scrollWidth)
        : 0.5;
    anchorRef.current = { kind: 'fraction', fraction };
    setZoomIndex(next);
    setScrollGen((current) => current + 1);
  }

  function resetView() {
    anchorRef.current = { kind: 'date', dateMs: parseYmd(todayDate) };
    setZoomIndex(DEFAULT_TIMELINE_ZOOM_INDEX);
    setScrollGen((current) => current + 1);
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

  const timelineZoomPx =
    TIMELINE_ZOOM_LEVELS[zoomIndex]?.pxPerDay ?? TIMELINE_ZOOM_LEVELS[0].pxPerDay;

  const { rangeStart, rangeEnd, labelTicks, gridTicks, windowActive, windowInvalid } =
    useMemo(() => {
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
        timelineZoomPx,
      );

      return {
        rangeStart: startMs,
        rangeEnd: endMs,
        labelTicks: nextLabels,
        gridTicks: nextGrid,
        windowActive: active,
        windowInvalid: invalid,
      };
    }, [autoRange, windowRange.from, windowRange.to, timelineZoomPx]);

  const span = Math.max(1, rangeEnd - rangeStart);
  const rangeDays = Math.max(1, (rangeEnd - rangeStart) / DAY_MS);
  const estimatedWidth = Math.max(rangeDays * timelineZoomPx, 768);
  const layoutWidth = chartPx > 0 ? chartPx : estimatedWidth;
  const axisLabels = useMemo(
    () => pruneCollidingAxisLabels(labelTicks, rangeStart, rangeEnd, layoutWidth),
    [labelTicks, layoutWidth, rangeEnd, rangeStart],
  );
  const canZoomIn = canZoomTimeline(zoomIndex, 'in');
  const canZoomOut = canZoomTimeline(zoomIndex, 'out');
  const todayInRange = parseYmd(todayDate) >= rangeStart && parseYmd(todayDate) <= rangeEnd;

  useLayoutEffect(() => {
    if (!hydrated) return;
    const el = scrollRef.current;
    if (!el || el.clientWidth <= 0) return;
    if (appliedScrollGen.current === scrollGen) return;
    appliedScrollGen.current = scrollGen;
    const anchor = anchorRef.current;
    if (anchor.kind === 'fraction') {
      el.scrollLeft = scrollLeftForFraction(anchor.fraction, el.clientWidth, el.scrollWidth);
      return;
    }
    const dateMs =
      anchor.dateMs >= rangeStart && anchor.dateMs <= rangeEnd ? anchor.dateMs : rangeStart;
    el.scrollLeft = scrollLeftForDate(dateMs, rangeStart, rangeEnd, el.clientWidth, el.scrollWidth);
    // chartPx retries the first scroll if the chart had no width yet.
    // Later resizes keep the same scrollGen, so they do not jump the view.
  }, [hydrated, scrollGen, chartPx, rangeStart, rangeEnd]);

  useLayoutEffect(() => {
    const el = chartRef.current;
    if (!el) return;
    const measure = () => {
      const next = Math.round(el.clientWidth);
      setChartPx((prev) => (prev === next ? prev : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [zoomIndex, rangeStart, rangeEnd]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      const scroller = scrollRef.current;
      if (!scroller) return;
      if (!(event.target instanceof Node) || !scroller.contains(event.target)) return;
      const mostlyHorizontal = Math.abs(event.deltaX) > Math.abs(event.deltaY);
      if (!event.shiftKey && !mostlyHorizontal) return;
      const delta = event.shiftKey
        ? mostlyHorizontal && event.deltaX !== 0
          ? event.deltaX
          : event.deltaY || event.deltaX
        : event.deltaX;
      if (delta === 0 || scroller.scrollWidth <= scroller.clientWidth + 1) return;
      event.preventDefault();
      scroller.scrollLeft += delta;
    };
    // Capture on document so Shift+wheel pans the chart before the page scrolls.
    document.addEventListener('wheel', onWheel, { passive: false, capture: true });
    return () => document.removeEventListener('wheel', onWheel, { capture: true });
  }, []);

  function onPanPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || event.pointerType === 'touch') return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest('button, a, input, textarea, select, label')) return;
    const el = scrollRef.current;
    if (!el || el.scrollWidth <= el.clientWidth + 1) return;
    panRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startScroll: el.scrollLeft,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setPanning(true);
  }

  function onPanPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const pan = panRef.current;
    const el = scrollRef.current;
    if (!pan || !el || pan.pointerId !== event.pointerId) return;
    el.scrollLeft = pan.startScroll - (event.clientX - pan.startX);
  }

  function onPanPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const pan = panRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return;
    panRef.current = null;
    setPanning(false);
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      /* ignore */
    }
  }

  function markerLeftPct(date: string): number {
    return clamp(((parseYmd(date) - rangeStart) / span) * 100, 0, 100);
  }

  function markerStyle(date: string) {
    return { left: `${markerLeftPct(date)}%` };
  }

  function tickLabelStyle(date: string): CSSProperties {
    const left = markerLeftPct(date);
    if (left <= 0) return { left: 0 };
    if (left >= 100) return { right: 0 };
    return { left: `${left}%`, transform: 'translateX(-50%)' };
  }

  function dateInWindow(date: string): boolean {
    const ms = parseYmd(date);
    return ms >= rangeStart && ms <= rangeEnd;
  }

  function dueAnchorPx(date: string): number {
    return ((parseYmd(date) - rangeStart) / span) * layoutWidth;
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
          startDate: milestone.startDate,
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
          itemType: task.itemType === 'bug' ? 'bug' : 'task',
          title: task.title,
          date: task.dueDate,
          startDate: task.startDate ?? null,
          status: task.status,
          humanKey: task.humanKey ?? null,
          onOpen: () => onManageTask(task.id),
        });
      }
    }
    if (filters.epics) {
      for (const epic of epics) {
        const due = timelineDueDate(epic.startDate, epic.endDate);
        if (!due || !inWindow(due)) continue;
        items.push({
          id: `epic:${epic.id}`,
          kind: 'epic',
          title: epic.title,
          date: due,
          startDate: epic.startDate,
          status: epic.status,
          humanKey: epic.humanKey ?? null,
          onOpen: () => onManageEpic(epic.id),
        });
      }
    }
    if (filters.stories) {
      for (const story of stories) {
        const due = timelineDueDate(story.startDate, story.endDate);
        if (!due || !inWindow(due)) continue;
        items.push({
          id: `story:${story.id}`,
          kind: 'story',
          title: story.title,
          date: due,
          startDate: story.startDate,
          status: story.status,
          humanKey: story.humanKey ?? null,
          onOpen: () => onManageStory(story.id),
        });
      }
    }
    items.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
    return items;
  }, [
    epics,
    filters.epics,
    filters.milestones,
    filters.stories,
    filters.tasks,
    milestones,
    onManageEpic,
    onManageMilestone,
    onManageStory,
    onManageTask,
    rangeEnd,
    rangeStart,
    stories,
    tasks,
  ]);

  function markerDateLines(marker: AxisMarker): string[] {
    const start =
      showStartDates && marker.startDate ? formatLocaleDate(marker.startDate, locale) : null;
    const due = showDueDates ? formatLocaleDate(marker.date, locale) : null;
    return [start, due].filter((line): line is string => Boolean(line));
  }

  const markerLanes = useMemo(() => {
    return packMarkerLanes(
      axisMarkers.map((marker) => ({
        id: marker.id,
        xPx: ((parseYmd(marker.date) - rangeStart) / span) * layoutWidth,
        widthPx: timelineMarkerWidthPx(markerDateLines(marker)),
      })),
      { tagWidthPx: MARKER_TAG_WIDTH_PX, gapPx: MARKER_TAG_GAP_PX },
    );
  }, [axisMarkers, layoutWidth, locale, rangeStart, showDueDates, showStartDates, span]);
  const markerTrackHeight = markerTrackHeightPx(markerLanes.values());

  const unscheduledEpics = filters.epics
    ? epics.filter((epic) => !timelineDueDate(epic.startDate, epic.endDate))
    : [];
  const unscheduledStories = filters.stories
    ? stories.filter((story) => !timelineDueDate(story.startDate, story.endDate))
    : [];
  const unscheduledMilestones = filters.milestones
    ? milestones.filter((milestone) => !milestone.startDate && !milestone.targetDate)
    : [];

  const hasCustomOffsets = Object.keys(offsets).length > 0;
  const anyTypeVisible = filters.epics || filters.stories || filters.milestones || filters.tasks;

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
            showStartDates,
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
      pushToast(err instanceof Error ? err.message : t('timelineExportFailed'), 'danger');
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
    showStartDates,
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
  }, [anyTypeVisible, exportHandleRef, exportPending, exportTimelinePdf, onExportStateChange]);

  return (
    <div className="grid gap-4">
      <fieldset className="kh-ops-panel m-0 grid gap-2 p-3">
        <legend className="px-1 text-sm font-semibold">{t('timelineFilterLabel')}</legend>
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
              <input type="checkbox" checked={filters[key]} onChange={() => toggleFilter(key)} />
              <span>{t(labelKey)}</span>
            </label>
          ))}
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={colorByStatus} onChange={toggleStatusColors} />
            <span>{t('timelineStatusColors')}</span>
          </label>
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={showStartDates} onChange={toggleStartDates} />
            <span>{t('startDate')}</span>
          </label>
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={showDueDates} onChange={toggleDueDates} />
            <span>{t('dueDate')}</span>
          </label>
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={showIssueIds} onChange={toggleIssueIds} />
            <span>{t('timelineIssueIds')}</span>
          </label>
        </div>
      </fieldset>

      <fieldset className="kh-ops-panel m-0 grid gap-3 p-3">
        <legend className="px-1 text-sm font-semibold">{t('timelineWindowLabel')}</legend>
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
          <Button type="button" variant="ghost" onClick={() => applyPreset('month')}>
            {t('timelineWindowPresetMonth')}
          </Button>
          <Button type="button" variant="ghost" onClick={() => applyPreset('next30')}>
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
          onClick={() => zoomBy('out')}
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
          onClick={() => zoomBy('in')}
          title={t('timelineZoomIn')}
          aria-label={t('timelineZoomIn')}
        >
          <ZoomInIcon />
        </Button>
        <Button
          type="button"
          variant="secondary"
          className="!px-2.5"
          onClick={resetView}
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
        <TimelineHintHelp onResetPositions={resetOffsets} canReset={hasCustomOffsets} />
      </div>

      <div ref={scrollRef} className="kh-ops-panel kh-ops-timeline-scroll">
        <div
          ref={chartRef}
          className={cn('kh-ops-timeline-chart', panning && 'is-panning')}
          data-zoom-level={TIMELINE_ZOOM_LEVELS[zoomIndex]?.id ?? 'month'}
          style={
            {
              '--kh-timeline-days': rangeDays,
              '--kh-timeline-px': timelineZoomPx,
            } as CSSProperties
          }
          onPointerDown={onPanPointerDown}
          onPointerMove={onPanPointerMove}
          onPointerUp={onPanPointerUp}
          onPointerCancel={onPanPointerUp}
        >
          <div className="relative mb-2 h-7">
            {axisLabels.map((tick) => (
              <div
                key={tick}
                className="kh-ops-timeline-axis absolute top-0 whitespace-nowrap"
                style={tickLabelStyle(tick)}
              >
                {formatLocaleDate(tick, locale)}
              </div>
            ))}
            {showGrid && todayInRange ? (
              <div
                className="kh-ops-menu-type absolute bottom-0 whitespace-nowrap font-semibold leading-none text-danger"
                style={tickLabelStyle(todayDate)}
              >
                {t('timelineToday')}
              </div>
            ) : null}
          </div>

          <div className="relative">
            {showGrid ? (
              <div className="pointer-events-none absolute inset-0 z-0" aria-hidden>
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

            <div
              className="relative z-[1] my-2 overflow-visible"
              style={{
                height: axisMarkers.length > 0 ? markerTrackHeight : 32,
              }}
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

              {axisMarkers.map((marker) => {
                const placement: MarkerLane = markerLanes.get(marker.id) ?? {
                  lane: 0,
                  side: 'above',
                };
                const kindLabel =
                  marker.kind === 'milestone'
                    ? t('kindMilestone')
                    : marker.kind === 'epic'
                      ? t('kindEpic')
                      : marker.kind === 'story'
                        ? t('kindStory')
                        : marker.itemType === 'bug'
                          ? t('kindBug')
                          : t('kindTask');
                const statusLabel =
                  marker.kind === 'task'
                    ? t(`taskStatus.${marker.status}`)
                    : t(`milestoneStatus.${marker.status}`);
                const tone = colorByStatus
                  ? deliveryScheduleTone({
                      status: marker.status,
                      date: marker.date,
                      today: todayDate,
                    })
                  : null;
                const offset = offsets[marker.id] ?? { dx: 0, dy: 0 };
                const baseY = markerBaseY(placement.side, placement.lane);
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
                const cardWidth = timelineMarkerWidthPx(markerDateLines(marker));
                const tagShift = timelineTagShiftX(
                  dueAnchorPx(marker.date),
                  layoutWidth,
                  cardWidth,
                  offset.dx,
                );

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
                        'absolute left-1/2 top-1/2 z-[2] overflow-hidden border px-1.5 py-0.5',
                        'text-left text-[10px] leading-snug shadow-sm',
                        tone
                          ? deliveryScheduleSurfaceClass(tone)
                          : 'border-line bg-panel-solid text-ink hover:border-brand/50',
                      )}
                      style={{
                        width: cardWidth,
                        transform: `translate(calc(-50% + ${tagShift}px), calc(-50% + ${baseY + offset.dy}px))`,
                      }}
                      title={tooltip}
                    >
                      <span
                        className={cn(
                          'mb-0.5 line-clamp-2 block text-[10px] font-semibold uppercase tracking-wide',
                          tone ? 'opacity-80' : 'text-ink-muted',
                        )}
                      >
                        {colorByStatus ? `${kindLabel} · ${statusLabel}` : kindLabel}
                      </span>
                      <span className="line-clamp-2 block">{marker.title}</span>
                      <ItemMetaRow
                        issueId={marker.humanKey}
                        startDate={marker.startDate}
                        dueDate={marker.date}
                        showIssueIds={showIssueIds}
                        showStartDates={showStartDates}
                        showDueDates={showDueDates}
                        className={cn('mt-0.5', tone ? 'opacity-80' : 'text-ink-muted')}
                      />
                    </DraggableTag>
                    <button
                      type="button"
                      className={cn(
                        'absolute left-1/2 top-1/2 z-[3] -translate-x-1/2 -translate-y-1/2',
                        tone
                          ? scheduleMarkerDotClass(tone, markerShape(marker.kind))
                          : markerShapeClass(marker.kind),
                      )}
                      title={tooltip}
                      aria-label={tooltip}
                      onClick={marker.onOpen}
                    />
                  </div>
                );
              })}
            </div>

            {anyTypeVisible && axisMarkers.length === 0 ? (
              <p className="m-0 py-4 text-center text-sm text-ink-muted">{t('timelineNoBars')}</p>
            ) : null}
          </div>
        </div>
      </div>

      {unscheduledEpics.length > 0 ||
      unscheduledStories.length > 0 ||
      unscheduledMilestones.length > 0 ? (
        <div className="kh-ops-panel p-3">
          <p className="mt-0 mb-2 text-sm font-semibold">{t('timelineUnscheduled')}</p>
          <ul className="m-0 grid list-none gap-2 p-0">
            {unscheduledEpics.map((epic) => (
              <li key={epic.id} className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm">
                  {epic.humanKey ? (
                    <span className="kh-ops-key-badge">{epic.humanKey}</span>
                  ) : (
                    <Badge tone="brand">{t('kindEpic')}</Badge>
                  )}{' '}
                  {epic.title}
                </span>
                <Button type="button" variant="secondary" onClick={() => onManageEpic(epic.id)}>
                  {t('manage')}
                </Button>
              </li>
            ))}
            {unscheduledStories.map((story) => (
              <li key={story.id} className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm">
                  {story.humanKey ? (
                    <span className="kh-ops-key-badge">{story.humanKey}</span>
                  ) : (
                    <Badge tone="brand">{t('kindStory')}</Badge>
                  )}{' '}
                  {story.title}
                </span>
                <Button type="button" variant="secondary" onClick={() => onManageStory(story.id)}>
                  {t('manage')}
                </Button>
              </li>
            ))}
            {unscheduledMilestones.map((milestone) => (
              <li key={milestone.id} className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm">
                  {milestone.humanKey ? (
                    <span className="kh-ops-key-badge">{milestone.humanKey}</span>
                  ) : (
                    <Badge tone="brand">{t('kindMilestone')}</Badge>
                  )}{' '}
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
