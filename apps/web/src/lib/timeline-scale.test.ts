import { describe, expect, it } from 'vitest';
import {
  TIMELINE_ZOOM_LEVELS,
  AXIS_LABEL_MIN_GAP_PX,
  buildTimelineTicks,
  pruneCollidingAxisLabels,
  canZoomTimeline,
  markerBaseY,
  markerTrackHeightPx,
  nextZoomIndex,
  MARKER_TAG_MIN_WIDTH_PX,
  MARKER_TAG_WIDTH_PX,
  MARKER_ICON_SAME_DATE_PITCH_SCALE,
  MARKER_ICON_STACK_PITCH_PX,
  packMarkerIconStacks,
  packMarkerLanes,
  packStoryLanes,
  rangeOverlaps,
  timelineBandHeightPx,
  timelineBandTopPx,
  timelineCardLeftPx,
  timelineDueDate,
  timelineMarkerWidthPx,
  timelineDueInRange,
  timelineDueLeftPct,
  timelineTagShiftX,
  scrollLeftForDate,
  scrollLeftForFraction,
  storyBaseY,
  storyLaneSpacerPx,
  timelineNaturalWidthPx,
  viewportCenterFraction,
} from './timeline-scale';

const start = Date.UTC(2026, 0, 1);
const end = Date.UTC(2026, 6, 1);

describe('timeline zoom scale', () => {
  it('uses month, week, and day steps that grow the chart', () => {
    expect(TIMELINE_ZOOM_LEVELS.map((level) => level.id)).toEqual(['month', 'week', 'day']);
    const days = 180;
    const widths = TIMELINE_ZOOM_LEVELS.map((level) =>
      timelineNaturalWidthPx(days, level.pxPerDay),
    );
    expect(widths[0]).toBeLessThan(widths[1]!);
    expect(widths[1]).toBeLessThan(widths[2]!);
    expect(widths[2]).toBe(180 * 72);
  });

  it('disables zoom at the ends of the scale', () => {
    expect(canZoomTimeline(0, 'out')).toBe(false);
    expect(canZoomTimeline(0, 'in')).toBe(true);
    expect(nextZoomIndex(0, 'out')).toBeNull();
    expect(nextZoomIndex(0, 'in')).toBe(1);
    const last = TIMELINE_ZOOM_LEVELS.length - 1;
    expect(canZoomTimeline(last, 'in')).toBe(false);
    expect(nextZoomIndex(last, 'out')).toBe(last - 1);
  });

  it('draws a finer grid as px-per-day increases', () => {
    const month = buildTimelineTicks(start, end, 8);
    const week = buildTimelineTicks(start, end, 28);
    const day = buildTimelineTicks(start, end, 72);
    expect(month.gridTicks.length).toBeGreaterThan(2);
    expect(week.gridTicks.length).toBeGreaterThan(month.gridTicks.length);
    expect(day.gridTicks.length).toBeGreaterThan(week.gridTicks.length);
    expect(month.labelTicks[0]).toBe('2026-01-01');
    expect(month.labelTicks.at(-1)).toBe('2026-07-01');
    expect(day.labelTicks.length).toBeGreaterThan(month.labelTicks.length);
  });

  it('drops the axis label that sits on the last one', () => {
    const startMs = Date.UTC(2026, 6, 1);
    const endMs = Date.UTC(2026, 6, 10);
    const ticks = ['2026-07-01', '2026-07-08', '2026-07-10'];
    const width = 400;
    const pruned = pruneCollidingAxisLabels(ticks, startMs, endMs, width);
    expect(pruned[0]).toBe('2026-07-01');
    expect(pruned.at(-1)).toBe('2026-07-10');
    expect(pruned).not.toContain('2026-07-08');
    const wide = pruneCollidingAxisLabels(ticks, startMs, endMs, 9 * 80);
    expect(wide).toEqual(ticks);
    expect(AXIS_LABEL_MIN_GAP_PX).toBeGreaterThan(110);
  });
});

