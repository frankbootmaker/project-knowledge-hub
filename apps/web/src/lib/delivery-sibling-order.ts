import { parseHumanKey } from '@project-knowledge-hub/domain';

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export type DeliverySiblingSortable = {
  title: string;
  sortOrder?: number;
  humanKey?: string | null;
  startDate?: string | null;
  /** Tasks and bugs. */
  dueDate?: string | null;
  /** Epics and stories. */
  endDate?: string | null;
};

function validYmd(value: string | null | undefined): string | null {
  if (!value || !YMD.test(value)) return null;
  return value;
}

function compareYmdAsc(
  left: string | null | undefined,
  right: string | null | undefined,
): number {
  const a = validYmd(left);
  const b = validYmd(right);
  if (a && b) return a < b ? -1 : a > b ? 1 : 0;
  if (a && !b) return -1;
  if (!a && b) return 1;
  return 0;
}

function humanKeyIssueNumber(humanKey: string | null | undefined): number {
  if (!humanKey) return Number.POSITIVE_INFINITY;
  const parsed = parseHumanKey(humanKey);
  if (!parsed) return Number.POSITIVE_INFINITY;
  return parsed.issueNumber;
}

/**
 * Default sibling order for epics, stories, tasks, and bugs under the same parent.
 * Start asc (undated last), due/end asc, sortOrder, human-key number, title (numeric).
 */
export function compareDeliverySiblings(
  a: DeliverySiblingSortable,
  b: DeliverySiblingSortable,
): number {
  const byStart = compareYmdAsc(a.startDate, b.startDate);
  if (byStart !== 0) return byStart;

  const dueA = a.dueDate ?? a.endDate ?? null;
  const dueB = b.dueDate ?? b.endDate ?? null;
  const byDue = compareYmdAsc(dueA, dueB);
  if (byDue !== 0) return byDue;

  const sortA = a.sortOrder ?? 0;
  const sortB = b.sortOrder ?? 0;
  if (sortA !== sortB) return sortA - sortB;

  const keyA = humanKeyIssueNumber(a.humanKey);
  const keyB = humanKeyIssueNumber(b.humanKey);
  if (keyA !== keyB) return keyA - keyB;

  return a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' });
}

export function sortDeliverySiblings<T extends DeliverySiblingSortable>(
  items: readonly T[],
): T[] {
  return [...items].sort(compareDeliverySiblings);
}
