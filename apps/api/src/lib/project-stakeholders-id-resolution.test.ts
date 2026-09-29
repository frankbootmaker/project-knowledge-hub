import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Database } from '@project-knowledge-hub/database';
import { resolveStakeholderId } from './project-stakeholders.js';
import { toMcpStakeholder } from './mcp-stakeholder-adapter.js';
import type { PublicStakeholder } from './project-stakeholders.js';

/**
 * Real tests for PRO-T-13 stakeholder ID resolution and MCP adapter.
 */

function createMockDatabase(): Database {
  const queryResults: unknown[][] = [];
  let queryIndex = 0;

  const createChain = () => {
    const chain = {
      from: () => chain,
      where: () => chain,
      limit: async () => {
        if (queryIndex >= queryResults.length) return [];
        return queryResults[queryIndex++] as unknown[];
      },
      // For queries without limit - return the array directly when awaited
      then: (resolve: (value: unknown[]) => unknown) => {
        if (queryIndex >= queryResults.length) return Promise.resolve(resolve([]));
        return Promise.resolve(resolve(queryResults[queryIndex++] as unknown[]));
      },
    };
    return chain;
  };

  const db = {
    select: () => createChain(),
  };

  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    db: db as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _test: { queryResults, resetIndex: () => { queryIndex = 0; } } as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe('resolveStakeholderId', () => {
  it('accepts a valid roster ID without projectId', async () => {
    const database = createMockDatabase();
    const rosterId = randomUUID();
    
    // Queue: check if ID is a roster ID
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (database as any)._test.queryResults.push([{ id: rosterId }]);
    
    const result = await resolveStakeholderId(database, rosterId);
    expect(result).toBe(rosterId);
  });

  it('rejects unknown ID without projectId', async () => {
    const database = createMockDatabase();
    const randomId = randomUUID();
    
    // Queue: check if ID is a roster ID (not found)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (database as any)._test.queryResults.push([]);
    
    await expect(resolveStakeholderId(database, randomId)).rejects.toMatchObject({
      code: 'STAKEHOLDER_NOT_FOUND',
      statusCode: 404,
      message: expect.stringContaining('rosterId from list_project_stakeholders'),
    });
  });

  it('accepts valid roster ID in the project with projectId', async () => {
    const database = createMockDatabase();
    const projectId = randomUUID();
    const rosterId = randomUUID();
    
    // Queue: check if ID is a roster ID in this project
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (database as any)._test.queryResults.push([{ id: rosterId }]);
    
    const result = await resolveStakeholderId(database, rosterId, projectId);
    expect(result).toBe(rosterId);
  });

  it('rejects roster ID from another project with projectId', async () => {
    const database = createMockDatabase();
    const projectId = randomUUID();
    const rosterId = randomUUID();
    
    // Queue: check if ID is a roster ID in this project (not found)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (database as any)._test.queryResults.push([]);
    // Queue: check if ID is a userId in this project (not found)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (database as any)._test.queryResults.push([]);
    
    await expect(resolveStakeholderId(database, rosterId, projectId)).rejects.toMatchObject({
      code: 'STAKEHOLDER_NOT_FOUND',
      statusCode: 404,
    });
  });

  it('rejects random UUID with projectId', async () => {
    const database = createMockDatabase();
    const projectId = randomUUID();
    const randomId = randomUUID();
    
    // Queue: check if ID is a roster ID in this project (not found)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (database as any)._test.queryResults.push([]);
    // Queue: check if ID is a userId in this project (not found)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (database as any)._test.queryResults.push([]);
    
    await expect(resolveStakeholderId(database, randomId, projectId)).rejects.toMatchObject({
      code: 'STAKEHOLDER_NOT_FOUND',
      statusCode: 404,
    });
  });

  it('returns 400 with rosterId for single-seat user with projectId', async () => {
    const database = createMockDatabase();
    const projectId = randomUUID();
    const userId = randomUUID();
    const rosterId = randomUUID();
    
    // Queue: check if ID is a roster ID in this project (not found)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (database as any)._test.queryResults.push([]);
    // Queue: check if ID is a userId in this project (found 1 seat)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (database as any)._test.queryResults.push([{ id: rosterId, userId }]);
    
    await expect(resolveStakeholderId(database, userId, projectId)).rejects.toMatchObject({
      code: 'STAKEHOLDER_ID_IS_USER_ID',
      statusCode: 400,
      message: expect.stringContaining(rosterId),
    });
  });

  it('returns 400 listing both rosterIds for multi-seat user with projectId', async () => {
    const database = createMockDatabase();
    const projectId = randomUUID();
    const userId = randomUUID();
    const rosterId1 = randomUUID();
    const rosterId2 = randomUUID();
    
    // Queue: check if ID is a roster ID in this project (not found)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (database as any)._test.queryResults.push([]);
    // Queue: check if ID is a userId in this project (found 2 seats)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (database as any)._test.queryResults.push([
      { id: rosterId1, userId },
      { id: rosterId2, userId },
    ]);
    
    const error = await resolveStakeholderId(database, userId, projectId).catch(e => e);
    expect(error).toMatchObject({
      code: 'STAKEHOLDER_ID_IS_USER_ID',
      statusCode: 400,
    });
    expect(error.message).toContain(rosterId1);
    expect(error.message).toContain(rosterId2);
  });
});