describe('timeline scroll anchor', () => {
  it('keeps a date fraction at the viewport center', () => {
    const fraction = viewportCenterFraction(100, 200, 1000);
    expect(fraction).toBeCloseTo(0.2);
    expect(scrollLeftForFraction(fraction, 200, 2000)).toBe(300);
  });

  it('scrolls a date into the center and clamps at the ends', () => {
    const rangeStart = Date.UTC(2026, 0, 1);
    const rangeEnd = Date.UTC(2026, 0, 21);
    expect(scrollLeftForDate(Date.UTC(2026, 0, 11), rangeStart, rangeEnd, 100, 1000)).toBe(450);
    expect(scrollLeftForDate(rangeStart, rangeStart, rangeEnd, 100, 1000)).toBe(0);
    expect(scrollLeftForDate(rangeEnd, rangeStart, rangeEnd, 100, 1000)).toBe(900);
  });
});

describe('timeline lanes', () => {
  it('stacks close markers and reuses a lane once they clear', () => {
    const lanes = packMarkerLanes(
      [
        { id: 'a', xPx: 0 },
        { id: 'b', xPx: 20 },
        { id: 'c', xPx: 400 },
      ],
      { tagWidthPx: 100, gapPx: 8 },
    );
    expect(lanes.get('a')).toEqual({ lane: 0, side: 'above' });
    expect(lanes.get('b')).toEqual({ lane: 0, side: 'below' });
    expect(lanes.get('c')).toEqual({ lane: 0, side: 'above' });
    expect(markerBaseY('above', 0)).toBeLessThan(0);
    expect(markerBaseY('below', 0)).toBeGreaterThan(0);
    expect(markerTrackHeightPx(lanes.values())).toBeGreaterThan(0);
  });

  it('uses each card width when dates make one card wider', () => {
    const lanes = packMarkerLanes(
      [
        { id: 'wide', xPx: 100, widthPx: 220 },
        { id: 'near', xPx: 180, widthPx: 176 },
      ],
      { tagWidthPx: 176, gapPx: 12 },
    );
    expect(lanes.get('wide')?.side).toBe('above');
    expect(lanes.get('near')?.side).toBe('below');
  });

  it('sizes a card to the longer date line when start and due wrap', () => {
    expect(timelineMarkerWidthPx(null)).toBe(MARKER_TAG_WIDTH_PX);
    expect(timelineMarkerWidthPx([])).toBe(MARKER_TAG_WIDTH_PX);
    expect(timelineMarkerWidthPx(['1 Jul 2026'])).toBe(MARKER_TAG_MIN_WIDTH_PX);
    const pair = timelineMarkerWidthPx(['2026. okt. 15.', '2026. dec. 31.']);
    expect(pair).toBe(timelineMarkerWidthPx(['2026. okt. 15.']));
    expect(pair).toBeLessThan(MARKER_TAG_WIDTH_PX);
  });

  it('places overlapping spine icons side by side and leaves separated ones in place', () => {
    const stacks = packMarkerIconStacks([
      { id: 'later', xPx: 40 },
      { id: 'top', xPx: 40 },
      { id: 'clear', xPx: 400 },
    ]);
    const samePitch = MARKER_ICON_STACK_PITCH_PX * MARKER_ICON_SAME_DATE_PITCH_SCALE;
    expect(stacks.get('later')).toBeCloseTo(-samePitch / 2);
    expect(stacks.get('top')).toBeCloseTo(samePitch / 2);
    expect(stacks.get('clear')).toBe(0);
  });

  it('pulls a neighbor into the row when spreading would cover it', () => {
    const stacks = packMarkerIconStacks(
      [
        { id: 'left', xPx: 0 },
        { id: 'a', xPx: 30 },
        { id: 'b', xPx: 30 },
        { id: 'c', xPx: 30 },
      ],
      { gapPx: 18, pitchPx: 18 },
    );
    const placed = [
      0 + (stacks.get('left') ?? 0),
      30 + (stacks.get('a') ?? 0),
      30 + (stacks.get('b') ?? 0),
      30 + (stacks.get('c') ?? 0),
    ];
    expect(placed[1]! - placed[0]!).toBeGreaterThanOrEqual(18);
    expect(placed[2]! - placed[1]!).toBeCloseTo(18 * MARKER_ICON_SAME_DATE_PITCH_SCALE);
    expect(placed[3]! - placed[2]!).toBeCloseTo(18 * MARKER_ICON_SAME_DATE_PITCH_SCALE);
  });

  it('packs story tags downward and spaces the spacer', () => {
    const lanes = packStoryLanes(
      [
        { id: 'near', xPx: 10 },
        { id: 'also', xPx: 30 },
        { id: 'far', xPx: 500 },
      ],
      { tagWidthPx: 80, gapPx: 8 },
    );
    expect(lanes.get('near')).toBe(0);
    expect(lanes.get('also')).toBe(1);
    expect(lanes.get('far')).toBe(0);
    expect(storyBaseY(1)).toBeGreaterThan(storyBaseY(0));
    expect(storyLaneSpacerPx(1)).toBeGreaterThan(storyLaneSpacerPx(0));
    expect(storyLaneSpacerPx(-1)).toBe(0);
  });
});

