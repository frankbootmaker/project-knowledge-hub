/**
 * Diff a replace-all write so unchanged rows keep their identity and created_by.
 * Callers insert only `insert`, delete only `remove`, and update `update`
 * without stamping a new creator.
 */
export type ReplacementDiff<TExisting, TNext> = {
  keep: TExisting[];
  update: Array<{ existing: TExisting; next: TNext }>;
  insert: TNext[];
  remove: TExisting[];
};

export function diffReplacement<TExisting, TNext>(
  existing: readonly TExisting[],
  next: readonly TNext[],
  keyOfExisting: (row: TExisting) => string,
  keyOfNext: (row: TNext) => string,
  unchanged: (existing: TExisting, next: TNext) => boolean,
): ReplacementDiff<TExisting, TNext> {
  const existingByKey = new Map<string, TExisting>();
  for (const row of existing) {
    const key = keyOfExisting(row);
    if (!existingByKey.has(key)) existingByKey.set(key, row);
  }

  const keep: TExisting[] = [];
  const update: Array<{ existing: TExisting; next: TNext }> = [];
  const insert: TNext[] = [];
  const seen = new Set<string>();

  for (const row of next) {
    const key = keyOfNext(row);
    if (seen.has(key)) continue;
    seen.add(key);
    const prev = existingByKey.get(key);
    if (!prev) {
      insert.push(row);
      continue;
    }
    if (unchanged(prev, row)) keep.push(prev);
    else update.push({ existing: prev, next: row });
  }

  const remove: TExisting[] = [];
  for (const [key, row] of existingByKey) {
    if (!seen.has(key)) remove.push(row);
  }

  return { keep, update, insert, remove };
}
