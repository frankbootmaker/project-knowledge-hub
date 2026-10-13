import { describe, expect, it } from 'vitest';
import {
  decodeListCursor,
  encodeListCursor,
  excerptTask,
  pageItems,
  pageTaskList,
  TASK_LIST_EXCERPT_CHARS,
} from './task-list-page.js';

function task(id: string, description: string) {
  return {
    id,
    description,
    stepsToReproduce: null,
    expectedBehavior: null,
    actualBehavior: null,
    foundInNote: null,
  };
}

describe('task list pages', () => {
  it('excerpts long text and pages with a cursor', () => {
    const long = 'd'.repeat(TASK_LIST_EXCERPT_CHARS + 15);
    const tasks = [task('a', long), task('b', 'short'), task('c', 'third')];
    const first = pageTaskList(tasks, undefined, 2);
    expect(first.total).toBe(3);
    expect(first.limit).toBe(2);
    expect(first.hasMore).toBe(true);
    expect(first.tasks).toHaveLength(2);
    expect(first.tasks[0]?.description).toBe(`${'d'.repeat(TASK_LIST_EXCERPT_CHARS)}…`);
    expect(first.tasks[1]?.description).toBe('short');
    expect(first.nextCursor).toBeTruthy();

    const second = pageTaskList(tasks, first.nextCursor ?? undefined, 2);
    expect(second.hasMore).toBe(false);
    expect(second.nextCursor).toBeNull();
    expect(second.tasks.map((row) => row.id)).toEqual(['c']);
  });

  it('rejects a cursor that is not an offset', () => {
    expect(() => decodeListCursor('not-a-cursor')).toThrowError(
      expect.objectContaining({ code: 'VALIDATION_ERROR', statusCode: 400 }),
    );
    expect(decodeListCursor(encodeListCursor(5))).toBe(5);
    expect(decodeListCursor(undefined)).toBe(0);
  });

  it('leaves a short bug note unchanged', () => {
    const row = excerptTask({
      ...task('bug', 'short'),
      stepsToReproduce: 'e'.repeat(TASK_LIST_EXCERPT_CHARS + 1),
    });
    expect(row.description).toBe('short');
    expect(row.stepsToReproduce?.endsWith('…')).toBe(true);
    expect(row.stepsToReproduce).toHaveLength(TASK_LIST_EXCERPT_CHARS + 1);
  });

  it('pages epics and changes with excerpted description and rationale', () => {
    const long = 'r'.repeat(TASK_LIST_EXCERPT_CHARS + 8);
    const rows = [
      { id: '1', description: long, rationale: long, goal: null, body: 'ok' },
      { id: '2', description: 'short', rationale: null, goal: long, body: null },
    ];
    const page = pageItems(rows, undefined, 1);
    expect(page.total).toBe(2);
    expect(page.hasMore).toBe(true);
    expect(page.items[0]?.description?.endsWith('…')).toBe(true);
    expect(page.items[0]?.rationale?.endsWith('…')).toBe(true);
    expect(page.items[0]?.body).toBe('ok');
    const rest = pageItems(rows, page.nextCursor ?? undefined, 1);
    expect(rest.items[0]?.goal?.endsWith('…')).toBe(true);
    expect(rest.hasMore).toBe(false);
  });
});
