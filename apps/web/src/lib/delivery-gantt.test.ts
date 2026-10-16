import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PROJECT_CALENDAR, type ProjectWorkingCalendar } from '@project-knowledge-hub/domain';
import de from '../../messages/de.json';
import en from '../../messages/en.json';
import hu from '../../messages/hu.json';
import {
  GANTT_COLUMNS,
  GANTT_PX_PER_DAY,
  buildGanttRows,
  dependencyEndpoints,
  ganttArrowPath,
  ganttBarGeometry,
  ganttColumnOffsets,
  ganttDependencyArrows,
  ganttDurationDetail,
  ganttNonWorkingBands,
  ganttTimelineRange,
  ganttTodayX,
  predecessorLabels,
  visibleGanttRows,
  type GanttDependency,
  type GanttEpicInput,
  type GanttStoryInput,
} from './delivery-gantt';

const root = dirname(fileURLToPath(import.meta.url));

const holidayCalendar: ProjectWorkingCalendar = {
  hoursPerWorkday: 7.5,
  workdaysPerWeek: 5,
  nonWorkingDays: ['2026-10-13'],
};

function epic(id: string, sortOrder: number, title = id): GanttEpicInput {
  return {
    id,
    title,
    status: 'planned',
    sortOrder,
    startDate: null,
    endDate: null,
    percent: null,
  };
}

function story(
  id: string,
  epicId: string,
  sortOrder: number,
  extra: Partial<GanttStoryInput> = {},
): GanttStoryInput {
  return {
    id,
    epicId,
    title: id,
    status: 'planned',
    sortOrder,
    startDate: null,
    endDate: null,
    percent: null,
    ...extra,
  };
}

