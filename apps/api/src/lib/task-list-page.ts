import { AppError } from '@project-knowledge-hub/domain';

export const TASK_LIST_EXCERPT_CHARS = 200;

type TaskListExcerpt = {
  description: string | null;
  stepsToReproduce: string | null;
  expectedBehavior: string | null;
  actualBehavior: string | null;
  foundInNote: string | null;
};

function excerptField(value: string | null): string | null {
  if (value === null || value.length <= TASK_LIST_EXCERPT_CHARS) return value;
  return `${value.slice(0, TASK_LIST_EXCERPT_CHARS)}…`;
}

export function excerptTask<T extends TaskListExcerpt>(task: T): T {
  return {
    ...task,
    description: excerptField(task.description),
    stepsToReproduce: excerptField(task.stepsToReproduce),
    expectedBehavior: excerptField(task.expectedBehavior),
    actualBehavior: excerptField(task.actualBehavior),
    foundInNote: excerptField(task.foundInNote),
  };
}

export function decodeListCursor(cursor: string | undefined): number {
  if (cursor === undefined || cursor.length === 0) return 0;
  let offset: unknown;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      offset?: unknown;
    };
    offset = parsed.offset;
  } catch {
    offset = null;
  }
  if (typeof offset !== 'number' || !Number.isInteger(offset) || offset < 0) {
    throw new AppError({
      code: 'VALIDATION_ERROR',
      message: 'cursor is invalid',
      statusCode: 400,
    });
  }
  return offset;
}

export function encodeListCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ offset }), 'utf8').toString('base64url');
}

export function pageTaskList<T extends TaskListExcerpt>(
  tasks: T[],
  cursor: string | undefined,
  limit: number,
): {
  tasks: T[];
  total: number;
  limit: number;
  nextCursor: string | null;
  hasMore: boolean;
} {
  const offset = decodeListCursor(cursor);
  const page = tasks.slice(offset, offset + limit).map(excerptTask);
  const next = offset + page.length;
  const hasMore = next < tasks.length;
  return {
    tasks: page,
    total: tasks.length,
    limit,
    nextCursor: hasMore ? encodeListCursor(next) : null,
    hasMore,
  };
}
