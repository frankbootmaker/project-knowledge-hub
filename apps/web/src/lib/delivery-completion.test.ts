import { describe, expect, it } from 'vitest';
import {
  deliveryCompletionIndex,
  deliveryLag,
  displayedParentCompletion,
  formatPercentLabel,
  plannedTargetPercent,
  taskCompletionPoints,
  taskDeliveryCompletion,
  type DeliveryCompletionTask,
} from './delivery-completion';

function task(
  partial: Partial<DeliveryCompletionTask> & Pick<DeliveryCompletionTask, 'status'>,
): DeliveryCompletionTask {
  return {
    userStoryId: null,
    epicId: null,
    ...partial,
  };
}

describe('taskDeliveryCompletion', () => {
  it('uses the stored step, and forces done or cancelled', () => {
    expect(taskDeliveryCompletion('in_progress', 50)).toEqual({
      percent: 50,
      done: 0.5,
      total: 1,
    });
    expect(taskDeliveryCompletion('done', 25)).toEqual({
      percent: 100,
      done: 1,
      total: 1,
    });
    expect(taskDeliveryCompletion('todo')).toEqual({ percent: 0, done: 0, total: 1 });
    expect(taskDeliveryCompletion('cancelled', 50)).toEqual({
      percent: 0,
      done: 0,
      total: 1,
    });
  });
});

describe('displayedParentCompletion', () => {
  it('shows 100 for a done story even when children average lower', () => {
    const index = deliveryCompletionIndex([
      task({
        status: 'in_progress',
        completionPercent: 50,
        userStoryId: 'story-done',
        epicId: 'epic-done',
      }),
      task({
        status: 'todo',
        completionPercent: 25,
        userStoryId: 'story-done',
        epicId: 'epic-done',
      }),
      task({
        status: 'cancelled',
        completionPercent: 100,
        userStoryId: 'story-done',
        epicId: 'epic-done',
      }),
    ]);
    const rollup = index.byStoryId.get('story-done') ?? null;
    expect(rollup).toEqual({ percent: 38, done: 0.75, total: 2 });
    expect(taskCompletionPoints('cancelled', 100)).toBeNull();
    expect(displayedParentCompletion('done', rollup)?.percent).toBe(100);
    expect(displayedParentCompletion('cancelled', rollup)?.percent).toBe(0);
    expect(displayedParentCompletion('active', rollup)?.percent).toBe(38);
  });
});

describe('formatPercentLabel', () => {
  it('folds unicode spaces so server and browser text match', () => {
    expect(formatPercentLabel(40, 'en').replace(/ /g, '')).toBe('40%');
    expect(formatPercentLabel(40, 'de')).not.toMatch(/[\u00a0\u202f\u2009]/);
  });
});

describe('deliveryCompletionIndex', () => {
  const tasks: DeliveryCompletionTask[] = [
    task({ status: 'done', userStoryId: 'story-a', epicId: 'epic-1' }),
    task({
      status: 'in_progress',
      completionPercent: 50,
      userStoryId: 'story-a',
      epicId: 'epic-1',
    }),
    task({ status: 'cancelled', userStoryId: 'story-a', epicId: 'epic-1' }),
    task({ status: 'todo', userStoryId: 'story-b', epicId: 'epic-1' }),
    task({ status: 'done', userStoryId: 'story-c', epicId: 'epic-2' }),
    task({ status: 'blocked', completionPercent: 25, userStoryId: null, epicId: null }),
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
      task({ status: 'cancelled', userStoryId: 'story-x', epicId: 'epic-x' }),
    ]);
    expect(index.byStoryId.has('story-x')).toBe(false);
    expect(index.byEpicId.has('epic-x')).toBe(false);
  });
});

describe('plannedTargetPercent', () => {
  it('follows the start and end window', () => {
    expect(plannedTargetPercent('2026-10-01', '2026-10-11', '2026-09-30')).toBe(0);
    expect(plannedTargetPercent('2026-10-01', '2026-10-11', '2026-10-01')).toBe(0);
    expect(plannedTargetPercent('2026-10-01', '2026-10-11', '2026-10-06')).toBe(50);
    expect(plannedTargetPercent('2026-10-01', '2026-10-11', '2026-10-11')).toBe(100);
    expect(plannedTargetPercent('2026-10-01', '2026-10-11', '2026-10-20')).toBe(100);
  });

  it('omits a missing or reversed window', () => {
    expect(plannedTargetPercent(null, '2026-10-11', '2026-10-06')).toBeNull();
    expect(plannedTargetPercent('2026-10-11', '2026-10-01', '2026-10-06')).toBeNull();
  });
});

describe('deliveryLag', () => {
  it('marks a shortfall inside the window, and a shortfall after the end', () => {
    expect(deliveryLag({ actual: 40, target: 70, status: 'active' })).toBe('behind');
    expect(deliveryLag({ actual: 40, target: 100, status: 'active' })).toBe('overdue');
    expect(deliveryLag({ actual: 80, target: 70, status: 'active' })).toBeNull();
    expect(deliveryLag({ actual: null, target: 40, status: 'planned' })).toBe('behind');
    expect(deliveryLag({ actual: null, target: 40, status: 'done' })).toBeNull();
    expect(deliveryLag({ actual: 10, target: 80, status: 'cancelled' })).toBeNull();
    expect(deliveryLag({ actual: 10, target: null, status: 'active' })).toBeNull();
  });
});