describe('gantt WBS numbering', () => {
  const rows = buildGanttRows({
    epics: [epic('e1', 1, 'One'), epic('e2', 2, 'Two'), epic('e3', 3, 'Three')],
    stories: [
      story('s1', 'e3', 1),
      story('s2', 'e3', 2),
      story('s3', 'e3', 3),
      story('s4', 'e3', 4, { humanKey: 'MIL-S-4' }),
    ],
    tasks: [
      {
        id: 'bug',
        title: 'Leak',
        status: 'todo',
        userStoryId: 's1',
        dueDate: null,
        itemType: 'bug',
        humanKey: 'MIL-B-2',
      },
      {
        id: 'task',
        title: 'Write',
        status: 'in_progress',
        userStoryId: 's4',
        startDate: '2026-10-01',
        dueDate: '2026-10-10',
        itemType: 'task',
        humanKey: 'MIL-T-15',
        percent: 25,
      },
    ],
    milestones: [
      {
        id: 'm1',
        title: 'Beta',
        status: 'planned',
        startDate: null,
        targetDate: '2026-10-20',
        humanKey: 'MIL-M-1',
      },
    ],
  });

  it('numbers the tree outline, including a compact 3.4 under the third epic', () => {
    const wbs = new Map(rows.map((row) => [row.id, row.wbs]));
    expect(rows.find((row) => row.id === 'milestone:m1')).toMatchObject({
      wbs: '4',
      start: null,
      end: '2026-10-20',
    });
    expect(wbs.get('epic:e1')).toBe('1');
    expect(wbs.get('epic:e3')).toBe('3');
    expect(wbs.get('story:s1')).toBe('3.1');
    expect(wbs.get('task:bug')).toBe('3.1.1');
    expect(rows.find((row) => row.id === 'task:bug')?.kind).toBe('bug');
    expect(wbs.get('story:s4')).toBe('3.4');
    expect(wbs.get('task:task')).toBe('3.4.1');
  });

  it('places dated milestones by date and groups milestones without dates', () => {
    const placed = buildGanttRows({
      epics: [epic('early', 1, 'Early'), epic('later', 2, 'Later')],
      stories: [
        story('soon', 'early', 1, { startDate: '2026-10-02', endDate: '2026-10-04' }),
        story('after', 'later', 1, { startDate: '2026-10-20', endDate: '2026-10-22' }),
      ],
      tasks: [],
      milestones: [
        {
          id: 'mid',
          title: 'Mid',
          status: 'planned',
          startDate: null,
          targetDate: '2026-10-10',
        },
        {
          id: 'open',
          title: 'Open',
          status: 'planned',
          startDate: '2026-01-01',
          targetDate: null,
        },
      ],
    });
    const ids = placed.map((row) => row.id);
    expect(ids.indexOf('milestone:mid')).toBeGreaterThan(ids.indexOf('story:soon'));
    expect(ids.indexOf('milestone:mid')).toBeLessThan(ids.indexOf('epic:later'));
    expect(placed.find((row) => row.id === 'milestone:mid')).toMatchObject({
      wbs: '2',
      parentId: null,
      depth: 0,
      start: null,
      end: '2026-10-10',
    });
    expect(placed.find((row) => row.id === 'epic:later')?.wbs).toBe('3');
    const group = placed.find((row) => row.id === 'delivery-tree-milestones');
    expect(group).toMatchObject({
      labelKey: 'milestonesWithoutDates',
      wbs: '',
    });
    expect(ids.indexOf('delivery-tree-milestones')).toBeGreaterThan(ids.indexOf('story:after'));
    expect(placed.find((row) => row.id === 'milestone:open')).toMatchObject({
      wbs: '',
      parentId: 'delivery-tree-milestones',
    });
  });

  it('places a dependent milestone immediately after its predecessor', () => {
    const dependency = {
      predecessorType: 'task',
      predecessorId: 'gate',
      predecessorKey: 'T-1',
      successorType: 'milestone',
      successorId: 'm',
      linkType: 'FS',
      lagDays: 0,
    };
    const placed = buildGanttRows({
      epics: [epic('e', 1, 'Epic')],
      stories: [
        story('first', 'e', 1, { startDate: '2026-10-10', endDate: '2026-10-10' }),
        story('later', 'e', 2, { startDate: '2026-10-10', endDate: '2026-10-12' }),
      ],
      tasks: [
        {
          id: 'gate',
          title: 'Gate',
          status: 'done',
          userStoryId: 'first',
          startDate: '2026-10-10',
          dueDate: '2026-10-10',
          itemType: 'task',
        },
        {
          id: 'other',
          title: 'Other',
          status: 'todo',
          userStoryId: 'later',
          startDate: '2026-10-10',
          dueDate: '2026-10-10',
          itemType: 'task',
        },
      ],
      milestones: [
        {
          id: 'm',
          title: 'Gate passed',
          status: 'planned',
          startDate: null,
          targetDate: '2026-10-10',
        },
      ],
      dependencies: [dependency],
    });
    const ids = placed.map((row) => row.id);
    expect(ids.indexOf('milestone:m')).toBe(ids.indexOf('task:gate') + 1);
    expect(ids.indexOf('milestone:m')).toBeLessThan(ids.indexOf('story:later'));
    expect(placed.find((row) => row.id === 'milestone:m')).toMatchObject({
      parentId: 'story:first',
      depth: placed.find((row) => row.id === 'task:gate')?.depth,
      wbs: '1.1.2',
    });
    expect(placed.find((row) => row.id === 'task:gate')?.wbs).toBe('1.1.1');
  });

  it('places a milestone after another milestone it depends on', () => {
    const placed = buildGanttRows({
      epics: [epic('e', 1, 'Epic')],
      stories: [
        story('first', 'e', 1, { startDate: '2026-10-01', endDate: '2026-10-04' }),
        story('later', 'e', 2, { startDate: '2026-10-20', endDate: '2026-10-22' }),
      ],
      tasks: [],
      milestones: [
        {
          id: 'early',
          title: 'Early',
          status: 'planned',
          startDate: null,
          targetDate: '2026-10-10',
        },
        {
          id: 'next',
          title: 'Next',
          status: 'planned',
          startDate: null,
          targetDate: '2026-10-10',
        },
      ],
      dependencies: [
        {
          predecessorType: 'milestone',
          predecessorId: 'early',
          predecessorKey: 'M-1',
          successorType: 'milestone',
          successorId: 'next',
          linkType: 'FS',
          lagDays: 0,
        },
      ],
    });
    const ids = placed.map((row) => row.id);
    expect(ids.indexOf('milestone:next')).toBe(ids.indexOf('milestone:early') + 1);
    expect(ids.indexOf('milestone:next')).toBeLessThan(ids.indexOf('story:later'));
  });

  it('keeps 3.4 when milestones are absent and collapse does not renumber', () => {
    const plain = buildGanttRows({
      epics: [epic('e1', 1), epic('e2', 2), epic('e3', 3)],
      stories: [1, 2, 3, 4].map((order) => story(`s${order}`, 'e3', order)),
      tasks: [],
      milestones: [],
    });
    expect(plain.find((row) => row.id === 'story:s4')?.wbs).toBe('3.4');
    const visible = visibleGanttRows(plain, { 'epic:e3': true });
    expect(visible.map((row) => row.id)).not.toContain('story:s4');
    expect(plain.find((row) => row.id === 'story:s4')?.wbs).toBe('3.4');
    expect(plain.find((row) => row.id === 'epic:e2')?.wbs).toBe('2');
  });

  it('rolls epic and story bars up from child dates and skips cancelled children', () => {
    const rolled = buildGanttRows({
      epics: [epic('e', 1, 'Build')],
      stories: [story('s', 'e', 1, { startDate: '2026-10-02', endDate: '2026-10-04' })],
      tasks: [
        {
          id: 'live',
          title: 'Live',
          status: 'in_progress',
          userStoryId: 's',
          startDate: '2026-10-01',
          dueDate: '2026-10-10',
        },
        {
          id: 'drop',
          title: 'Drop',
          status: 'cancelled',
          userStoryId: 's',
          startDate: '2026-09-01',
          dueDate: '2026-12-01',
        },
      ],
      milestones: [],
    });
    expect(rolled.find((row) => row.id === 'story:s')).toMatchObject({
      start: '2026-10-01',
      end: '2026-10-10',
    });
    expect(rolled.find((row) => row.id === 'epic:e')).toMatchObject({
      start: '2026-10-01',
      end: '2026-10-10',
      wbs: '1',
    });
  });
});

