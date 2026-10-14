import { AppError } from './index.js';

/** Delivery items that can take a predecessor link. Bugs use entity type task. */
export const DELIVERY_DEPENDENCY_ENTITY_TYPES = [
  'epic',
  'user_story',
  'task',
  'milestone',
  'sprint',
] as const;

export type DeliveryDependencyEntityType =
  (typeof DELIVERY_DEPENDENCY_ENTITY_TYPES)[number];

/** Finish/start relationships. Lag is calendar days and may be negative (lead). */
export const DELIVERY_DEPENDENCY_LINK_TYPES = ['FS', 'SS', 'FF', 'SF'] as const;

export type DeliveryDependencyLinkType =
  (typeof DELIVERY_DEPENDENCY_LINK_TYPES)[number];

export const DELIVERY_DEPENDENCY_LINK_LABELS: Record<
  DeliveryDependencyLinkType,
  string
> = {
  FS: 'Finish-to-Start',
  SS: 'Start-to-Start',
  FF: 'Finish-to-Finish',
  SF: 'Start-to-Finish',
};

export const DELIVERY_DEPENDENCY_LAG_MIN = -3650;
export const DELIVERY_DEPENDENCY_LAG_MAX = 3650;
export const DELIVERY_DURATION_MAX_DAYS = 3650;

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

export function deliveryItemKey(
  entityType: DeliveryDependencyEntityType,
  id: string,
): string {
  return `${entityType}:${id}`;
}

/** Human-key type letter to a dependency entity. B is a bug, stored as task. */
export function dependencyEntityTypeFromIssueKey(
  issueKeyType: string,
): DeliveryDependencyEntityType | null {
  switch (issueKeyType) {
    case 'E':
      return 'epic';
    case 'S':
      return 'user_story';
    case 'M':
      return 'milestone';
    case 'T':
    case 'B':
      return 'task';
    case 'SP':
      return 'sprint';
    default:
      return null;
  }
}

