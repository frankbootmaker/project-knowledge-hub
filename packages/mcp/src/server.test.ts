import { describe, test, expect, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  createKnowledgeHubMcpServer,
  toMcpErrorResult,
  type McpClientContext,
  type McpToolHandlers,
} from './server.js';
import { AppError } from '@project-knowledge-hub/domain';
import { MCP_MAX_RESPONSE_BYTES } from './limits.js';

function testClient(scopes: string[]): McpClientContext {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    name: 'test-client',
    organizationId: '00000000-0000-4000-8000-000000000002',
    scopes,
    allowedWorkspaceIds: [],
    allowedProjectIds: [],
    actingUserId: null,
  };
}

async function callPlatformStatus(
  scopes: string[],
  handlers: Partial<McpToolHandlers>,
) {
  const server = createKnowledgeHubMcpServer(
    testClient(scopes),
    handlers as McpToolHandlers,
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'scope-test', version: '0.0.0' });
  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);
  try {
    return await client.callTool({
      name: 'get_platform_status',
      arguments: {},
    });
  } finally {
    await client.close();
    await server.close();
  }
}

describe('requireScope through the MCP sanitizer', () => {
  test('missing monitoring:read returns the scope message', async () => {
    const getPlatformStatus = vi.fn();
    const result = await callPlatformStatus(['projects:read'], { getPlatformStatus });

    expect(getPlatformStatus).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
    const text = result.content[0]?.type === 'text' ? result.content[0].text : '';
    expect(text).toBe('Missing required scope: monitoring:read');
    expect(text).not.toContain('Internal error');
  });

  test('unexpected handler error stays sanitized', async () => {
    const logger = { error: vi.fn() };
    const getPlatformStatus = vi.fn(async () => {
      throw new Error('postgres://user:secret@db/knowledge');
    });
    const result = await callPlatformStatus(['monitoring:read'], {
      getPlatformStatus,
      logger,
    });

    expect(getPlatformStatus).toHaveBeenCalledOnce();
    expect(result.isError).toBe(true);
    const text = result.content[0]?.type === 'text' ? result.content[0].text : '';
    expect(text).toContain('Internal error (ref:');
    expect(text).not.toContain('postgres://');
    expect(text).not.toContain('secret');
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        correlationId: expect.any(String),
        errorMessage: 'postgres://user:secret@db/knowledge',
      }),
      'MCP tool error',
    );
  });
});

describe('toMcpErrorResult', () => {
  test('AppError message passes through verbatim', () => {
    const appError = new AppError({
      code: 'PROJECT_NOT_FOUND',
      message: 'Project not found',
      statusCode: 404,
    });

    const result = toMcpErrorResult(appError);

    expect(result.isError).toBe(true);
    expect(result.content).toHaveLength(1);
    expect(result.content[0]?.type).toBe('text');
    expect(result.content[0]?.text).toBe('Project not found');
  });

  test('DrizzleQueryError-like error is sanitized', () => {
    const postgresError = Object.assign(new Error('date/time field value out of range'), {
      code: '22007',
      table_name: 'project_tasks',
    });

    const drizzleError = Object.assign(
      new Error('Failed query: insert into "project_tasks" (title, due_date) values ($1, $2)\nparams: ["Test", "2026-02-30"]'),
      {
        cause: postgresError,
      },
    );

    const result = toMcpErrorResult(drizzleError);

    expect(result.isError).toBe(true);
    expect(result.content).toHaveLength(1);
    const text = result.content[0]?.text || '';
    
    // Should not contain SQL, params, or table names
    expect(text).not.toContain('Failed query');
    expect(text).not.toContain('insert into');
    expect(text).not.toContain('params:');
    expect(text).not.toContain('2026-02-30');
    expect(text).not.toContain('project_tasks');
    
    // Should contain clean error message
    expect(text).toBe('Invalid date or datetime value');
  });

  test('plain Error does not expose error message', () => {
    const error = new Error('boom');

    const result = toMcpErrorResult(error);

    expect(result.isError).toBe(true);
    expect(result.content).toHaveLength(1);
    const text = result.content[0]?.text || '';
    
    // Should not contain the error message
    expect(text).not.toContain('boom');
    
    // Should be a generic internal error
    expect(text).toContain('Internal error (ref:');
  });

  test('logs to provided logger', () => {
    const mockLogger = {
      error: vi.fn(),
    };

    const error = new Error('database connection failed');
    toMcpErrorResult(error, mockLogger);

    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        err: error,
        correlationId: expect.any(String),
      }),
      'MCP tool error',
    );
  });

  test('logs DrizzleQueryError with SQL details', () => {
    const mockLogger = {
      error: vi.fn(),
    };

    const postgresError = Object.assign(new Error('unique violation'), {
      code: '23505',
      constraint_name: 'users_email_unique',
      table_name: 'users',
    });

    const drizzleError = Object.assign(
      new Error('Failed query: insert into "users" (email) values ($1)\nparams: ["test@example.com"]'),
      {
        cause: postgresError,
      },
    );

    toMcpErrorResult(drizzleError, mockLogger);

    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        err: drizzleError,
        correlationId: expect.any(String),
        dbCode: '23505',
        constraint_name: 'users_email_unique',
        table_name: 'users',
      }),
      'MCP tool error',
    );
  });

  test('falls back to console.error when no logger provided', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const error = new Error('something went wrong');
    toMcpErrorResult(error);

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[MCP Error]',
      expect.objectContaining({
        err: error,
        correlationId: expect.any(String),
      }),
    );

    consoleErrorSpy.mockRestore();
  });
});

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';

