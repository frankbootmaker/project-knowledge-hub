type Entry<T> = {
  promise: Promise<T>;
  expiresAt: number;
};

const entries = new Map<string, Entry<unknown>>();

/**
 * Share one in-flight result across callers for a short window.
 * Next.js can render a server tree twice (shell, then the resumed tree)
 * with separate React caches. My Work uses this so those renders issue
 * one API call.
 */
export function coalesceInflight<T>(
  key: string,
  ttlMs: number,
  fn: () => Promise<T>,
  now = Date.now(),
): Promise<T> {
  const existing = entries.get(key) as Entry<T> | undefined;
  if (existing && existing.expiresAt > now) return existing.promise;

  const promise = fn();
  const entry: Entry<T> = { promise, expiresAt: now + ttlMs };
  entries.set(key, entry);
  promise.then(
    () => undefined,
    () => {
      if (entries.get(key)?.promise === promise) entries.delete(key);
    },
  );
  return promise;
}
