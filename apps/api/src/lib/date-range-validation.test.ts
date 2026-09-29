import { describe, expect, it, vi } from 'vitest';
import type { Database } from '@project-knowledge-hub/database';
import { AppError } from '@project-knowledge-hub/domain';
import { createEpic, updateEpic } from './project-agile.js';
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
    it('rejects updating only endDate to before stored startDate', async () => {
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
  });
});
