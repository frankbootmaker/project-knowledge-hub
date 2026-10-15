import { z } from 'zod';
import { AppError } from './index.js';

/**
 * Project working calendar shared by scheduling and the upcoming Gantt (PRO-T-62).
 *
 * Date offsets count working days only. `workdaysPerWeek` is Monday-first:
 * 5 is Monday–Friday, 6 is Monday–Saturday, 7 is every day, 1 is Monday only.
 * Listed non-working days are skipped even when they fall on a working weekday.
 * `hoursPerWorkday` converts a working-day duration into effort hours.
 */

export const HOURS_PER_WORKDAY_MIN = 0.25;
export const HOURS_PER_WORKDAY_MAX = 24;
export const WORKDAYS_PER_WEEK_MIN = 1;
export const WORKDAYS_PER_WEEK_MAX = 7;
export const NON_WORKING_DAY_LIMIT = 2000;

const STEP_LIMIT = 3660 * 4;
const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

export type ProjectWorkingCalendar = {
  /** Effort hours in one working day. Scheduling rejects a non-positive value. */
  hoursPerWorkday: number;
  /** 1–7, Monday-first. Days after this weekday are non-working. */
  workdaysPerWeek: number;
  /** YYYY-MM-DD dates that are never working days. */
  nonWorkingDays: readonly string[];
};

export const DEFAULT_PROJECT_CALENDAR: ProjectWorkingCalendar = {
  hoursPerWorkday: 8,
  workdaysPerWeek: 5,
  nonWorkingDays: [],
};

/** Every calendar day counts. Useful when a project sets workdays per week to 7. */
export const EVERY_DAY_CALENDAR: ProjectWorkingCalendar = {
  hoursPerWorkday: 24,
  workdaysPerWeek: 7,
  nonWorkingDays: [],
};

export const hoursPerWorkdaySchema = z
  .number()
  .gt(0)
  .lte(HOURS_PER_WORKDAY_MAX)
  .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6, {
    message: 'hoursPerWorkday supports up to 2 decimal places',
  });

export const workdaysPerWeekSchema = z
  .number()
  .int()
  .min(WORKDAYS_PER_WEEK_MIN)
  .max(WORKDAYS_PER_WEEK_MAX);

export const nonWorkingDaySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
  .refine((value) => isRealYmd(value), { message: 'Invalid calendar date' });

export const nonWorkingDaysSchema = z
  .array(nonWorkingDaySchema)
  .max(NON_WORKING_DAY_LIMIT);

function invalidDate(ymd: string): AppError {
  return new AppError({
    code: 'INVALID_DATE',
    message: `Expected YYYY-MM-DD, received ${ymd}`,
    statusCode: 400,
  });
}

function invalidCalendar(message: string): AppError {
  return new AppError({
    code: 'INVALID_CALENDAR',
    message,
    statusCode: 400,
  });
}

export function isRealYmd(ymd: string): boolean {
  const match = YMD.exec(ymd);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = new Date(Date.UTC(year, month - 1, day));
  return (
    utc.getUTCFullYear() === year
    && utc.getUTCMonth() === month - 1
    && utc.getUTCDate() === day
  );
}