export function addCalendarDays(ymd: string, days: number): string {
  const match = YMD.exec(ymd);
  if (!match) {
    throw new AppError({
      code: 'INVALID_DATE',
      message: `Expected YYYY-MM-DD, received ${ymd}`,
      statusCode: 400,
    });
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (
    utc.getUTCFullYear() !== year
    || utc.getUTCMonth() !== month - 1
    || utc.getUTCDate() !== day
  ) {
    throw new AppError({
      code: 'INVALID_DATE',
      message: `Invalid date ${ymd}`,
      statusCode: 400,
    });
  }
  utc.setUTCDate(utc.getUTCDate() + days);
  const y = String(utc.getUTCFullYear()).padStart(4, '0');
  const m = String(utc.getUTCMonth() + 1).padStart(2, '0');
  const d = String(utc.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function diffCalendarDays(start: string, end: string): number {
  const startUtc = Date.parse(`${start}T00:00:00Z`);
  const endUtc = Date.parse(`${end}T00:00:00Z`);
  if (Number.isNaN(startUtc) || Number.isNaN(endUtc)) {
    throw new AppError({
      code: 'INVALID_DATE',
      message: `Expected YYYY-MM-DD dates, received ${start} and ${end}`,
      statusCode: 400,
    });
  }
  return Math.round((endUtc - startUtc) / 86_400_000);
}

export type TaskDateFields = {
  startDate: string | null;
  dueDate: string | null;
  durationDays: number | null;
};

function invalidRange(start: string, due: string): AppError {
  return new AppError({
    code: 'INVALID_DATE_RANGE',
    message: `dueDate (${due}) must be on or after startDate (${start})`,
    statusCode: 400,
  });
}

/**
 * Tasks and bugs: duration is calendar days added to the start date.
 * Due = start + duration when duration is known. An explicit duration wins
 * over a sent due date. Clearing the start date clears duration.
 */
export function resolveTaskScheduleDates(input: {
  stored: {
    startDate?: string | null;
    dueDate?: string | null;
    durationDays?: number | null;
  };
  patch: {
    startDate?: string | null;
    dueDate?: string | null;
    durationDays?: number | null;
  };
}): TaskDateFields {
  const start =
    input.patch.startDate !== undefined
      ? input.patch.startDate
      : (input.stored.startDate ?? null);
  const due =
    input.patch.dueDate !== undefined
      ? input.patch.dueDate
      : (input.stored.dueDate ?? null);
  const duration =
    input.patch.durationDays !== undefined
      ? input.patch.durationDays
      : (input.stored.durationDays ?? null);

  if (input.patch.durationDays != null) {
    const days = input.patch.durationDays;
    if (!Number.isInteger(days) || days < 0 || days > DELIVERY_DURATION_MAX_DAYS) {
      throw new AppError({
        code: 'INVALID_DURATION',
        message: `durationDays must be a whole number from 0 to ${DELIVERY_DURATION_MAX_DAYS}`,
        statusCode: 400,
      });
    }
    if (start) {
      return {
        startDate: start,
        dueDate: addCalendarDays(start, days),
        durationDays: days,
      };
    }
    if (due) {
      return {
        startDate: addCalendarDays(due, -days),
        dueDate: due,
        durationDays: days,
      };
    }
    return { startDate: null, dueDate: null, durationDays: days };
  }

  if (input.patch.durationDays === null) {
    if (start && due && due < start) throw invalidRange(start, due);
    return { startDate: start, dueDate: due, durationDays: null };
  }

  if (input.patch.startDate === null) {
    return { startDate: null, dueDate: due, durationDays: null };
  }

  if (input.patch.dueDate === undefined && start && duration != null) {
    return {
      startDate: start,
      dueDate: addCalendarDays(start, duration),
      durationDays: duration,
    };
  }

  if (start && due) {
    const span = diffCalendarDays(start, due);
    if (span < 0) throw invalidRange(start, due);
    return { startDate: start, dueDate: due, durationDays: span };
  }

  if (!start && due && duration != null && input.patch.startDate === undefined) {
    return {
      startDate: addCalendarDays(due, -duration),
      dueDate: due,
      durationDays: duration,
    };
  }

  return { startDate: start, dueDate: due, durationDays: duration };
}

export type ScheduleNode = {
  key: string;
  entityType: DeliveryDependencyEntityType;
  start: string | null;
  finish: string | null;
  /** Stored duration for tasks and bugs. Null when the span is not duration-driven. */
  durationDays: number | null;
};

export type ScheduleLink = {
  predecessorKey: string;
  successorKey: string;
  linkType: DeliveryDependencyLinkType;
  lagDays: number;
};

/**
 * Duration used to turn a finish constraint into a start.
 * Tasks use stored duration, else the existing span. A finish with no start
 * is a point (milestones). Missing dates cannot satisfy FF or SF.
 */
export function successorDurationDays(node: ScheduleNode): number | null {
  if (node.entityType === 'task') {
    if (node.durationDays != null) return node.durationDays;
    if (node.start && node.finish) return diffCalendarDays(node.start, node.finish);
    return null;
  }
  if (node.start && node.finish) return diffCalendarDays(node.start, node.finish);
  if (!node.start && node.finish) return 0;
  return null;
}

export function earliestSuccessorStart(
  link: { linkType: DeliveryDependencyLinkType; lagDays: number },
  predecessor: { start: string | null; finish: string | null },
  successorDuration: number | null,
): string | null {
  const lag = link.lagDays;
  switch (link.linkType) {
    case 'FS':
      return predecessor.finish
        ? addCalendarDays(predecessor.finish, lag)
        : null;
    case 'SS':
      return predecessor.start
        ? addCalendarDays(predecessor.start, lag)
        : null;
    case 'FF':
      if (!predecessor.finish || successorDuration == null) return null;
      return addCalendarDays(predecessor.finish, lag - successorDuration);
    case 'SF':
      if (!predecessor.start || successorDuration == null) return null;
      return addCalendarDays(predecessor.start, lag - successorDuration);
    default: {
      const _exhaustive: never = link.linkType;
      return _exhaustive;
    }
  }
}

type DatedLink = {
  linkType: DeliveryDependencyLinkType;
  lagDays: number;
  predecessor: { start: string | null; finish: string | null };
};

/** Returns the updated node, or null when no predecessor date applies. */
export function applyPredecessorSchedule(
  node: ScheduleNode,
  links: DatedLink[],
): ScheduleNode | null {
  if (links.length === 0) return null;
  const duration = successorDurationDays(node);
  const starts = links
    .map((link) => earliestSuccessorStart(link, link.predecessor, duration))
    .filter((value): value is string => value != null);
  if (starts.length === 0) return null;
  const start = starts.reduce((max, value) => (value > max ? value : max));

  let finish = node.finish;
  let durationDays = node.durationDays;
  if (node.entityType === 'task') {
    if (node.durationDays != null) {
      finish = addCalendarDays(start, node.durationDays);
    } else if (node.start && node.finish) {
      const span = diffCalendarDays(node.start, node.finish);
      finish = addCalendarDays(start, span);
      durationDays = span;
    } else if (node.finish && node.finish < start) {
      finish = start;
      durationDays = 0;
    }
  } else if (node.start && node.finish) {
    finish = addCalendarDays(start, diffCalendarDays(node.start, node.finish));
  } else if (node.finish && !node.start) {
    finish = start;
  } else if (node.finish && node.finish < start) {
    finish = start;
  }

  if (
    start === node.start
    && finish === node.finish
    && durationDays === node.durationDays
  ) {
    return null;
  }
  return { ...node, start, finish, durationDays };
}

export function predecessorConstraintApplies(
  node: ScheduleNode,
  links: DatedLink[],
): boolean {
  if (links.length === 0) return false;
  const duration = successorDurationDays(node);
  return links.some(
    (link) => earliestSuccessorStart(link, link.predecessor, duration) != null,
  );
}

/**
 * Recompute seeds from their predecessors, then walk successors in
 * topological order. Returns nodes whose dates changed.
 */
export function scheduleDeliveryGraph(input: {
  nodes: ScheduleNode[];
  links: ScheduleLink[];
  seeds: string[];
}): ScheduleNode[] {
  const byKey = new Map(input.nodes.map((node) => [node.key, { ...node }]));
  const original = new Map(input.nodes.map((node) => [node.key, node]));
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, ScheduleLink[]>();
  for (const link of input.links) {
    const next = outgoing.get(link.predecessorKey) ?? [];
    next.push(link.successorKey);
    outgoing.set(link.predecessorKey, next);
    const inc = incoming.get(link.successorKey) ?? [];
    inc.push(link);
    incoming.set(link.successorKey, inc);
  }

  const needed = new Set<string>();
  const pending = [...input.seeds];
  while (pending.length > 0) {
    const key = pending.shift();
    if (!key || needed.has(key) || !byKey.has(key)) continue;
    needed.add(key);
    for (const next of outgoing.get(key) ?? []) pending.push(next);
  }

  const indegree = new Map<string, number>();
  for (const key of needed) indegree.set(key, 0);
  for (const link of input.links) {
    if (!needed.has(link.predecessorKey) || !needed.has(link.successorKey)) {
      continue;
    }
    indegree.set(
      link.successorKey,
      (indegree.get(link.successorKey) ?? 0) + 1,
    );
  }
  const ready = [...needed].filter((key) => (indegree.get(key) ?? 0) === 0);
  const ordered: string[] = [];
  while (ready.length > 0) {
    const key = ready.shift();
    if (!key) break;
    ordered.push(key);
    for (const next of outgoing.get(key) ?? []) {
      if (!needed.has(next)) continue;
      const left = (indegree.get(next) ?? 1) - 1;
      indegree.set(next, left);
      if (left === 0) ready.push(next);
    }
  }
  if (ordered.length !== needed.size) {
    throw new AppError({
      code: 'DEPENDENCY_CYCLE',
      message: 'Dependency cycle detected while scheduling',
      statusCode: 400,
    });
  }

  const changed: ScheduleNode[] = [];
  for (const key of ordered) {
    const node = byKey.get(key);
    if (!node) continue;
    const preds: DatedLink[] = [];
    for (const link of incoming.get(key) ?? []) {
      const predecessor = byKey.get(link.predecessorKey);
      if (!predecessor) continue;
      preds.push({
        linkType: link.linkType,
        lagDays: link.lagDays,
        predecessor,
      });
    }
    const next = applyPredecessorSchedule(node, preds);
    if (!next) continue;
    byKey.set(key, next);
    const before = original.get(key);
    if (
      !before
      || before.start !== next.start
      || before.finish !== next.finish
      || before.durationDays !== next.durationDays
    ) {
      changed.push(next);
    }
  }
  return changed;
}

/**
 * Path of keys if adding predecessor → successor closes a cycle.
 * Includes both ends. Null when the link is acyclic.
 */
export function dependencyCycleKeys(
  links: Array<{ predecessorKey: string; successorKey: string }>,
  predecessorKey: string,
  successorKey: string,
): string[] | null {
  if (predecessorKey === successorKey) {
    return [predecessorKey, successorKey];
  }
  const outgoing = new Map<string, string[]>();
  for (const link of links) {
    const next = outgoing.get(link.predecessorKey) ?? [];
    next.push(link.successorKey);
    outgoing.set(link.predecessorKey, next);
  }
  const previous = new Map<string, string | null>();
  const queue = [successorKey];
  previous.set(successorKey, null);
  let found = false;
  while (queue.length > 0) {
    const node = queue.shift();
    if (!node) break;
    if (node === predecessorKey) {
      found = true;
      break;
    }
    for (const next of outgoing.get(node) ?? []) {
      if (previous.has(next)) continue;
      previous.set(next, node);
      queue.push(next);
    }
  }
  if (!found) return null;
  const backward = [predecessorKey];
  let cursor = predecessorKey;
  while (previous.get(cursor)) {
    const prior = previous.get(cursor);
    if (!prior) break;
    backward.push(prior);
    cursor = prior;
  }
  const forward = [...backward].reverse();
  return [predecessorKey, ...forward];
}
