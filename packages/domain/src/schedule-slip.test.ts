import { describe, expect, it } from 'vitest';
import { parentDateDetail } from './index.js';
import {
  SCHEDULE_SLIP_CLOSURE_NOTE,
  decideScheduleSlipRisk,
  evaluateDeliveryScheduleSlips,
  evaluateScheduleSlip,
  scheduleSlipWindow,
  type OpenAutoSlipRisk,
  type ScheduleSlipSettings,
} from './schedule-slip.js';
import { DEFAULT_PROJECT_CALENDAR } from './working-calendar.js';

const calendar = DEFAULT_PROJECT_CALENDAR;
const enabled: ScheduleSlipSettings = {
  enabled: true,
  thresholdWorkingDays: 2,
  itemTypes: ['task', 'user_story', 'epic', 'milestone'],
};

function openRisk(patch: Partial<OpenAutoSlipRisk> = {}): OpenAutoSlipRisk {
  return {
    id: 'raid-1',
    title: 'Schedule slip: PRO-T-1 +2 days',
    description: 'Auto-generated schedule slip for PRO-T-1 (2 working days).',
    probability: 'low',
    impact: 'low',
    severity: 'low',
    ownerUserId: 'user-1',
    slipWorkingDays: 2,
    closureSuggested: false,
    ...patch,
  };
}

describe('schedule slip detection', () => {
  it('matches the parent end rollup', () => {
    const children = [
      { status: 'todo', start: '2026-01-01', end: '2026-01-10' },
      { status: 'cancelled', start: '2026-01-01', end: '2026-06-01' },
    ];
    const detail = parentDateDetail({ start: null, end: '2026-01-05' }, children);
    expect(scheduleSlipWindow({
      ownFinish: '2026-01-05',
      children,
    }).plannedFinish).toBe(detail.end);
  });

  it('slips when the planned finish is later than the baseline', () => {
    const result = evaluateScheduleSlip({
      status: 'in_progress',
      plannedFinish: '2026-10-16',
      dueDate: '2026-10-16',
      baselineDate: '2026-10-12',
      today: '2026-10-12',
      thresholdWorkingDays: 2,
      calendar,
    });
    expect(result.slipping).toBe(true);
    expect(result.slipWorkingDays).toBe(4);
    expect(result.probability).toBe('low');
    expect(result.impact).toBe('low');
  });

  it('slips when the due date has passed and the item is still open', () => {
    const result = evaluateScheduleSlip({
      status: 'todo',
      plannedFinish: '2026-10-12',
      dueDate: '2026-10-12',
      baselineDate: '2026-10-12',
      today: '2026-10-16',
      thresholdWorkingDays: 2,
      calendar,
    });
    expect(result.slipping).toBe(true);
    expect(result.overdueWorkingDays).toBe(4);
  });

  it('stays quiet under the working-day threshold', () => {
    const result = evaluateScheduleSlip({
      status: 'todo',
      plannedFinish: '2026-10-13',
      dueDate: '2026-10-13',
      baselineDate: '2026-10-12',
      today: '2026-10-12',
      thresholdWorkingDays: 2,
      calendar,
    });
    expect(result.slipping).toBe(false);
    expect(result.slipWorkingDays).toBe(0);
  });

  it('ignores done and cancelled items', () => {
    for (const status of ['done', 'cancelled'] as const) {
      const result = evaluateScheduleSlip({
        status,
        plannedFinish: '2026-10-01',
        dueDate: '2026-10-01',
        today: '2026-10-20',
        thresholdWorkingDays: 2,
        calendar,
      });
      expect(result.slipping).toBe(false);
    }
  });

  it('raises probability and impact from slip size, and from the critical path when known', () => {
    const large = evaluateScheduleSlip({
      status: 'todo',
      plannedFinish: '2026-11-06',
      dueDate: '2026-10-12',
      today: '2026-10-12',
      thresholdWorkingDays: 2,
      calendar,
      onCriticalPath: null,
    });
    expect(large.slipWorkingDays).toBeGreaterThanOrEqual(10);
    expect(large.probability).toBe('high');
    const critical = evaluateScheduleSlip({
      status: 'todo',
      plannedFinish: '2026-10-14',
      dueDate: '2026-10-12',
      today: '2026-10-12',
      thresholdWorkingDays: 2,
      calendar,
      onCriticalPath: true,
    });
    expect(critical.probability).toBe('medium');
    expect(critical.impact).toBe('medium');
  });

  it('uses a child-derived finish that is later than the milestone due date', () => {
    const hits = evaluateDeliveryScheduleSlips({
      settings: enabled,
      today: '2026-10-01',
      calendar,
      tasks: [{
        id: 'task-1',
        status: 'todo',
        dueDate: '2026-10-20',
        baselineFinishDate: '2026-10-20',
      }],
      stories: [],
      epics: [],
      milestones: [{
        id: 'ms-1',
        status: 'planned',
        targetDate: '2026-10-12',
        baselineFinishDate: '2026-10-12',
        links: [{ entityType: 'task', entityId: 'task-1' }],
      }],
    });
    expect(hits.get('ms-1')?.evaluation.slipping).toBe(true);
    expect(hits.get('ms-1')?.evaluation.forecastWorkingDays).toBe(6);
    expect(hits.get('task-1')?.evaluation.slipping).toBe(false);
  });
});

