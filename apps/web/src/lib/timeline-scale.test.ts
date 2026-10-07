import { describe, expect, it } from 'vitest';
import {
  TIMELINE_ZOOM_LEVELS,
  buildTimelineTicks,
  canZoomTimeline,
  markerBaseY,
  markerTrackHeightPx,
  nextZoomIndex,
  packMarkerLanes,
  packStoryLanes,
  rangeOverlaps,
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
