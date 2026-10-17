import { z } from 'zod';
import {
  coerceProjectCalendar,
  diffWorkingDays,
  type ProjectWorkingCalendar,
} from './working-calendar.js';

type SlipChild = {
  status: string;
  end?: string | null;
};

/** RAID `source` for a risk raised from a delivery schedule slip. */
export const SCHEDULE_SLIP_SOURCE = 'auto_schedule_slip';

/** Appended when a slip clears. The risk stays open. */
export const SCHEDULE_SLIP_CLOSURE_NOTE =
  'Schedule slip resolved. Consider closing this risk.';

export const SCHEDULE_SLIP_ITEM_TYPES = [
  'task',
  'user_story',
  'epic',
  'milestone',
] as const;

export type ScheduleSlipItemType = (typeof SCHEDULE_SLIP_ITEM_TYPES)[number];

export const DEFAULT_SCHEDULE_SLIP_ITEM_TYPES: readonly ScheduleSlipItemType[] = [
  'task',
  'user_story',
  'epic',
  'milestone',
];

export const DEFAULT_SCHEDULE_SLIP_THRESHOLD_DAYS = 2;

export const scheduleSlipItemTypeSchema = z.enum(SCHEDULE_SLIP_ITEM_TYPES);

export const scheduleSlipThresholdSchema = z.number().int().min(1).max(3650);

const RATINGS = ['low', 'medium', 'high', 'critical'] as const;

export type ScheduleSlipRating = (typeof RATINGS)[number];

export type ScheduleSlipSettings = {
  enabled: boolean;
  thresholdWorkingDays: number;
  itemTypes: ScheduleSlipItemType[];
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function normalizeScheduleSlipItemTypes(
  value: unknown,
): ScheduleSlipItemType[] {
  if (!Array.isArray(value)) return [...DEFAULT_SCHEDULE_SLIP_ITEM_TYPES];
  const allowed = new Set<string>(SCHEDULE_SLIP_ITEM_TYPES);
  const next: ScheduleSlipItemType[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || !allowed.has(item)) continue;
    const typed = item as ScheduleSlipItemType;
    if (!next.includes(typed)) next.push(typed);
  }
  return next;
}

export function scheduleSlipSettingsFromRow(row: {
  enabled?: boolean | null;
  thresholdWorkingDays?: number | null;
  itemTypes?: unknown;
}): ScheduleSlipSettings {
  const threshold = row.thresholdWorkingDays;
  const parsed = scheduleSlipThresholdSchema.safeParse(threshold);
  return {
    enabled: row.enabled === true,
    thresholdWorkingDays: parsed.success
      ? parsed.data
      : DEFAULT_SCHEDULE_SLIP_THRESHOLD_DAYS,
    itemTypes: normalizeScheduleSlipItemTypes(row.itemTypes),
  };
}

/**
 * First saved finish is the baseline. Later edits keep that date so a move
 * later than the baseline is a slip. A missing previous finish uses the new one.
 */
export function initialBaselineFinish(
  existingBaseline: string | null | undefined,
  previousFinish: string | null | undefined,
  nextFinish: string | null | undefined,
): string | null {
  if (existingBaseline) return existingBaseline;
  return previousFinish ?? nextFinish ?? null;
}

export function scheduleSlipTitle(label: string, slipWorkingDays: number): string {
  return `Schedule slip: ${label} +${slipWorkingDays} days`;
}

export function scheduleSlipDescription(label: string, slipWorkingDays: number): string {
  return `Auto-generated schedule slip for ${label} (${slipWorkingDays} working days).`;
}

export function scheduleSlipRating(
  slipWorkingDays: number,
  onCriticalPath: boolean | null | undefined,
): ScheduleSlipRating {
  let rating: ScheduleSlipRating = 'low';
  if (slipWorkingDays >= 20) rating = 'critical';
  else if (slipWorkingDays >= 10) rating = 'high';
  else if (slipWorkingDays >= 5) rating = 'medium';
  if (onCriticalPath !== true) return rating;
  const index = RATINGS.indexOf(rating);
  return RATINGS[Math.min(index + 1, RATINGS.length - 1)] ?? 'critical';
}

export type ScheduleSlipEvaluation = {
  slipping: boolean;
  slipWorkingDays: number;
  forecastWorkingDays: number;
  overdueWorkingDays: number;
  probability: ScheduleSlipRating | null;
  impact: ScheduleSlipRating | null;
  severity: ScheduleSlipRating | null;
};

