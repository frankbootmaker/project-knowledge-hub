import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '@project-knowledge-hub/database';

vi.mock('./project-budget-signals.js', () => ({
  listProjectBudgetSignals: vi.fn(),
}));

import type { ProjectBudgetSignal } from './project-budget.js';
import { listProjectBudgetSignals } from './project-budget-signals.js';
import { listProjectHealth } from './project-overall-rag.js';

const TODAY = '2026-10-17';

type MilestoneRow = {
  projectId: string;
  status: string;
  targetDate: string | null;
};

type TaskRow = {
  projectId: string;
  status: string;
  dueDate: string | null;
};

function testDatabase(input: { milestones: MilestoneRow[]; tasks: TaskRow[] }) {
  const selects: string[] = [];
  const db = {
    select(fields: object) {
      const keys = Object.keys(fields);
      return {
        from() {
          return {
            where: async () => {
              if (keys.includes('workspaceId')) {
                selects.push('workspaces');
                const ids = new Set([
                  ...input.milestones.map((row) => row.projectId),
                  ...input.tasks.map((row) => row.projectId),
                  'p-1',
                  'p-2',
                ]);
                return [...ids].map((id) => ({ id, workspaceId: 'ws-1' }));
              }
              if (keys.includes('targetDate')) {
                selects.push('milestones');
                return input.milestones;
              }
              if (keys.includes('dueDate')) {
                selects.push('tasks');
                return input.tasks;
              }
              throw new Error(`unexpected select: ${keys.join(',')}`);
            },
          };
        },
      };
    },
  };
  return {
    database: { db } as unknown as Database,
    selects,
  };
}

const greenSignal = {
  riskRag: 'green',
  financialRag: 'green',
  riskReasons: [],
  bac: null,
  cpi: null,
  spi: null,
} as ProjectBudgetSignal;

describe('listProjectHealth', () => {
  beforeEach(() => {
    vi.mocked(listProjectBudgetSignals).mockReset();
    vi.mocked(listProjectBudgetSignals).mockImplementation(async (_database, projectIds) => {
      const signals = new Map<string, ProjectBudgetSignal>();
      for (const projectId of projectIds) signals.set(projectId, greenSignal);
      return signals;
    });
  });

  it('marks a task due in 5 days amber for every caller of this function', async () => {
    const { database, selects } = testDatabase({
      milestones: [],
      tasks: [{ projectId: 'p-1', status: 'todo', dueDate: '2026-10-22' }],
    });

    const health = await listProjectHealth(database, ['p-1', 'p-2'], TODAY);

    expect(selects).toEqual(['workspaces', 'milestones', 'tasks']);
    expect(listProjectBudgetSignals).toHaveBeenCalledTimes(1);
    expect(listProjectBudgetSignals).toHaveBeenCalledWith(
      database,
      ['p-1', 'p-2'],
      TODAY,
    );
    expect(health.get('p-1')).toEqual({
      overall: 'amber',
      timeline: 'amber',
      risk: 'green',
      financial: 'green',
      riskReasons: [],
    });
    expect(health.get('p-2')?.overall).toBe('green');
  });

  it('is red when only the budget is red', async () => {
    vi.mocked(listProjectBudgetSignals).mockResolvedValue(new Map([
      ['p-1', { ...greenSignal, financialRag: 'red', bac: 100 }],
    ]));
    const { database } = testDatabase({
      milestones: [],
      tasks: [{ projectId: 'p-1', status: 'todo', dueDate: '2026-12-01' }],
    });

    const health = await listProjectHealth(database, ['p-1'], TODAY);

    expect(health.get('p-1')).toEqual({
      overall: 'red',
      timeline: 'green',
      risk: 'green',
      financial: 'red',
      riskReasons: [],
    });
  });

  it('falls back to timeline only when the budget summary fails', async () => {
    vi.mocked(listProjectBudgetSignals).mockRejectedValue(new Error('budget down'));
    const { database } = testDatabase({
      milestones: [{ projectId: 'p-1', status: 'planned', targetDate: '2026-10-20' }],
      tasks: [{ projectId: 'p-1', status: 'done', dueDate: '2026-10-01' }],
    });

    const health = await listProjectHealth(database, ['p-1'], TODAY);

    expect(health.get('p-1')).toEqual({
      overall: 'amber',
      timeline: 'amber',
      risk: 'green',
      financial: null,
      riskReasons: [],
    });
  });

  it('returns an empty map without querying when there are no projects', async () => {
    const { database, selects } = testDatabase({ milestones: [], tasks: [] });
    const health = await listProjectHealth(database, [], TODAY);
    expect(health.size).toBe(0);
    expect(selects).toEqual([]);
    expect(listProjectBudgetSignals).not.toHaveBeenCalled();
  });
});