function baselineProject(definitionOfDone: string | null) {
  return {
    id: PROJECT_ID,
    workspaceId: '22222222-2222-4222-8222-222222222222',
    name: 'Demo',
    slug: 'demo',
    status: 'active',
    summary: null,
    description: null,
    startDate: null,
    endDate: null,
    charterRecordId: null,
    charterRecord: null,
    initialPlanRecordId: null,
    initialPlanRecord: null,
    definitionOfDone,
    currency: 'EUR',
    initialBudget: 100,
    approvedBudget: null,
    keyPrefix: 'DEM',
  };
}

async function withMcpClient(
  scopes: string[],
  handlers: Partial<McpToolHandlers>,
  run: (client: Client) => Promise<void>,
) {
  const server = createKnowledgeHubMcpServer(
    testClient(scopes),
    handlers as McpToolHandlers,
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'dod-test', version: '0.0.0' });
  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);
  try {
    await run(client);
  } finally {
    await client.close();
    await server.close();
  }
}

function toolText(result: { content: Array<{ type: string; text?: string }> }): string {
  const block = result.content[0];
  return block?.type === 'text' ? (block.text ?? '') : '';
}

describe('definitionOfDone on project baseline tools', () => {
  test('tool descriptions and output schemas include definitionOfDone', async () => {
    await withMcpClient(['projects:read', 'pm:write'], {}, async (client) => {
      const listed = await client.listTools();
      for (const name of ['get_project', 'update_project_baseline']) {
        const tool = listed.tools.find((item) => item.name === name);
        expect(tool?.description).toContain('definitionOfDone');
        expect(JSON.stringify(tool?.outputSchema)).toContain('definitionOfDone');
      }
    });
  });

  test('get_project and update_project_baseline return definitionOfDone', async () => {
    const project = baselineProject('All tests pass');
    const getProject = vi.fn(async () => ({ project }));
    const updateProjectBaseline = vi.fn(async () => ({ project }));

    await withMcpClient(
      ['projects:read', 'pm:write'],
      { getProject, updateProjectBaseline },
      async (client) => {
        const read = await client.callTool({
          name: 'get_project',
          arguments: { projectId: PROJECT_ID },
        });
        expect(read.isError).not.toBe(true);
        expect(JSON.parse(toolText(read)).project.definitionOfDone).toBe('All tests pass');
        expect(read.structuredContent).toEqual({ project });

        const write = await client.callTool({
          name: 'update_project_baseline',
          arguments: {
            projectId: PROJECT_ID,
            definitionOfDone: 'All tests pass',
          },
        });
        expect(write.isError).not.toBe(true);
        expect(JSON.parse(toolText(write)).project.definitionOfDone).toBe('All tests pass');
        expect(write.structuredContent).toEqual({ project });
        expect(updateProjectBaseline).toHaveBeenCalledWith(
          expect.objectContaining({
            projectId: PROJECT_ID,
            definitionOfDone: 'All tests pass',
          }),
        );
      },
    );
  });

  test('a project result without definitionOfDone fails output validation', async () => {
    const { definitionOfDone: _omitted, ...project } = baselineProject('hidden');
    const getProject = vi.fn(async () => ({ project }));

    await withMcpClient(['projects:read'], { getProject }, async (client) => {
      const read = await client.callTool({
        name: 'get_project',
        arguments: { projectId: PROJECT_ID },
      });
      expect(read.isError).toBe(true);
      expect(toolText(read)).toContain('Output validation error');
    });
  });

  test('an oversized get_project skips output validation', async () => {
    const getProject = vi.fn(async () => ({
      project: { notes: 'x'.repeat(MCP_MAX_RESPONSE_BYTES) },
    }));

    await withMcpClient(['projects:read'], { getProject }, async (client) => {
      const read = await client.callTool({
        name: 'get_project',
        arguments: { projectId: PROJECT_ID },
      });
      expect(read.isError).toBe(true);
      expect(read.structuredContent).toBeUndefined();
      expect(JSON.parse(toolText(read))).toEqual({
        error: 'Response exceeds size limit',
        hint: 'Narrow filters or request a specific record id',
      });
      expect(toolText(read)).not.toContain('Output validation error');
    });
  });
});

describe('tools without an output schema', () => {
  test('list_projects stays a success and omits structuredContent', async () => {
    const projects = [{ id: PROJECT_ID, name: 'Demo' }];
    const listProjects = vi.fn(async () => ({ projects }));

    await withMcpClient(['projects:read'], { listProjects }, async (client) => {
      const result = await client.callTool({
        name: 'list_projects',
        arguments: {},
      });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toBeUndefined();
      expect(JSON.parse(toolText(result))).toEqual({ projects });
    });
  });

  test('an oversized list_projects stays a success without structuredContent', async () => {
    const listProjects = vi.fn(async () => ({
      blob: 'x'.repeat(MCP_MAX_RESPONSE_BYTES),
    }));

    await withMcpClient(['projects:read'], { listProjects }, async (client) => {
      const result = await client.callTool({
        name: 'list_projects',
        arguments: {},
      });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toBeUndefined();
      expect(JSON.parse(toolText(result))).toEqual({
        error: 'Response exceeds size limit',
        hint: 'Narrow filters or request a specific record id',
      });
    });
  });
});
