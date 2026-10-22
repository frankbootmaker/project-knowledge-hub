/**
 * One Cursor cloud agent may be linked to several tasks (PRO-T-117).
 *
 * Imported usage stays one row per agent run. When N tasks in the workspace
 * link that agent, each task receives an equal share of the token buckets.
 * Whole tokens use the largest remainder: sort task ids, give every task
 * floor(total / N), and give one extra token to the first (total mod N)
 * tasks. The shares sum to the original total, so adding the task counters
 * does not double count the run. A single linked task keeps the whole run.
 */

export type TokenBuckets = {
  tokensInput: number;
  tokensOutput: number;
  tokensCache: number;
  tokensCacheWrite: number;
};

export type TokenShare = TokenBuckets & {
  taskId: string;
  tokensUsed: number;
};

export function splitIntegerTotal(total: number, parts: number): number[] {
  if (!Number.isInteger(parts) || parts < 1) return [];
  const safe = Number.isFinite(total) ? Math.trunc(total) : 0;
  const sign = safe < 0 ? -1 : 1;
  const absolute = Math.abs(safe);
  const base = Math.floor(absolute / parts);
  const extra = absolute % parts;
  return Array.from({ length: parts }, (_, index) => sign * (base + (index < extra ? 1 : 0)));
}

/** Split a money amount in cents so the parts sum to the rounded total. */
export function splitMoneyTotal(total: number, parts: number): number[] {
  if (!Number.isInteger(parts) || parts < 1) return [];
  const cents = Math.round((Number.isFinite(total) ? total : 0) * 100);
  return splitIntegerTotal(cents, parts).map((part) => part / 100);
}

export function splitTokensAcrossTasks(
  total: TokenBuckets,
  taskIds: readonly string[],
): TokenShare[] {
  const ordered = [...new Set(taskIds.filter((id) => id.trim() !== ''))].sort();
  const count = ordered.length;
  if (count === 0) return [];
  const input = splitIntegerTotal(total.tokensInput, count);
  const output = splitIntegerTotal(total.tokensOutput, count);
  const cache = splitIntegerTotal(total.tokensCache, count);
  const cacheWrite = splitIntegerTotal(total.tokensCacheWrite, count);
  return ordered.map((taskId, index) => {
    const tokensInput = input[index] ?? 0;
    const tokensOutput = output[index] ?? 0;
    const tokensCache = cache[index] ?? 0;
    const tokensCacheWrite = cacheWrite[index] ?? 0;
    return {
      taskId,
      tokensInput,
      tokensOutput,
      tokensCache,
      tokensCacheWrite,
      tokensUsed: tokensInput + tokensOutput + tokensCache + tokensCacheWrite,
    };
  });
}
