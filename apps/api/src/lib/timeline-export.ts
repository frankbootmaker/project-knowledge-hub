import { renderHtmlDocumentToPdf } from './knowledge-export.js';

export type TimelineExportFilters = {
  includeEpics: boolean;
  includeStories: boolean;
  includeMilestones: boolean;
  includeTasks: boolean;
};

export type TimelineExportEpic = {
  id: string;
  title: string;
  status: string;
  startDate: string | null;
  endDate: string | null;
};

export type TimelineExportStory = {
  id: string;
  epicId: string;
  title: string;
  status: string;
  startDate: string | null;
  endDate: string | null;
};

export type TimelineExportMilestone = {
  id: string;
  title: string;
  status: string;
  targetDate: string | null;
};

export type TimelineExportTask = {
  id: string;
  title: string;
  status: string;
  dueDate: string | null;
};

export type TimelineTagOffset = { dx: number; dy: number };

type ScheduleTone =
  | 'onTrack'
  | 'atRisk'
  | 'overdue'
  | 'completed'
  | 'neutral';

const DEFAULT_RIB_Y = 96;
const STORY_BASE_Y = 36;
const OFFSET_LIMIT = 2000;
const AT_RISK_DAYS = 3;

/** Light-mode schedule colors matching apps/web tokens + deliveryScheduleSurfaceClass. */
const SCHEDULE_STYLES: Record<
  ScheduleTone,
  { bg: string; border: string; text: string; fill: string }
> = {
  completed: {
    bg: '#f3f7fb',
    border: 'rgba(31, 75, 115, 0.35)',
    text: '#1f4b73',
    fill: '#1f4b73',
  },
  overdue: {
    bg: '#fde8e8',
    border: 'rgba(155, 28, 28, 0.35)',
    text: '#9b1c1c',
    fill: '#9b1c1c',
  },
  atRisk: {
    bg: '#fff7e6',
    border: 'rgba(138, 90, 0, 0.4)',
    text: '#8a5a00',
    fill: '#8a5a00',
  },
  onTrack: {
    bg: '#e3f6ec',
    border: 'rgba(20, 90, 54, 0.35)',
    text: '#145a36',
    fill: '#145a36',
  },
  neutral: {
    bg: '#ffffff',
    border: 'rgba(21, 32, 43, 0.14)',
    text: '#4b5a68',
    fill: '#4b5a68',
  },
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function todayYmdUtc(now = new Date()): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function daysUntil(dateYmd: string, today: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateYmd) || !/^\d{4}-\d{2}-\d{2}$/.test(today)) {
    return null;
  }
  const due = Date.UTC(
    Number(dateYmd.slice(0, 4)),
    Number(dateYmd.slice(5, 7)) - 1,
    Number(dateYmd.slice(8, 10)),
  );
  const base = Date.UTC(
    Number(today.slice(0, 4)),
    Number(today.slice(5, 7)) - 1,
    Number(today.slice(8, 10)),
  );
  return Math.round((due - base) / 86_400_000);
}

function scheduleTone(input: {
  status: string;
  date: string | null | undefined;
  today?: string;
}): ScheduleTone {
  if (input.status === 'done') return 'completed';
  if (input.status === 'cancelled') return 'neutral';
  const today = input.today ?? todayYmdUtc();
  if (!input.date) return 'onTrack';
  const delta = daysUntil(input.date, today);
  if (delta == null) return 'onTrack';
  if (delta < 0) return 'overdue';
  if (delta <= AT_RISK_DAYS) return 'atRisk';
  return 'onTrack';
}

function surfaceStyle(tone: ScheduleTone): string {
  const colors = SCHEDULE_STYLES[tone];
  return `background:${colors.bg};border-color:${colors.border};color:${colors.text}`;
}

function markerFillStyle(tone: ScheduleTone): string {
  const colors = SCHEDULE_STYLES[tone];
  return `background:${colors.fill};border-color:${colors.border}`;
}

