/** Horizontal scale, tick density, and tag lanes for the delivery timeline. */

export const DAY_MS = 86_400_000;

/** Discrete zoom steps. Index 0 is the default overview. */
export const TIMELINE_ZOOM_LEVELS = [
  { id: 'month', pxPerDay: 8 },
  { id: 'week', pxPerDay: 28 },
  { id: 'day', pxPerDay: 72 },
] as const;

export const DEFAULT_TIMELINE_ZOOM_INDEX = 0;

export const MARKER_TAG_WIDTH_PX = 176;
export const MARKER_TAG_GAP_PX = 12;
export const MARKER_LANE_PITCH_PX = 84;

export const STORY_TAG_WIDTH_PX = 224;
export const STORY_TAG_GAP_PX = 8;
export const STORY_LANE_PITCH_PX = 48;
export const STORY_BASE_Y_PX = 36;

const GRID_STEP_DAYS = [1, 2, 7, 14, 30, 60, 90, 180] as const;
const GRID_TARGET_PX = 56;
const LABEL_TARGET_PX = 110;
const MAX_GRID_TICKS = 400;

export type TimelineZoomDirection = 'in' | 'out';

export type MarkerLane = {
  lane: number;
  side: 'above' | 'below';
};

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function parseYmd(value: string): number {
  const parts = value.split('-').map(Number);
  const y = parts[0] ?? 1970;
  const m = parts[1] ?? 1;
  const d = parts[2] ?? 1;
  return Date.UTC(y, m - 1, d);
}

export function formatYmd(ms: number): string {
  const date = new Date(ms);
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDays(ms: number, days: number): number {
  return ms + days * DAY_MS;
}

/** Inclusive overlap of [start, end] with [winStart, winEnd]. */
export function rangeOverlaps(
  startMs: number,
  endMs: number,
  winStart: number,
  winEnd: number,
): boolean {
  return startMs <= winEnd && endMs >= winStart;
}

export function timelineZoomPx(index: number): number {
  const level = TIMELINE_ZOOM_LEVELS[clampZoomIndex(index)];
  return level ? level.pxPerDay : TIMELINE_ZOOM_LEVELS[0].pxPerDay;
}

export function clampZoomIndex(index: number): number {
  return clamp(index, 0, TIMELINE_ZOOM_LEVELS.length - 1);
}

export function canZoomTimeline(index: number, direction: TimelineZoomDirection): boolean {
  if (direction === 'in') return index < TIMELINE_ZOOM_LEVELS.length - 1;
  return index > 0;
}

export function nextZoomIndex(index: number, direction: TimelineZoomDirection): number | null {
  if (!canZoomTimeline(index, direction)) return null;
  return direction === 'in' ? index + 1 : index - 1;
}

/** Natural chart width in px before the viewport floor (`max(100%, this)`). */
export function timelineNaturalWidthPx(rangeDays: number, pxPerDay: number): number {
  return Math.max(1, rangeDays) * pxPerDay;
}

export function stepDaysForPx(pxPerDay: number, targetPx: number): number {
  const raw = targetPx / Math.max(pxPerDay, 1);
  for (const step of GRID_STEP_DAYS) {
    if (step >= raw - 0.001) return step;
  }
  return 180;
}

function stepThatFits(startMs: number, endMs: number, pxPerDay: number, targetPx: number): number {
  let step = stepDaysForPx(pxPerDay, targetPx);
  const spanDays = Math.max(1, (endMs - startMs) / DAY_MS);
  while (spanDays / step > MAX_GRID_TICKS) {
    const next = GRID_STEP_DAYS.find((candidate) => candidate > step);
    if (!next) return step;
    step = next;
  }
  return step;
}

function firstInterior(startMs: number, stepDays: number): number {
  if (stepDays >= 28) {
    const date = new Date(startMs);
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
  }
  return startMs + stepDays * DAY_MS;
}

function advanceTick(ms: number, stepDays: number): number {
  if (stepDays >= 28) {
    const date = new Date(ms);
    const months = Math.max(1, Math.round(stepDays / 30));
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1);
  }
  return ms + stepDays * DAY_MS;
}

function collectTicks(startMs: number, endMs: number, stepDays: number): string[] {
  const ticks: string[] = [formatYmd(startMs)];
  let ms = firstInterior(startMs, stepDays);
  let guard = 0;
  while (ms < endMs - DAY_MS * 0.5 && guard < MAX_GRID_TICKS) {
    const label = formatYmd(ms);
    if (label !== ticks[ticks.length - 1]) ticks.push(label);
    ms = advanceTick(ms, stepDays);
    guard += 1;
  }
  const endLabel = formatYmd(endMs);
  if (ticks[ticks.length - 1] !== endLabel) ticks.push(endLabel);
  return ticks;
}

