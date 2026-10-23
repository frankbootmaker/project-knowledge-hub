import { describe, expect, it } from 'vitest';
import { AppError } from './index.js';
import {
  EVERY_DAY_CALENDAR,
  addWorkingDays,
  diffWorkingDays,
  exclusiveWorkingDays,
  inclusiveWorkingDays,
  isWorkingDay,
  planDurationWorkingDays,
  planWindowFromDatedItems,
  scheduledEffortHours,
  type ProjectWorkingCalendar,
} from './working-calendar.js';
import {
  resolveTaskScheduleDates,
  scheduleDeliveryGraph,
  type ScheduleNode,
} from './delivery-dependencies.js';

const mondayFriday: ProjectWorkingCalendar = {
  hoursPerWorkday: 8,
  workdaysPerWeek: 5,
  nonWorkingDays: [],
};

function node(
  key: string,
  entityType: ScheduleNode['entityType'],
  start: string | null,
  finish: string | null,
  durationDays: number | null = null,
): ScheduleNode {
  return { key, entityType, start, finish, durationDays };
}

describe('project working calendar', () => {
  it('treats Monday–Friday as working days and skips the weekend', () => {
    expect(isWorkingDay('2026-10-01', mondayFriday)).toBe(true);
    expect(isWorkingDay('2026-10-02', mondayFriday)).toBe(true);
    expect(isWorkingDay('2026-10-03', mondayFriday)).toBe(false);
    expect(isWorkingDay('2026-10-04', mondayFriday)).toBe(false);
    expect(addWorkingDays('2026-10-01', 1, mondayFriday)).toBe('2026-10-02');
    expect(addWorkingDays('2026-10-02', 1, mondayFriday)).toBe('2026-10-05');
    expect(addWorkingDays('2026-10-05', -1, mondayFriday)).toBe('2026-10-02');
    expect(exclusiveWorkingDays('2026-10-02', '2026-10-05', mondayFriday)).toBe(1);
    // Friday and the following Monday. The start day counts.
    expect(diffWorkingDays('2026-10-02', '2026-10-05', mondayFriday)).toBe(2);
    expect(addWorkingDays('2026-10-02', 0, mondayFriday)).toBe('2026-10-02');
  });

  it('skips listed non-working days and uses hours for effort', () => {
    const calendar: ProjectWorkingCalendar = {
      hoursPerWorkday: 7.5,
      workdaysPerWeek: 5,
      nonWorkingDays: ['2026-10-09'],
    };
    expect(isWorkingDay('2026-10-09', calendar)).toBe(false);
    expect(addWorkingDays('2026-10-08', 1, calendar)).toBe('2026-10-12');
    expect(exclusiveWorkingDays('2026-10-08', '2026-10-12', calendar)).toBe(1);
    // Thursday plus Monday. Friday is a holiday and the start day counts.
    expect(diffWorkingDays('2026-10-08', '2026-10-12', calendar)).toBe(2);
    expect(scheduledEffortHours(2, calendar)).toBe(15);
  });

  it('counts every day when the week is seven workdays', () => {
    expect(addWorkingDays('2026-10-02', 1, EVERY_DAY_CALENDAR)).toBe('2026-10-03');
    expect(exclusiveWorkingDays('2026-10-01', '2026-10-06', EVERY_DAY_CALENDAR)).toBe(5);
    expect(diffWorkingDays('2026-10-01', '2026-10-06', EVERY_DAY_CALENDAR)).toBe(6);
  });

  it('rejects a calendar with no working hours', () => {
    expect(() =>
      addWorkingDays('2026-10-01', 1, {
        hoursPerWorkday: 0,
        workdaysPerWeek: 5,
        nonWorkingDays: [],
      }),
    ).toThrow(AppError);
  });

  it('derives the plan window from rolled-up dates and working days', () => {
    const window = planWindowFromDatedItems([
      { start: '2026-10-08', end: '2026-10-12' },
      { start: '2026-10-01', end: '2026-10-02' },
      { start: null, end: '2026-10-20' },
      { start: '2026-11-02', end: null },
    ]);
    expect(window).toEqual({ start: '2026-10-01', finish: '2026-10-20' });
    // Thursday 1 Oct through Tuesday 20 Oct, start day included.
    expect(planDurationWorkingDays(window, mondayFriday)).toBe(14);
    expect(planDurationWorkingDays({ start: null, finish: '2026-10-20' }, mondayFriday)).toBeNull();
  });

  it('counts baseline duration inclusive of the start day (PRO-B-41)', () => {
    const calendar: ProjectWorkingCalendar = {
      hoursPerWorkday: 8,
      workdaysPerWeek: 5,
      nonWorkingDays: ['2026-08-20', '2026-08-21'],
    };
    expect(
      inclusiveWorkingDays('2026-08-01', '2026-10-22', calendar),
    ).toBe(57);
    expect(
      planDurationWorkingDays(
        { start: '2026-08-01', finish: '2026-10-22' },
        calendar,
      ),
    ).toBe(57);
    // Monday 5 Oct is one working day. The start day counts.
    expect(
      planDurationWorkingDays(
        { start: '2026-10-05', finish: '2026-10-05' },
        mondayFriday,
      ),
    ).toBe(1);
    expect(
      planDurationWorkingDays(
        { start: '2026-10-03', finish: '2026-10-03' },
        mondayFriday,
      ),
    ).toBe(0);
    // Saturday 3 Oct through Monday 5 Oct. The weekend start does not count.
    expect(diffWorkingDays('2026-10-03', '2026-10-05', mondayFriday)).toBe(1);
    expect(diffWorkingDays('2026-10-03', '2026-10-03', mondayFriday)).toBe(0);
    expect(
      planDurationWorkingDays(
        { start: '2026-10-03', finish: '2026-10-05' },
        mondayFriday,
      ),
    ).toBe(1);
    // Thursday 20 Aug and Friday 21 Aug are holidays, so they drop out of 57.
    expect(isWorkingDay('2026-08-20', calendar)).toBe(false);
    expect(isWorkingDay('2026-08-01', calendar)).toBe(false);
  });
});