const CLEAR_SLIP: ScheduleSlipEvaluation = {
  slipping: false,
  slipWorkingDays: 0,
  forecastWorkingDays: 0,
  overdueWorkingDays: 0,
  probability: null,
  impact: null,
  severity: null,
};

function workingGap(
  earlier: string | null | undefined,
  later: string | null | undefined,
  calendar: ProjectWorkingCalendar,
): number {
  if (!earlier || !later || !ISO_DATE.test(earlier) || !ISO_DATE.test(later)) return 0;
  if (later <= earlier) return 0;
  return diffWorkingDays(earlier, later, calendar);
}

/**
 * Planned finish is the item's own end, or the child rollup when children
 * supply one. A slip is that finish later than the stored due date or the
 * baseline, or the due date already passed while the item is still open.
 * Days are working days. Critical path bumps the rating one step when known.
 */
export function evaluateScheduleSlip(input: {
  status: string;
  archived?: boolean;
  plannedFinish: string | null;
  dueDate?: string | null;
  baselineDate?: string | null;
  today: string;
  thresholdWorkingDays: number;
  calendar?: ProjectWorkingCalendar;
  onCriticalPath?: boolean | null;
}): ScheduleSlipEvaluation {
  if (
    input.archived
    || input.status === 'done'
    || input.status === 'cancelled'
  ) {
    return CLEAR_SLIP;
  }
  const calendar = coerceProjectCalendar(input.calendar ?? {});
  const threshold = input.thresholdWorkingDays;
  const planned = input.plannedFinish;
  const due = input.dueDate ?? null;
  const forecastWorkingDays = Math.max(
    workingGap(due, planned, calendar),
    workingGap(input.baselineDate, planned, calendar),
  );
  const overdueAnchor = due ?? planned;
  const overdueWorkingDays = workingGap(overdueAnchor, input.today, calendar);
  const slipWorkingDays = Math.max(forecastWorkingDays, overdueWorkingDays);
  if (!Number.isFinite(threshold) || slipWorkingDays < threshold) return CLEAR_SLIP;
  const rating = scheduleSlipRating(slipWorkingDays, input.onCriticalPath);
  return {
    slipping: true,
    slipWorkingDays,
    forecastWorkingDays,
    overdueWorkingDays,
    probability: rating,
    impact: rating,
    severity: rating,
  };
}

/**
 * Stored finish is the due date. The latest non-cancelled child end replaces
 * it, matching parentDateDetail's end side.
 */
export function scheduleSlipWindow(input: {
  ownFinish: string | null;
  children?: readonly SlipChild[];
}): { plannedFinish: string | null; dueDate: string | null } {
  const ends = (input.children ?? [])
    .filter((child) => child.status !== 'cancelled' && child.end)
    .map((child) => child.end as string);
  const plannedFinish = ends.length === 0
    ? input.ownFinish
    : ends.reduce((max, value) => (value > max ? value : max));
  return { plannedFinish, dueDate: input.ownFinish };
}

export type ScheduleSlipTaskInput = {
  id: string;
  itemType?: string | null;
  status: string;
  archived?: boolean;
  dueDate: string | null;
  baselineFinishDate?: string | null;
  userStoryId?: string | null;
  onCriticalPath?: boolean | null;
};

export type ScheduleSlipStoryInput = {
  id: string;
  epicId: string;
  status: string;
  archived?: boolean;
  endDate: string | null;
  baselineFinishDate?: string | null;
  onCriticalPath?: boolean | null;
};

export type ScheduleSlipEpicInput = {
  id: string;
  status: string;
  archived?: boolean;
  endDate: string | null;
  baselineFinishDate?: string | null;
  onCriticalPath?: boolean | null;
};

export type ScheduleSlipMilestoneLink = {
  entityType: 'task' | 'user_story' | 'epic';
  entityId: string;
};

export type ScheduleSlipMilestoneInput = {
  id: string;
  status: string;
  archived?: boolean;
  targetDate: string | null;
  baselineFinishDate?: string | null;
  links?: readonly ScheduleSlipMilestoneLink[];
  onCriticalPath?: boolean | null;
};

export type ScheduleSlipHit = {
  id: string;
  type: ScheduleSlipItemType;
  evaluation: ScheduleSlipEvaluation;
};

function childSource(status: string, end: string | null): SlipChild {
  return { status, end };
}

/**
 * Slip map for one project. Disabled settings yield an empty map.
 * Bugs are not a watched type. Story and epic finishes follow the child
 * rollup. Milestone finishes follow linked items; the stored target stays
 * the due date.
 */