describe('gantt predecessor labels', () => {
  const rows = buildGanttRows({
    epics: [epic('e1', 1), epic('e2', 2), epic('e3', 3)],
    stories: [1, 2, 3, 4].map((order) => story(`s${order}`, 'e3', order)),
    tasks: [
      {
        id: 't15',
        title: 'Keyed',
        status: 'todo',
        userStoryId: 's4',
        dueDate: '2026-10-10',
        humanKey: 'MIL-T-15',
      },
    ],
    milestones: [],
  });
  const wbsById = new Map(rows.map((row) => [row.id, row.wbs]));
  const keyById = new Map(rows.map((row) => [row.id, row.humanKey]));
  const uuid = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  const links: GanttDependency[] = [
    {
      predecessorType: 'user_story',
      predecessorId: 's4',
      predecessorKey: uuid,
      successorType: 'task',
      successorId: 'succ',
      linkType: 'FS',
      lagDays: 0,
    },
    {
      predecessorType: 'task',
      predecessorId: 't15',
      predecessorKey: 'MIL-T-15',
      successorType: 'task',
      successorId: 'succ',
      linkType: 'SS',
      lagDays: 2,
    },
    {
      predecessorType: 'sprint',
      predecessorId: uuid,
      predecessorKey: 'PRO-SP-1',
      successorType: 'task',
      successorId: 'succ',
      linkType: 'FF',
      lagDays: 0,
    },
    {
      predecessorType: 'task',
      predecessorId: uuid,
      predecessorKey: uuid,
      successorType: 'task',
      successorId: 'succ',
      linkType: 'SF',
      lagDays: 0,
    },
  ];

  it('uses human keys or WBS numbers and never a UUID', () => {
    expect(rows.find((row) => row.id === 'story:s4')?.wbs).toBe('3.4');
    const byKey = predecessorLabels({
      successorId: 'task:succ',
      links,
      mode: 'key',
      wbsById,
      keyById,
    });
    const byWbs = predecessorLabels({
      successorId: 'task:succ',
      links,
      mode: 'wbs',
      wbsById,
      keyById,
    });
    expect(byKey).toBe('3.4 FS, MIL-T-15 SS+2, PRO-SP-1 FF');
    expect(byWbs).toBe('3.4 FS, 3.4.1 SS+2, PRO-SP-1 FF');
    expect(byKey).not.toContain(uuid);
    expect(byWbs).not.toContain(uuid);
    expect(byKey).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/i);
  });
});

