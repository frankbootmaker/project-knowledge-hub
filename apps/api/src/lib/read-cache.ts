type Entry<T> = {
  promise: Promise<T>;
  expiresAt: number;
  settled: boolean;
};

const buckets = new WeakMap<object, Map<string, Entry<unknown>>>();

/**
 * Share one result for a scope (usually the database) and key.
 * A ttl of 0 still joins callers that are already in flight, then drops
 * the entry so the next call runs again. Failures are never kept.
 */
export function coalesceRead<T>(
  scope: object,
  key: string,
  ttlMs: number,
  fn: () => Promise<T>,
  now = Date.now(),
): Promise<T> {
  let bucket = buckets.get(scope);
  if (!bucket) {
    bucket = new Map();
    buckets.set(scope, bucket);
  }
  const existing = bucket.get(key) as Entry<T> | undefined;
  if (existing && (existing.expiresAt > now || !existing.settled)) return existing.promise;

  const promise = fn();
  const entry: Entry<T> = {
    promise,
    expiresAt: now + Math.max(0, ttlMs),
    settled: false,
  };
  bucket.set(key, entry);
  promise.then(
    () => {
      entry.settled = true;
      if (ttlMs <= 0 && bucket.get(key)?.promise === promise) bucket.delete(key);
    },
    () => {
      entry.settled = true;
      if (bucket.get(key)?.promise === promise) bucket.delete(key);
    },
  );
  return promise;
}

/** Keep a result across requests in production. Tests only share in-flight work. */
export function liveReadTtl(ttlMs: number): number {
  return process.env.NODE_ENV === 'test' ? 0 : ttlMs;
}