function legendSwatchStyle(tone: ScheduleTone): string {
  const colors = SCHEDULE_STYLES[tone];
  return `background:${colors.bg};border-color:${colors.border}`;
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

function rangeOverlaps(
  startMs: number,
  endMs: number,
  winStart: number,
  winEnd: number,
): boolean {
  return startMs <= winEnd && endMs >= winStart;
}

function sanitizeOffsets(
  raw: Record<string, TimelineTagOffset> | null | undefined,
): Record<string, TimelineTagOffset> {
  if (!raw || typeof raw !== 'object') return {};
  const next: Record<string, TimelineTagOffset> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (Object.keys(next).length >= 500) break;
    if (!key || typeof key !== 'string' || key.length > 120) continue;
    if (!value || typeof value !== 'object') continue;
    if (typeof value.dx !== 'number' || typeof value.dy !== 'number') continue;
    if (!Number.isFinite(value.dx) || !Number.isFinite(value.dy)) continue;
    next[key] = {
      dx: clamp(value.dx, -OFFSET_LIMIT, OFFSET_LIMIT),
      dy: clamp(value.dy, -OFFSET_LIMIT, OFFSET_LIMIT),
    };
  }
  return next;
}

function getOffset(
  offsets: Record<string, TimelineTagOffset>,
  id: string,
): TimelineTagOffset {
  return offsets[id] ?? { dx: 0, dy: 0 };
}

function computeRange(input: {
  projectStartDate: string | null;
  projectEndDate: string | null;
  epics: TimelineExportEpic[];
  stories: TimelineExportStory[];
  milestones: TimelineExportMilestone[];
  tasks: TimelineExportTask[];
  filters: TimelineExportFilters;
  windowFrom?: string | null;
  windowTo?: string | null;
}): { startMs: number; endMs: number; labelTicks: string[]; gridTicks: string[] } {
  const candidates: string[] = [];
  if (input.projectStartDate) candidates.push(input.projectStartDate);
  if (input.projectEndDate) candidates.push(input.projectEndDate);
  if (input.filters.includeEpics) {
    for (const epic of input.epics) {
      if (epic.startDate) candidates.push(epic.startDate);
      if (epic.endDate) candidates.push(epic.endDate);
    }
  }
  if (input.filters.includeStories) {
    for (const story of input.stories) {
      if (story.startDate) candidates.push(story.startDate);
      if (story.endDate) candidates.push(story.endDate);
    }
  }
  if (input.filters.includeMilestones) {
    for (const milestone of input.milestones) {
      if (milestone.targetDate) candidates.push(milestone.targetDate);
    }
  }
  if (input.filters.includeTasks) {
    for (const task of input.tasks) {
      if (task.dueDate) candidates.push(task.dueDate);
    }
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
    if (endMs <= startMs) endMs = addDays(startMs, 30);
  }

  const fromOk = Boolean(input.windowFrom);
  const toOk = Boolean(input.windowTo);
  if (fromOk || toOk) {
    const fromMs = fromOk ? parseYmd(input.windowFrom!) : startMs;
    const toMs = toOk ? parseYmd(input.windowTo!) : endMs;
    if (fromMs <= toMs) {
      startMs = fromMs;
      endMs = toMs;
      if (endMs <= startMs) endMs = addDays(startMs, 1);
    }
  }

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

  return { startMs, endMs, labelTicks, gridTicks };
}

function pct(date: string, startMs: number, endMs: number): number {
  const span = Math.max(1, endMs - startMs);
  return clamp(((parseYmd(date) - startMs) / span) * 100, 0, 100);
}

function barBox(
  start: string | null,
  end: string | null,
  startMs: number,
  endMs: number,
): { left: number; width: number } | null {
  if (!start && !end) return null;
  const a = parseYmd(start ?? end!);
  const b = parseYmd(end ?? start!);
  if (!rangeOverlaps(a, b, startMs, endMs)) return null;
  const clippedStart = Math.max(a, startMs);
  const clippedEnd = Math.min(b, endMs);
  const span = Math.max(1, endMs - startMs);
  const left = clamp(((clippedStart - startMs) / span) * 100, 0, 100);
  const width = Math.max(
    1.2,
    clamp(
      ((Math.max(clippedStart, clippedEnd) - clippedStart) / span) * 100,
      1.2,
      100 - left,
    ),
  );
  return { left, width };
}

