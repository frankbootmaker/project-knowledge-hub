import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Database } from '@project-knowledge-hub/database';
import { assertAiAssistantForProject } from './ai-assistant-systems.js';
import { createTask, updateTask } from './project-delivery.js';
import { updateAiAssistantCost } from './project-stakeholders.js';

const AI_ASSISTANT_SYSTEM_TYPE = 'ai_assistant';

describe('assertAiAssistantForProject', () => {
  let mockDb: Database;

  beforeEach(() => {
    mockDb = {
      db: {
        select: vi.fn(),
      },
    } as unknown as Database;
  });

  it('accepts a valid AI assistant linked to the project', async () => {
    const projectId = 'proj-123';
    const workspaceId = 'ws-1';
    const systemId = 'sys-456';
    const mockSystem = {
      id: systemId,
      projectId,
      workspaceId,
      systemType: AI_ASSISTANT_SYSTEM_TYPE,
      archivedAt: null,
      name: 'GPT-4',
      slug: 'gpt4',
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
      workspaceId,
      systemId,
    );
    expect(result).toEqual(mockSystem);
  });

  it('rejects a non-existent system (404)', async () => {
    vi.mocked(mockDb.db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    } as unknown as ReturnType<typeof mockDb.db.select>);

    await expect(
      assertAiAssistantForProject(mockDb, 'proj-123', 'ws-1', 'sys-missing'),
    ).rejects.toMatchObject({
      code: 'SYSTEM_NOT_FOUND',
      message: 'AI assistant system not found',
      statusCode: 404,
    });
  });

  it('rejects an archived system (404)', async () => {
    const mockSystem = {
      id: 'sys-456',
      projectId: 'proj-123',
      workspaceId: 'ws-1',
      systemType: AI_ASSISTANT_SYSTEM_TYPE,
      archivedAt: new Date(),
      name: 'GPT-4',
      slug: 'gpt4',
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
      assertAiAssistantForProject(mockDb, 'proj-123', 'ws-1', 'sys-456'),
    ).rejects.toMatchObject({
      code: 'SYSTEM_NOT_FOUND',
      message: 'AI assistant system not found',
      statusCode: 404,
    });
  });

  it('rejects a system in another workspace (404)', async () => {
    const mockSystem = {
      id: 'sys-456',
      projectId: 'proj-123',
      workspaceId: 'ws-other',
      systemType: AI_ASSISTANT_SYSTEM_TYPE,
      archivedAt: null,
      name: 'GPT-4',
      slug: 'gpt4',
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
      assertAiAssistantForProject(mockDb, 'proj-123', 'ws-1', 'sys-456'),
    ).rejects.toMatchObject({
      code: 'SYSTEM_NOT_FOUND',
      message: 'AI assistant system not found',
      statusCode: 404,
    });
  });

  it('rejects a same-workspace non-AI system (400 SYSTEM_NOT_AI_ASSISTANT)', async () => {
    const mockSystem = {
      id: 'sys-456',
      projectId: 'proj-123',
      workspaceId: 'ws-1',
      systemType: 'service',
      archivedAt: null,
      name: 'Data Ingestion Platform',
      slug: 'data-ingestion',
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
      assertAiAssistantForProject(mockDb, 'proj-123', 'ws-1', 'sys-456'),
    ).rejects.toMatchObject({
      code: 'SYSTEM_NOT_AI_ASSISTANT',
      message: 'System is not an AI assistant',
      statusCode: 400,
    });
  });

  it('rejects an AI assistant of another project in same workspace (400 AI_SYSTEM_NOT_IN_PROJECT)', async () => {
    const mockSystem = {
      id: 'sys-456',
      projectId: 'proj-other',
      workspaceId: 'ws-1',
      systemType: AI_ASSISTANT_SYSTEM_TYPE,
      archivedAt: null,
      name: 'GPT-4',
      slug: 'gpt4',
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
      assertAiAssistantForProject(mockDb, 'proj-123', 'ws-1', 'sys-456'),
    ).rejects.toMatchObject({
      code: 'AI_SYSTEM_NOT_IN_PROJECT',
      message: 'AI assistant is not linked to this project',
      statusCode: 400,
    });
  });
});

