import { describe, expect, it } from 'vitest';
import type { Database } from '@project-knowledge-hub/database';
import {
  listProjectBudgetSignals,
} from './project-budget-signals.js';
import { projectBudgetSignalFromParts } from './project-budget.js';

function countingDatabase(projectCount: number) {
  let selects = 0;
  const projectRows = Array.from({ length: projectCount }, (_, index) => ({
    id: `p${index}`,
    workspaceId: 'ws-1',
    currency: 'EUR',
    initialBudget: null,
    approvedBudget: null,
    startDate: null,
    endDate: null,
  }));

  function chain(rows: unknown[]) {
    const builder: Record<string, unknown> = {};
    const self = () => builder;
    builder.from = self;
    builder.innerJoin = self;
    builder.leftJoin = self;
    builder.where = self;
    builder.orderBy = self;
    builder.groupBy = self;
    builder.limit = () => chain(rows);
    builder.then = (
      resolve: (value: unknown) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => Promise.resolve(rows).then(resolve, reject);
    return builder;
  }

  return {
    selectCount: () => selects,
    database: {
      db: {
        select(fields?: object) {
          selects += 1;
          const keys = fields ? Object.keys(fields) : [];
          const rows = keys.includes('approvedBudget') ? projectRows : [];
          return chain(rows);
        },
        execute() {
          selects += 1;
          return Promise.resolve([]);
        },
      },
    } as unknown as Database,
  };
}

describe('project budget signals', () => {
  it('keeps the same query count when more projects are requested', async () => {
    const one = countingDatabase(1);
    const many = countingDatabase(5);
    const today = '2026-10-23';

    const oneSignals = await listProjectBudgetSignals(one.database, ['p0'], today);
    const manySignals = await listProjectBudgetSignals(
      many.database,
      ['p0', 'p1', 'p2', 'p3', 'p4'],
      today,
    );

    expect(one.selectCount()).toBeGreaterThan(0);
    expect(many.selectCount()).toBe(one.selectCount());
    expect(oneSignals.get('p0')?.financialRag).toBe('green');
    expect(oneSignals.get('p0')?.riskRag).toBe('green');
    expect(oneSignals.get('p0')?.bac).toBeNull();
    expect(manySignals.get('p4')?.financialRag).toBe('green');
    expect(manySignals.size).toBe(5);
  });

  it('matches the budget summary financial and risk RAG', () => {
    const signal = projectBudgetSignalFromParts({
      project: {
        currency: 'EUR',
        initialBudget: 100,
        approvedBudget: 100,
        startDate: '2026-01-01',
        endDate: '2026-12-31',
      },
      costs: [
        {
          taskId: 't1',
          epicId: null,
          userStoryId: null,
          status: 'done',
          forecastHours: 1,
          actualHours: 2,
          rateUserId: 'u1',
          hourlyRate: 100,
          forecastCost: 100,
          actualCost: 200,
        },
      ],
      aiBillableCost: 0,
      systemBillableCost: 0,
      raidRows: [],
      today: '2026-10-23',
    });

    expect(signal.bac).toBe(100);
    expect(signal.ac).toBe(200);
    expect(signal.financialRag).toBe('red');
    expect(signal.riskRag).toBe('green');
    expect(signal.riskReasons).toEqual([]);
    expect(signal.cpi).toBe(0.5);
  });
});
