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

    expect(html).toContain('transform:translateX(-50%)');
    expect(html).not.toMatch(/width:\s*4[0-9]\./);
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

    expect(html).toContain('2026-02-01 · 2026-02-28');
    expect(html).toContain('left:');
  });
});
