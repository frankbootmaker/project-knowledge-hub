import {
  systemItDetailsSchema,
  type SystemItDetails,
  type SystemItDetailsPatch,
} from '@project-knowledge-hub/domain';

/**
 * Merge itDetails with partial-update semantics.
 *
 * - Top-level keys in `patch` replace those in `existing`.
 * - Keys set to `null` are removed from the result.
 * - Array fields (ports, endpoints, ipAddresses, dependencies) are replaced entirely, not merged element-wise.
 * - Omitted keys in `patch` are preserved from `existing`.
 * - The merged result is validated against the itDetails schema.
 *
 * @param existing - Current itDetails stored in the database.
 * @param patch - Partial itDetails update from the client (nullable fields to remove keys).
 * @returns Merged and validated itDetails object.
 * @throws ZodError if the merged result fails validation.
 */
export function mergeItDetails(
  existing: SystemItDetails,
  patch: SystemItDetailsPatch | null | undefined,
): SystemItDetails {
  if (patch == null) {
    return existing;
  }

  const merged: Record<string, unknown> = { ...existing };

  for (const key of Object.keys(patch)) {
    const value = patch[key as keyof SystemItDetailsPatch];
    if (value === null || value === undefined) {
      delete merged[key];
    } else {
      merged[key] = value;
    }
  }

  return systemItDetailsSchema.parse(merged);
}