describe('task aiSystemId validation', () => {
  let mockDb: Database;

  beforeEach(() => {
    mockDb = {
      db: {
        select: vi.fn(),
        insert: vi.fn(),
        update: vi.fn(),
      },
    } as unknown as Database;
  });

  it('createTask rejects non-AI system before write', async () => {
    const mockSystem = {
      id: 'sys-456',
      projectId: 'proj-123',
      workspaceId: 'ws-1',
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

    const insertMock = vi.fn();
    vi.mocked(mockDb.db.insert).mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: insertMock,
      }),
    } as unknown as ReturnType<typeof mockDb.db.insert>);

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

    expect(insertMock).not.toHaveBeenCalled();
  });

  it('updateTask rejects non-AI system before write', async () => {
    const mockTask = {
      id: 'task-1',
      projectId: 'proj-123',
      title: 'Test task',
      aiSystemId: null,
      status: 'todo',
    };
    const mockProject = {
      workspaceId: 'ws-1',
    };
    const mockSystem = {
      id: 'sys-456',
      projectId: 'proj-123',
      workspaceId: 'ws-1',
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
            limit: vi.fn().mockResolvedValue([mockProject]),
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

    const updateMock = vi.fn();
    vi.mocked(mockDb.db.update).mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: updateMock,
      }),
    } as unknown as ReturnType<typeof mockDb.db.update>);

    await expect(
      updateTask(mockDb, 'task-1', {
        aiSystemId: 'sys-456',
      }),
    ).rejects.toMatchObject({
      code: 'SYSTEM_NOT_AI_ASSISTANT',
      message: 'System is not an AI assistant',
    });

    expect(updateMock).not.toHaveBeenCalled();
  });

  it('updateTask allows clearing aiSystemId with null without validation', async () => {
    const mockTask = {
      id: 'task-1',
      projectId: 'proj-123',
      title: 'Test task',
      aiSystemId: 'sys-456',
      status: 'todo',
    };

    const systemsSelectCallCount = { count: 0 };
    const selectMock = vi.fn().mockImplementation(() => {
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([mockTask]),
          }),
        }),
        innerJoin: vi.fn().mockImplementation(() => {
          systemsSelectCallCount.count++;
          throw new Error('Should not query systems table for null aiSystemId');
        }),
      };
    });

    vi.mocked(mockDb.db.select).mockImplementation(selectMock);

    const updateMock = vi.fn().mockResolvedValue(undefined);
    vi.mocked(mockDb.db.update).mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: updateMock,
      }),
    } as unknown as ReturnType<typeof mockDb.db.update>);

    const insertMock = vi.fn().mockResolvedValue(undefined);
    vi.mocked(mockDb.db.insert).mockReturnValue({
      values: insertMock,
    } as unknown as ReturnType<typeof mockDb.db.insert>);

    try {
      await updateTask(mockDb, 'task-1', {
        aiSystemId: null,
      });
    } catch {
      // getTask at the end will fail due to incomplete mocks
    }

    expect(updateMock).toHaveBeenCalled();
    expect(systemsSelectCallCount.count).toBe(0);
  });

  it('updateTask does not re-validate stored aiSystemId when caller omits it', async () => {
    const mockTask = {
      id: 'task-1',
      projectId: 'proj-123',
      title: 'Test task',
      aiSystemId: 'sys-legacy-non-ai',
      status: 'todo',
      tokensUsed: 100,
    };

    const systemsSelectCallCount = { count: 0 };
    const selectMock = vi.fn().mockImplementation(() => {
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([mockTask]),
          }),
        }),
        innerJoin: vi.fn().mockImplementation(() => {
          systemsSelectCallCount.count++;
          throw new Error('Should not query systems table when aiSystemId not provided');
        }),
      };
    });

    vi.mocked(mockDb.db.select).mockImplementation(selectMock);

    const updateMock = vi.fn().mockResolvedValue(undefined);
    vi.mocked(mockDb.db.update).mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: updateMock,
      }),
    } as unknown as ReturnType<typeof mockDb.db.update>);

    const insertMock = vi.fn().mockResolvedValue(undefined);
    vi.mocked(mockDb.db.insert).mockReturnValue({
      values: insertMock,
    } as unknown as ReturnType<typeof mockDb.db.insert>);

    try {
      await updateTask(mockDb, 'task-1', {
        tokensUsed: 200,
      });
    } catch {
      // getTask at the end will fail due to incomplete mocks
    }

    expect(updateMock).toHaveBeenCalled();
    expect(systemsSelectCallCount.count).toBe(0);
  });
});

describe('updateAiAssistantCost validation', () => {
  let mockDb: Database;

  beforeEach(() => {
    mockDb = {
      db: {
        select: vi.fn(),
        update: vi.fn(),
      },
    } as unknown as Database;
  });

  it('rejects ordinary IT system with 400 SYSTEM_NOT_AI_ASSISTANT', async () => {
    const mockSystem = {
      id: 'sys-456',
      projectId: null,
      workspaceId: 'ws-1',
      systemType: 'service',
      archivedAt: null,
      name: 'Data Ingestion Platform',
      slug: 'data-ingestion',
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
      updateAiAssistantCost(mockDb, 'sys-456', {}),
    ).rejects.toMatchObject({
      code: 'SYSTEM_NOT_AI_ASSISTANT',
      message: 'System is not an AI assistant',
      statusCode: 400,
    });
  });

  it('rejects unlinked AI assistant with 400 SYSTEM_NOT_PROJECT_SCOPED', async () => {
    const mockSystem = {
      id: 'sys-456',
      projectId: null,
      workspaceId: 'ws-1',
      systemType: AI_ASSISTANT_SYSTEM_TYPE,
      archivedAt: null,
      name: 'GPT-4',
      slug: 'gpt4',
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
      updateAiAssistantCost(mockDb, 'sys-456', {}),
    ).rejects.toMatchObject({
      code: 'SYSTEM_NOT_PROJECT_SCOPED',
      message: 'AI assistant must be linked to a project',
      statusCode: 400,
    });
  });
});
