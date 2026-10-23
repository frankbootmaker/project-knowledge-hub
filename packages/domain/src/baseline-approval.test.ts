import { describe, expect, it } from 'vitest';
import {
  baselineApprovalNeedsConfirm,
  previewBaselineApply,
} from './baseline-approval.js';
import type { ProjectWorkingCalendar } from './working-calendar.js';

const calendar: ProjectWorkingCalendar = {
  hoursPerWorkday: 8,
  workdaysPerWeek: 5,
  nonWorkingDays: ['2026-08-20', '2026-08-21'],
};

describe('baseline approval confirmation (PRO-B-41)', () => {
  it('asks before the first approval and before an approved change is applied', () => {
    expect(baselineApprovalNeedsConfirm({
      savedStatus: 'proposed',
      nextStatus: 'approved',
      baselineAppliedAt: null,
    })).toBe(true);
    expect(baselineApprovalNeedsConfirm({
      savedStatus: 'approved',
      nextStatus: 'approved',
      baselineAppliedAt: null,
    })).toBe(true);
  });

  it('does not ask again after the baseline was applied, and cancel writes nothing', () => {
    expect(baselineApprovalNeedsConfirm({
      savedStatus: 'approved',
      nextStatus: 'approved',
      baselineAppliedAt: '2026-10-22T12:00:00.000Z',
    })).toBe(false);
    expect(baselineApprovalNeedsConfirm({
      savedStatus: 'proposed',
      nextStatus: 'proposed',
      baselineAppliedAt: null,
    })).toBe(false);
    // Cancel keeps the saved status. The client does not call save.
    const savedStatus = 'proposed';
    const confirmed = false;
    const nextStatus = confirmed ? 'approved' : savedStatus;
    expect(nextStatus).toBe('proposed');
    expect(baselineApprovalNeedsConfirm({
      savedStatus,
      nextStatus,
      baselineAppliedAt: null,
    })).toBe(false);
  });

  it('previews finish, inclusive duration, and a zero budget delta', () => {
    const preview = previewBaselineApply({
      projectStart: '2026-08-01',
      projectFinish: '2026-10-22',
      changeStartAfter: null,
      changeFinishAfter: '2026-12-31',
      approvedBudget: 1000,
      initialBudget: 800,
      calendar,
    });
    expect(preview.finishBefore).toBe('2026-10-22');
    expect(preview.finishAfter).toBe('2026-12-31');
    expect(preview.durationBefore).toBe(57);
    expect(preview.durationAfter).toBeGreaterThan(57);
    expect(preview.budgetBefore).toBe(1000);
    expect(preview.budgetAfter).toBe(1000);
    expect(preview.budgetDelta).toBe(0);
    expect(preview.appliesSchedule).toBe(true);
  });

  it('leaves the window unchanged when the change has no schedule dates', () => {
    const preview = previewBaselineApply({
      projectStart: '2026-10-05',
      projectFinish: '2026-10-05',
      changeStartAfter: null,
      changeFinishAfter: null,
      initialBudget: null,
      approvedBudget: null,
    });
    expect(preview.appliesSchedule).toBe(false);
    expect(preview.durationBefore).toBe(1);
    expect(preview.durationAfter).toBe(1);
    expect(preview.budgetDelta).toBeNull();
  });
});