export function evaluateDeliveryScheduleSlips(input: {
  settings: ScheduleSlipSettings;
  today: string;
  calendar?: ProjectWorkingCalendar;
  tasks: readonly ScheduleSlipTaskInput[];
  stories: readonly ScheduleSlipStoryInput[];
  epics: readonly ScheduleSlipEpicInput[];
  milestones: readonly ScheduleSlipMilestoneInput[];
}): Map<string, ScheduleSlipHit> {
  const hits = new Map<string, ScheduleSlipHit>();
  if (!input.settings.enabled) return hits;
  const watched = new Set(input.settings.itemTypes);
  const calendar = input.calendar;
  const threshold = input.settings.thresholdWorkingDays;

  const storyChildren = new Map<string, SlipChild[]>();
  for (const task of input.tasks) {
    if (task.archived || !task.userStoryId) continue;
    const list = storyChildren.get(task.userStoryId) ?? [];
    list.push(childSource(task.status, task.dueDate));
    storyChildren.set(task.userStoryId, list);
  }

  const storyPlan = new Map<string, string | null>();
  for (const story of input.stories) {
    const window = scheduleSlipWindow({
      ownFinish: story.endDate,
      children: story.archived ? [] : storyChildren.get(story.id) ?? [],
    });
    storyPlan.set(story.id, window.plannedFinish);
    if (!watched.has('user_story')) continue;
    hits.set(story.id, {
      id: story.id,
      type: 'user_story',
      evaluation: evaluateScheduleSlip({
        status: story.status,
        archived: story.archived,
        plannedFinish: window.plannedFinish,
        dueDate: window.dueDate,
        baselineDate: story.baselineFinishDate,
        today: input.today,
        thresholdWorkingDays: threshold,
        calendar,
        onCriticalPath: story.onCriticalPath,
      }),
    });
  }

  const epicChildren = new Map<string, SlipChild[]>();
  for (const story of input.stories) {
    if (story.archived) continue;
    const list = epicChildren.get(story.epicId) ?? [];
    list.push(childSource(story.status, storyPlan.get(story.id) ?? story.endDate));
    epicChildren.set(story.epicId, list);
  }

  const epicPlan = new Map<string, string | null>();
  for (const epic of input.epics) {
    const window = scheduleSlipWindow({
      ownFinish: epic.endDate,
      children: epic.archived ? [] : epicChildren.get(epic.id) ?? [],
    });
    epicPlan.set(epic.id, window.plannedFinish);
    if (!watched.has('epic')) continue;
    hits.set(epic.id, {
      id: epic.id,
      type: 'epic',
      evaluation: evaluateScheduleSlip({
        status: epic.status,
        archived: epic.archived,
        plannedFinish: window.plannedFinish,
        dueDate: window.dueDate,
        baselineDate: epic.baselineFinishDate,
        today: input.today,
        thresholdWorkingDays: threshold,
        calendar,
        onCriticalPath: epic.onCriticalPath,
      }),
    });
  }

  if (watched.has('task')) {
    for (const task of input.tasks) {
      if (task.itemType === 'bug') continue;
      const window = scheduleSlipWindow({ ownFinish: task.dueDate });
      hits.set(task.id, {
        id: task.id,
        type: 'task',
        evaluation: evaluateScheduleSlip({
          status: task.status,
          archived: task.archived,
          plannedFinish: window.plannedFinish,
          dueDate: window.dueDate,
          baselineDate: task.baselineFinishDate,
          today: input.today,
          thresholdWorkingDays: threshold,
          calendar,
          onCriticalPath: task.onCriticalPath,
        }),
      });
    }
  }

  if (watched.has('milestone')) {
    const taskById = new Map(input.tasks.map((task) => [task.id, task]));
    const storyById = new Map(input.stories.map((story) => [story.id, story]));
    const epicById = new Map(input.epics.map((epic) => [epic.id, epic]));
    for (const milestone of input.milestones) {
      const children: SlipChild[] = [];
      for (const link of milestone.links ?? []) {
        if (link.entityType === 'task') {
          const task = taskById.get(link.entityId);
          if (!task) continue;
          children.push(childSource(task.status, task.dueDate));
        } else if (link.entityType === 'user_story') {
          const story = storyById.get(link.entityId);
          if (!story || story.archived) continue;
          children.push(childSource(
            story.status,
            storyPlan.get(story.id) ?? story.endDate,
          ));
        } else {
          const epic = epicById.get(link.entityId);
          if (!epic || epic.archived) continue;
          children.push(childSource(
            epic.status,
            epicPlan.get(epic.id) ?? epic.endDate,
          ));
        }
      }
      const window = scheduleSlipWindow({
        ownFinish: milestone.targetDate,
        children: milestone.archived ? [] : children,
      });
      hits.set(milestone.id, {
        id: milestone.id,
        type: 'milestone',
        evaluation: evaluateScheduleSlip({
          status: milestone.status,
          archived: milestone.archived,
          plannedFinish: window.plannedFinish,
          dueDate: window.dueDate,
          baselineDate: milestone.baselineFinishDate,
          today: input.today,
          thresholdWorkingDays: threshold,
          calendar,
          onCriticalPath: milestone.onCriticalPath,
        }),
      });
    }
  }

  return hits;
}

