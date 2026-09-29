import { getTableName } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { Database } from '@project-knowledge-hub/database';
import {
  applySystemUserPurge,
  planSystemUserPurge,
  runSystemUserPurge,
} from './system-user-purge.js';

const SYS = 'system-user';
const PROJECT = 'project-1';
const WS = 'workspace-1';

function recordingDb() {
  const ops: string[] = [];
  const chain = (op: string, table: object) => {
    const step = {
      set() {
        return step;
      },
      where() {
        ops.push(`${op}:${getTableName(table as never)}`);
        return Promise.resolve();
      },
    };
    return step;
  };
  return {
    ops,
    db: {
      update: (table: object) => chain('update', table),
      delete: (table: object) => chain('delete', table),
    },
  };
}

function queryDb(options?: {
  phaseMedia?: () => string;
  txRows?: (table: string) => unknown[];
  onTransaction?: (opts: unknown) => void;
}) {
  const events: string[] = [];
  const inserts: Array<Record<string, unknown>> = [];
  let phase: 'preview' | 'tx' = 'preview';
  let bucket = inserts;

  const select = () => {
    let rows: unknown[] = [];
    const promise = () => Promise.resolve(rows);
    const api = {
      from(table: object) {
        const name = getTableName(table as never);
        if (phase === 'tx' && options?.txRows) rows = options.txRows(name);
        else if (name === 'workspace_media' && options?.phaseMedia) {
          const mediaId = options.phaseMedia();
          rows = [
            {
              id: mediaId,
              createdBy: SYS,
              workspaceId: WS,
              knowledgeRecordId: `${mediaId}-record`,
            },
          ];
        } else if (name === 'knowledge_records' && options?.phaseMedia) {
          const mediaId = options.phaseMedia();
          rows = [
            {
              id: `${mediaId}-record`,
              createdBy: SYS,
              projectId: PROJECT,
              workspaceId: WS,
              systemId: null,
              translationGroupId: null,
              supersedesRecordId: null,
            },
          ];
        } else rows = [];
        return api;
      },
      innerJoin() {
        return api;
      },
      where() {
        return api;
      },
      orderBy() {
        return api;
      },
      limit() {
        return promise();
      },
      then(
        resolve: (value: unknown) => unknown,
        reject?: (error: unknown) => unknown,
      ) {
        return promise().then(resolve, reject);
      },
    };
    return api;
  };

  const db = {
    select,
    insert() {
      return {
        values(value: Record<string, unknown>) {
          bucket.push(value);
          return Promise.resolve();
        },
      };
    },
    update(table: object) {
      return {
        set() {
          return {
            where() {
              events.push(`update:${getTableName(table as never)}`);
              return Promise.resolve();
            },
          };
        },
      };
    },
    delete(table: object) {
      return {
        where() {
          events.push(`delete:${getTableName(table as never)}`);
          return Promise.resolve();
        },
      };
    },
    async transaction(
      fn: (tx: unknown) => Promise<unknown>,
      opts?: unknown,
    ) {
      options?.onTransaction?.(opts);
      const previous = phase;
      const previousBucket = bucket;
      const local: Array<Record<string, unknown>> = [];
      phase = 'tx';
      bucket = local;
      try {
        const result = await fn(db);
        inserts.push(...local);
        events.push('committed');
        return result;
      } catch (error) {
        events.push('rolled-back');
        throw error;
      } finally {
        phase = previous;
        bucket = previousBucket;
      }
    },
  };

  return { events, inserts, db: db as unknown as Database['db'] };
}

describe('applySystemUserPurge', () => {
  it('writes deletes for the plan and does not open its own transaction', async () => {
    const plan = planSystemUserPurge({
      systemUserId: SYS,
      projectId: PROJECT,
      workspaceId: WS,
      organizationId: 'org-1',
      tasks: [
        {
          id: 'qa-task',
          createdBy: SYS,
          projectId: PROJECT,
          milestoneId: null,
          userStoryId: null,
          sprintId: null,
          aiSystemId: null,
        },
      ],
      sprints: [],
      epics: [],
      userStories: [],
      milestones: [],
      raidItems: [],
      changeItems: [],
      activities: [],
      raci: [],
      stakeholders: [],
      knowledgeDeliveryLinks: [],
      changeDeliveryLinks: [],
      raidTaskLinks: [],
      knowledgeRecords: [],
      knowledgeRecordVersions: [],
      media: [],
      systems: [],
      tags: [],
      tagLinks: [],
      mediaImportRefs: [],
      recordImportRefs: [],
    });
    const recorder = recordingDb();
    await applySystemUserPurge(
      recorder.db as unknown as Database['db'],
      plan,
    );
    expect(recorder.ops).toContain('delete:project_tasks');
    expect(recorder.ops.some((op) => op.startsWith('update:'))).toBe(false);
  });
});