describe('toMcpStakeholder', () => {
  it('returns id=rosterId for an open seat', () => {
    const openSeat: PublicStakeholder = {
      kind: 'open_role',
      id: 'original-id',
      rosterId: 'roster-123',
      userId: null,
      systemId: null,
      displayName: 'Open PM Role',
      fullName: null,
      email: null,
      projectRole: 'pm',
      jobTitle: 'Product Manager',
      roleDescription: null,
      competencies: [],
      staffingStatus: 'open',
      notes: null,
      reportsToUserId: null,
      hourlyRate: null,
      engagementType: null,
      assignmentStart: null,
      assignmentEnd: null,
      allocatedDailyHours: null,
      contractRef: null,
      contractedBudget: null,
      contractStart: null,
      contractEnd: null,
      avatarUrl: null,
      assistantBrand: null,
      aiCostMode: null,
      aiFlatMonthlyFee: null,
      aiTokenRatePer1k: null,
      aiBudgetAllocation: null,
      raciRoles: [],
      taskCount: 0,
      sources: ['roster'],
      sortOrder: 0,
      systemSlug: null,
      systemStatus: null,
    };

    const result = toMcpStakeholder(openSeat);
    expect(result.id).toBe('roster-123');
    expect(result.rosterId).toBe('roster-123');
    expect(result.userId).toBeNull();
  });

  it('returns id=rosterId for a filled seat', () => {
    const userId = randomUUID();
    const filledSeat: PublicStakeholder = {
      kind: 'person',
      id: userId,
      rosterId: 'roster-456',
      userId,
      systemId: null,
      displayName: 'Alice',
      fullName: 'Alice Smith',
      email: 'alice@example.com',
      projectRole: 'developer',
      jobTitle: 'Senior Developer',
      roleDescription: null,
      competencies: [],
      staffingStatus: 'assigned',
      notes: null,
      reportsToUserId: null,
      hourlyRate: null,
      engagementType: 'employee',
      assignmentStart: null,
      assignmentEnd: null,
      allocatedDailyHours: null,
      contractRef: null,
      contractedBudget: null,
      contractStart: null,
      contractEnd: null,
      avatarUrl: null,
      assistantBrand: null,
      aiCostMode: null,
      aiFlatMonthlyFee: null,
      aiTokenRatePer1k: null,
      aiBudgetAllocation: null,
      raciRoles: ['R'],
      taskCount: 3,
      sources: ['roster', 'raci'],
      sortOrder: 0,
      systemSlug: null,
      systemStatus: null,
    };

    const result = toMcpStakeholder(filledSeat);
    expect(result.id).toBe('roster-456');
    expect(result.rosterId).toBe('roster-456');
    expect(result.userId).toBe(userId);
  });

  it('leaves RACI-only person unchanged', () => {
    const userId = randomUUID();
    const raciPerson: PublicStakeholder = {
      kind: 'person',
      id: userId,
      rosterId: null,
      userId,
      systemId: null,
      displayName: 'Bob',
      fullName: 'Bob Jones',
      email: 'bob@example.com',
      projectRole: null,
      jobTitle: null,
      roleDescription: null,
      competencies: [],
      staffingStatus: 'unassigned',
      notes: null,
      reportsToUserId: null,
      hourlyRate: null,
      engagementType: null,
      assignmentStart: null,
      assignmentEnd: null,
      allocatedDailyHours: null,
      contractRef: null,
      contractedBudget: null,
      contractStart: null,
      contractEnd: null,
      avatarUrl: null,
      assistantBrand: null,
      aiCostMode: null,
      aiFlatMonthlyFee: null,
      aiTokenRatePer1k: null,
      aiBudgetAllocation: null,
      raciRoles: ['A'],
      taskCount: 1,
      sources: ['raci'],
      sortOrder: 1000,
      systemSlug: null,
      systemStatus: null,
    };

    const result = toMcpStakeholder(raciPerson);
    expect(result.id).toBe(userId);
    expect(result.rosterId).toBeNull();
    expect(result.userId).toBe(userId);
  });

  it('leaves AI assistant unchanged', () => {
    const aiAssistant: PublicStakeholder = {
      kind: 'ai_assistant',
      id: 'ai:system-789',
      rosterId: null,
      userId: null,
      systemId: 'system-789',
      displayName: 'CopilotBot',
      fullName: null,
      email: null,
      projectRole: null,
      jobTitle: null,
      roleDescription: null,
      competencies: [],
      staffingStatus: 'unassigned',
      notes: null,
      reportsToUserId: null,
      hourlyRate: null,
      engagementType: null,
      assignmentStart: null,
      assignmentEnd: null,
      allocatedDailyHours: null,
      contractRef: null,
      contractedBudget: null,
      contractStart: null,
      contractEnd: null,
      avatarUrl: null,
      assistantBrand: 'openai',
      aiCostMode: 'api',
      aiFlatMonthlyFee: null,
      aiTokenRatePer1k: '0.01',
      aiBudgetAllocation: null,
      raciRoles: [],
      taskCount: 0,
      sources: ['ai_assistant'],
      sortOrder: 500,
      systemSlug: 'copilot',
      systemStatus: 'active',
    };

    const result = toMcpStakeholder(aiAssistant);
    expect(result.id).toBe('ai:system-789');
    expect(result.rosterId).toBeNull();
    expect(result.userId).toBeNull();
  });
});
