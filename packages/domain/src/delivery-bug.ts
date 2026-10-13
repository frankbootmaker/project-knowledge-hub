import { z } from 'zod';

/** Work-item type stored on a project task row. Chosen at create. */
export const taskItemTypeSchema = z.enum(['task', 'bug']);

/** Where a bug was observed. */
export const bugFoundInSchema = z.enum([
  'development',
  'test',
  'staging',
  'production',
]);

/** Why a bug was closed. Status stays the task lifecycle. */
export const bugResolutionSchema = z.enum([
  'fixed',
  'duplicate',
  'wont_fix',
  'cannot_reproduce',
  'works_as_designed',
]);

export type TaskItemType = z.infer<typeof taskItemTypeSchema>;
export type BugFoundIn = z.infer<typeof bugFoundInSchema>;
export type BugResolution = z.infer<typeof bugResolutionSchema>;

export type StoredBugFields = {
  severity: 'low' | 'medium' | 'high' | 'critical' | null;
  foundIn: BugFoundIn | null;
  foundInNote: string | null;
  stepsToReproduce: string | null;
  expectedBehavior: string | null;
  actualBehavior: string | null;
  resolution: BugResolution | null;
  regression: boolean;
  affectedSystemId: string | null;
  duplicateOfTaskId: string | null;
};

/** Patch values. `undefined` means leave the stored value alone. */
export type BugFieldPatch = {
  severity?: StoredBugFields['severity'];
  foundIn?: BugFoundIn | null;
  foundInNote?: string | null;
  stepsToReproduce?: string | null;
  expectedBehavior?: string | null;
  actualBehavior?: string | null;
  resolution?: BugResolution | null;
  regression?: boolean | null;
  affectedSystemId?: string | null;
  duplicateOfTaskId?: string | null;
};

export type BugWriteErrorCode =
  | 'BUG_FIELDS_ON_TASK'
  | 'TASK_ITEM_TYPE_IMMUTABLE'
  | 'BUG_DUPLICATE_LINK_INVALID';

export type BugWriteResult =
  | { ok: true; itemType: TaskItemType; fields: StoredBugFields }
  | { ok: false; code: BugWriteErrorCode; message: string };

const BUG_PATCH_KEYS = [
  'severity',
  'foundIn',
  'foundInNote',
  'stepsToReproduce',
  'expectedBehavior',
  'actualBehavior',
  'resolution',
  'regression',
  'affectedSystemId',
  'duplicateOfTaskId',
] as const satisfies ReadonlyArray<keyof BugFieldPatch>;

export function emptyBugFields(): StoredBugFields {
  return {
    severity: null,
    foundIn: null,
    foundInNote: null,
    stepsToReproduce: null,
    expectedBehavior: null,
    actualBehavior: null,
    resolution: null,
    regression: false,
    affectedSystemId: null,
    duplicateOfTaskId: null,
  };
}

export function bugPatchTouches(patch: BugFieldPatch): boolean {
  return BUG_PATCH_KEYS.some((key) => patch[key] !== undefined);
}

function blankToNull(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function fail(code: BugWriteErrorCode, message: string): BugWriteResult {
  return { ok: false, code, message };
}

function pickText(
  patchValue: string | null | undefined,
  existing: string | null,
): string | null {
  const normalized = blankToNull(patchValue);
  if (normalized === undefined) return existing;
  return normalized;
}

export function resolveBugCreate(
  itemType: TaskItemType,
  patch: BugFieldPatch,
): BugWriteResult {
  if (itemType === 'task') {
    if (bugPatchTouches(patch)) {
      return fail('BUG_FIELDS_ON_TASK', 'Bug fields are only allowed on a bug');
    }
    return { ok: true, itemType, fields: emptyBugFields() };
  }

  const resolution = patch.resolution ?? null;
  const duplicateOfTaskId = blankToNull(patch.duplicateOfTaskId) ?? null;
  if (duplicateOfTaskId && resolution !== 'duplicate') {
    return fail(
      'BUG_DUPLICATE_LINK_INVALID',
      'Duplicate of is stored only when resolution is duplicate',
    );
  }

  return {
    ok: true,
    itemType,
    fields: {
      severity: patch.severity ?? 'medium',
      foundIn: patch.foundIn ?? null,
      foundInNote: blankToNull(patch.foundInNote) ?? null,
      stepsToReproduce: blankToNull(patch.stepsToReproduce) ?? null,
      expectedBehavior: blankToNull(patch.expectedBehavior) ?? null,
      actualBehavior: blankToNull(patch.actualBehavior) ?? null,
      resolution,
      regression: patch.regression ?? false,
      affectedSystemId: patch.affectedSystemId ?? null,
      duplicateOfTaskId: resolution === 'duplicate' ? duplicateOfTaskId : null,
    },
  };
}

export function resolveBugUpdate(input: {
  existingItemType: TaskItemType;
  existing: StoredBugFields;
  itemType?: TaskItemType;
  patch: BugFieldPatch;
}): BugWriteResult {
  if (
    input.itemType !== undefined &&
    input.itemType !== input.existingItemType
  ) {
    return fail(
      'TASK_ITEM_TYPE_IMMUTABLE',
      'Item type is set at create and cannot be changed',
    );
  }

  if (input.existingItemType === 'task') {
    if (bugPatchTouches(input.patch)) {
      return fail('BUG_FIELDS_ON_TASK', 'Bug fields are only allowed on a bug');
    }
    return { ok: true, itemType: 'task', fields: emptyBugFields() };
  }

  const patch = input.patch;
  const existing = input.existing;
  const resolution =
    patch.resolution !== undefined ? patch.resolution : existing.resolution;
  const duplicateOfTaskId =
    patch.duplicateOfTaskId !== undefined
      ? (blankToNull(patch.duplicateOfTaskId) ?? null)
      : existing.duplicateOfTaskId;

  if (resolution !== 'duplicate' && patch.duplicateOfTaskId) {
    return fail(
      'BUG_DUPLICATE_LINK_INVALID',
      'Duplicate of is stored only when resolution is duplicate',
    );
  }

  return {
    ok: true,
    itemType: 'bug',
    fields: {
      severity:
        patch.severity !== undefined
          ? (patch.severity ?? 'medium')
          : (existing.severity ?? 'medium'),
      foundIn: patch.foundIn !== undefined ? patch.foundIn : existing.foundIn,
      foundInNote: pickText(patch.foundInNote, existing.foundInNote),
      stepsToReproduce: pickText(
        patch.stepsToReproduce,
        existing.stepsToReproduce,
      ),
      expectedBehavior: pickText(
        patch.expectedBehavior,
        existing.expectedBehavior,
      ),
      actualBehavior: pickText(patch.actualBehavior, existing.actualBehavior),
      resolution,
      regression:
        patch.regression !== undefined
          ? (patch.regression ?? false)
          : existing.regression,
      affectedSystemId:
        patch.affectedSystemId !== undefined
          ? patch.affectedSystemId
          : existing.affectedSystemId,
      duplicateOfTaskId: resolution === 'duplicate' ? duplicateOfTaskId : null,
    },
  };
}
