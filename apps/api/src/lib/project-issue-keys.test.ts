import { describe, test, expect, vi } from 'vitest';
import { allocateIssueNumber } from './project-issue-keys.js';
import type { Database } from '@project-knowledge-hub/database';

describe('allocateIssueNumber transactional behavior', () => {
  test('uses provided transaction context', async () => {
    const mockUpdate = vi.fn().mockResolvedValue(undefined);
    const mockTx = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      for: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([
        {
          id: 'project-123',
          workspaceId: 'workspace-123',
          name: 'Test Project',
          slug: 'test',
          keyPrefix: 'TST',
          issueCounters: { T: 5 },
        },
      ]),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: mockUpdate,
        }),
      }),
    };

    const mockDatabase = {
      db: {
        transaction: vi.fn((fn) => fn(mockTx)),
      },
    } as unknown as Database;

    const result = await allocateIssueNumber(
      mockDatabase,
      'project-123',
      'T',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockTx as any,
    );

    expect(result.issueKeyType).toBe('T');
    expect(result.issueNumber).toBe(6);
    expect(result.keyPrefix).toBe('TST');
    expect(result.humanKey).toBe('TST-T-6');
    
    // The transaction callback should not be called since we passed tx
    expect(mockDatabase.db.transaction).not.toHaveBeenCalled();
    
    // The transaction operations should use the passed tx
    expect(mockTx.select).toHaveBeenCalled();
    expect(mockTx.update).toHaveBeenCalled();
  });

  test('creates own transaction when tx not provided', async () => {
    const mockUpdate = vi.fn().mockResolvedValue(undefined);
    const mockTx = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      for: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([
        {
          id: 'project-123',
          workspaceId: 'workspace-123',
          name: 'Test Project',
          slug: 'test',
          keyPrefix: 'TST',
          issueCounters: { T: 5 },
        },
      ]),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: mockUpdate,
        }),
      }),
    };

    const mockDatabase = {
      db: {
        transaction: vi.fn((fn) => fn(mockTx)),
      },
    } as unknown as Database;

    const result = await allocateIssueNumber(mockDatabase, 'project-123', 'T');

    expect(result.issueKeyType).toBe('T');
    expect(result.issueNumber).toBe(6);
    
    // The transaction callback should be called since no tx was passed
    expect(mockDatabase.db.transaction).toHaveBeenCalled();
  });

  test('error in transaction propagates and rolls back', async () => {
    const errorToThrow = new Error('Insert failed');
    
    const mockTx = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      for: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([
        {
          id: 'project-123',
          workspaceId: 'workspace-123',
          name: 'Test Project',
          slug: 'test',
          keyPrefix: 'TST',
          issueCounters: { T: 5 },
        },
      ]),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockRejectedValue(errorToThrow),
        }),
      }),
    };

    const mockDatabase = {
      db: {
        transaction: vi.fn((fn) => fn(mockTx)),
      },
    } as unknown as Database;

    await expect(
      allocateIssueNumber(
        mockDatabase,
        'project-123',
        'T',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mockTx as any,
      ),
    ).rejects.toThrow('Insert failed');
  });
});