describe('runSystemUserPurge', () => {
  const input = {
    systemUserId: SYS,
    projectId: PROJECT,
    workspaceId: WS,
    organizationId: 'org-1',
    actorUserId: 'admin',
  };

  it('dry-run writes a flagged audit row and does not delete or refresh', async () => {
    const harness = queryDb();
    let refreshCalls = 0;
    const result = await runSystemUserPurge(
      {
        db: {
          ...harness.db,
          transaction: () => {
            throw new Error('dry-run opened a transaction');
          },
        },
      } as unknown as Database,
      {
        ...input,
        dryRun: true,
        refreshCostSnapshot: async () => {
          refreshCalls += 1;
        },
        deleteMedia: async () => {
          throw new Error('dry-run deleted media');
        },
      },
    );
    expect(refreshCalls).toBe(0);
    expect(result.aggregates.costSnapshotRefreshed).toBe(false);
    expect(result.committed).toBe(false);
    expect(harness.events.filter((event) => event.startsWith('delete:'))).toEqual(
      [],
    );
    expect(harness.inserts).toHaveLength(1);
    const metadata = harness.inserts[0]?.metadataJson as {
      dryRun: boolean;
      committed: boolean;
    };
    expect(metadata.dryRun).toBe(true);
    expect(metadata.committed).toBe(false);
  });

  it('commits the in-transaction plan and deletes that media only after commit', async () => {
    let phase: 'preview' | 'tx' = 'preview';
    const seen: string[] = [];
    const isolation: unknown[] = [];
    let refreshCalls = 0;
    const harness = queryDb({
      phaseMedia: () => (phase === 'tx' ? 'tx-media' : 'preview-media'),
      onTransaction: (opts) => {
        phase = 'tx';
        isolation.push(opts);
      },
    });
    const originalTx = harness.db.transaction.bind(harness.db);
    harness.db.transaction = (async (fn, opts) => {
      phase = 'tx';
      try {
        return await originalTx(fn, opts);
      } finally {
        phase = 'preview';
      }
    }) as Database['db']['transaction'];

    const result = await runSystemUserPurge(
      { db: harness.db } as unknown as Database,
      {
        ...input,
        dryRun: false,
        refreshCostSnapshot: async () => {
          refreshCalls += 1;
          harness.events.push('refresh');
        },
        deleteMedia: async (media) => {
          seen.push(media.id);
          harness.events.push(`media:${media.id}`);
          return 2;
        },
      },
    );
    expect(refreshCalls).toBe(1);
    const refreshAt = harness.events.indexOf('refresh');
    expect(refreshAt).toBeGreaterThan(harness.events.indexOf('committed'));

    expect(isolation[0]).toMatchObject({ isolationLevel: 'serializable' });
    expect(seen).toEqual(['tx-media']);
    expect(result.mediaStorageFailures).toBe(2);
    expect(result.counts.media).toBe(1);
    const committedAt = harness.events.indexOf('committed');
    const mediaAt = harness.events.indexOf('media:tx-media');
    expect(committedAt).toBeGreaterThanOrEqual(0);
    expect(mediaAt).toBeGreaterThan(committedAt);
    const audit = harness.inserts.find(
      (row) =>
        (row.metadataJson as { committed?: boolean }).committed === true,
    );
    expect(audit?.action).toBe('admin.system_user_purge');
    expect(audit?.entityId).toBe(SYS);
    expect(
      (audit?.metadataJson as { counts: { media: number } }).counts.media,
    ).toBe(1);
    expect(
      (audit?.metadataJson as { dryRun: boolean }).dryRun,
    ).toBe(false);
  });

  it('audits an in-transaction conflict after rollback', async () => {
    const harness = queryDb({
      txRows: (table) => {
        if (table === 'project_tasks') {
          return [
            {
              id: 'qa-task',
              createdBy: SYS,
              projectId: PROJECT,
              milestoneId: null,
              userStoryId: null,
              sprintId: null,
              aiSystemId: null,
            },
          ];
        }
        if (table === 'project_task_activities') {
          return [
            {
              id: 'human-comment',
              actorUserId: 'human',
              taskId: 'qa-task',
              type: 'comment',
              metadataJson: { fields: [] },
              createdAt: new Date('2026-01-01T00:00:00.000Z'),
            },
          ];
        }
        return [];
      },
    });
    const media: string[] = [];
    await expect(
      runSystemUserPurge({ db: harness.db } as unknown as Database, {
        ...input,
        dryRun: false,
        deleteMedia: async (row) => {
          media.push(row.id);
        },
      }),
    ).rejects.toMatchObject({ code: 'PURGE_CONFLICT', statusCode: 409 });
    expect(harness.events).toContain('rolled-back');
    expect(harness.events).not.toContain('committed');
    expect(media).toEqual([]);
    expect(harness.inserts).toHaveLength(1);
    const metadata = harness.inserts[0]?.metadataJson as {
      committed: boolean;
      dryRun: boolean;
      conflictCount: number;
    };
    expect(metadata.committed).toBe(false);
    expect(metadata.dryRun).toBe(false);
    expect(metadata.conflictCount).toBe(1);
  });

  it('retries once after a serialization failure', async () => {
    let calls = 0;
    const harness = queryDb({
      phaseMedia: () => 'tx-media',
    });
    const original = harness.db.transaction.bind(harness.db);
    harness.db.transaction = (async (fn, opts) => {
      calls += 1;
      if (calls === 1) {
        const error = new Error('could not serialize access');
        (error as { code?: string }).code = '40001';
        throw error;
      }
      return original(fn, opts);
    }) as Database['db']['transaction'];

    const result = await runSystemUserPurge(
      { db: harness.db } as unknown as Database,
      { ...input, dryRun: false },
    );
    expect(calls).toBe(2);
    expect(result.committed).toBe(true);
    expect(result.counts.media).toBe(1);
  });

  it('gives up when a second serialization failure happens', async () => {
    let calls = 0;
    let refreshCalls = 0;
    const harness = queryDb();
    harness.db.transaction = (async () => {
      calls += 1;
      const error = new Error('could not serialize access');
      (error as { code?: string }).code = '40001';
      throw error;
    }) as Database['db']['transaction'];

    await expect(
      runSystemUserPurge({ db: harness.db } as unknown as Database, {
        ...input,
        dryRun: false,
        refreshCostSnapshot: async () => {
          refreshCalls += 1;
        },
      }),
    ).rejects.toMatchObject({ code: '40001' });
    expect(calls).toBe(2);
    expect(refreshCalls).toBe(0);
    expect(harness.inserts).toEqual([]);
  });
});