function datedRangeOverlapsWindow(
  start: string | null,
  end: string | null,
  startMs: number,
  endMs: number,
): boolean {
  if (!start && !end) return false;
  const a = parseYmd(start ?? end!);
  const b = parseYmd(end ?? start!);
  return rangeOverlaps(a, b, startMs, endMs);
}

function ribHtml(dx: number, dy: number): string {
  const len = Math.max(1, Math.hypot(dx, dy));
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  return `<div class="rib" style="width:${len.toFixed(1)}px;transform:rotate(${angle.toFixed(2)}deg)"></div>`;
}

function dateSubHtml(date: string | null | undefined, showDueDates: boolean): string {
  if (!showDueDates || !date) return '';
  return `<span class="due">${escapeHtml(date)}</span>`;
}

function storyTagsHtml(
  stories: TimelineExportStory[],
  startMs: number,
  endMs: number,
  offsets: Record<string, TimelineTagOffset>,
  colorByStatus: boolean,
  showDueDates: boolean,
  today: string,
): string {
  return stories
    .map((story) => {
      const box = barBox(story.startDate, story.endDate, startMs, endMs);
      if (!box) return '';
      const midDate = formatYmd(
        (parseYmd(story.startDate ?? story.endDate!) +
          parseYmd(story.endDate ?? story.startDate!)) /
          2,
      );
      const midLeft = pct(midDate, startMs, endMs);
      const anchorLeft = clamp(midLeft, box.left, box.left + box.width);
      const offset = getOffset(offsets, `story:${story.id}`);
      const ribX = offset.dx;
      const ribY = STORY_BASE_Y + offset.dy;
      const tone = colorByStatus
        ? scheduleTone({
            status: story.status,
            date: story.endDate ?? story.startDate,
            today,
          })
        : null;
      const styleAttrs = tone
        ? `transform:translate(calc(-50% + ${offset.dx}px), ${ribY}px);${surfaceStyle(tone)}`
        : `transform:translate(calc(-50% + ${offset.dx}px), ${ribY}px)`;
      const due = story.endDate ?? story.startDate;
      return `<div class="story-anchor" style="left:${anchorLeft.toFixed(2)}%">
  ${ribHtml(ribX, ribY)}
  <div class="story-tag" style="${styleAttrs}" title="${escapeHtml(story.title)}">${escapeHtml(story.title)}${dateSubHtml(due, showDueDates)}</div>
</div>`;
    })
    .join('');
}

function epicLaneHtml(
  epic: TimelineExportEpic,
  stories: TimelineExportStory[],
  startMs: number,
  endMs: number,
  offsets: Record<string, TimelineTagOffset>,
  colorByStatus: boolean,
  showDueDates: boolean,
  today: string,
): string {
  const box = barBox(epic.startDate, epic.endDate, startMs, endMs);
  if (!box) return '';

  let tagRoom = stories.length > 0 ? STORY_BASE_Y + 28 : 8;
  for (const story of stories) {
    const offset = getOffset(offsets, `story:${story.id}`);
    tagRoom = Math.max(
      tagRoom,
      STORY_BASE_Y + offset.dy + (showDueDates ? 40 : 28),
      Math.abs(offset.dx) + 24,
    );
  }

  const epicTone = colorByStatus
    ? scheduleTone({
        status: epic.status,
        date: epic.endDate ?? epic.startDate,
        today,
      })
    : null;
  const epicStyle = epicTone
    ? `left:${box.left.toFixed(2)}%;width:${box.width.toFixed(2)}%;${surfaceStyle(epicTone)}`
    : `left:${box.left.toFixed(2)}%;width:${box.width.toFixed(2)}%`;

  return `<section class="lane" style="padding-bottom:${Math.max(8, tagRoom)}px">
  <div class="lane-title">${escapeHtml(epic.title)}</div>
  <div class="track">
    <div class="epic-bar" style="${epicStyle}">${escapeHtml(epic.title)}${dateSubHtml(epic.endDate, showDueDates)}</div>
    ${storyTagsHtml(stories, startMs, endMs, offsets, colorByStatus, showDueDates, today)}
  </div>
</section>`;
}

