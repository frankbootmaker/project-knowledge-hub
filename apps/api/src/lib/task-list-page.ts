import { AppError } from '@project-knowledge-hub/domain';

export const TASK_LIST_EXCERPT_CHARS = 200;

type TaskListExcerpt = {
  description: string | null;
  stepsToReproduce: string | null;
  expectedBehavior: string | null;
  actualBehavior: string | null;
  foundInNote: string | null;
};

const EXCERPT_KEYS = [
  'description',
  'stepsToReproduce',
  'expectedBehavior',
  'actualBehavior',
  'foundInNote',
  'rationale',
  'goal',
  'body',
] as const;

function excerptField(value: string | null): string | null {
  if (value === null || value.length <= TASK_LIST_EXCERPT_CHARS) return value;
  return `${value.slice(0, TASK_LIST_EXCERPT_CHARS)}…`;
}

export function excerptItem<T extends object>(item: T): T {
  const copy = { ...item } as Record<string, unknown>;
  for (const key of EXCERPT_KEYS) {
    const value = copy[key];
    if (typeof value === 'string') copy[key] = excerptField(value);
  }
  return copy as T;
}

export function excerptTask<T extends TaskListExcerpt>(task: T): T {
  return excerptItem(task);
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

export function pageItems<T extends object>(
  items: T[],
  cursor: string | undefined,
  limit: number,
): {
  items: T[];
  total: number;
  limit: number;
  nextCursor: string | null;
  hasMore: boolean;
} {
  const offset = decodeListCursor(cursor);
  const page = items.slice(offset, offset + limit).map(excerptItem);
  const next = offset + page.length;
  const hasMore = next < items.length;
  return {
    items: page,
    total: items.length,
    limit,
    nextCursor: hasMore ? encodeListCursor(next) : null,
    hasMore,
  };
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
  const page = pageItems(tasks, cursor, limit);
  return {
    tasks: page.items,
    total: page.total,
    limit: page.limit,
    nextCursor: page.nextCursor,
    hasMore: page.hasMore,
  };
}
