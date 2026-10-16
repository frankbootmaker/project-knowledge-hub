import { describe, expect, it } from 'vitest';
import {
  childCompletionPoints,
  deliveryCompletionIndex,
  dependencyLagDaysSchema,
  derivedDateWriteField,
  derivedParentDates,
  derivedParentStatus,
  displayedParentCompletion,
  displayedTaskCompletionPercent,
  milestoneCompletion,
  milestoneLinkPoints,
  milestoneStatusFromLinks,
  parentDateDetail,
  parentStatusFromChildren,
  plannedTargetPercent,
  targetPercentSchema,
  type DeliveryCompletionChild,
} from './index.js';

function child(
  partial: Partial<DeliveryCompletionChild> & Pick<DeliveryCompletionChild, 'status'>,
): DeliveryCompletionChild {
  return partial;
}

describe('displayedTaskCompletionPercent', () => {
  it('forces done to 100 and cancelled to 0', () => {
    expect(displayedTaskCompletionPercent('done', 25)).toBe(100);
    expect(displayedTaskCompletionPercent('cancelled', 50)).toBe(0);
    expect(displayedTaskCompletionPercent('cancelled', null)).toBe(0);
    expect(displayedTaskCompletionPercent('in_progress', 50)).toBe(50);
    expect(displayedTaskCompletionPercent('todo', null)).toBe(0);
    expect(displayedTaskCompletionPercent('blocked')).toBe(0);
  });
});

describe('childCompletionPoints', () => {
  it('leaves cancelled children out of a parent average', () => {
    expect(childCompletionPoints('cancelled', 50)).toBeNull();
    expect(childCompletionPoints('done', 25)).toBe(100);
    expect(childCompletionPoints('in_progress', 50)).toBe(50);
    expect(childCompletionPoints('todo', null)).toBe(0);
  });
});

describe('deliveryCompletionIndex', () => {
  const tasks: DeliveryCompletionChild[] = [
    child({ status: 'done', userStoryId: 'story-a', epicId: 'epic-1' }),
    child({
      status: 'in_progress',
      completionPercent: 50,
      userStoryId: 'story-a',
      epicId: 'epic-1',
    }),
    child({ status: 'cancelled', userStoryId: 'story-a', epicId: 'epic-1' }),
    child({ status: 'todo', userStoryId: 'story-b', epicId: 'epic-1' }),
    child({ status: 'done', userStoryId: 'story-c', epicId: 'epic-2' }),
    child({ status: 'blocked', completionPercent: 25, userStoryId: null, epicId: null }),
  ];

  it('averages child steps and leaves cancelled ones out', () => {
    const index = deliveryCompletionIndex(tasks);
    expect(index.byStoryId.get('story-a')).toEqual({ percent: 75, done: 1.5, total: 2 });
    expect(index.byStoryId.get('story-b')).toEqual({ percent: 0, done: 0, total: 1 });
    expect(index.byStoryId.has('missing')).toBe(false);
  });

  it('rolls an epic up from the tasks on its stories', () => {
    const index = deliveryCompletionIndex(tasks);
    expect(index.byEpicId.get('epic-1')).toEqual({ percent: 50, done: 1.5, total: 3 });
    expect(index.byEpicId.get('epic-2')).toEqual({ percent: 100, done: 1, total: 1 });
  });

  it('omits a parent whose children are all cancelled', () => {
    const index = deliveryCompletionIndex([
      child({ status: 'cancelled', userStoryId: 'story-x', epicId: 'epic-x' }),
    ]);
    expect(index.byStoryId.has('story-x')).toBe(false);
    expect(index.byEpicId.has('epic-x')).toBe(false);
  });
});

describe('displayedParentCompletion', () => {
  const partial = { percent: 40, done: 0.4, total: 1 };

  it('lets status override a contradictory child average', () => {
    expect(displayedParentCompletion('done', partial)).toEqual({
      percent: 100,
      done: 1,
      total: 1,
    });
    expect(displayedParentCompletion('cancelled', partial)).toEqual({
      percent: 0,
      done: 0,
      total: 1,
    });
    expect(displayedParentCompletion('active', partial)).toEqual(partial);
    expect(displayedParentCompletion('planned', null)).toBeNull();
  });

  it('still forces done and cancelled when every child was excluded', () => {
    expect(displayedParentCompletion('done', null)).toEqual({
      percent: 100,
      done: 1,
      total: 1,
    });
    expect(displayedParentCompletion('cancelled', null)).toEqual({
      percent: 0,
      done: 0,
      total: 0,
    });
  });
});

