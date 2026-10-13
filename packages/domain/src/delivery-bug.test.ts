import { describe, expect, it } from 'vitest';
import {
  bugFoundInSchema,
  bugResolutionSchema,
  resolveBugCreate,
  resolveBugUpdate,
  taskItemTypeSchema,
  type StoredBugFields,
} from './delivery-bug.js';

const storedBug: StoredBugFields = {
  severity: 'high',
  foundIn: 'staging',
  foundInNote: 'build 12',
  stepsToReproduce: 'Open the form',
  expectedBehavior: 'It saves',
  actualBehavior: 'It errors',
  resolution: 'duplicate',
  regression: true,
  affectedSystemId: 'sys-1',
  duplicateOfTaskId: 'bug-1',
};

describe('bug item schemas', () => {
  it('accepts the locked enums', () => {
    expect(taskItemTypeSchema.parse('bug')).toBe('bug');
    expect(bugFoundInSchema.parse('production')).toBe('production');
    expect(bugResolutionSchema.parse('wont_fix')).toBe('wont_fix');
  });
});

describe('resolveBugCreate', () => {
  it('stores empty bug fields on a task', () => {
    const result = resolveBugCreate('task', {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fields.severity).toBeNull();
    expect(result.fields.regression).toBe(false);
  });

  it('rejects bug fields on a task', () => {
    const result = resolveBugCreate('task', { severity: 'low' });
    expect(result).toMatchObject({ ok: false, code: 'BUG_FIELDS_ON_TASK' });
  });

  it('defaults severity to medium on a bug', () => {
    const result = resolveBugCreate('bug', {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fields.severity).toBe('medium');
    expect(result.fields.regression).toBe(false);
  });

  it('keeps a duplicate link only when resolution is duplicate', () => {
    const rejected = resolveBugCreate('bug', { duplicateOfTaskId: 'bug-2' });
    expect(rejected).toMatchObject({
      ok: false,
      code: 'BUG_DUPLICATE_LINK_INVALID',
    });

    const accepted = resolveBugCreate('bug', {
      resolution: 'duplicate',
      duplicateOfTaskId: 'bug-2',
    });
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    expect(accepted.fields.duplicateOfTaskId).toBe('bug-2');
  });
});

describe('resolveBugUpdate', () => {
  it('refuses to change item type', () => {
    const result = resolveBugUpdate({
      existingItemType: 'task',
      existing: {
        severity: null,
        foundIn: null,
        foundInNote: null,
        stepsToReproduce: null,
        expectedBehavior: null,
        actualBehavior: null,
        resolution: null,
        regression: false,
        affectedSystemId: null,
        duplicateOfTaskId: null,
      },
      itemType: 'bug',
      patch: {},
    });
    expect(result).toMatchObject({
      ok: false,
      code: 'TASK_ITEM_TYPE_IMMUTABLE',
    });
  });

  it('clears the duplicate link when resolution leaves duplicate', () => {
    const result = resolveBugUpdate({
      existingItemType: 'bug',
      existing: storedBug,
      patch: { resolution: 'fixed' },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fields.resolution).toBe('fixed');
    expect(result.fields.duplicateOfTaskId).toBeNull();
    expect(result.fields.severity).toBe('high');
  });
});