export type OpenAutoSlipRisk = {
  id: string;
  title: string;
  description: string | null;
  probability: string | null;
  impact: string | null;
  severity: string;
  ownerUserId: string | null;
  slipWorkingDays: number | null;
  closureSuggested: boolean;
};

export type ScheduleSlipDecision =
  | { action: 'skip' }
  | {
      action: 'create';
      title: string;
      description: string;
      probability: ScheduleSlipRating;
      impact: ScheduleSlipRating;
      severity: ScheduleSlipRating;
      slipWorkingDays: number;
      ownerUserId: string | null;
    }
  | {
      action: 'update';
      id: string;
      title: string;
      description: string;
      probability: ScheduleSlipRating;
      impact: ScheduleSlipRating;
      severity: ScheduleSlipRating;
      slipWorkingDays: number;
      ownerUserId: string | null;
      closureSuggested: false;
    }
  | {
      action: 'suggest_close';
      id: string;
      description: string;
      closureSuggested: true;
    };

export function stripScheduleSlipClosureNote(description: string | null): string | null {
  if (!description) return description;
  const next = description
    .split(SCHEDULE_SLIP_CLOSURE_NOTE)
    .join('')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return next || null;
}

export function withScheduleSlipClosureNote(description: string | null): string {
  if (description?.includes(SCHEDULE_SLIP_CLOSURE_NOTE)) return description;
  const base = description?.trim();
  if (!base) return SCHEDULE_SLIP_CLOSURE_NOTE;
  return `${base}\n\n${SCHEDULE_SLIP_CLOSURE_NOTE}`;
}

function openSlipDescription(
  existing: string | null,
  label: string,
  days: number,
): string {
  const fresh = scheduleSlipDescription(label, days);
  const stripped = stripScheduleSlipClosureNote(existing);
  if (!stripped || stripped.startsWith('Auto-generated schedule slip')) return fresh;
  return stripped;
}

/**
 * At most one open auto risk per item. A larger slip updates that risk.
 * A resolved slip asks for closure and does not change status.
 * Settings off, or a type that is not watched, does nothing.
 */
export function decideScheduleSlipRisk(input: {
  enabled: boolean;
  watched: boolean;
  evaluation: ScheduleSlipEvaluation;
  label: string;
  ownerUserId: string | null;
  existing: OpenAutoSlipRisk | null;
}): ScheduleSlipDecision {
  if (!input.enabled || !input.watched) return { action: 'skip' };
  const existing = input.existing;
  if (!input.evaluation.slipping) {
    if (!existing || existing.closureSuggested) return { action: 'skip' };
    return {
      action: 'suggest_close',
      id: existing.id,
      description: withScheduleSlipClosureNote(existing.description),
      closureSuggested: true,
    };
  }
  const days = input.evaluation.slipWorkingDays;
  const probability = input.evaluation.probability ?? 'low';
  const impact = input.evaluation.impact ?? 'low';
  const severity = input.evaluation.severity ?? 'low';
  const title = scheduleSlipTitle(input.label, days);
  const description = openSlipDescription(existing?.description ?? null, input.label, days);
  const draft = {
    title,
    description,
    probability,
    impact,
    severity,
    slipWorkingDays: days,
    ownerUserId: input.ownerUserId,
  };
  if (!existing) return { action: 'create', ...draft };
  if (
    existing.title === title
    && existing.description === description
    && existing.probability === probability
    && existing.impact === impact
    && existing.severity === severity
    && existing.slipWorkingDays === days
    && existing.ownerUserId === input.ownerUserId
    && !existing.closureSuggested
  ) {
    return { action: 'skip' };
  }
  return {
    action: 'update',
    id: existing.id,
    ...draft,
    closureSuggested: false,
  };
}
