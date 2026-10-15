import { AppError } from './index.js';
import {
  addCalendarDays,
  addWorkingDays,
  DEFAULT_PROJECT_CALENDAR,
  diffCalendarDays,
  diffWorkingDays,
  type ProjectWorkingCalendar,
} from './working-calendar.js';

export { addCalendarDays, diffCalendarDays };

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

/**
 * Finish/start relationships. Lag is working days on the project calendar
 * and may be negative (lead). Non-working days are skipped.
 */
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
 * Tasks and bugs: duration is working days on the project calendar.
 * Due = start + duration when duration is known. An explicit duration wins
 * over a sent due date. Clearing the start date clears duration.
 * Weekends and listed non-working days are skipped.
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
  calendar?: ProjectWorkingCalendar;
}): TaskDateFields {
  const calendar = input.calendar ?? DEFAULT_PROJECT_CALENDAR;
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
        dueDate: addWorkingDays(start, days, calendar),
        durationDays: days,
      };
    }
    if (due) {
      return {
        startDate: addWorkingDays(due, -days, calendar),
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
      dueDate: addWorkingDays(start, duration, calendar),
      durationDays: duration,
    };
  }

  if (start && due) {
    const span = diffWorkingDays(start, due, calendar);
    if (span < 0) throw invalidRange(start, due);
    return { startDate: start, dueDate: due, durationDays: span };
  }

  if (!start && due && duration != null && input.patch.startDate === undefined) {
    return {
      startDate: addWorkingDays(due, -duration, calendar),
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
  /**
   * Story, epic, or milestone whose dates come from children.
   * Predecessors do not move it. Successors still read its start and finish.
   */
  rollupLocked?: boolean;
};

export type ScheduleLink = {
  predecessorKey: string;
  successorKey: string;
  linkType: DeliveryDependencyLinkType;
  lagDays: number;
};

/**
 * Duration used to turn a finish constraint into a start.
 * Tasks use stored duration, else the existing working-day span. A finish
 * with no start is a point (milestones). Missing dates cannot satisfy FF or SF.
 */
export function successorDurationDays(
  node: ScheduleNode,
  calendar: ProjectWorkingCalendar = DEFAULT_PROJECT_CALENDAR,
): number | null {
  if (node.entityType === 'task') {
    if (node.durationDays != null) return node.durationDays;
    if (node.start && node.finish) return diffWorkingDays(node.start, node.finish, calendar);
    return null;
  }
  if (node.start && node.finish) return diffWorkingDays(node.start, node.finish, calendar);
  if (!node.start && node.finish) return 0;
  return null;
}

export function earliestSuccessorStart(
  link: { linkType: DeliveryDependencyLinkType; lagDays: number },
  predecessor: { start: string | null; finish: string | null },
  successorDuration: number | null,
  calendar: ProjectWorkingCalendar = DEFAULT_PROJECT_CALENDAR,
): string | null {
  const lag = link.lagDays;
  switch (link.linkType) {
    case 'FS':
      return predecessor.finish
        ? addWorkingDays(predecessor.finish, lag, calendar)
        : null;
    case 'SS':
      return predecessor.start
        ? addWorkingDays(predecessor.start, lag, calendar)
        : null;
    case 'FF':
      if (!predecessor.finish || successorDuration == null) return null;
      return addWorkingDays(predecessor.finish, lag - successorDuration, calendar);
    case 'SF':
      if (!predecessor.start || successorDuration == null) return null;
      return addWorkingDays(predecessor.start, lag - successorDuration, calendar);
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
  calendar: ProjectWorkingCalendar = DEFAULT_PROJECT_CALENDAR,
): ScheduleNode | null {
  if (node.rollupLocked) return null;
  if (links.length === 0) return null;
  const duration = successorDurationDays(node, calendar);
  const starts = links
    .map((link) => earliestSuccessorStart(link, link.predecessor, duration, calendar))
    .filter((value): value is string => value != null);
  if (starts.length === 0) return null;
  const start = starts.reduce((max, value) => (value > max ? value : max));

  let finish = node.finish;
  let durationDays = node.durationDays;
  if (node.entityType === 'task') {
    if (node.durationDays != null) {
      finish = addWorkingDays(start, node.durationDays, calendar);
    } else if (node.start && node.finish) {
      const span = diffWorkingDays(node.start, node.finish, calendar);
      finish = addWorkingDays(start, span, calendar);
      durationDays = span;
    } else if (node.finish && node.finish < start) {
      finish = start;
      durationDays = 0;
    }
  } else if (node.start && node.finish) {
    finish = addWorkingDays(
      start,
      diffWorkingDays(node.start, node.finish, calendar),
      calendar,
    );
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
  calendar: ProjectWorkingCalendar = DEFAULT_PROJECT_CALENDAR,
): boolean {
  if (links.length === 0) return false;
  const duration = successorDurationDays(node, calendar);
  return links.some(
    (link) => earliestSuccessorStart(link, link.predecessor, duration, calendar) != null,
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
  calendar?: ProjectWorkingCalendar;
}): ScheduleNode[] {
  const calendar = input.calendar ?? DEFAULT_PROJECT_CALENDAR;
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
    const next = applyPredecessorSchedule(node, preds, calendar);
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
