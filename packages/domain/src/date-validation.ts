import { AppError } from './index.js';

/**
 * Validates that an end date (or target date) is on or after the start date.
 * Allows equal dates. Skips validation when either date is null/undefined.
 * Throws AppError 400 with code INVALID_DATE_RANGE when validation fails.
 *
 * @param options.start - Start date in YYYY-MM-DD format or null/undefined
 * @param options.end - End date in YYYY-MM-DD format or null/undefined
 * @param options.startField - Field name for start date (for error message)
 * @param options.endField - Field name for end date (for error message)
 * @throws {AppError} When end date is before start date
 */
export function assertDateRange(options: {
  start: string | null | undefined;
  end: string | null | undefined;
  startField: string;
  endField: string;
}): void {
  const { start, end, startField, endField } = options;

  // Skip validation if either date is missing
  if (!start || !end) {
    return;
  }

  // Compare ISO date strings directly (YYYY-MM-DD format allows lexical comparison)
  if (end < start) {
    throw new AppError({
      code: 'INVALID_DATE_RANGE',
      message: `${endField} (${end}) must be on or after ${startField} (${start})`,
      statusCode: 400,
    });
  }
}

/**
 * Merges a patch with stored values to create an effective date range for validation.
 * Used during updates when only one date field may be supplied.
 *
 * @param stored - The current stored date pair
 * @param patch - The update patch containing new date values
 * @returns Effective date pair combining stored and patch values
 */
export function effectiveDateRange<T extends string>(options: {
  stored: { start: string | null; end: string | null };
  patch: { start?: T | null; end?: T | null };
}): { start: string | null; end: string | null } {
  const { stored, patch } = options;
  return {
    start: patch.start !== undefined ? (patch.start ?? null) : stored.start,
    end: patch.end !== undefined ? (patch.end ?? null) : stored.end,
  };
}