function parseYmd(ymd: string): { year: number; month: number; day: number } {
  const match = YMD.exec(ymd);
  if (!match || !isRealYmd(ymd)) throw invalidDate(ymd);
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

function formatYmd(year: number, month: number, day: number): string {
  const y = String(year).padStart(4, '0');
  const m = String(month).padStart(2, '0');
  const d = String(day).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** ISO weekday: Monday is 1 and Sunday is 7. */
export function isoWeekday(ymd: string): number {
  const { year, month, day } = parseYmd(ymd);
  const utc = new Date(Date.UTC(year, month - 1, day));
  const sundayBased = utc.getUTCDay();
  return sundayBased === 0 ? 7 : sundayBased;
}

export function addCalendarDays(ymd: string, days: number): string {
  const { year, month, day } = parseYmd(ymd);
  const utc = new Date(Date.UTC(year, month - 1, day));
  utc.setUTCDate(utc.getUTCDate() + days);
  return formatYmd(utc.getUTCFullYear(), utc.getUTCMonth() + 1, utc.getUTCDate());
}

export function diffCalendarDays(start: string, end: string): number {
  const startUtc = Date.parse(`${start}T00:00:00Z`);
  const endUtc = Date.parse(`${end}T00:00:00Z`);
  if (Number.isNaN(startUtc) || Number.isNaN(endUtc) || !isRealYmd(start) || !isRealYmd(end)) {
    throw new AppError({
      code: 'INVALID_DATE',
      message: `Expected YYYY-MM-DD dates, received ${start} and ${end}`,
      statusCode: 400,
    });
  }
  return Math.round((endUtc - startUtc) / 86_400_000);
}

export function normalizeNonWorkingDays(days: readonly string[]): string[] {
  const unique = new Set<string>();
  for (const day of days) {
    if (!isRealYmd(day)) throw invalidDate(day);
    unique.add(day);
  }
  if (unique.size > NON_WORKING_DAY_LIMIT) {
    throw invalidCalendar(
      `A project can list at most ${NON_WORKING_DAY_LIMIT} non-working days`,
    );
  }
  return [...unique].sort();
}

/**
 * Coerce stored project fields into a calendar. Missing or unusable numbers
 * fall back to the product default so a read never fails closed.
 */
export function coerceProjectCalendar(input: {
  hoursPerWorkday?: number | string | null;
  workdaysPerWeek?: number | null;
  nonWorkingDays?: readonly string[] | null;
}): ProjectWorkingCalendar {
  const hoursRaw = input.hoursPerWorkday == null ? NaN : Number(input.hoursPerWorkday);
  const hours = Number.isFinite(hoursRaw) && hoursRaw > 0 && hoursRaw <= HOURS_PER_WORKDAY_MAX
    ? Math.round(hoursRaw * 100) / 100
    : DEFAULT_PROJECT_CALENDAR.hoursPerWorkday;
  const days = input.workdaysPerWeek;
  const workdays = Number.isInteger(days)
    && days != null
    && days >= WORKDAYS_PER_WEEK_MIN
    && days <= WORKDAYS_PER_WEEK_MAX
    ? days
    : DEFAULT_PROJECT_CALENDAR.workdaysPerWeek;
  const holidays = (input.nonWorkingDays ?? []).filter((day) => isRealYmd(day));
  return {
    hoursPerWorkday: hours,
    workdaysPerWeek: workdays,
    nonWorkingDays: [...new Set(holidays)].sort(),
  };
}

/** Scheduling reads hours so a calendar with no working time cannot shift dates. */
export function assertUsableCalendar(
  calendar: ProjectWorkingCalendar,
): ProjectWorkingCalendar {
  if (
    !Number.isFinite(calendar.hoursPerWorkday)
    || calendar.hoursPerWorkday <= 0
    || calendar.hoursPerWorkday > HOURS_PER_WORKDAY_MAX
  ) {
    throw invalidCalendar('hoursPerWorkday must be greater than 0 and at most 24');
  }
  if (
    !Number.isInteger(calendar.workdaysPerWeek)
    || calendar.workdaysPerWeek < WORKDAYS_PER_WEEK_MIN
    || calendar.workdaysPerWeek > WORKDAYS_PER_WEEK_MAX
  ) {
    throw invalidCalendar('workdaysPerWeek must be a whole number from 1 to 7');
  }
  return calendar;
}

export function isWorkingDay(ymd: string, calendar: ProjectWorkingCalendar): boolean {
  assertUsableCalendar(calendar);
  if (calendar.nonWorkingDays.includes(ymd)) return false;
  return isoWeekday(ymd) <= calendar.workdaysPerWeek;
}

/**
 * Move by working days. A zero offset stays on the anchor, even on a
 * non-working day (finish-to-start lag 0). Any other offset lands on a
 * working day and does not count weekends or listed non-working days.
 */
export function addWorkingDays(
  ymd: string,
  days: number,
  calendar: ProjectWorkingCalendar = DEFAULT_PROJECT_CALENDAR,
): string {
  assertUsableCalendar(calendar);
  if (!Number.isInteger(days)) {
    throw invalidCalendar('Working-day offsets must be whole days');
  }
  if (days === 0) {
    parseYmd(ymd);
    return ymd;
  }
  const direction = days > 0 ? 1 : -1;
  let remaining = Math.abs(days);
  let cursor = ymd;
  let steps = 0;
  while (remaining > 0) {
    cursor = addCalendarDays(cursor, direction);
    if (isWorkingDay(cursor, calendar)) remaining -= 1;
    steps += 1;
    if (steps > STEP_LIMIT) {
      throw invalidCalendar('No working day within range of the project calendar');
    }
  }
  return cursor;
}

/**
 * Working days strictly after `start` through `end`.
 * `addWorkingDays(start, diffWorkingDays(start, end))` matches `end` when
 * `end` is a working day (or the zero-offset anchor).
 */
export function diffWorkingDays(
  start: string,
  end: string,
  calendar: ProjectWorkingCalendar = DEFAULT_PROJECT_CALENDAR,
): number {
  assertUsableCalendar(calendar);
  if (start === end) {
    parseYmd(start);
    return 0;
  }
  const sign = end > start ? 1 : -1;
  let cursor = start;
  let count = 0;
  let steps = 0;
  while (cursor !== end) {
    cursor = addCalendarDays(cursor, sign);
    if (isWorkingDay(cursor, calendar)) count += 1;
    steps += 1;
    if (steps > STEP_LIMIT) {
      throw invalidCalendar('No working day within range of the project calendar');
    }
  }
  return sign * count;
}

/** Effort hours for a working-day duration. Gantt uses this with the same calendar. */
export function scheduledEffortHours(
  durationWorkingDays: number,
  calendar: ProjectWorkingCalendar = DEFAULT_PROJECT_CALENDAR,
): number {
  assertUsableCalendar(calendar);
  if (!Number.isFinite(durationWorkingDays)) {
    throw invalidCalendar('durationWorkingDays must be a finite number');
  }
  return Math.round(durationWorkingDays * calendar.hoursPerWorkday * 100) / 100;
}

export type PlanDateSpan = {
  start?: string | null;
  end?: string | null;
};

/**
 * Earliest start and latest end across scheduled items.
 * Callers pass dates already rolled up from children (PRO-T-73): a parent
 * start is the earliest child start and a parent end is the latest child end.
 */
export function planWindowFromDatedItems(
  items: readonly PlanDateSpan[],
): { start: string | null; finish: string | null } {
  let start: string | null = null;
  let finish: string | null = null;
  for (const item of items) {
    if (item.start && (start == null || item.start < start)) start = item.start;
    if (item.end && (finish == null || item.end > finish)) finish = item.end;
  }
  return { start, finish };
}

/** Working days from the plan's earliest start to its latest finish. */
export function planDurationWorkingDays(
  window: { start: string | null; finish: string | null },
  calendar: ProjectWorkingCalendar = DEFAULT_PROJECT_CALENDAR,
): number | null {
  if (!window.start || !window.finish) return null;
  if (window.finish < window.start) return null;
  return diffWorkingDays(window.start, window.finish, calendar);
}