describe('gantt bar date math', () => {
  const range = { start: '2026-10-12', end: '2026-10-18' };

  it('draws an inclusive start..due bar and shades percent', () => {
    const bar = ganttBarGeometry({
      shape: 'bar',
      start: '2026-10-12',
      end: '2026-10-15',
      percent: 25,
      rangeStart: range.start,
      pxPerDay: 10,
    });
    expect(bar).toEqual({
      kind: 'bar',
      start: '2026-10-12',
      end: '2026-10-15',
      leftPx: 0,
      widthPx: 40,
      completePx: 10,
    });
    const full = ganttBarGeometry({
      shape: 'bar',
      start: '2026-10-12',
      end: '2026-10-15',
      percent: 150,
      rangeStart: range.start,
      pxPerDay: 10,
    });
    expect(full && full.kind === 'bar' ? full.completePx : null).toBe(40);
    expect(ganttBarGeometry({
      shape: 'bar',
      start: null,
      end: null,
      percent: 10,
      rangeStart: range.start,
      pxPerDay: 10,
    })).toBeNull();
  });

  it('places a milestone diamond on the due date', () => {
    expect(ganttBarGeometry({
      shape: 'milestone',
      start: '2026-10-01',
      end: '2026-10-15',
      percent: 100,
      rangeStart: range.start,
      pxPerDay: 10,
    })).toEqual({
      kind: 'milestone',
      date: '2026-10-15',
      centerPx: 35,
    });
  });

  it('counts working days and effort hours, skipping the weekend and a holiday', () => {
    const detail = ganttDurationDetail('2026-10-12', '2026-10-15', holidayCalendar);
    expect(detail).toEqual({ workingDays: 2, effortHours: 15 });
    const bands = ganttNonWorkingBands(range, holidayCalendar, 10);
    expect(bands.map((band) => band.x)).toEqual([10, 50, 60]);
    expect(ganttTodayX('2026-10-14', range, 10)).toBe(25);
    expect(ganttTodayX('2026-11-01', range, 10)).toBeNull();
  });

  it('shortens the same span when the zoom moves from day to month', () => {
    const day = ganttBarGeometry({
      shape: 'bar',
      start: '2026-10-12',
      end: '2026-10-15',
      percent: 0,
      rangeStart: '2026-10-12',
      pxPerDay: GANTT_PX_PER_DAY.day,
    });
    const month = ganttBarGeometry({
      shape: 'bar',
      start: '2026-10-12',
      end: '2026-10-15',
      percent: 0,
      rangeStart: '2026-10-12',
      pxPerDay: GANTT_PX_PER_DAY.month,
    });
    expect(day?.kind).toBe('bar');
    expect(month?.kind).toBe('bar');
    if (day?.kind === 'bar' && month?.kind === 'bar') {
      expect(month.widthPx).toBeLessThan(day.widthPx);
    }
  });

  it('aligns the week and month scales and draws FS arrows between bar ends', () => {
    expect(ganttTimelineRange(['2026-10-14'], '2026-10-14', 'week')).toEqual({
      start: '2026-10-12',
      end: '2026-10-18',
    });
    expect(ganttTimelineRange(['2026-10-14'], '2026-10-14', 'month')).toEqual({
      start: '2026-10-01',
      end: '2026-10-31',
    });
    expect(dependencyEndpoints('FS')).toEqual({ from: 'finish', to: 'start' });
    expect(dependencyEndpoints('SS')).toEqual({ from: 'start', to: 'start' });
    expect(dependencyEndpoints('FF')).toEqual({ from: 'finish', to: 'finish' });
    expect(dependencyEndpoints('SF')).toEqual({ from: 'start', to: 'finish' });
    expect(ganttArrowPath(10, 18, 80, 54)).toBe('M 10 18 H 45 V 54 H 80');

    const linked = buildGanttRows({
      epics: [],
      stories: [],
      tasks: [
        {
          id: 'a',
          title: 'A',
          status: 'todo',
          userStoryId: null,
          startDate: '2026-10-12',
          dueDate: '2026-10-12',
        },
        {
          id: 'b',
          title: 'B',
          status: 'todo',
          userStoryId: null,
          startDate: '2026-10-20',
          dueDate: '2026-10-21',
        },
      ],
      milestones: [],
    });
    const arrows = ganttDependencyArrows({
      rows: linked,
      links: [{
        predecessorType: 'task',
        predecessorId: 'a',
        predecessorKey: 'MIL-T-1',
        successorType: 'task',
        successorId: 'b',
        linkType: 'FS',
        lagDays: 0,
      }],
      rangeStart: '2026-10-12',
      pxPerDay: 10,
      rowHeight: 36,
    });
    // The ungrouped-task group is row 0, so the two bars sit on rows 1 and 2.
    expect(arrows).toEqual([{
      key: 'task:a->task:b:FS',
      linkType: 'FS',
      path: 'M 10 54 H 45 V 90 H 80',
    }]);
    expect(ganttDependencyArrows({
      rows: linked,
      links: [{
        predecessorType: 'task',
        predecessorId: 'a',
        predecessorKey: null,
        successorType: 'task',
        successorId: 'missing',
        linkType: 'SS',
        lagDays: 0,
      }],
      rangeStart: '2026-10-12',
      pxPerDay: 10,
      rowHeight: 36,
    })).toEqual([]);
  });

  it('uses the default calendar when the project has not set one', () => {
    expect(ganttDurationDetail('2026-10-12', '2026-10-16', DEFAULT_PROJECT_CALENDAR))
      .toEqual({ workingDays: 4, effortHours: 32 });
  });
});

