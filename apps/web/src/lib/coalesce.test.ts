import { describe, expect, it, vi } from 'vitest';
import { coalesceInflight } from './coalesce';

describe('coalesceInflight', () => {
  it('runs overlapping My Work loads once', async () => {
    const run = vi.fn(async () => ({ insights: true }));
    const now = 1_000;
    const first = coalesceInflight('insights:user-a', 2_000, run, now);
    const second = coalesceInflight('insights:user-a', 2_000, run, now + 169);
    await expect(Promise.all([first, second])).resolves.toEqual([
      { insights: true },
      { insights: true },
    ]);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('does not share a result across users or after the window', async () => {
    const run = vi.fn(async () => 'ok');
    await coalesceInflight('insights:user-a', 2_000, run, 5_000);
    await coalesceInflight('insights:user-b', 2_000, run, 5_100);
    await coalesceInflight('insights:user-a', 2_000, run, 7_100);
    expect(run).toHaveBeenCalledTimes(3);
  });

  it('lets a failed load be retried', async () => {
    const run = vi.fn()
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValueOnce('ok');
    await expect(coalesceInflight('insights:retry', 2_000, run, 10_000)).rejects.toThrow('down');
    await expect(coalesceInflight('insights:retry', 2_000, run, 10_100)).resolves.toBe('ok');
    expect(run).toHaveBeenCalledTimes(2);
  });
});
