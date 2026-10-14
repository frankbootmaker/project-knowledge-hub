import { describe, expect, it } from 'vitest';
import { AppError } from './index.js';
import {
  addCalendarDays,
  dependencyCycleKeys,
  dependencyEntityTypeFromIssueKey,
  diffCalendarDays,
  resolveTaskScheduleDates,
  scheduleDeliveryGraph,
  type ScheduleNode,
} from './delivery-dependencies.js';

function node(
  key: string,
  entityType: ScheduleNode['entityType'],
  start: string | null,
  finish: string | null,
  durationDays: number | null = null,
): ScheduleNode {
  return { key, entityType, start, finish, durationDays };
}

describe('delivery dependency dates', () => {
  it('adds and subtracts calendar days', () => {
    expect(addCalendarDays('2026-10-01', 5)).toBe('2026-10-06');
    expect(addCalendarDays('2026-10-01', 0)).toBe('2026-10-01');
    expect(addCalendarDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(diffCalendarDays('2026-10-01', '2026-10-06')).toBe(5);
  });

  it('sets due to start plus duration for tasks and bugs', () => {
    expect(
      resolveTaskScheduleDates({
        stored: { startDate: null, dueDate: null, durationDays: null },
        patch: { startDate: '2026-10-01', durationDays: 5 },
      }),
    ).toEqual({
      startDate: '2026-10-01',
      dueDate: '2026-10-06',
      durationDays: 5,
    });
  });

  it('derives duration when both dates are sent', () => {
    expect(
      resolveTaskScheduleDates({
        stored: { startDate: null, dueDate: null, durationDays: null },
        patch: { startDate: '2026-10-01', dueDate: '2026-10-20' },
      }).durationDays,
    ).toBe(19);
  });

  it('keeps a due date when the start date is cleared', () => {
    expect(
      resolveTaskScheduleDates({
        stored: {
          startDate: '2026-10-01',
          dueDate: '2026-10-20',
          durationDays: 19,
        },
        patch: { startDate: null },
      }),
    ).toEqual({
      startDate: null,
      dueDate: '2026-10-20',
      durationDays: null,
    });
  });

  it('rejects a due date before the start date', () => {
    expect(() =>
      resolveTaskScheduleDates({
        stored: { startDate: '2026-06-01', dueDate: '2026-12-31', durationDays: 213 },
        patch: { dueDate: '2026-05-01' },
      }),
    ).toThrow(AppError);
  });

  it('maps bug keys onto the task entity', () => {
    expect(dependencyEntityTypeFromIssueKey('B')).toBe('task');
    expect(dependencyEntityTypeFromIssueKey('T')).toBe('task');
    expect(dependencyEntityTypeFromIssueKey('SP')).toBe('sprint');
    expect(dependencyEntityTypeFromIssueKey('RD')).toBeNull();
  });
});

describe('dependency cycles and schedule', () => {
  const links = [
    { predecessorKey: 'task:a', successorKey: 'task:b' },
    { predecessorKey: 'task:b', successorKey: 'task:c' },
  ];

  it('rejects a cycle and a self link', () => {
    expect(dependencyCycleKeys(links, 'task:c', 'task:a')).toEqual([
      'task:c',
      'task:a',
      'task:b',
      'task:c',
    ]);
    expect(dependencyCycleKeys(links, 'task:a', 'task:a')).toEqual([
      'task:a',
      'task:a',
    ]);
    expect(dependencyCycleKeys(links, 'task:a', 'task:d')).toBeNull();
  });

  it('computes finish-to-start and shifts the successor due date', () => {
    const changed = scheduleDeliveryGraph({
      nodes: [
        node('task:a', 'task', '2026-10-01', '2026-10-06', 5),
        node('task:b', 'task', null, null, 2),
      ],
      links: [
        {
          predecessorKey: 'task:a',
          successorKey: 'task:b',
          linkType: 'FS',
          lagDays: 0,
        },
      ],
      seeds: ['task:b'],
    });
    expect(changed).toEqual([
      node('task:b', 'task', '2026-10-06', '2026-10-08', 2),
    ]);
  });

  it('uses the latest predecessor and a negative lag as lead', () => {
    const changed = scheduleDeliveryGraph({
      nodes: [
        node('task:a', 'task', '2026-10-01', '2026-10-06', 5),
        node('task:c', 'task', '2026-10-10', '2026-10-12', 2),
        node('task:b', 'task', '2026-10-01', '2026-10-03', 2),
      ],
      links: [
        {
          predecessorKey: 'task:a',
          successorKey: 'task:b',
          linkType: 'FS',
          lagDays: -1,
        },
        {
          predecessorKey: 'task:c',
          successorKey: 'task:b',
          linkType: 'SS',
          lagDays: 1,
        },
      ],
      seeds: ['task:b'],
    });
    expect(changed[0]?.start).toBe('2026-10-11');
    expect(changed[0]?.finish).toBe('2026-10-13');
  });

  it('applies finish-to-finish by backing the start up by duration', () => {
    const changed = scheduleDeliveryGraph({
      nodes: [
        node('milestone:m', 'milestone', null, '2026-11-01', null),
        node('task:b', 'task', '2026-10-01', '2026-10-04', 3),
      ],
      links: [
        {
          predecessorKey: 'milestone:m',
          successorKey: 'task:b',
          linkType: 'FF',
          lagDays: 0,
        },
      ],
      seeds: ['task:b'],
    });
    expect(changed[0]).toMatchObject({
      start: '2026-10-29',
      finish: '2026-11-01',
    });
  });

  it('moves a successor epic window when its predecessor finish moves', () => {
    const changed = scheduleDeliveryGraph({
      nodes: [
        node('task:a', 'task', '2026-10-01', '2026-10-10', 9),
        node('epic:e', 'epic', '2026-10-06', '2026-10-20', null),
      ],
      links: [
        {
          predecessorKey: 'task:a',
          successorKey: 'epic:e',
          linkType: 'FS',
          lagDays: 2,
        },
      ],
      seeds: ['task:a'],
    });
    expect(changed).toEqual([
      node('epic:e', 'epic', '2026-10-12', '2026-10-26', null),
    ]);
  });
});