describe('gantt column presets and copy', () => {
  it('keeps the requested columns, with the chart beside every preset', () => {
    expect(GANTT_COLUMNS.default).toEqual([
      'wbs',
      'title',
      'status',
      'percent',
      'duration',
      'predecessors',
    ]);
    expect(GANTT_COLUMNS.compact).toEqual(['wbs', 'title', 'percent']);
    expect(ganttColumnOffsets('default').get('wbs')).toBe(0);
    expect(ganttColumnOffsets('default').get('predecessors')).toBe(700);
    expect(ganttColumnOffsets('compact').get('percent')).toBe(344);
    expect(GANTT_COLUMNS.planning).toEqual([
      'wbs',
      'title',
      'duration',
      'predecessors',
      'start',
      'due',
    ]);
    expect(GANTT_COLUMNS.execution).toEqual([
      'wbs',
      'title',
      'status',
      'percent',
      'owner',
      'due',
    ]);
  });

  it('places the Gantt tab directly after Tree and translates the controls', () => {
    const panel = readFileSync(join(root, '../components/ProjectDeliveryPanel.tsx'), 'utf8');
    expect(panel).toContain("const VIEW_MODES = ['board', 'list', 'tree', 'gantt',");
    expect(en.delivery.viewMode.gantt).toBe('Gantt');
    expect(hu.delivery.viewMode.gantt).toBe('Gantt');
    expect(de.delivery.viewMode.gantt).toBe('Gantt');
    expect(en.delivery.ganttView.planning).toBe('Planning');
    expect(hu.delivery.ganttView.planning).toBe('Tervezés');
    expect(de.delivery.ganttView.planning).toBe('Planung');
    expect(en.delivery.ganttColTitle).not.toBe(hu.delivery.ganttColTitle);
    expect(en.delivery.ganttColTitle).not.toBe(de.delivery.ganttColTitle);
    expect(en.delivery.ganttPredKeys).not.toBe(hu.delivery.ganttPredKeys);
    expect(en.delivery.ganttZoomDay).not.toBe(de.delivery.ganttZoomDay);
  });
});
