import { describe, expect, it } from 'vitest';
import { buildGanttRows, type GanttTaskInput } from './delivery-gantt';
import { compareDeliverySiblings, sortDeliverySiblings } from './delivery-sibling-order';

function task(
  id: string,
  storyId: string,
  extra: Partial<GanttTaskInput> & Pick<GanttTaskInput, 'title'>,
): GanttTaskInput {
  return {
    status: 'todo',
    userStoryId: storyId,
    dueDate: null,
    ...extra,
    id,
  };
}

describe('compareDeliverySiblings', () => {
  it('sorts undated items after dated starts', () => {
    const ordered = sortDeliverySiblings([
      { title: 'Undated', startDate: null, humanKey: 'PRO-T-1' },
      { title: 'Dated', startDate: '2026-10-01', humanKey: 'PRO-T-2' },
    ]);
    expect(ordered.map((row) => row.title)).toEqual(['Dated', 'Undated']);
  });

  it('breaks ties on start by due date', () => {
    const ordered = sortDeliverySiblings([
      {
        title: 'Later due',
        startDate: '2026-10-10',
        dueDate: '2026-10-20',
        humanKey: 'PRO-T-2',
      },
      {
        title: 'Earlier due',
        startDate: '2026-10-10',
        dueDate: '2026-10-12',
        humanKey: 'PRO-T-1',
      },
    ]);
    expect(ordered.map((row) => row.title)).toEqual(['Earlier due', 'Later due']);
  });

  it('breaks ties on start and due by human key number', () => {
    expect(compareDeliverySiblings(
      {
        title: 'B',
        startDate: '2026-10-22',
        dueDate: '2026-10-25',
        humanKey: 'MIL-T-5',
      },
      {
        title: 'A',
        startDate: '2026-10-22',
        dueDate: '2026-10-25',
        humanKey: 'MIL-T-2',
      },
    )).toBeGreaterThan(0);
  });
});

describe('gantt task sibling order (PRO-B-17)', () => {
  const epicId = 'e-mileguide';
  const storyId = 's-mileguide';

  function taskRowIds(tasks: GanttTaskInput[]): string[] {
    const rows = buildGanttRows({
      epics: [{
        id: epicId,
        title: 'MileGuide',
        status: 'planned',
        sortOrder: 0,
        startDate: null,
        endDate: null,
      }],
      stories: [{
        id: storyId,
        epicId,
        title: 'Guide',
        status: 'planned',
        sortOrder: 0,
        startDate: null,
        endDate: null,
      }],
      tasks,
      milestones: [],
    });
    return rows
      .filter((row) => row.parentId === `story:${storyId}`)
      .map((row) => row.id);
  }

  it('keeps MIL-T-1 first when renaming removes a numeric title prefix', () => {
    const baseTasks: GanttTaskInput[] = [
      task('t1', storyId, {
        title: '1.1 First step',
        humanKey: 'MIL-T-1',
        startDate: '2026-10-19',
        dueDate: '2026-10-19',
      }),
      task('t2', storyId, {
        title: '2. Task two',
        humanKey: 'MIL-T-2',
        startDate: '2026-10-22',
        dueDate: '2026-10-25',
      }),
      task('t3', storyId, {
        title: '3. Task three',
        humanKey: 'MIL-T-3',
        startDate: '2026-10-22',
        dueDate: '2026-10-25',
      }),
      task('t4', storyId, {
        title: '4. Task four',
        humanKey: 'MIL-T-4',
        startDate: '2026-10-22',
        dueDate: '2026-10-25',
      }),
      task('t5', storyId, {
        title: '5. Task five',
        humanKey: 'MIL-T-5',
        startDate: '2026-10-22',
        dueDate: '2026-10-25',
      }),
    ];

    const before = taskRowIds(baseTasks);
    const renamed = baseTasks.map((row) => (
      row.id === 't1' ? { ...row, title: 'First step' } : row
    ));
    const after = taskRowIds(renamed);

    expect(before).toEqual([
      'task:t1',
      'task:t2',
      'task:t3',
      'task:t4',
      'task:t5',
    ]);
    expect(after).toEqual(before);
  });
});