describe('working-day dependency schedule', () => {
  const holiday: ProjectWorkingCalendar = {
    hoursPerWorkday: 8,
    workdaysPerWeek: 5,
    nonWorkingDays: ['2026-10-09'],
  };

  it('moves a task due date by working days, skipping a holiday', () => {
    expect(
      resolveTaskScheduleDates({
        stored: { startDate: null, dueDate: null, durationDays: null },
        patch: { startDate: '2026-10-08', durationDays: 1 },
        calendar: holiday,
      }),
    ).toEqual({
      startDate: '2026-10-08',
      dueDate: '2026-10-12',
      durationDays: 1,
    });
  });

  it('skips non-working days for FS, SS, FF, and SF with several predecessors', () => {
    const changed = scheduleDeliveryGraph({
      calendar: holiday,
      nodes: [
        node('task:fs', 'task', '2026-10-08', '2026-10-08', 0),
        node('task:ss', 'task', '2026-10-08', '2026-10-08', 0),
        node('task:ff', 'task', '2026-10-12', '2026-10-14', 2),
        node('task:sf', 'task', '2026-10-12', '2026-10-13', 1),
        node('task:b', 'task', null, null, 2),
      ],
      links: [
        { predecessorKey: 'task:fs', successorKey: 'task:b', linkType: 'FS', lagDays: 1 },
        { predecessorKey: 'task:ss', successorKey: 'task:b', linkType: 'SS', lagDays: 1 },
        { predecessorKey: 'task:ff', successorKey: 'task:b', linkType: 'FF', lagDays: 0 },
        { predecessorKey: 'task:sf', successorKey: 'task:b', linkType: 'SF', lagDays: 0 },
      ],
      seeds: ['task:b'],
    });
    // FS and SS from Thursday + 1 working day skip Friday's holiday and land Monday.
    // FF finish Wednesday 14 minus 2 working days is Monday 12.
    // SF start Monday 12 minus 2 working days is Wednesday 7.
    // The latest start is Monday 12. Duration 2 finishes Wednesday 14.
    expect(changed[0]).toMatchObject({
      start: '2026-10-12',
      finish: '2026-10-14',
      durationDays: 2,
    });
  });
});