describe('derivedParentStatus', () => {
  it('keeps a manual status when every child is cancelled or absent', () => {
    expect(derivedParentStatus([])).toBeNull();
    expect(
      derivedParentStatus([{ status: 'cancelled', points: null }]),
    ).toBeNull();
    expect(
      parentStatusFromChildren('active', [{ status: 'cancelled', completionPercent: 50 }]),
    ).toBe('active');
    expect(parentStatusFromChildren('done', [])).toBe('done');
  });

  it('is done only when every included child is done', () => {
    expect(
      parentStatusFromChildren('planned', [
        { status: 'done', completionPercent: 25 },
        { status: 'cancelled', completionPercent: 0 },
      ]),
    ).toBe('done');
    expect(
      parentStatusFromChildren('planned', [
        { status: 'done' },
        { status: 'todo', completionPercent: 0 },
      ]),
    ).toBe('in_progress');
  });

  it('is blocked when a child that is not done is blocked', () => {
    expect(
      parentStatusFromChildren('planned', [
        { status: 'blocked', completionPercent: 0 },
        { status: 'todo', completionPercent: 0 },
      ]),
    ).toBe('blocked');
    expect(
      parentStatusFromChildren('planned', [
        { status: 'done' },
        { status: 'blocked', completionPercent: 25 },
      ]),
    ).toBe('blocked');
  });

  it('is in progress when completion is above 0 or a child has started', () => {
    expect(
      parentStatusFromChildren('planned', [
        { status: 'in_progress', completionPercent: 0 },
        { status: 'todo', completionPercent: 0 },
      ]),
    ).toBe('in_progress');
    expect(
      parentStatusFromChildren('planned', [
        { status: 'todo', completionPercent: 25 },
        { status: 'todo', completionPercent: 0 },
      ]),
    ).toBe('in_progress');
    expect(
      derivedParentStatus([
        { status: 'active', points: 0 },
        { status: 'planned', points: 0 },
      ]),
    ).toBe('in_progress');
  });

  it('is planned or todo when nothing has started', () => {
    expect(
      parentStatusFromChildren('active', [
        { status: 'todo', completionPercent: 0 },
        { status: 'planned', completionPercent: null },
      ]),
    ).toBe('planned');
    expect(
      derivedParentStatus([{ status: 'todo', points: 0 }], 'todo'),
    ).toBe('todo');
  });

  it('applies the same rule to milestone links', () => {
    expect(
      milestoneStatusFromLinks('planned', [
        { kind: 'task', status: 'done', completionPercent: 0 },
        { kind: 'task', status: 'cancelled', completionPercent: 100 },
      ]),
    ).toBe('done');
    expect(
      milestoneStatusFromLinks('active', [
        { kind: 'task', status: 'in_progress', completionPercent: 50 },
        { kind: 'parent', status: 'planned', completionPercent: null },
      ]),
    ).toBe('in_progress');
    expect(
      milestoneStatusFromLinks('planned', [
        { kind: 'parent', status: 'blocked', completionPercent: 25 },
        { kind: 'task', status: 'todo', completionPercent: 0 },
      ]),
    ).toBe('blocked');
    expect(
      milestoneStatusFromLinks('active', [
        { kind: 'parent', status: 'planned', completionPercent: null },
        { kind: 'task', status: 'cancelled', completionPercent: 50 },
      ]),
    ).toBe('active');
    expect(
      milestoneStatusFromLinks('planned', [
        { kind: 'task', status: 'todo', completionPercent: 0 },
      ]),
    ).toBe('planned');
  });
});

describe('derivedParentDates', () => {
  const manual = { start: '2026-01-01', end: '2026-01-31' };

  it('keeps manual dates when no included child has a date', () => {
    expect(derivedParentDates(manual, [])).toEqual(manual);
    expect(
      derivedParentDates(manual, [
        { status: 'cancelled', start: '2026-06-01', end: '2026-06-30' },
      ]),
    ).toEqual(manual);
    expect(
      derivedParentDates(manual, [{ status: 'todo', start: null, end: null }]),
    ).toEqual(manual);
  });

  it('uses the earliest start and the latest end', () => {
    expect(
      derivedParentDates(manual, [
        { status: 'todo', start: '2026-03-10', end: '2026-03-12' },
        { status: 'in_progress', start: '2026-02-01', end: null },
        { status: 'done', start: null, end: '2026-04-20' },
        { status: 'cancelled', start: '2026-01-01', end: '2026-12-31' },
      ]),
    ).toEqual({ start: '2026-02-01', end: '2026-04-20' });
  });
});

