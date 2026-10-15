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
  humanKey?: string | null;
};

export type TimelineExportStory = {
  id: string;
  epicId: string;
  title: string;
  status: string;
  startDate: string | null;
  endDate: string | null;
  humanKey?: string | null;
};

export type TimelineExportMilestone = {
  id: string;
  title: string;
  status: string;
  startDate?: string | null;
  targetDate: string | null;
  humanKey?: string | null;
};

export type TimelineExportTask = {
  id: string;
  title: string;
  status: string;
  dueDate: string | null;
  startDate?: string | null;
  humanKey?: string | null;
};

export type TimelineTagOffset = { dx: number; dy: number };

type ScheduleTone = 'onTrack' | 'atRisk' | 'overdue' | 'completed' | 'neutral';

const DEFAULT_RIB_Y = 96;
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

function getOffset(offsets: Record<string, TimelineTagOffset>, id: string): TimelineTagOffset {
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
  for (let ms = startMs; ms <= endMs && gridTicks.length < 62; ms = addDays(ms, gridStepDays)) {
    gridTicks.push(formatYmd(ms));
  }
  const endLabel = formatYmd(endMs);
  if (gridTicks[gridTicks.length - 1] !== endLabel) {
    gridTicks.push(endLabel);
  }

  const targetLabels = Math.min(12, Math.max(4, gridTicks.length));
  const labelStride = Math.max(1, Math.ceil(gridTicks.length / targetLabels));
  const labelTicks = gridTicks.filter(
    (_, index) => index === 0 || index === gridTicks.length - 1 || index % labelStride === 0,
  );

  return { startMs, endMs, labelTicks, gridTicks };
}

function pct(date: string, startMs: number, endMs: number): number {
  const span = Math.max(1, endMs - startMs);
  return clamp(((parseYmd(date) - startMs) / span) * 100, 0, 100);
}

function timelineDueDate(start: string | null, endOrDue: string | null): string | null {
  return endOrDue ?? start;
}

function dueInWindow(
  start: string | null,
  endOrDue: string | null,
  startMs: number,
  endMs: number,
): boolean {
  const due = timelineDueDate(start, endOrDue);
  if (!due) return false;
  const ms = parseYmd(due);
  return ms >= startMs && ms <= endMs;
}

const CARD_WIDTH_PCT = 18;
const CARD_GAP_PCT = 1;
const CARD_LANE_PX = 52;

/** Left edge of a due-anchored card, clamped inside the page. */
function cardLeftPct(anchorPct: number, widthPct = CARD_WIDTH_PCT): number {
  return clamp(anchorPct - widthPct / 2, 0, 100 - widthPct);
}

/** Greedy rows. Items that do not overlap share a lane. */
function packLanesPct(items: Array<{ id: string; xPct: number }>): Map<string, number> {
  const sorted = [...items].sort((a, b) => a.xPct - b.xPct || a.id.localeCompare(b.id));
  const laneRight: number[] = [];
  const result = new Map<string, number>();
  const half = CARD_WIDTH_PCT / 2;
  for (const item of sorted) {
    const left = item.xPct - half;
    const right = item.xPct + half;
    let placed = -1;
    for (let index = 0; index < laneRight.length; index += 1) {
      const occupiedUntil = laneRight[index] ?? Number.NEGATIVE_INFINITY;
      if (left >= occupiedUntil + CARD_GAP_PCT) {
        placed = index;
        laneRight[index] = right;
        break;
      }
    }
    if (placed < 0) {
      placed = laneRight.length;
      laneRight.push(right);
    }
    result.set(item.id, placed);
  }
  return result;
}

function ribHtml(dx: number, dy: number): string {
  const len = Math.max(1, Math.hypot(dx, dy));
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  return `<div class="rib" style="width:${len.toFixed(1)}px;transform:rotate(${angle.toFixed(2)}deg)"></div>`;
}