describe('schedule slip RAID decisions', () => {
  const slipping = evaluateScheduleSlip({
    status: 'todo',
    plannedFinish: '2026-10-16',
    dueDate: '2026-10-16',
    baselineDate: '2026-10-12',
    today: '2026-10-12',
    thresholdWorkingDays: 2,
    calendar,
  });
  const worse = evaluateScheduleSlip({
    status: 'todo',
    plannedFinish: '2026-10-23',
    dueDate: '2026-10-23',
    baselineDate: '2026-10-12',
    today: '2026-10-12',
    thresholdWorkingDays: 2,
    calendar,
  });
  const clear = evaluateScheduleSlip({
    status: 'todo',
    plannedFinish: '2026-10-12',
    dueDate: '2026-10-12',
    baselineDate: '2026-10-12',
    today: '2026-10-12',
    thresholdWorkingDays: 2,
    calendar,
  });

  it('does not create a risk when the setting is off', () => {
    const decision = decideScheduleSlipRisk({
      enabled: false,
      watched: true,
      evaluation: slipping,
      label: 'PRO-T-1',
      ownerUserId: 'user-1',
      existing: null,
    });
    expect(decision).toEqual({ action: 'skip' });
  });

  it('creates one risk, then updates it when the slip grows', () => {
    const created = decideScheduleSlipRisk({
      enabled: true,
      watched: true,
      evaluation: slipping,
      label: 'PRO-T-1',
      ownerUserId: 'user-1',
      existing: null,
    });
    expect(created.action).toBe('create');
    if (created.action !== 'create') return;
    expect(created.title).toBe('Schedule slip: PRO-T-1 +4 days');
    const updated = decideScheduleSlipRisk({
      enabled: true,
      watched: true,
      evaluation: worse,
      label: 'PRO-T-1',
      ownerUserId: 'user-1',
      existing: openRisk({
        title: created.title,
        description: created.description,
        slipWorkingDays: created.slipWorkingDays,
        probability: created.probability,
        impact: created.impact,
        severity: created.severity,
      }),
    });
    expect(updated.action).toBe('update');
    if (updated.action !== 'update') return;
    expect(updated.id).toBe('raid-1');
    expect(updated.title).toBe('Schedule slip: PRO-T-1 +9 days');
    expect(updated.slipWorkingDays).toBe(9);
  });

  it('suggests closure and does not auto-close when the slip resolves', () => {
    const decision = decideScheduleSlipRisk({
      enabled: true,
      watched: true,
      evaluation: clear,
      label: 'PRO-T-1',
      ownerUserId: 'user-1',
      existing: openRisk(),
    });
    expect(decision.action).toBe('suggest_close');
    if (decision.action !== 'suggest_close') return;
    expect(decision.closureSuggested).toBe(true);
    expect(decision.description).toContain(SCHEDULE_SLIP_CLOSURE_NOTE);
    expect(decision).not.toHaveProperty('status');
    const again = decideScheduleSlipRisk({
      enabled: true,
      watched: true,
      evaluation: clear,
      label: 'PRO-T-1',
      ownerUserId: 'user-1',
      existing: openRisk({
        closureSuggested: true,
        description: decision.description,
      }),
    });
    expect(again).toEqual({ action: 'skip' });
  });
});
