import { getTableName } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { Database } from '@project-knowledge-hub/database';
import { replaceTaskRaci } from './project-delivery.js';

function raciHarness() {
  const statements: string[] = [];
  const select = (source: 'db' | 'tx') => {
    let table = '';
    let joined = false;
    const api = {
      from(target: object) {
        table = getTableName(target as never);
        return api;
      },
      innerJoin() {
        joined = true;
        return api;
      },
      where() {
        return api;
      },
      then(
        resolve: (value: unknown) => unknown,
        reject?: (error: unknown) => unknown,
      ) {
        let rows: unknown[] = [];
        if (table === 'memberships') {
          rows = [{ userId: 'u1' }, { userId: 'u2' }];
        } else if (source === 'tx' && table === 'project_task_raci' && !joined) {
          rows = [{ id: 'raci-1', userId: 'u1', role: 'A' }];
        }
        return Promise.resolve(rows).then(resolve, reject);
      },
    };
    return api;
  };

  const tx = {
    select: () => select('tx'),
    delete(table: object) {
      const name = getTableName(table as never);
      return {
        where() {
          statements.push(`delete:${name}`);
          return Promise.resolve();
        },
      };
    },
    update(table: object) {
      const name = getTableName(table as never);
      return {
        set(values: { role?: string }) {
          return {
            where() {
              statements.push(`update:${name}:${values.role ?? ''}`);
              return Promise.resolve();
            },
          };
        },
      };
    },
    insert(table: object) {
      const name = getTableName(table as never);
      return {
        values(rows: Array<{ role?: string }>) {
          if (name === 'project_task_raci') {
            for (const row of rows) statements.push(`insert:${name}:${row.role}`);
          } else {
            statements.push(`insert:${name}`);
          }
          return Promise.resolve();
        },
      };
    },
  };

  const db = {
    select: () => select('db'),
    transaction: async (fn: (scoped: typeof tx) => Promise<unknown>) => fn(tx),
    insert() {
      throw new Error('write outside transaction');
    },
    update() {
      throw new Error('write outside transaction');
    },
    delete() {
      throw new Error('write outside transaction');
    },
  };

  return { statements, database: { db } as unknown as Database };
}

describe('replaceTaskRaci', () => {
  it('demotes the current Accountable before inserting the new one', async () => {
    const harness = raciHarness();
    await replaceTaskRaci(harness.database, {
      taskId: 'task-1',
      workspaceId: 'workspace-1',
      actorUserId: 'actor',
      entries: [
        { userId: 'u2', role: 'A' },
        { userId: 'u1', role: 'R' },
      ],
    });

    expect(harness.statements).toEqual([
      'update:project_task_raci:R',
      'insert:project_task_raci:A',
      'insert:project_task_activities',
    ]);
  });
});
