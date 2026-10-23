import {
  planDurationWorkingDays,
  type ProjectWorkingCalendar,
} from './working-calendar.js';

/**
 * Saving a change request needs a confirmation when it is moving to
 * Approved, or when it is already Approved and the baseline has not been
 * written yet. Cancel leaves the saved row untouched.
 */
export function baselineApprovalNeedsConfirm(input: {
  savedStatus: string;
  nextStatus: string;
  baselineAppliedAt: string | null;
}): boolean {
  if (input.nextStatus !== 'approved') return false;
  if (input.savedStatus !== 'approved') return true;
  return input.baselineAppliedAt == null;
}

export type BaselineApplyPreview = {
  startBefore: string | null;
  startAfter: string | null;
  finishBefore: string | null;
  finishAfter: string | null;
  durationBefore: number | null;
  durationAfter: number | null;
  budgetBefore: number | null;
  budgetAfter: number | null;
  /**
   * A schedule apply does not change the approved budget, so the delta is 0
   * when a budget is stored and null when both approved and initial are empty.
   */
  budgetDelta: number | null;
  appliesSchedule: boolean;
};

function storedBudget(
  approved: number | null | undefined,
  initial: number | null | undefined,
): number | null {
  if (approved != null && Number.isFinite(approved)) return approved;
  if (initial != null && Number.isFinite(initial)) return initial;
  return null;
}

/** Old and new baseline window for the approval confirmation. */
export function previewBaselineApply(input: {
  projectStart: string | null;
  projectFinish: string | null;
  changeStartAfter: string | null;
  changeFinishAfter: string | null;
  approvedBudget?: number | null;
  initialBudget?: number | null;
  calendar?: ProjectWorkingCalendar;
}): BaselineApplyPreview {
  const appliesSchedule = input.changeStartAfter != null || input.changeFinishAfter != null;
  const startAfter = appliesSchedule
    ? (input.changeStartAfter ?? input.projectStart)
    : input.projectStart;
  const finishAfter = appliesSchedule
    ? (input.changeFinishAfter ?? input.projectFinish)
    : input.projectFinish;
  const budgetBefore = storedBudget(input.approvedBudget, input.initialBudget);
  return {
    startBefore: input.projectStart,
    startAfter,
    finishBefore: input.projectFinish,
    finishAfter,
    durationBefore: planDurationWorkingDays(
      { start: input.projectStart, finish: input.projectFinish },
      input.calendar,
    ),
    durationAfter: planDurationWorkingDays(
      { start: startAfter, finish: finishAfter },
      input.calendar,
    ),
    budgetBefore,
    budgetAfter: budgetBefore,
    budgetDelta: budgetBefore == null ? null : 0,
    appliesSchedule,
  };
}
