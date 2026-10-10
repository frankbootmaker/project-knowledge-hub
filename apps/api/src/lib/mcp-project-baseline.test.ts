import { describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { McpClientContext } from '@project-knowledge-hub/mcp';
import { createMcpToolHandlers } from './mcp-tools.js';

const projectId = '11111111-1111-4111-8111-111111111111';
const workspaceId = '22222222-2222-4222-8222-222222222222';
const clientId = '33333333-3333-4333-8333-333333333333';
const actingUserId = '44444444-4444-4444-8444-444444444444';

type ProjectRow = {
  id: string;
  workspaceId: string;
  name: string;
  slug: string;
  summary: string | null;
  description: string | null;
  status: string;
  ownerUserId: string | null;
  businessDomain: string | null;
  criticality: string | null;
  startDate: string | null;
  endDate: string | null;
  charterRecordId: string | null;
  initialPlanRecordId: string | null;
  definitionOfDone: string | null;
  currency: string;
  initialBudget: number | null;
  approvedBudget: number | null;
  keyPrefix: string | null;
  issueCounters: Record<string, number>;
  metadataJson: null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function projectRow(definitionOfDone: string | null = null): ProjectRow {
  const now = new Date('2026-09-30T00:00:00.000Z');
  return {
    id: projectId,
    workspaceId,
    name: 'Demo',
    slug: 'demo',
    summary: null,
    description: null,
    status: 'active',
    ownerUserId: null,
    businessDomain: null,
    criticality: null,
    startDate: '2026-01-01',
    endDate: '2026-12-31',
    charterRecordId: null,
    initialPlanRecordId: null,
    definitionOfDone,
    currency: 'EUR',
    initialBudget: 1000,
    approvedBudget: 2000,
    keyPrefix: 'DEM',
    issueCounters: {},
    metadataJson: null,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

function testClient(): McpClientContext {
  return {
    id: clientId,
    name: 'baseline-test',
    organizationId: '55555555-5555-4555-8555-555555555555',
    scopes: ['projects:read', 'pm:write'],
    allowedWorkspaceIds: [workspaceId],
    allowedProjectIds: [],
    actingUserId,
  };
}

function mockApp(initial: ProjectRow) {
  let stored = initial;
  const updates: Array<Record<string, unknown>> = [];
  const db = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => {
          const rows = () => [stored];
          return {
            limit: vi.fn(async () => rows()),
            then: (
              resolve: (value: ProjectRow[]) => void,
              reject?: (reason: unknown) => void,
            ) => Promise.resolve(rows()).then(resolve, reject),
          };
        }),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn((values: Record<string, unknown>) => {
        updates.push(values);
        return {
          where: vi.fn(() => ({
            returning: vi.fn(async () => {
              stored = {
                ...stored,
                ...values,
                updatedAt: values.updatedAt instanceof Date ? values.updatedAt : stored.updatedAt,
              };
              return [stored];
            }),
          })),
        };
      }),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(async () => undefined),
    })),
  };
  const app = { database: { db } } as unknown as FastifyInstance;
  return {
    app,
    updates,
    readStored: () => stored,
  };
}

describe('MCP project baseline definitionOfDone', () => {
  it('persists definitionOfDone and returns it from update and get', async () => {
    const { app, updates, readStored } = mockApp(projectRow(null));
    const handlers = createMcpToolHandlers(app, testClient());

    const updated = await handlers.updateProjectBaseline({
      projectId,
      definitionOfDone: 'Tests pass\nReviewed',
    });
    expect(updates.at(-1)?.definitionOfDone).toBe('Tests pass\nReviewed');
    expect(readStored().definitionOfDone).toBe('Tests pass\nReviewed');
    expect(updated).toEqual({
      project: expect.objectContaining({
        id: projectId,
        definitionOfDone: 'Tests pass\nReviewed',
      }),
    });

    const read = await handlers.getProject({ projectId });
    expect(read).toEqual({
      project: expect.objectContaining({
        definitionOfDone: 'Tests pass\nReviewed',
      }),
    });
  });

  it('keeps the stored definitionOfDone when the field is omitted', async () => {
    const { app, updates, readStored } = mockApp(projectRow('Keep me'));
    const handlers = createMcpToolHandlers(app, testClient());

    const updated = await handlers.updateProjectBaseline({
      projectId,
      startDate: '2026-02-01',
    });

    expect(updates.at(-1)?.definitionOfDone).toBe('Keep me');
    expect(readStored().definitionOfDone).toBe('Keep me');
    expect(updated).toEqual({
      project: expect.objectContaining({ definitionOfDone: 'Keep me' }),
    });
  });

  it('clears definitionOfDone when the caller sends null', async () => {
    const { app, updates, readStored } = mockApp(projectRow('Old checklist'));
    const handlers = createMcpToolHandlers(app, testClient());

    const updated = await handlers.updateProjectBaseline({
      projectId,
      definitionOfDone: null,
    });

    expect(updates.at(-1)?.definitionOfDone).toBeNull();
    expect(readStored().definitionOfDone).toBeNull();
    expect(updated).toEqual({
      project: expect.objectContaining({ definitionOfDone: null }),
    });

    const read = await handlers.getProject({ projectId });
    expect(read).toEqual({
      project: expect.objectContaining({ definitionOfDone: null }),
    });
  });
});
