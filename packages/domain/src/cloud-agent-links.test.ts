import { describe, expect, it } from 'vitest';
import { allocationTokenSlices } from './ai-billing.js';
import { linkUsageRows } from './ai-usage-import.js';
import { splitIntegerTotal, splitMoneyTotal, splitTokensAcrossTasks } from './cloud-agent-links.js';

describe('shared cloud agent token split (PRO-T-117)', () => {
  it('gives one task the whole total', () => {
    expect(splitIntegerTotal(100, 1)).toEqual([100]);
    const [share] = splitTokensAcrossTasks(
      { tokensInput: 10, tokensOutput: 4, tokensCache: 2, tokensCacheWrite: 1 },
      ['task-a'],
    );
    expect(share).toMatchObject({
      taskId: 'task-a',
      tokensInput: 10,
      tokensOutput: 4,
      tokensCache: 2,
      tokensCacheWrite: 1,
      tokensUsed: 17,
    });
  });

  it('splits two tasks so the shares sum to the run and do not double it', () => {
    const shares = splitTokensAcrossTasks(
      { tokensInput: 5, tokensOutput: 0, tokensCache: 0, tokensCacheWrite: 0 },
      ['task-b', 'task-a'],
    );
    expect(shares.map((share) => share.taskId)).toEqual(['task-a', 'task-b']);
    expect(shares.map((share) => share.tokensInput)).toEqual([3, 2]);
    expect(shares.reduce((sum, share) => sum + share.tokensUsed, 0)).toBe(5);
    expect(splitMoneyTotal(1.01, 2)).toEqual([0.51, 0.5]);
  });

  it('points an event at a task only when one task links the agent', () => {
    const one = linkUsageRows(
      [{ cloudAgentId: 'bc-1' }, { cloudAgentId: null }],
      new Map([['bc-1', 'task-a']]),
    );
    expect(one[0]?.projectTaskId).toBe('task-a');
    expect(one[1]?.projectTaskId).toBeNull();
    const shared = linkUsageRows(
      [{ cloudAgentId: 'bc-1' }],
      new Map([['bc-1', ['task-b', 'task-a']]]),
    );
    expect(shared[0]?.projectTaskId).toBeNull();
  });

  it('counts one imported run once across two projects', () => {
    const slices = allocationTokenSlices({
      tasks: [
        {
          taskId: 'task-a',
          projectId: 'alpha',
          aiSystemId: null,
          cloudAgentId: 'bc-shared',
          cloudAgentIds: ['bc-shared'],
          period: '2026-10',
          tokens: 80,
        },
        {
          taskId: 'task-b',
          projectId: 'beta',
          aiSystemId: null,
          cloudAgentId: 'bc-shared',
          cloudAgentIds: ['bc-shared'],
          period: '2026-10',
          tokens: 80,
        },
      ],
      events: [
        {
          projectId: null,
          aiSystemId: null,
          cloudAgentId: 'bc-shared',
          occurredAt: new Date('2026-10-22T12:00:00Z'),
          tokens: 100,
        },
      ],
    });
    const of = (projectId: string) =>
      slices
        .filter((slice) => slice.projectId === projectId)
        .reduce((sum, slice) => sum + slice.tokens, 0);
    expect(of('alpha')).toBe(50);
    expect(of('beta')).toBe(50);
    expect(of('alpha') + of('beta')).toBe(100);
    expect(slices.some((slice) => slice.tokens === 80)).toBe(false);
  });
});