export type TimelineExportInput = {
  title: string;
  projectName: string;
  projectStartDate: string | null;
  projectEndDate: string | null;
  epics: TimelineExportEpic[];
  stories: TimelineExportStory[];
  milestones: TimelineExportMilestone[];
  tasks: TimelineExportTask[];
  filters: TimelineExportFilters;
  colorByStatus?: boolean;
  showDueDates?: boolean;
  showGrid?: boolean;
  today?: string;
  windowFrom?: string | null;
  windowTo?: string | null;
  tagOffsets?: Record<string, TimelineTagOffset> | null;
  labels: {
    epic: string;
    story: string;
    milestone: string;
    task: string;
    generated: string;
    empty: string;
    today?: string;
    scheduleOnTrack?: string;
    scheduleAtRisk?: string;
    scheduleOverdue?: string;
    scheduleCompleted?: string;
    scheduleNeutral?: string;
  };
};

export function buildTimelineHtml(input: TimelineExportInput): string {
  const { startMs, endMs, labelTicks, gridTicks } = computeRange(input);
  const offsets = sanitizeOffsets(input.tagOffsets);
  const generated = new Date().toISOString().slice(0, 10);
  const colorByStatus = Boolean(input.colorByStatus);
  const showDueDates = Boolean(input.showDueDates);
  const showGrid = input.showGrid !== false;
  const today = input.today ?? todayYmdUtc();
  const todayMs = parseYmd(today);
  const todayInRange = todayMs >= startMs && todayMs <= endMs;

  const epicRows = input.filters.includeEpics
    ? input.epics.filter((epic) =>
        datedRangeOverlapsWindow(epic.startDate, epic.endDate, startMs, endMs),
      )
    : [];
  const storiesByEpic = new Map<string, TimelineExportStory[]>();
  if (input.filters.includeStories) {
    for (const story of input.stories) {
      if (
        !datedRangeOverlapsWindow(
          story.startDate,
          story.endDate,
          startMs,
          endMs,
        )
      ) {
        continue;
      }
      if (input.filters.includeEpics) {
        const list = storiesByEpic.get(story.epicId) ?? [];
        list.push(story);
        storiesByEpic.set(story.epicId, list);
      }
    }
  }
  const standaloneStories =
    input.filters.includeStories && !input.filters.includeEpics
      ? input.stories.filter((story) =>
          datedRangeOverlapsWindow(
            story.startDate,
            story.endDate,
            startMs,
            endMs,
          ),
        )
      : [];

  const milestoneMarkers = input.filters.includeMilestones
    ? input.milestones.filter((row) => {
        if (!row.targetDate) return false;
        const ms = parseYmd(row.targetDate);
        return ms >= startMs && ms <= endMs;
      })
    : [];
  const taskMarkers = input.filters.includeTasks
    ? input.tasks.filter((row) => {
        if (!row.dueDate) return false;
        const ms = parseYmd(row.dueDate);
        return ms >= startMs && ms <= endMs;
      })
    : [];

  const markers = [
    ...milestoneMarkers.map((row) => ({
      id: `milestone:${row.id}`,
      kind: 'milestone' as const,
      title: row.title,
      date: row.targetDate!,
      status: row.status,
    })),
    ...taskMarkers.map((row) => ({
      id: `task:${row.id}`,
      kind: 'task' as const,
      title: row.title,
      date: row.dueDate!,
      status: row.status,
    })),
  ].sort(
    (a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title),
  );

  const showSpine =
    markers.length > 0 ||
    Boolean(input.projectStartDate) ||
    Boolean(input.projectEndDate);

  let spineHalf = markers.length > 0 ? 160 : 16;
  for (const [index, marker] of markers.entries()) {
    const above = index % 2 === 0;
    const baseY = above ? -DEFAULT_RIB_Y : DEFAULT_RIB_Y;
    const offset = getOffset(offsets, marker.id);
    spineHalf = Math.max(
      spineHalf,
      Math.abs(baseY + offset.dy) + (showDueDates ? 48 : 36),
      Math.abs(offset.dx) + 36,
    );
  }
  const spineHeight = Math.max(32, spineHalf * 2);

  const ticksHtml = labelTicks
    .map((tick) => {
      const left = pct(tick, startMs, endMs);
      return `<div class="tick" style="left:${left.toFixed(2)}%">${escapeHtml(tick)}</div>`;
    })
    .join('');
  const todayAxisHtml =
    showGrid && todayInRange
      ? `<div class="tick today-tick" style="left:${pct(today, startMs, endMs).toFixed(2)}%">${escapeHtml(input.labels.today ?? 'Today')}</div>`
      : '';

  const gridHtml = showGrid
    ? `<div class="grid" aria-hidden="true">
  ${gridTicks
    .map(
      (tick) =>
        `<div class="grid-line" style="left:${pct(tick, startMs, endMs).toFixed(2)}%"></div>`,
    )
    .join('')}
  ${
    todayInRange
      ? `<div class="today-line" style="left:${pct(today, startMs, endMs).toFixed(2)}%"></div>`
      : ''
  }
</div>`
    : '';

  const aboveEpics = epicRows.filter((_, index) => index % 2 === 0);
  const belowEpics = epicRows.filter((_, index) => index % 2 === 1);

  const renderEpicGroup = (rows: TimelineExportEpic[]) =>
    rows
      .map((epic) =>
        epicLaneHtml(
          epic,
          storiesByEpic.get(epic.id) ?? [],
          startMs,
          endMs,
          offsets,
          colorByStatus,
          showDueDates,
          today,
        ),
      )
      .join('');

  const standaloneHtml = standaloneStories
    .map((story) => {
      const box = barBox(story.startDate, story.endDate, startMs, endMs);
      if (!box) return '';
      const tone = colorByStatus
        ? scheduleTone({
            status: story.status,
            date: story.endDate ?? story.startDate,
            today,
          })
        : null;
      const style = tone
        ? `left:${box.left.toFixed(2)}%;width:${box.width.toFixed(2)}%;${surfaceStyle(tone)}`
        : `left:${box.left.toFixed(2)}%;width:${box.width.toFixed(2)}%`;
      const due = story.endDate ?? story.startDate;
      return `<section class="lane">
  <div class="lane-title">${escapeHtml(story.title)}</div>
  <div class="track alone">
    <div class="story-bar" style="${style}">${escapeHtml(story.title)}${dateSubHtml(due, showDueDates)}</div>
  </div>
</section>`;
    })
    .join('');

  const projectMarkersHtml = [
    input.projectStartDate &&
    parseYmd(input.projectStartDate) >= startMs &&
    parseYmd(input.projectStartDate) <= endMs
      ? `<div class="project-mark" style="left:${pct(input.projectStartDate, startMs, endMs).toFixed(2)}%"></div>`
      : '',
    input.projectEndDate &&
    parseYmd(input.projectEndDate) >= startMs &&
    parseYmd(input.projectEndDate) <= endMs
      ? `<div class="project-mark" style="left:${pct(input.projectEndDate, startMs, endMs).toFixed(2)}%"></div>`
      : '',
  ].join('');

  const markersHtml = markers
    .map((marker, index) => {
      const left = pct(marker.date, startMs, endMs);
      const above = index % 2 === 0;
      const baseY = above ? -DEFAULT_RIB_Y : DEFAULT_RIB_Y;
      const offset = getOffset(offsets, marker.id);
      const ribX = offset.dx;
      const ribY = baseY + offset.dy;
      const iconClass = marker.kind === 'milestone' ? 'diamond' : 'dot';
      const tone = colorByStatus
        ? scheduleTone({
            status: marker.status,
            date: marker.date,
            today,
          })
        : null;
      const tagStyle = tone
        ? `transform:translate(calc(-50% + ${offset.dx}px), calc(-50% + ${ribY}px));${surfaceStyle(tone)}`
        : `transform:translate(calc(-50% + ${offset.dx}px), calc(-50% + ${ribY}px))`;
      const iconStyle = tone ? ` style="${markerFillStyle(tone)}"` : '';
      return `<div class="marker" style="left:${left.toFixed(2)}%">
  ${ribHtml(ribX, ribY)}
  <div class="marker-tag" style="${tagStyle}">${escapeHtml(marker.title)}${dateSubHtml(marker.date, showDueDates)}</div>
  <div class="${iconClass}"${iconStyle}></div>
</div>`;
    })
    .join('');

  const hasContent =
    epicRows.length > 0 ||
    standaloneStories.length > 0 ||
    markers.length > 0;

  const scheduleLegend = colorByStatus
    ? [
        input.labels.scheduleOnTrack
          ? `<span><i class="swatch-tone" style="${legendSwatchStyle('onTrack')}"></i>${escapeHtml(input.labels.scheduleOnTrack)}</span>`
          : '',
        input.labels.scheduleAtRisk
          ? `<span><i class="swatch-tone" style="${legendSwatchStyle('atRisk')}"></i>${escapeHtml(input.labels.scheduleAtRisk)}</span>`
          : '',
        input.labels.scheduleOverdue
          ? `<span><i class="swatch-tone" style="${legendSwatchStyle('overdue')}"></i>${escapeHtml(input.labels.scheduleOverdue)}</span>`
          : '',
        input.labels.scheduleCompleted
          ? `<span><i class="swatch-tone" style="${legendSwatchStyle('completed')}"></i>${escapeHtml(input.labels.scheduleCompleted)}</span>`
          : '',
        input.labels.scheduleNeutral
          ? `<span><i class="swatch-tone" style="${legendSwatchStyle('neutral')}"></i>${escapeHtml(input.labels.scheduleNeutral)}</span>`
          : '',
      ].join('')
    : '';

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(input.title)}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: system-ui, -apple-system, Segoe UI, sans-serif;
      color: #15202b;
      margin: 1.25rem;
      font-size: 11px;
    }
    h1 { margin: 0 0 0.25rem; font-size: 1.35rem; }
    .sub { margin: 0 0 1rem; color: #5b6b7c; }
    .legend { display: flex; flex-wrap: wrap; gap: 0.75rem; margin-bottom: 0.75rem; }
    .legend span { display: inline-flex; align-items: center; gap: 0.35rem; }
    .swatch-epic { width: 18px; height: 8px; border-radius: 3px; background: #cfe3ff; border: 1px solid #7aa7e0; }
    .swatch-story { width: 18px; height: 8px; border-radius: 3px; background: #fff; border: 1px solid #c5ced6; }
    .swatch-diamond { width: 8px; height: 8px; background: #d4a017; border: 1px solid #b8860b; transform: rotate(45deg); }
    .swatch-dot { width: 8px; height: 8px; border-radius: 50%; background: #5b6b7c; }
    .swatch-tone { width: 10px; height: 10px; border-radius: 2px; border: 1px solid transparent; display: inline-block; }
    .chart {
      padding: 0;
      background: #fff;
      overflow: visible;
    }
    .axis { position: relative; height: 1.4rem; margin-bottom: 0.35rem; }
    .tick {
      position: absolute;
      top: 0;
      transform: translateX(-50%);
      color: #5b6b7c;
      font-size: 9px;
      white-space: nowrap;
    }
    .today-tick {
      top: auto;
      bottom: 0;
      color: #c0392b;
      font-weight: 600;
      font-size: 9px;
      line-height: 1;
    }
    .chart-body { position: relative; }
    .grid {
      position: absolute;
      inset: 0;
      z-index: 0;
      pointer-events: none;
    }
    .grid-line {
      position: absolute;
      top: 0;
      bottom: 0;
      width: 1px;
      background: rgba(197, 206, 214, 0.7);
    }
    .today-line {
      position: absolute;
      top: 0;
      bottom: 0;
      width: 2px;
      background: #c0392b;
    }
    .lane {
      margin-bottom: 0.65rem;
      position: relative;
      z-index: 1;
      break-inside: avoid;
      page-break-inside: avoid;
      -webkit-column-break-inside: avoid;
    }
    .lane-title { margin-bottom: 0.25rem; font-weight: 600; }
    .track { position: relative; height: 1.6rem; overflow: visible; }
    .track.alone { height: 1.6rem; }
    .epic-bar, .story-bar {
      position: absolute;
      top: 0.2rem;
      min-height: 1.15rem;
      height: auto;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
      padding: 0.1rem 0.35rem;
      border-radius: 4px;
      font-size: 9px;
      line-height: 1.2;
    }
    .epic-bar {
      background: #d7e8ff;
      border: 1px solid #7aa7e0;
    }
    .story-bar {
      background: #fff;
      border: 1px solid #c5ced6;
    }
    .story-anchor {
      position: absolute;
      top: 0;
      width: 0;
      height: 100%;
    }
    .rib {
      position: absolute;
      left: 0;
      top: 0.55rem;
      height: 1px;
      background: #8a97a5;
      transform-origin: left center;
      pointer-events: none;
    }
    .story-tag, .marker-tag {
      position: absolute;
      left: 0;
      top: 0.2rem;
      z-index: 2;
      width: max-content;
      max-width: 11rem;
      padding: 0.12rem 0.35rem;
      border: 1px solid #c5ced6;
      border-radius: 4px;
      background: #fff;
      font-size: 8px;
      line-height: 1.25;
      overflow: hidden;
      white-space: normal;
      box-shadow: 0 1px 2px rgba(21, 32, 43, 0.08);
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .due {
      display: block;
      margin-top: 1px;
      font-size: 7px;
      opacity: 0.8;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .epic-bar .due, .story-bar .due {
      font-size: 8px;
    }
    .marker-tag { top: 50%; }
    .spine {
      position: relative;
      z-index: 1;
      height: ${spineHeight}px;
      margin: 0.35rem 0;
      overflow: visible;
      break-inside: avoid;
      page-break-inside: avoid;
      -webkit-column-break-inside: avoid;
    }
    .spine-line {
      position: absolute;
      left: 0; right: 0; top: 50%;
      height: 1px;
      background: #c5ced6;
    }
    .project-mark {
      position: absolute;
      top: 0;
      bottom: 0;
      width: 1px;
      background: rgba(58, 112, 186, 0.45);
    }
    .marker {
      position: absolute;
      top: 50%;
      transform: translate(-50%, -50%);
      width: 0;
      z-index: 1;
    }
    .marker .rib {
      left: 50%;
      top: 50%;
    }
    .diamond {
      position: absolute;
      left: 50%;
      top: 50%;
      width: 9px;
      height: 9px;
      margin: -4.5px 0 0 -4.5px;
      background: #d4a017;
      border: 1px solid #b8860b;
      transform: rotate(45deg);
      z-index: 3;
    }
    .dot {
      position: absolute;
      left: 50%;
      top: 50%;
      width: 8px;
      height: 8px;
      margin: -4px 0 0 -4px;
      border-radius: 50%;
      background: #5b6b7c;
      z-index: 3;
    }
    .empty { color: #5b6b7c; padding: 1.5rem 0; text-align: center; }
  </style>
</head>
<body>
  <h1>${escapeHtml(input.title)}</h1>
  <p class="sub">${escapeHtml(input.projectName)} · ${escapeHtml(input.labels.generated)} ${escapeHtml(generated)}${
    input.windowFrom || input.windowTo
      ? ` · ${escapeHtml(formatYmd(startMs))} → ${escapeHtml(formatYmd(endMs))}`
      : ''
  }</p>
  <div class="legend">
    ${
      colorByStatus
        ? scheduleLegend
        : `${input.filters.includeEpics ? `<span><i class="swatch-epic"></i>${escapeHtml(input.labels.epic)}</span>` : ''}
    ${input.filters.includeStories ? `<span><i class="swatch-story"></i>${escapeHtml(input.labels.story)}</span>` : ''}
    ${input.filters.includeMilestones ? `<span><i class="swatch-diamond"></i>${escapeHtml(input.labels.milestone)}</span>` : ''}
    ${input.filters.includeTasks ? `<span><i class="swatch-dot"></i>${escapeHtml(input.labels.task)}</span>` : ''}`
    }
  </div>
  <div class="chart">
    <div class="axis">${ticksHtml}${todayAxisHtml}</div>
    <div class="chart-body">
      ${gridHtml}
      ${renderEpicGroup(aboveEpics)}
      ${standaloneHtml}
      ${
        showSpine
          ? `<div class="spine"><div class="spine-line"></div>${projectMarkersHtml}${markersHtml}</div>`
          : ''
      }
      ${renderEpicGroup(belowEpics)}
      ${hasContent ? '' : `<p class="empty">${escapeHtml(input.labels.empty)}</p>`}
    </div>
  </div>
</body>
</html>`;
}

export async function buildTimelinePdf(
  input: TimelineExportInput,
): Promise<Buffer> {
  const html = buildTimelineHtml(input);
  return renderHtmlDocumentToPdf({
    html,
    title: input.title,
    landscape: true,
  });
}