describe('timeline period overlap', () => {
  it('keeps bars that cross the period and drops the rest', () => {
    const from = Date.UTC(2026, 3, 1);
    const to = Date.UTC(2026, 3, 30);
    expect(rangeOverlaps(Date.UTC(2026, 2, 1), Date.UTC(2026, 3, 10), from, to)).toBe(true);
    expect(rangeOverlaps(Date.UTC(2026, 5, 1), Date.UTC(2026, 5, 20), from, to)).toBe(false);
    expect(rangeOverlaps(from, from, from, to)).toBe(true);
  });
});

describe('timeline due anchoring', () => {
  it('prefers end/due over start for card position', () => {
    expect(timelineDueDate('2026-01-01', '2026-03-15')).toBe('2026-03-15');
    expect(timelineDueDate('2026-01-01', null)).toBe('2026-01-01');
    expect(timelineDueDate(null, null)).toBeNull();
  });

  it('filters by due date inside the visible window', () => {
    const from = Date.UTC(2026, 3, 1);
    const to = Date.UTC(2026, 3, 30);
    expect(timelineDueInRange('2026-05-10', from, to)).toBe(false);
    expect(timelineDueInRange('2026-04-15', from, to)).toBe(true);
    expect(timelineDueInRange(null, from, to)).toBe(false);
  });

  it('maps due dates to horizontal percent without using the start span', () => {
    const rangeStart = Date.UTC(2026, 0, 1);
    const span = Date.UTC(2026, 2, 1) - rangeStart;
    const dueOnly = timelineDueLeftPct('2026-02-01', rangeStart, span);
    const wideStart = timelineDueLeftPct('2026-02-01', rangeStart, span);
    expect(dueOnly).toBe(wideStart);
    expect(dueOnly).toBeGreaterThan(0);
    expect(dueOnly).toBeLessThan(100);
  });

  it('clamps a due-anchored card inside the chart', () => {
    expect(timelineCardLeftPx(500, 1000, 200)).toBe(400);
    expect(timelineCardLeftPx(10, 1000, 200)).toBe(0);
    expect(timelineCardLeftPx(990, 1000, 200)).toBe(800);
    expect(timelineCardLeftPx(0, 80, 100)).toBe(0);
    expect(timelineTagShiftX(500, 1000, 200, 0)).toBe(0);
    expect(timelineTagShiftX(10, 1000, 200, 0)).toBe(90);
    expect(timelineTagShiftX(500, 1000, 200, 12)).toBe(12);
  });

  it('shares a lane when cards do not overlap and stacks when they do', () => {
    const lanes = packStoryLanes(
      [
        { id: 'left', xPx: 40 },
        { id: 'overlap', xPx: 80 },
        { id: 'clear', xPx: 400 },
      ],
      { tagWidthPx: 100, gapPx: 8 },
    );
    expect(lanes.get('left')).toBe(0);
    expect(lanes.get('overlap')).toBe(1);
    expect(lanes.get('clear')).toBe(0);
    expect(timelineBandTopPx(0)).toBe(0);
    expect(timelineBandTopPx(1)).toBeGreaterThan(0);
    expect(timelineBandHeightPx(1)).toBeGreaterThan(timelineBandHeightPx(0));
    expect(timelineBandHeightPx(-1)).toBe(0);
  });
});