/** Grid and label ticks. Finer px-per-day yields finer steps. */
export function buildTimelineTicks(
  startMs: number,
  endMs: number,
  pxPerDay: number,
): { labelTicks: string[]; gridTicks: string[] } {
  const safeEnd = endMs <= startMs ? addDays(startMs, 1) : endMs;
  const gridStep = stepThatFits(startMs, safeEnd, pxPerDay, GRID_TARGET_PX);
  const labelStep = Math.max(gridStep, stepThatFits(startMs, safeEnd, pxPerDay, LABEL_TARGET_PX));
  return {
    gridTicks: collectTicks(startMs, safeEnd, gridStep),
    labelTicks: collectTicks(startMs, safeEnd, labelStep),
  };
}

export function viewportCenterFraction(
  scrollLeft: number,
  clientWidth: number,
  scrollWidth: number,
): number {
  if (scrollWidth <= 0) return 0;
  return (scrollLeft + clientWidth / 2) / scrollWidth;
}

export function scrollLeftForFraction(
  fraction: number,
  clientWidth: number,
  scrollWidth: number,
): number {
  const maxScroll = Math.max(0, scrollWidth - clientWidth);
  const target = fraction * scrollWidth - clientWidth / 2;
  return clamp(target, 0, maxScroll);
}

export function scrollLeftForDate(
  dateMs: number,
  rangeStart: number,
  rangeEnd: number,
  clientWidth: number,
  scrollWidth: number,
): number {
  const span = Math.max(1, rangeEnd - rangeStart);
  const fraction = clamp((dateMs - rangeStart) / span, 0, 1);
  return scrollLeftForFraction(fraction, clientWidth, scrollWidth);
}

type PackOptions = {
  tagWidthPx: number;
  gapPx: number;
};

/**
 * Greedy horizontal lanes. Lane 0 is above the axis, lane 1 below,
 * then further out. Items far apart share a lane.
 */
export function packMarkerLanes(
  items: Array<{ id: string; xPx: number }>,
  options: PackOptions = {
    tagWidthPx: MARKER_TAG_WIDTH_PX,
    gapPx: MARKER_TAG_GAP_PX,
  },
): Map<string, MarkerLane> {
  const sorted = [...items].sort((a, b) => a.xPx - b.xPx || a.id.localeCompare(b.id));
  const laneRight: number[] = [];
  const result = new Map<string, MarkerLane>();
  const half = options.tagWidthPx / 2;
  for (const item of sorted) {
    const left = item.xPx - half;
    const right = item.xPx + half;
    let placed = -1;
    for (let index = 0; index < laneRight.length; index += 1) {
      const occupiedUntil = laneRight[index] ?? Number.NEGATIVE_INFINITY;
      if (left >= occupiedUntil + options.gapPx) {
        placed = index;
        laneRight[index] = right;
        break;
      }
    }
    if (placed < 0) {
      placed = laneRight.length;
      laneRight.push(right);
    }
    result.set(item.id, {
      lane: Math.floor(placed / 2),
      side: placed % 2 === 0 ? 'above' : 'below',
    });
  }
  return result;
}

/** Downward lanes under an epic bar. Lane 0 is closest to the bar. */
export function packStoryLanes(
  items: Array<{ id: string; xPx: number }>,
  options: PackOptions = {
    tagWidthPx: STORY_TAG_WIDTH_PX,
    gapPx: STORY_TAG_GAP_PX,
  },
): Map<string, number> {
  const sorted = [...items].sort((a, b) => a.xPx - b.xPx || a.id.localeCompare(b.id));
  const laneRight: number[] = [];
  const result = new Map<string, number>();
  const half = options.tagWidthPx / 2;
  for (const item of sorted) {
    const left = item.xPx - half;
    const right = item.xPx + half;
    let placed = -1;
    for (let index = 0; index < laneRight.length; index += 1) {
      const occupiedUntil = laneRight[index] ?? Number.NEGATIVE_INFINITY;
      if (left >= occupiedUntil + options.gapPx) {
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

export function markerBaseY(side: 'above' | 'below', lane: number): number {
  const magnitude = MARKER_LANE_PITCH_PX * (lane + 1);
  return side === 'above' ? -magnitude : magnitude;
}

export function storyBaseY(lane: number): number {
  return STORY_BASE_Y_PX + lane * STORY_LANE_PITCH_PX;
}

export function markerTrackHeightPx(lanes: Iterable<MarkerLane>): number {
  let maxLane = 0;
  for (const lane of lanes) {
    maxLane = Math.max(maxLane, lane.lane);
  }
  const half = Math.max(160, (maxLane + 1) * MARKER_LANE_PITCH_PX + 56);
  return half * 2;
}

export function storyLaneSpacerPx(maxLane: number): number {
  if (maxLane < 0) return 0;
  return storyBaseY(maxLane) + 48;
}
