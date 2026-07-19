type Bucket = { count: number; resetAt: number };

/**
 * Simple per-process sliding window limiter for auth endpoints.
 * Not shared across API replicas — good enough for this phase.
 */
export class MemoryRateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  /** Returns true when the request is allowed. */
  allow(key: string): boolean {
    const now = Date.now();
    const existing = this.buckets.get(key);
    if (!existing || existing.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + this.windowMs });
      return true;
    }
    if (existing.count >= this.max) {
      return false;
    }
    existing.count += 1;
    return true;
  }
}