function metaRowHtml(input: {
  humanKey?: string | null;
  startDate?: string | null;
  dueDate?: string | null;
  showIssueIds: boolean;
  showStartDates: boolean;
  showDueDates: boolean;
}): string {
  const id = input.showIssueIds && input.humanKey ? input.humanKey : null;
  const start = input.showStartDates && input.startDate ? input.startDate : null;
  const due = input.showDueDates && input.dueDate ? input.dueDate : null;
  const dates = [start, due]
    .filter(Boolean)
    .map((value) => escapeHtml(value!))
    .join(' · ');
  if (!id && !dates) return '';
  if (id && dates) {
    return `<span class="meta-stack"><span class="id">${escapeHtml(id)}</span><span class="due">${dates}</span></span>`;
  }
  if (id) return `<span class="id">${escapeHtml(id)}</span>`;
  return `<span class="due">${dates}</span>`;
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
  showStartDates?: boolean;
  showDueDates?: boolean;
  showIssueIds?: boolean;
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
  const showStartDates = Boolean(input.showStartDates);
  const showDueDates = Boolean(input.showDueDates);
  const showIssueIds = input.showIssueIds !== false;
  const showGrid = input.showGrid !== false;
  const today = input.today ?? todayYmdUtc();
  const todayMs = parseYmd(today);
  const todayInRange = todayMs >= startMs && todayMs <= endMs;

  const scheduleCards: Array<{
    id: string;
    title: string;
    due: string;
    startDate: string | null;
    endDate: string | null;
    status: string;
    humanKey: string | null;
  }> = [];
  if (input.filters.includeEpics) {
    for (const epic of input.epics) {
      const due = timelineDueDate(epic.startDate, epic.endDate);
      if (!due || !dueInWindow(epic.startDate, epic.endDate, startMs, endMs)) continue;
      scheduleCards.push({
        id: `epic:${epic.id}`,
        title: epic.title,
        due,
        startDate: epic.startDate,
        endDate: epic.endDate,
        status: epic.status,
        humanKey: epic.humanKey ?? null,
      });
    }
  }
  if (input.filters.includeStories) {
    for (const story of input.stories) {
      const due = timelineDueDate(story.startDate, story.endDate);
      if (!due || !dueInWindow(story.startDate, story.endDate, startMs, endMs)) continue;
      scheduleCards.push({
        id: `story:${story.id}`,
        title: story.title,
        due,
        startDate: story.startDate,
        endDate: story.endDate,
        status: story.status,
        humanKey: story.humanKey ?? null,
      });
    }
  }

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
      startDate: row.startDate ?? null,
      status: row.status,
      humanKey: row.humanKey ?? null,
    })),
    ...taskMarkers.map((row) => ({
      id: `task:${row.id}`,
      kind: 'task' as const,
      title: row.title,
      date: row.dueDate!,
      startDate: row.startDate ?? null,
      status: row.status,
      humanKey: row.humanKey ?? null,
    })),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));

  const showSpine =
    markers.length > 0 || Boolean(input.projectStartDate) || Boolean(input.projectEndDate);

  let spineHalf = markers.length > 0 ? 160 : 16;
  for (const [index, marker] of markers.entries()) {
    const above = index % 2 === 0;
    const baseY = above ? -DEFAULT_RIB_Y : DEFAULT_RIB_Y;
    const offset = getOffset(offsets, marker.id);
    spineHalf = Math.max(
      spineHalf,
      Math.abs(baseY + offset.dy) + (showStartDates || showDueDates || showIssueIds ? 48 : 36),
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

  const cardLanes = packLanesPct(
    scheduleCards.map((card) => ({
      id: card.id,
      xPct: pct(card.due, startMs, endMs),
    })),
  );
  let maxCardLane = -1;
  for (const lane of cardLanes.values()) maxCardLane = Math.max(maxCardLane, lane);
  const cardTrackHeight = maxCardLane < 0 ? 0 : (maxCardLane + 1) * CARD_LANE_PX;
  const scheduleHtml =
    cardTrackHeight === 0
      ? ''
      : `<div class="card-track" style="height:${cardTrackHeight}px">${scheduleCards
          .map((card) => {
            const anchor = pct(card.due, startMs, endMs);
            const left = cardLeftPct(anchor);
            const top = (cardLanes.get(card.id) ?? 0) * CARD_LANE_PX;
            const tone = colorByStatus
              ? scheduleTone({ status: card.status, date: card.due, today })
              : null;
            const toneCss = tone ? surfaceStyle(tone) : '';
            return `<div class="item-card" style="left:${left.toFixed(2)}%;top:${top}px;width:${CARD_WIDTH_PCT}%;${toneCss}">${escapeHtml(card.title)}${metaRowHtml(
              {
                humanKey: card.humanKey,
                startDate: card.startDate,
                dueDate: card.endDate,
                showIssueIds,
                showStartDates,
                showDueDates,
              },
            )}</div>`;
          })
          .join('')}</div>`;

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
  <div class="marker-tag" style="${tagStyle}">${escapeHtml(marker.title)}${metaRowHtml({
    humanKey: marker.humanKey,
    startDate: marker.startDate,
    dueDate: marker.date,
    showIssueIds,
    showStartDates,
    showDueDates,
  })}</div>
  <div class="${iconClass}"${iconStyle}></div>
</div>`;
    })
    .join('');

  const hasContent = scheduleCards.length > 0 || markers.length > 0;

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
    .swatch-epic, .swatch-story { width: 18px; height: 8px; border-radius: 3px; background: #fff; border: 1px solid #c5ced6; }
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
    .card-track {
      position: relative;
      z-index: 1;
      margin-bottom: 0.35rem;
    }
    .item-card {
      position: absolute;
      box-sizing: border-box;
      overflow: hidden;
      padding: 0.12rem 0.35rem;
      border: 1px solid #c5ced6;
      border-radius: 4px;
      background: #fff;
      color: #15202b;
      font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
      font-size: 9px;
      font-weight: 400;
      line-height: 1.3;
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
    .id {
      display: block;
      margin-top: 1px;
      font-size: 7px;
      opacity: 0.8;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .meta-stack { display: block; margin-top: 1px; }
    .meta-stack .id, .meta-stack .due { display: block; margin-top: 0; }
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
      ${scheduleHtml}
      ${
        showSpine
          ? `<div class="spine"><div class="spine-line"></div>${projectMarkersHtml}${markersHtml}</div>`
          : ''
      }
      ${hasContent ? '' : `<p class="empty">${escapeHtml(input.labels.empty)}</p>`}
    </div>
  </div>
</body>
</html>`;
}

export async function buildTimelinePdf(input: TimelineExportInput): Promise<Buffer> {
  const html = buildTimelineHtml(input);
  return renderHtmlDocumentToPdf({
    html,
    title: input.title,
    landscape: true,
  });
}
