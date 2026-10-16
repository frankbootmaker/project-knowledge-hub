import { describe, expect, it, vi } from 'vitest';
import type { Database } from '@project-knowledge-hub/database';
import { AppError } from '@project-knowledge-hub/domain';
import { createEpic, updateEpic } from './project-agile.js';
import { createTask, updateTask } from './project-delivery.js';
import { createSprint } from './project-sprints.js';

describe('date range validation wiring', () => {
  describe('createEpic', () => {
    it('rejects end before start with INVALID_DATE_RANGE before any DB operation', async () => {
      const mockDatabase = {
        db: {
          insert: vi.fn(),
          select: vi.fn(),
          transaction: vi.fn(),
        },
      } as unknown as Database;

      await expect(
        createEpic(mockDatabase, {
          projectId: '00000000-0000-4000-8000-000000000001',
          title: 'Test Epic',
          startDate: '2026-11-30',
          endDate: '2026-11-01',
        }),
      ).rejects.toThrow(AppError);

      await expect(
        createEpic(mockDatabase, {
          projectId: '00000000-0000-4000-8000-000000000001',
          title: 'Test Epic',
          startDate: '2026-11-30',
          endDate: '2026-11-01',
        }),
      ).rejects.toMatchObject({
        code: 'INVALID_DATE_RANGE',
        statusCode: 400,
      });

      // Verify no DB operations were attempted (no insert, no key allocation)
      expect(mockDatabase.db.insert).not.toHaveBeenCalled();
      expect(mockDatabase.db.select).not.toHaveBeenCalled();
      expect(mockDatabase.db.transaction).not.toHaveBeenCalled();
    });
  });

  describe('createSprint', () => {
    it('rejects end before start with INVALID_DATE_RANGE before any DB operation', async () => {
      const mockDatabase = {
        db: {
          insert: vi.fn(),
          select: vi.fn(),
          transaction: vi.fn(),
        },
      } as unknown as Database;

      await expect(
        createSprint(mockDatabase, {
          projectId: '00000000-0000-4000-8000-000000000001',
          name: 'Sprint 1',
          startDate: '2026-12-14',
          endDate: '2026-12-01',
        }),
      ).rejects.toMatchObject({
        code: 'INVALID_DATE_RANGE',
        statusCode: 400,
      });

      const error = await createSprint(mockDatabase, {
        projectId: '00000000-0000-4000-8000-000000000001',
        name: 'Sprint 1',
        startDate: '2026-12-14',
        endDate: '2026-12-01',
      }).catch((e) => e);

      expect(error.message).toContain('endDate');
      expect(error.message).toContain('startDate');

      // Verify no DB operations were attempted
      expect(mockDatabase.db.insert).not.toHaveBeenCalled();
      expect(mockDatabase.db.select).not.toHaveBeenCalled();
      expect(mockDatabase.db.transaction).not.toHaveBeenCalled();
    });
  });

  describe('updateEpic', () => {
    const epicRow = {
      id: '00000000-0000-4000-8000-000000000002',
      projectId: '00000000-0000-4000-8000-000000000001',
      title: 'Test Epic',
      description: null,
      status: 'planned',
      startDate: '2026-06-01',
      endDate: '2026-12-31',
      sortOrder: 0,
      issueKeyType: 'E',
      issueNumber: 1,
      archivedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    function epicDatabase(stories: unknown[] = []) {
      let selects = 0;
      return {
        db: {
          select: vi.fn(() => ({
            from: vi.fn(() => ({
              where: vi.fn(() => {
                selects += 1;
                if (selects === 1) {
                  return {
                    limit: vi.fn(() => Promise.resolve([epicRow])),
                  };
                }
                // Task rows, then story rows, for the parent date rollup.
                return Promise.resolve(selects === 2 ? [] : stories);
              }),
            })),
          })),
          update: vi.fn(),
        },
      } as unknown as Database;
    }

    it('rejects updating only endDate to before stored startDate', async () => {
      const mockDatabase = epicDatabase();

      await expect(
        updateEpic(mockDatabase, '00000000-0000-4000-8000-000000000002', {
          endDate: '2026-05-01', // Before stored startDate
        }),
      ).rejects.toMatchObject({
        code: 'INVALID_DATE_RANGE',
        statusCode: 400,
      });

      // Verify the update was not attempted
      expect(mockDatabase.db.update).not.toHaveBeenCalled();
    });

    it('rejects a start date write when a child story already supplies it', async () => {
      const mockDatabase = epicDatabase([
        {
          id: '00000000-0000-4000-8000-000000000010',
          epicId: '00000000-0000-4000-8000-000000000002',
          status: 'planned',
          startDate: '2026-06-15',
          endDate: null,
          archivedAt: null,
        },
      ]);

      await expect(
        updateEpic(mockDatabase, '00000000-0000-4000-8000-000000000002', {
          startDate: '2026-07-01',
        }),
      ).rejects.toMatchObject({
        code: 'DATE_DERIVED',
        statusCode: 400,
      });

      expect(mockDatabase.db.update).not.toHaveBeenCalled();
    });
  });

  describe('createTask', () => {
    it('rejects a start date after the due date before insert', async () => {
      const mockDatabase = {
        db: {
          insert: vi.fn(),
          select: vi.fn(),
          transaction: vi.fn(),
        },
      } as unknown as Database;

      await expect(
        createTask(mockDatabase, {
          projectId: '00000000-0000-4000-8000-000000000001',
          workspaceId: '00000000-0000-4000-8000-000000000003',
          title: 'Late start',
          startDate: '2026-12-14',
          dueDate: '2026-12-01',
        }),
      ).rejects.toMatchObject({
        code: 'INVALID_DATE_RANGE',
        statusCode: 400,
      });

      expect(mockDatabase.db.transaction).not.toHaveBeenCalled();
    });
  });

  describe('updateTask', () => {
    it('rejects a due date before the stored start date', async () => {
      const mockDatabase = {
        db: {
          select: vi.fn(() => ({
            from: vi.fn(() => ({
              where: vi.fn(() => ({
                limit: vi.fn(() =>
                  Promise.resolve([
                    {
                      id: '00000000-0000-4000-8000-000000000002',
                      projectId: '00000000-0000-4000-8000-000000000001',
                      itemType: 'task',
                      status: 'todo',
                      startDate: '2026-06-01',
                      dueDate: '2026-12-31',
                      severity: null,
                      foundIn: null,
                      foundInNote: null,
                      stepsToReproduce: null,
                      expectedBehavior: null,
                      actualBehavior: null,
                      resolution: null,
                      regression: false,
                      affectedSystemId: null,
                      duplicateOfTaskId: null,
                    },
                  ]),
                ),
              })),
            })),
          })),
          update: vi.fn(),
        },
      } as unknown as Database;

      await expect(
        updateTask(mockDatabase, '00000000-0000-4000-8000-000000000002', {
          dueDate: '2026-05-01',
        }),
      ).rejects.toMatchObject({
        code: 'INVALID_DATE_RANGE',
        statusCode: 400,
      });

      expect(mockDatabase.db.update).not.toHaveBeenCalled();
    });
  });
});
