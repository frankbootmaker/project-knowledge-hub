import { describe, expect, it, vi } from 'vitest';
import { coalesceRead } from './read-cache.js';

describe('coalesceRead', () => {
  it('joins callers for the same scope and key until the ttl', async () => {
    const scope = {};
    const run = vi.fn(async () => ({ total: 42 }));
    const first = coalesceRead(scope, 'health:ws:2026-10-24', 5_000, run, 1_000);
    const second = coalesceRead(scope, 'health:ws:2026-10-24', 5_000, run, 1_200);
    await expect(Promise.all([first, second])).resolves.toEqual([
      { total: 42 },
      { total: 42 },
    ]);
    expect(run).toHaveBeenCalledTimes(1);
    await coalesceRead(scope, 'health:ws:2026-10-24', 5_000, run, 6_000);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('does not share across scopes or keys', async () => {
    const run = vi.fn(async () => 'ok');
    await coalesceRead({}, 'a', 5_000, run, 1_000);
    await coalesceRead({}, 'a', 5_000, run, 1_100);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('drops a failed read so the next caller can retry', async () => {
    const scope = {};
    const run = vi.fn()
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValueOnce('ok');
    await expect(coalesceRead(scope, 'retry', 5_000, run, 1_000)).rejects.toThrow('down');
    await expect(coalesceRead(scope, 'retry', 5_000, run, 1_100)).resolves.toBe('ok');
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('shares an in-flight read even when the ttl is zero', async () => {
    const scope = {};
    let release: (value: string) => void = () => undefined;
    const gate = new Promise<string>((resolve) => {
      release = resolve;
    });
    const run = vi.fn(() => gate);
    const first = coalesceRead(scope, 'inflight', 0, run, 1_000);
    const second = coalesceRead(scope, 'inflight', 0, run, 1_000);
    expect(run).toHaveBeenCalledTimes(1);
    release('ok');
    await expect(Promise.all([first, second])).resolves.toEqual(['ok', 'ok']);
    await expect(coalesceRead(scope, 'inflight', 0, run, 2_000)).resolves.toBe('ok');
    expect(run).toHaveBeenCalledTimes(2);
  });
});
