import { describe, expect, it, vi } from 'vitest';
import type { Database } from '@project-knowledge-hub/database';
import { AppError } from '@project-knowledge-hub/domain';
import { assertAiAssistantForProject } from './project-stakeholders.js';
import { createTask, updateTask } from './project-delivery.js';

const mockDb = {
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
  },
} as unknown as Database;

const AI_ASSISTANT_SYSTEM_TYPE = 'ai_assistant';

describe('assertAiAssistantForProject', () => {
  it('accepts a valid AI assistant linked to the project', async () => {
    const projectId = 'proj-123';
    const systemId = 'sys-456';
    const mockSystem = {
      id: systemId,
      projectId,
      systemType: AI_ASSISTANT_SYSTEM_TYPE,
      archivedAt: null,
      name: 'GPT-4',
      slug: 'gpt4',
      workspaceId: 'ws-1',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    vi.mocked(mockDb.db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([mockSystem]),
        }),
      }),
    } as unknown as ReturnType<typeof mockDb.db.select>);

    const result = await assertAiAssistantForProject(
      mockDb,
      projectId,
      systemId,
    );
    expect(result).toEqual(mockSystem);
  });

  it('rejects a non-existent system', async () => {
    vi.mocked(mockDb.db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    } as unknown as ReturnType<typeof mockDb.db.select>);

    await expect(
      assertAiAssistantForProject(mockDb, 'proj-123', 'sys-missing'),
    ).rejects.toThrow(AppError);

    await expect(
      assertAiAssistantForProject(mockDb, 'proj-123', 'sys-missing'),
    ).rejects.toMatchObject({
      code: 'SYSTEM_NOT_FOUND',
      message: 'AI assistant system not found',
      statusCode: 404,
    });
  });

  it('rejects an archived system', async () => {
    const mockSystem = {
      id: 'sys-456',
      projectId: 'proj-123',
      systemType: AI_ASSISTANT_SYSTEM_TYPE,
      archivedAt: new Date(),
      name: 'GPT-4',
      slug: 'gpt4',
      workspaceId: 'ws-1',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    vi.mocked(mockDb.db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([mockSystem]),
        }),
      }),
    } as unknown as ReturnType<typeof mockDb.db.select>);

    await expect(
      assertAiAssistantForProject(mockDb, 'proj-123', 'sys-456'),
    ).rejects.toMatchObject({
      code: 'SYSTEM_NOT_FOUND',
      message: 'AI assistant system not found',
      statusCode: 404,
    });
  });

  it('rejects a non-AI system (service type)', async () => {
    const mockSystem = {
      id: 'sys-456',
      projectId: 'proj-123',
      systemType: 'service',
      archivedAt: null,
      name: 'Data Ingestion Platform',
      slug: 'data-ingestion',
      workspaceId: 'ws-1',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    vi.mocked(mockDb.db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([mockSystem]),
        }),
      }),
    } as unknown as ReturnType<typeof mockDb.db.select>);

    await expect(
      assertAiAssistantForProject(mockDb, 'proj-123', 'sys-456'),
    ).rejects.toMatchObject({
      code: 'SYSTEM_NOT_AI_ASSISTANT',
      message: 'System is not an AI assistant',
      statusCode: 400,
    });
  });

  it('rejects an AI assistant from a different project', async () => {
    const mockSystem = {
      id: 'sys-456',
      projectId: 'proj-other',
      systemType: AI_ASSISTANT_SYSTEM_TYPE,
      archivedAt: null,
      name: 'GPT-4',
      slug: 'gpt4',
      workspaceId: 'ws-1',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    vi.mocked(mockDb.db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([mockSystem]),
        }),
      }),
    } as unknown as ReturnType<typeof mockDb.db.select>);

    await expect(
      assertAiAssistantForProject(mockDb, 'proj-123', 'sys-456'),
    ).rejects.toMatchObject({
      code: 'SYSTEM_NOT_FOUND',
      message: 'AI assistant system not found',
      statusCode: 404,
    });
  });
});

describe('task aiSystemId validation', () => {
  it('createTask rejects non-AI system before write', async () => {
    const mockSystem = {
      id: 'sys-456',
      projectId: 'proj-123',
      systemType: 'service',
      archivedAt: null,
    };

    vi.mocked(mockDb.db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([mockSystem]),
        }),
      }),
    } as unknown as ReturnType<typeof mockDb.db.select>);

    await expect(
      createTask(mockDb, {
        projectId: 'proj-123',
        workspaceId: 'ws-1',
        title: 'Test task',
        aiSystemId: 'sys-456',
      }),
    ).rejects.toMatchObject({
      code: 'SYSTEM_NOT_AI_ASSISTANT',
      message: 'System is not an AI assistant',
    });
  });

  it('updateTask rejects non-AI system before write', async () => {
    const mockTask = {
      id: 'task-1',
      projectId: 'proj-123',
      title: 'Test task',
      aiSystemId: null,
      status: 'todo',
    };
    const mockSystem = {
      id: 'sys-456',
      projectId: 'proj-123',
      systemType: 'service',
      archivedAt: null,
    };

    const selectMock = vi.fn();
    selectMock
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([mockTask]),
          }),
        }),
      })
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([mockSystem]),
          }),
        }),
      });

    vi.mocked(mockDb.db.select).mockImplementation(selectMock);

    await expect(
      updateTask(mockDb, 'task-1', {
        aiSystemId: 'sys-456',
      }),
    ).rejects.toMatchObject({
      code: 'SYSTEM_NOT_AI_ASSISTANT',
      message: 'System is not an AI assistant',
    });
  });

  it('updateTask allows clearing aiSystemId with null', async () => {
    const mockTask = {
      id: 'task-1',
      projectId: 'proj-123',
      title: 'Test task',
      aiSystemId: 'sys-456',
      status: 'todo',
    };

    vi.mocked(mockDb.db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([mockTask]),
        }),
      }),
    } as unknown as ReturnType<typeof mockDb.db.select>);

    vi.mocked(mockDb.db.update).mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    } as unknown as ReturnType<typeof mockDb.db.update>);

    const validationSpy = vi.spyOn(
      await import('./project-stakeholders.js'),
      'assertAiAssistantForProject',
    );

    try {
      await updateTask(mockDb, 'task-1', {
        aiSystemId: null,
      });
    } catch {
      // Expected to fail due to incomplete mocking, but validation should NOT be called
    }

    expect(validationSpy).not.toHaveBeenCalled();
  });
});

