import { describe, expect, it } from 'vitest';
import { buildTimelineHtml } from './timeline-export.js';

const labels = {
  epic: 'Epic',
  story: 'Story',
  milestone: 'Milestone',
  task: 'Task',
  generated: 'Generated',
  empty: 'Empty',
};

describe('buildTimelineHtml due anchoring', () => {
  it('anchors epic bars on the due date instead of spanning start..end', () => {
    const html = buildTimelineHtml({
      title: 'Timeline',
      projectName: 'Demo',
      projectStartDate: '2026-01-01',
      projectEndDate: '2026-12-31',
      epics: [
        {
          id: 'e1',
          title: 'Wide epic',
          status: 'in_progress',
          startDate: '2026-01-01',
          endDate: '2026-06-30',
        },
      ],
      stories: [],
      milestones: [],
      tasks: [],
      filters: {
        includeEpics: true,
        includeStories: false,
        includeMilestones: false,
        includeTasks: false,
      },
      labels,
    });

    expect(html).toContain('class="marker"');
    expect(html).not.toContain('lane-title');
    expect(html).not.toContain('epic-bar');
    expect(html).not.toContain('class="item-card"');
    expect(html).not.toMatch(/width:\s*4[0-9]\./);
    const card = html.match(/class="marker" style="([^"]*)"/);
    expect(card).toBeTruthy();
    const left = Number(card?.[1]?.match(/left:([\d.]+)%/)?.[1]);
    expect(left).toBeGreaterThan(30);
    expect(left).toBeLessThan(60);
    expect(html).toContain('Wide epic');
  });

  it('renders optional start date text without changing anchor position', () => {
    const html = buildTimelineHtml({
      title: 'Timeline',
      projectName: 'Demo',
      projectStartDate: null,
      projectEndDate: null,
      epics: [
        {
          id: 'e1',
          title: 'Epic',
          status: 'planned',
          startDate: '2026-02-01',
          endDate: '2026-02-28',
        },
      ],
      stories: [],
      milestones: [],
      tasks: [],
      filters: {
        includeEpics: true,
        includeStories: false,
        includeMilestones: false,
        includeTasks: false,
      },
      showStartDates: true,
      showDueDates: true,
      labels,
    });

    expect(html).toContain('2026-02-01');
    expect(html).toContain('2026-02-28');
    expect(html).not.toContain('2026-02-01 · 2026-02-28');
    expect(html).toContain('class="marker"');
    expect(html).not.toContain('class="item-card"');
    expect(html).not.toContain('lane-title');
  });

  it('packs non-overlapping cards onto one row and clamps the left edge', () => {
    const html = buildTimelineHtml({
      title: 'Timeline',
      projectName: 'Demo',
      projectStartDate: '2026-01-01',
      projectEndDate: '2026-12-31',
      epics: [],
      stories: [
        {
          id: 's1',
          epicId: 'e',
          title: 'Early',
          status: 'planned',
          startDate: '2026-01-01',
          endDate: '2026-01-15',
          humanKey: 'S-1',
        },
        {
          id: 's2',
          epicId: 'e',
          title: 'Late',
          status: 'planned',
          startDate: '2026-02-01',
          endDate: '2026-12-01',
          humanKey: 'S-2',
        },
        {
          id: 's3',
          epicId: 'e',
          title: 'Also early',
          status: 'planned',
          startDate: '2026-01-02',
          endDate: '2026-01-20',
          humanKey: 'S-3',
        },
      ],
      milestones: [],
      tasks: [],
      filters: {
        includeEpics: false,
        includeStories: true,
        includeMilestones: false,
        includeTasks: false,
      },
      labels,
    });

    expect(html).not.toContain('lane-title');
    expect(html).not.toContain('story-bar');
    expect(html).not.toContain('class="item-card"');

    function markerBlock(title: string): string {
      const chunk = html
        .split('<div class="marker"')
        .slice(1)
        .find((part) => part.includes(`>${title}<`));
      expect(chunk, title).toBeTruthy();
      return chunk ?? '';
    }

    const early = markerBlock('Early');
    const late = markerBlock('Late');
    const also = markerBlock('Also early');
    const shiftPattern = /calc\(-50% \+ -?\d+px\), calc\(-50% \+ (-?\d+)px\)/;
    const earlyShift = early.match(shiftPattern);
    const lateShift = late.match(shiftPattern);
    const alsoShift = also.match(shiftPattern);
    expect(earlyShift?.[1]).toBe(lateShift?.[1]);
    expect(alsoShift?.[1]).not.toBe(earlyShift?.[1]);
    expect(Number(early.match(/left:([\d.]+)/)?.[1])).toBeLessThan(10);
    expect(Number(late.match(/left:([\d.]+)/)?.[1])).toBeGreaterThan(70);
  });
});
