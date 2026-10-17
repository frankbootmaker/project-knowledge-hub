import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '@project-knowledge-hub/database';
import type { ProjectHealth } from '@project-knowledge-hub/domain';

vi.mock('./project-overall-rag.js', () => ({
  listProjectHealth: vi.fn(),
}));

vi.mock('./project-delivery.js', () => ({
  listAssignedTasksForUser: vi.fn(async () => []),
}));

vi.mock('./project-budget.js', () => ({
  getProjectBudgetSummary: vi.fn(async () => {
    throw new Error('budget attention is not part of this test');
  }),
}));

import { getDashboardInsights } from './dashboard-insights.js';
import { listProjectHealth } from './project-overall-rag.js';

function query(rows: unknown[]) {
  const builder: Record<string, unknown> = {};
  builder.from = () => builder;
  builder.innerJoin = () => builder;
  builder.where = () => builder;
  builder.orderBy = () => builder;
  builder.limit = async () => rows;
  builder.then = (
    resolve: (value: unknown[]) => unknown,
    reject?: (reason: unknown) => unknown,
  ) => Promise.resolve(rows).then(resolve, reject);
  return builder;
}

function database(responses: unknown[][]) {
  const pending = [...responses];
  return {
    db: {
      select: () => query(pending.shift() ?? []),
    },
  } as unknown as Database;
}

const projectRow = {
  id: 'p-1',
  name: 'Budget red',
  slug: 'budget-red',
  workspaceSlug: 'lab',
  updatedAt: new Date('2026-10-17T00:00:00.000Z'),
};

describe('dashboard project health', () => {
  beforeEach(() => {
    vi.mocked(listProjectHealth).mockReset();
  });

  it('counts the shared overall RAG, including a budget-only red', async () => {
    const health: ProjectHealth = {
      overall: 'red',
      timeline: 'green',
      risk: 'green',
      financial: 'red',
    };
    vi.mocked(listProjectHealth).mockResolvedValue(new Map([['p-1', health]]));
    const insights = await getDashboardInsights(
      database([
        [{ id: 'ws-1' }],
        [projectRow],
        [{ kind: 'risk', status: 'open' }],
      ]),
      { userId: 'user-1', isSystemAdmin: true },
    );

    expect(listProjectHealth).toHaveBeenCalledWith(
      expect.anything(),
      ['p-1'],
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    );
    expect(insights.projectHealthRag).toEqual({ green: 0, amber: 0, red: 1 });
    expect(insights.openRaid.risks).toBe(1);
    expect(insights.budgetAttention).toEqual([]);
  });

  it('counts an amber timeline from the shared function', async () => {
    vi.mocked(listProjectHealth).mockResolvedValue(
      new Map([
        [
          'p-1',
          {
            overall: 'amber',
            timeline: 'amber',
            risk: 'green',
            financial: 'green',
          },
        ],
      ]),
    );
    const insights = await getDashboardInsights(
      database([[{ id: 'ws-1' }], [projectRow], []]),
      { userId: 'user-1', isSystemAdmin: true },
    );

    expect(insights.projectHealthRag).toEqual({ green: 0, amber: 1, red: 0 });
  });
});