describe('parentDateDetail', () => {
  const manual = { start: '2026-01-01', end: '2026-01-31' };

  it('keeps manual dates writable when children have none', () => {
    expect(parentDateDetail(manual, [])).toEqual({
      ...manual,
      startDerived: false,
      endDerived: false,
    });
    expect(
      parentDateDetail(manual, [{ status: 'todo', start: null, end: '2026-04-01' }]),
    ).toEqual({
      start: '2026-01-01',
      end: '2026-04-01',
      startDerived: false,
      endDerived: true,
    });
  });

  it('marks a side read-only when a child supplies it', () => {
    const detail = parentDateDetail(manual, [
      { status: 'todo', start: '2026-03-10', end: '2026-03-12' },
      { status: 'cancelled', start: '2026-01-01', end: '2026-12-31' },
    ]);
    expect(detail).toEqual({
      start: '2026-03-10',
      end: '2026-03-12',
      startDerived: true,
      endDerived: true,
    });
    expect(derivedDateWriteField({ detail, startDate: '2026-01-01' })).toBe('startDate');
    expect(derivedDateWriteField({ detail, endDate: '2026-03-12' })).toBe('endDate');
    expect(derivedDateWriteField({ detail })).toBeNull();
  });
});

describe('planned target percent and lag', () => {
  it('stays inside 0-100 and rejects a bad window', () => {
    expect(plannedTargetPercent('2026-10-01', '2026-10-11', '2026-10-06')).toBe(50);
    expect(plannedTargetPercent('2026-10-01', '2026-10-11', '2026-09-30')).toBe(0);
    expect(plannedTargetPercent('2026-10-01', '2026-10-11', '2026-10-20')).toBe(100);
    expect(plannedTargetPercent(null, '2026-10-11', '2026-10-06')).toBeNull();
    expect(targetPercentSchema.safeParse(0).success).toBe(true);
    expect(targetPercentSchema.safeParse(100).success).toBe(true);
    expect(targetPercentSchema.safeParse(101).success).toBe(false);
    expect(targetPercentSchema.safeParse(-1).success).toBe(false);
    expect(targetPercentSchema.safeParse(1.5).success).toBe(false);
  });

  it('requires lag to be an integer', () => {
    expect(dependencyLagDaysSchema.safeParse(0).success).toBe(true);
    expect(dependencyLagDaysSchema.safeParse(-3).success).toBe(true);
    expect(dependencyLagDaysSchema.safeParse(1.5).success).toBe(false);
    expect(dependencyLagDaysSchema.safeParse(3651).success).toBe(false);
  });
});

describe('milestoneCompletion', () => {
  it('counts done as 100, drops cancelled, and uses computed percents', () => {
    expect(milestoneLinkPoints({ kind: 'task', status: 'done', completionPercent: 25 })).toBe(100);
    expect(milestoneLinkPoints({ kind: 'task', status: 'cancelled', completionPercent: 50 })).toBeNull();
    expect(milestoneLinkPoints({ kind: 'task', status: 'todo', completionPercent: null })).toBe(0);
    expect(milestoneLinkPoints({ kind: 'parent', status: 'done', completionPercent: 10 })).toBe(100);
    expect(milestoneLinkPoints({ kind: 'parent', status: 'cancelled', completionPercent: 10 })).toBeNull();
    expect(milestoneLinkPoints({ kind: 'parent', status: 'active', completionPercent: null })).toBeNull();
    expect(milestoneLinkPoints({ kind: 'parent', status: 'active', completionPercent: 50 })).toBe(50);

    expect(
      milestoneCompletion([
        { kind: 'task', status: 'done', completionPercent: 0 },
        { kind: 'task', status: 'in_progress', completionPercent: 50 },
        { kind: 'task', status: 'cancelled', completionPercent: 100 },
        { kind: 'parent', status: 'active', completionPercent: 25 },
        { kind: 'parent', status: 'planned', completionPercent: null },
      ]),
    ).toEqual({ percent: 0, done: 0, total: 3 });
  });

  it('is complete only when every included link is 100', () => {
    expect(
      milestoneCompletion([
        { kind: 'parent', status: 'done', completionPercent: 0 },
        { kind: 'task', status: 'done', completionPercent: 25 },
      ]),
    ).toEqual({ percent: 100, done: 2, total: 2 });
    expect(milestoneCompletion([])).toBeNull();
    expect(
      milestoneCompletion([{ kind: 'parent', status: 'cancelled', completionPercent: 0 }]),
    ).toBeNull();
  });
});
