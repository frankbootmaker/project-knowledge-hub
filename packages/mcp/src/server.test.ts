import { describe, test, expect, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv';
import { invokeNamedHubTool } from './llm-tool-catalog.js';
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
    hoursPerWorkday: 8,
    workdaysPerWeek: 5,
    nonWorkingDays: [],
    finishDate: null,
    durationWorkingDays: null,
    charterRecordId: null,
    charterRecord: null,
    initialPlanRecordId: null,
    initialPlanRecord: null,
    definitionOfDone,
    currency: 'EUR',
    initialBudget: 100,
    approvedBudget: null,
    keyPrefix: 'DEM',
    methodology: null,
    createdVia: null,
    createdByApiClientId: null,
    createdByOauthGrantId: null,
    createdByUserId: null,
    generatedByModel: null,
    scheduleSlipRiskEnabled: false,
    scheduleSlipThresholdDays: 2,
    scheduleSlipItemTypes: ['task', 'user_story', 'epic', 'milestone'],
    url: null,
    health: {
      overall: 'green',
      timeline: 'green',
      risk: 'green',
      financial: 'green',
      riskReasons: [],
    },
  };
}

const CHARTER_ID = '33333333-3333-4333-8333-333333333333';

/** Budget, baseline dates, calendar, pinned charter, and Definition of Done. */
function realisticProject() {
  return {
    id: PROJECT_ID,
    workspaceId: '22222222-2222-4222-8222-222222222222',
    workspaceName: 'Lab',
    workspaceSlug: 'lab',
    name: 'Demo',
    slug: 'demo',
    status: 'active',
    summary: 'Kickoff baseline',
    description: 'Working calendar and budgets',
    startDate: '2026-01-06',
    endDate: '2026-12-18',
    hoursPerWorkday: 7.5,
    workdaysPerWeek: 5,
    nonWorkingDays: ['2026-01-01', '2026-12-25'],
    finishDate: '2026-11-30',
    durationWorkingDays: 220,
    charterRecordId: CHARTER_ID,
    charterRecord: {
      id: CHARTER_ID,
      title: 'Charter',
      slug: 'charter',
      recordType: 'project-charter',
    },
    initialPlanRecordId: null,
    initialPlanRecord: null,
    definitionOfDone: '- Tests pass\n- Reviewed',
    currency: 'EUR',
    initialBudget: 48000,
    approvedBudget: 50000.5,
    keyPrefix: 'DEM',
    methodology: 'scrum',
    createdVia: 'mcp',
    createdByApiClientId: '66666666-6666-4666-8666-666666666666',
    createdByOauthGrantId: null,
    createdByUserId: '55555555-5555-4555-8555-555555555555',
    generatedByModel: 'gpt-4.1',
    scheduleSlipRiskEnabled: false,
    scheduleSlipThresholdDays: 2,
    scheduleSlipItemTypes: ['task', 'user_story', 'epic', 'milestone'],
    url: 'https://knowledge.example.com/workspaces/lab/projects/demo',
    health: {
      overall: 'amber',
      timeline: 'amber',
      risk: 'green',
      financial: 'green',
      riskReasons: [],
    },
  };
}

async function withMcpClient(
  scopes: string[],
  handlers: Partial<McpToolHandlers>,
  run: (client: Client) => Promise<void>,
  options?: Parameters<typeof createKnowledgeHubMcpServer>[2],
) {
  const server = createKnowledgeHubMcpServer(
    testClient(scopes),
    handlers as McpToolHandlers,
    options,
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
        expect(JSON.stringify(tool?.outputSchema)).toContain('health');
        expect(JSON.stringify(tool?.outputSchema)).toContain('createdVia');
        expect(JSON.stringify(tool?.outputSchema)).toContain('generatedByModel');
        expect(JSON.stringify(tool?.outputSchema)).toContain('finishDate');
        expect(JSON.stringify(tool?.outputSchema)).toContain('durationWorkingDays');
        expect(JSON.stringify(tool?.inputSchema)).toContain('projectId');
      }
      const getProjectTool = listed.tools.find((item) => item.name === 'get_project');
      expect(getProjectTool?.description).toContain('health.overall');
      expect(getProjectTool?.description).toMatch(/lifecycle stage/);
      const listProjects = listed.tools.find((item) => item.name === 'list_projects');
      expect(listProjects?.description).toContain('health.overall');
      expect(listProjects?.description).toMatch(/lifecycle stage/);
      const update = listed.tools.find((item) => item.name === 'update_project_baseline');
      const input = JSON.stringify(update?.inputSchema);
      expect(input).toContain('hoursPerWorkday');
      expect(input).toContain('workdaysPerWeek');
      expect(input).toContain('nonWorkingDays');
      expect(update?.inputSchema).toMatchObject({ required: ['projectId'] });
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
        hint:
          'Pass a smaller limit, follow nextCursor, or page get_knowledge_record with contentOffset. suggestedLimit is a smaller list page size.',
        suggestedLimit: 10,
      });
      expect(toolText(read)).not.toContain('Output validation error');
    });
  });

  test('a realistic project matches the declared output schema', async () => {
    const project = realisticProject();
    const getProject = vi.fn(async () => ({
      project: {
        ...project,
        ownerUserId: '44444444-4444-4444-8444-444444444444',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
        tags: ['lab'],
        charterRecord: { ...project.charterRecord, contentMarkdown: '# extra' },
      },
    }));

    await withMcpClient(['projects:read'], { getProject }, async (client) => {
      const listed = await client.listTools();
      const tool = listed.tools.find((item) => item.name === 'get_project');
      const output = tool?.outputSchema as {
        properties?: { project?: object };
      };
      expect(JSON.stringify(output)).not.toContain('"$ref"');
      const projectSchema = output.properties?.project;
      expect(projectSchema).toBeTruthy();

      const validator = new AjvJsonSchemaValidator();
      const isolated = validator.getValidator(projectSchema as object);
      const read = await client.callTool({
        name: 'get_project',
        arguments: { projectId: PROJECT_ID },
      });
      expect(read.isError).not.toBe(true);
      const body = JSON.parse(toolText(read)) as {
        project: {
          definitionOfDone: unknown;
          initialBudget: unknown;
          approvedBudget: unknown;
          ownerUserId?: unknown;
          charterRecord: { contentMarkdown?: unknown };
        };
      };
      expect(body.project.definitionOfDone).toBe('- Tests pass\n- Reviewed');
      expect(body.project.initialBudget).toBe(48000);
      expect(body.project.approvedBudget).toBe(50000.5);
      expect(typeof body.project.definitionOfDone).toBe('string');
      expect(typeof body.project.initialBudget).toBe('number');
      expect(typeof body.project.approvedBudget).toBe('number');
      expect(body.project.ownerUserId).toBeUndefined();
      expect(body.project.charterRecord.contentMarkdown).toBeUndefined();
      expect(isolated(body.project).valid).toBe(true);
      expect(validator.getValidator(tool!.outputSchema as object)(body).valid).toBe(true);
      expect(read.structuredContent).toEqual(body);
    });
  });
});

const parentScheduleSample = {
  id: 'item-1',
  startDate: '2026-10-01',
  endDate: '2026-10-11',
  startDateDerived: false,
  endDateDerived: true,
  targetPercent: 50,
};

const pageSample = {
  total: 1,
  limit: 25,
  nextCursor: null,
  hasMore: false,
};

const taskSample = {
  id: 'task-1',
  title: 'Write the brief',
  startDate: '2026-10-01',
  completionPercent: 25,
  targetPercent: null,
  forecastHours: 3,
  mediaLinkCount: 0,
};

const milestoneSample = {
  id: 'milestone-1',
  title: 'Gate',
  startDate: '2026-10-01',
  targetDate: '2026-10-11',
  targetPercent: null,
};

const dependencySample = {
  id: 'link-1',
  linkType: 'FS',
  lagDays: 2,
  predecessor: { id: 'task-1', humanKey: 'PRO-T-1' },
  successor: { id: 'task-2', humanKey: 'PRO-T-2' },
};

const OUTPUT_SAMPLES: Record<string, unknown> = {
  get_project: { project: realisticProject() },
  update_project_baseline: { project: realisticProject() },
  create_project: {
    project: {
      id: PROJECT_ID,
      name: 'Demo',
      slug: 'demo',
      workspaceId: '22222222-2222-4222-8222-222222222222',
      status: 'idea',
      keyPrefix: 'DEM',
      url: 'https://knowledge.example.com/workspaces/lab/projects/demo',
      methodology: 'kanban',
      currency: 'EUR',
      description: 'Proposal',
      createdVia: 'mcp',
      createdByApiClientId: '66666666-6666-4666-8666-666666666666',
      createdByOauthGrantId: null,
      createdByUserId: '55555555-5555-4555-8555-555555555555',
      generatedByModel: 'gpt-4.1',
      warning: null,
    },
  },
  update_project: {
    project: realisticProject(),
    warning: null,
  },
  list_project_tasks: {
    tasks: [taskSample],
    ...pageSample,
  },
  get_project_task: { task: taskSample },
  create_project_task: { task: taskSample },
  update_project_task: { task: taskSample },
  list_project_milestones: {
    milestones: [milestoneSample],
    ...pageSample,
  },
  create_project_milestone: { milestone: milestoneSample },
  update_project_milestone: { milestone: milestoneSample },
  get_project_milestone: { milestone: milestoneSample },
  list_project_epics: {
    epics: [parentScheduleSample],
    ...pageSample,
  },
  create_project_epic: { epic: parentScheduleSample },
  update_project_epic: { epic: parentScheduleSample },
  list_project_user_stories: {
    userStories: [parentScheduleSample],
    ...pageSample,
  },
  create_project_user_story: { userStory: parentScheduleSample },
  update_project_user_story: { userStory: parentScheduleSample },
  list_delivery_dependencies: {
    predecessors: [dependencySample],
    successors: [],
    scheduleDriven: false,
  },
  set_delivery_dependency: {
    dependency: dependencySample,
    schedule: [{ id: 'task-2', startDate: '2026-10-13', finishDate: '2026-10-14' }],
  },
  get_profile: {
    id: '55555555-5555-4555-8555-555555555555',
    name: 'Ada',
    email: 'ada@example.com',
  },
  get_knowledge_record: {
    knowledgeRecord: {
      id: '66666666-6666-4666-8666-666666666666',
      title: 'Charter',
      contentMarkdown: '# Charter',
      linkedItems: {
        deliveryLinks: [
          {
            id: '77777777-7777-4777-8777-777777777777',
            humanKey: 'HL1-T-1',
            title: 'Write the brief',
            type: 'task',
            kind: 'task',
            projectId: '11111111-1111-4111-8111-111111111111',
            projectSlug: 'renewal',
          },
        ],
        raidLinks: [],
        changeItems: [],
      },
      recordRelations: {
        outboundCount: 1,
        inboundCount: 0,
        cap: 20,
        truncated: false,
        items: [
          {
            direction: 'outbound',
            relationType: 'depends_on',
            record: {
              id: '22222222-2222-4222-8222-222222222222',
              humanKey: 'REL-ARCH-1',
              title: 'Upstream',
              recordType: 'architecture',
              lifecycleStatus: 'current',
              archivedAt: null,
            },
          },
        ],
      },
    },
  },
  get_knowledge_record_relations: {
    relations: {
      outbound: [
        {
          relationType: 'depends_on',
          record: {
            id: '22222222-2222-4222-8222-222222222222',
            humanKey: 'REL-ARCH-1',
            title: 'Upstream',
            slug: 'upstream',
            recordType: 'architecture',
            lifecycleStatus: 'current',
            archivedAt: null,
          },
        },
      ],
      inbound: [],
    },
    lifecycleSuccessor: null,
    lifecyclePredecessor: null,
  },
  set_knowledge_record_relations: {
    relations: { outbound: [], inbound: [] },
    lifecycleSuccessor: null,
    lifecyclePredecessor: null,
  },
};

describe('create_project and update_project schemas', () => {
  test('descriptions keep idea-stage creates and projects:write', async () => {
    await withMcpClient(['projects:read', 'projects:write'], {}, async (client) => {
      const listed = await client.listTools();
      const create = listed.tools.find((tool) => tool.name === 'create_project');
      const update = listed.tools.find((tool) => tool.name === 'update_project');
      const guide = listed.tools.find((tool) => tool.name === 'list_project_metadata');
      expect(create?.description).toContain('idea');
      expect(create?.description).toContain('projects:write');
      expect(update?.description).toContain('idea');
      expect(guide?.description).toContain('idea');
      const validator = new AjvJsonSchemaValidator();
      expect(
        validator.getValidator(create!.outputSchema as object)(OUTPUT_SAMPLES.create_project).valid,
      ).toBe(true);
      const promoted = {
        project: {
          ...(OUTPUT_SAMPLES.create_project as { project: object }).project,
          status: 'active',
        },
      };
      expect(validator.getValidator(create!.outputSchema as object)(promoted).valid).toBe(false);
    });
  });
});

describe('MCP output schemas accept their sample results', () => {
  test('every tool with an outputSchema validates its sample', async () => {
    const validator = new AjvJsonSchemaValidator();
    const assertSamples = async (client: Client) => {
      const listed = await client.listTools();
      const declared = listed.tools.filter((tool) => tool.outputSchema);
      expect(declared.length).toBeGreaterThan(0);
      for (const tool of declared) {
        const sample = OUTPUT_SAMPLES[tool.name];
        expect(sample, `${tool.name} sample`).toBeTruthy();
        const result = validator.getValidator(tool.outputSchema as object)(sample);
        expect(result.valid, `${tool.name}: ${result.errorMessage ?? ''}`).toBe(true);
      }
    };

    await withMcpClient(['projects:read', 'pm:read', 'pm:write'], {}, assertSamples);
    await withMcpClient(
      ['projects:read'],
      {},
      assertSamples,
      {
        oauth: {
          resourceMetadataUrl:
            'https://knowledge.example.com/.well-known/oauth-protected-resource/mcp/oauth',
          profile: { id: 'user-1', name: 'Ada', email: 'ada@example.com' },
        },
      },
    );
  });
});

describe('due-date risk RAG on MCP project tools (PRO-T-98)', () => {
  test('get_project structured output accepts riskReasons and rejects extras', async () => {
    const validator = new AjvJsonSchemaValidator();
    await withMcpClient(['projects:read', 'pm:read'], {}, async (client) => {
      const listed = await client.listTools();
      const tool = listed.tools.find((item) => item.name === 'get_project');
      const schema = tool?.outputSchema as {
        properties?: {
          project?: {
            properties?: {
              health?: {
                additionalProperties?: boolean;
                required?: string[];
                properties?: {
                  riskReasons?: {
                    type?: string;
                    items?: { additionalProperties?: boolean; required?: string[] };
                  };
                };
              };
            };
          };
        };
      };
      const health = schema.properties?.project?.properties?.health;
      expect(health?.additionalProperties).toBe(false);
      expect(health?.required).toEqual(
        expect.arrayContaining(['overall', 'timeline', 'risk', 'financial', 'riskReasons']),
      );
      expect(health?.properties?.riskReasons?.type).toBe('array');
      expect(health?.properties?.riskReasons?.items?.additionalProperties).toBe(false);
      expect(health?.properties?.riskReasons?.items?.required).toEqual(
        expect.arrayContaining(['count', 'severity', 'kind', 'cause']),
      );

      const withReasons = {
        project: {
          ...realisticProject(),
          health: {
            overall: 'red',
            timeline: 'green',
            risk: 'red',
            financial: 'green',
            riskReasons: [
              {
                count: 1,
                severity: 'critical',
                kind: 'risk',
                cause: 'due_soon',
                dueInDays: 2,
              },
            ],
          },
        },
      };
      expect(validator.getValidator(tool!.outputSchema as object)(withReasons).valid).toBe(true);

      const extra = {
        project: {
          ...realisticProject(),
          health: {
            ...realisticProject().health,
            unexplained: true,
          },
        },
      };
      expect(validator.getValidator(tool!.outputSchema as object)(extra).valid).toBe(false);

      const budget = listed.tools.find((item) => item.name === 'get_project_budget_summary');
      expect(budget?.description).toMatch(/riskRag/);
      expect(budget?.description).toMatch(/7-day/);
      expect(budget?.description).toMatch(/kind issue/);
      expect(budget?.description).toMatch(/overdue/);
      expect(budget?.description).toMatch(/riskReasons/);
    });
  });
});

describe('delivery schedule fields (PRO-T-94)', () => {
  test('target percent stays in 0-100 and lag must be an integer', async () => {
    const validator = new AjvJsonSchemaValidator();
    await withMcpClient(['pm:read', 'pm:write'], {}, async (client) => {
      const listed = await client.listTools();
      const epic = listed.tools.find((tool) => tool.name === 'list_project_epics');
      const set = listed.tools.find((tool) => tool.name === 'set_delivery_dependency');
      const epicSchema = epic?.outputSchema as {
        properties?: { epics?: { items?: object } };
      };
      const itemSchema = epicSchema.properties?.epics?.items;
      expect(itemSchema).toBeTruthy();
      const check = validator.getValidator(itemSchema as object);
      expect(check({ ...parentScheduleSample, targetPercent: 0 }).valid).toBe(true);
      expect(check({ ...parentScheduleSample, targetPercent: 100 }).valid).toBe(true);
      expect(check({ ...parentScheduleSample, targetPercent: null }).valid).toBe(true);
      expect(check({ ...parentScheduleSample, targetPercent: 101 }).valid).toBe(false);
      expect(check({ ...parentScheduleSample, targetPercent: -1 }).valid).toBe(false);
      expect(check({ ...parentScheduleSample, targetPercent: 1.5 }).valid).toBe(false);

      const lag = (set?.inputSchema as {
        properties?: { lagDays?: object; links?: { items?: { properties?: { lagDays?: object } } } };
      }).properties?.lagDays;
      const lagCheck = validator.getValidator(lag as object);
      expect(lagCheck(2).valid).toBe(true);
      expect(lagCheck(-3).valid).toBe(true);
      expect(lagCheck(1.5).valid).toBe(false);
      const linkLag = (set?.inputSchema as {
        properties?: { links?: { items?: { properties?: { lagDays?: object } } } };
      }).properties?.links?.items?.properties?.lagDays;
      expect(validator.getValidator(linkLag as object)(1.5).valid).toBe(false);
    });
  });

  test('a non-integer lag is rejected before the handler', async () => {
    const setDeliveryDependency = vi.fn();
    await withMcpClient(['pm:write'], { setDeliveryDependency }, async (client) => {
      const result = await client.callTool({
        name: 'set_delivery_dependency',
        arguments: {
          projectId: PROJECT_ID,
          predecessorId: 'PRO-T-1',
          successorId: 'PRO-T-2',
          linkType: 'FS',
          lagDays: 1.5,
        },
      });
      expect(result.isError).toBe(true);
      expect(setDeliveryDependency).not.toHaveBeenCalled();
    });
  });

  test('startDate and lagDays round-trip and match the output schema', async () => {
    const validator = new AjvJsonSchemaValidator();
    const epic = {
      ...parentScheduleSample,
      id: 'epic-1',
      startDate: '2026-10-08',
      startDateDerived: false,
      endDateDerived: false,
      targetPercent: 0,
    };
    const createProjectEpic = vi.fn(async (args: { startDate?: string | null }) => ({
      epic: { ...epic, startDate: args.startDate ?? null },
    }));
    const setDeliveryDependency = vi.fn(async (args: { lagDays?: number }) => ({
      dependency: { ...dependencySample, lagDays: args.lagDays ?? 0 },
      schedule: [{ id: 'task-2', startDate: '2026-10-13', finishDate: null }],
    }));
    await withMcpClient(
      ['pm:write'],
      { createProjectEpic, setDeliveryDependency },
      async (client) => {
        const listed = await client.listTools();
        const created = await client.callTool({
          name: 'create_project_epic',
          arguments: {
            projectId: PROJECT_ID,
            title: 'Rollout',
            startDate: '2026-10-08',
          },
        });
        expect(created.isError).not.toBe(true);
        const createdBody = JSON.parse(toolText(created)) as {
          epic: { startDate: string };
        };
        expect(createdBody.epic.startDate).toBe('2026-10-08');
        const createSchema = listed.tools.find(
          (tool) => tool.name === 'create_project_epic',
        )?.outputSchema;
        expect(
          validator.getValidator(createSchema as object)(createdBody).valid,
        ).toBe(true);
        expect(created.structuredContent).toEqual(createdBody);

        const linked = await client.callTool({
          name: 'set_delivery_dependency',
          arguments: {
            projectId: PROJECT_ID,
            predecessorId: 'PRO-T-1',
            successorId: 'PRO-T-2',
            linkType: 'FS',
            lagDays: 4,
          },
        });
        expect(linked.isError).not.toBe(true);
        const linkedBody = JSON.parse(toolText(linked)) as {
          dependency: { lagDays: number };
        };
        expect(linkedBody.dependency.lagDays).toBe(4);
        const setSchema = listed.tools.find(
          (tool) => tool.name === 'set_delivery_dependency',
        )?.outputSchema;
        expect(validator.getValidator(setSchema as object)(linkedBody).valid).toBe(true);
        expect(setDeliveryDependency).toHaveBeenCalledWith(
          expect.objectContaining({ lagDays: 4 }),
        );
      },
    );
  });
});

const BUG_FIELDS = [
  'itemType',
  'severity',
  'foundIn',
  'foundInNote',
  'stepsToReproduce',
  'expectedBehavior',
  'actualBehavior',
  'resolution',
  'regression',
  'affectedSystemId',
  'duplicateOfTaskId',
];

describe('strict tool arguments', () => {
  test('update_project_task names an unknown field and does not call the handler', async () => {
    const updateProjectTask = vi.fn();
    await withMcpClient(['pm:write'], { updateProjectTask }, async (client) => {
      const result = await client.callTool({
        name: 'update_project_task',
        arguments: { taskId: 'PRO-T-1', statuss: 'done' },
      });
      expect(result.isError).toBe(true);
      expect(toolText(result)).toContain('statuss');
      expect(updateProjectTask).not.toHaveBeenCalled();
    });
  });

  test('list_project_tasks names an unknown field and does not call the handler', async () => {
    const listProjectTasks = vi.fn();
    await withMcpClient(['pm:read'], { listProjectTasks }, async (client) => {
      const result = await client.callTool({
        name: 'list_project_tasks',
        arguments: { projectId: PROJECT_ID, bogus: true },
      });
      expect(result.isError).toBe(true);
      expect(toolText(result)).toContain('bogus');
      expect(listProjectTasks).not.toHaveBeenCalled();
    });
  });

  test('invokeNamedHubTool rejects unknown fields on write and read tools', async () => {
    const updateProjectTask = vi.fn();
    const listProjectTasks = vi.fn();
    await expect(
      invokeNamedHubTool({ updateProjectTask }, ['pm:write'], 'update_project_task', {
        taskId: 'PRO-B-4',
        notAField: true,
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      statusCode: 400,
      message: 'Unknown field: notAField',
    });
    await expect(
      invokeNamedHubTool({ listProjectTasks }, ['pm:read'], 'list_project_tasks', {
        projectId: PROJECT_ID,
        nope: 1,
      }),
    ).rejects.toMatchObject({ message: 'Unknown field: nope' });
    expect(updateProjectTask).not.toHaveBeenCalled();
    expect(listProjectTasks).not.toHaveBeenCalled();
  });

  test('set_delivery_media_links rejects an unknown link field', async () => {
    const setDeliveryMediaLinks = vi.fn();
    await withMcpClient(['pm:write'], { setDeliveryMediaLinks }, async (client) => {
      const result = await client.callTool({
        name: 'set_delivery_media_links',
        arguments: {
          projectId: PROJECT_ID,
          entityType: 'user_story',
          entityId: 'PRO-S-1',
          links: [{ kind: 'url', url: 'https://example.com', title: 'Shot', extra: true }],
        },
      });
      expect(result.isError).toBe(true);
      expect(toolText(result)).toContain('extra');
      expect(setDeliveryMediaLinks).not.toHaveBeenCalled();
    });
    await expect(
      invokeNamedHubTool({ setDeliveryMediaLinks }, ['pm:write'], 'set_delivery_media_links', {
        projectId: PROJECT_ID,
        entityType: 'task',
        entityId: 'PRO-T-1',
        links: [{ kind: 'media', mediaId: PROJECT_ID, nope: 1 }],
      }),
    ).rejects.toMatchObject({
      message: 'Unknown field: links[0].nope',
    });
    expect(setDeliveryMediaLinks).not.toHaveBeenCalled();
  });

  test('linking media requires pm:write and readers stay read-only', async () => {
    const setDeliveryMediaLinks = vi.fn();
    await withMcpClient(['pm:read'], { setDeliveryMediaLinks }, async (client) => {
      const result = await client.callTool({
        name: 'set_delivery_media_links',
        arguments: {
          projectId: PROJECT_ID,
          entityType: 'task',
          entityId: 'PRO-T-1',
          links: [],
        },
      });
      expect(result.isError).toBe(true);
      expect(toolText(result)).toContain('pm:write');
      expect(setDeliveryMediaLinks).not.toHaveBeenCalled();
    });
  });

  test('media tool descriptions name item links and human keys', async () => {
    await withMcpClient(['pm:read', 'knowledge:read', 'knowledge:write'], {}, async (client) => {
      const listed = await client.listTools();
      const byName = new Map(listed.tools.map((tool) => [tool.name, tool.description ?? '']));
      expect(byName.get('set_delivery_media_links')).toMatch(/PRO-T-1/);
      expect(byName.get('set_delivery_media_links')).toMatch(/pm:write/);
      expect(byName.get('begin_workspace_media_upload')).toMatch(/targetEntityId/);
      expect(byName.get('begin_workspace_media_upload')).toMatch(/pm:write/);
      expect(byName.get('list_workspace_media')).toMatch(/entityId/);
      expect(byName.get('get_project_task')).toMatch(/mediaLinks/);
      expect(byName.get('list_project_tasks')).toMatch(/mediaLinkCount/);
      expect(byName.get('list_project_user_stories')).toMatch(/mediaLinks/);
      expect(byName.get('list_project_epics')).toMatch(/mediaLinks/);
      expect(byName.get('list_project_raid_items')).toMatch(/mediaLinks/);
      expect(byName.get('list_project_raid_items')).toMatch(/records\[\]/);
      expect(byName.get('list_project_change_items')).toMatch(/mediaLinks/);
      expect(byName.get('get_knowledge_record')).toMatch(/linkedItems/);
      expect(byName.get('create_project_raid_item')).toMatch(/recordIds/);
    });
  });
});

describe('knowledge record linked items and RAID recordIds', () => {
  test('get_knowledge_record output schema names linkedItems', async () => {
    await withMcpClient(['knowledge:read'], {}, async (client) => {
      const listed = await client.listTools();
      const tool = listed.tools.find((item) => item.name === 'get_knowledge_record');
      const output = JSON.stringify(tool?.outputSchema);
      expect(output).toContain('linkedItems');
      expect(output).toContain('deliveryLinks');
      expect(output).toContain('raidLinks');
      expect(output).toContain('changeItems');
    });
  });

  test('create_project_raid_item accepts recordIds and rejects unknown fields', async () => {
    const createProjectRaidItem = vi.fn(async () => ({ raidItem: { id: 'raid-1' } }));
    await withMcpClient(['pm:write'], { createProjectRaidItem }, async (client) => {
      const listed = await client.listTools();
      const tool = listed.tools.find((item) => item.name === 'create_project_raid_item');
      const input = tool?.inputSchema as {
        properties?: Record<string, { description?: string; maxItems?: number }>;
      };
      expect(input.properties?.recordIds).toBeTruthy();
      expect(input.properties?.recordIds?.description).toMatch(/record/i);
      const created = await client.callTool({
        name: 'create_project_raid_item',
        arguments: {
          projectId: PROJECT_ID,
          kind: 'risk',
          title: 'Supplier delay',
          recordIds: ['HL1-VIS-2'],
        },
      });
      expect(created.isError).not.toBe(true);
      expect(createProjectRaidItem).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        kind: 'risk',
        title: 'Supplier delay',
        recordIds: ['HL1-VIS-2'],
      });
      const rejected = await client.callTool({
        name: 'create_project_raid_item',
        arguments: {
          projectId: PROJECT_ID,
          kind: 'risk',
          title: 'Supplier delay',
          recordIds: ['HL1-VIS-2'],
          nope: true,
        },
      });
      expect(rejected.isError).toBe(true);
      expect(toolText(rejected)).toContain('nope');
    });
  });

  test('get_knowledge_record keeps linkedItems on the first page', async () => {
    const linkedItems = {
      deliveryLinks: [
        {
          id: '77777777-7777-4777-8777-777777777777',
          humanKey: 'HL1-T-1',
          title: 'Write the brief',
          type: 'task',
          kind: 'bug',
          projectId: PROJECT_ID,
          projectSlug: 'renewal',
        },
      ],
      raidLinks: [],
      changeItems: [],
    };
    const getKnowledgeRecord = vi.fn(async () => ({
      knowledgeRecord: {
        id: '66666666-6666-4666-8666-666666666666',
        title: 'Charter',
        contentMarkdown: '# Charter',
        extraField: 'kept',
        linkedItems,
        recordRelations: {
          outboundCount: 0,
          inboundCount: 0,
          cap: 20,
          truncated: false,
          items: [],
        },
      },
    }));
    await withMcpClient(['knowledge:read'], { getKnowledgeRecord }, async (client) => {
      const read = await client.callTool({
        name: 'get_knowledge_record',
        arguments: { recordId: 'HL1-VIS-2' },
      });
      expect(read.isError).not.toBe(true);
      const body = JSON.parse(toolText(read)) as {
        knowledgeRecord: {
          title: string;
          extraField?: string;
          linkedItems: typeof linkedItems;
          recordRelations?: { outboundCount: number };
        };
      };
      expect(body.knowledgeRecord.title).toBe('Charter');
      expect(body.knowledgeRecord.extraField).toBe('kept');
      expect(body.knowledgeRecord.linkedItems).toEqual(linkedItems);
      expect(body.knowledgeRecord.recordRelations?.outboundCount).toBe(0);
      expect(read.structuredContent).toEqual(body);
    });
  });
});

describe('list_project_tasks paging schema', () => {
  test('input schema keeps limit and cursor (PRO-T-88)', async () => {
    await withMcpClient(['pm:read'], {}, async (client) => {
      const listed = await client.listTools();
      const tool = listed.tools.find((item) => item.name === 'list_project_tasks');
      const input = tool?.inputSchema as {
        properties?: Record<string, {
          type?: string;
          description?: string;
          minimum?: number;
          maximum?: number;
        }>;
        additionalProperties?: boolean;
      };
      expect(input.additionalProperties).toBe(false);
      expect(input.properties?.limit).toMatchObject({
        type: 'integer',
        minimum: 1,
        maximum: 25,
      });
      expect(input.properties?.limit?.description).toMatch(/25/);
      expect(input.properties?.cursor).toMatchObject({ type: 'string' });
      expect(input.properties?.cursor?.description).toMatch(/nextCursor/);
      expect(tool?.description).toMatch(/limit/);
      expect(tool?.description).toMatch(/cursor/);
      const output = tool?.outputSchema as {
        properties?: { nextCursor?: { description?: string } };
      };
      expect(output.properties?.nextCursor?.description).toMatch(/cursor/);
    });
  });

  test('passes limit and cursor through and returns nextCursor', async () => {
    const page = {
      tasks: [{ id: 'task-1', completionPercent: 0 }],
      total: 1,
      limit: 2,
      nextCursor: null,
      hasMore: false,
    };
    const listProjectTasks = vi.fn(async () => page);
    await withMcpClient(['pm:read'], { listProjectTasks }, async (client) => {
      const result = await client.callTool({
        name: 'list_project_tasks',
        arguments: { projectId: PROJECT_ID, limit: 2, cursor: 'page-2' },
      });
      expect(result.isError).not.toBe(true);
      expect(JSON.parse(toolText(result)).nextCursor).toBeNull();
      expect(result.structuredContent).toEqual(page);
      expect(listProjectTasks).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: PROJECT_ID, limit: 2, cursor: 'page-2' }),
      );
    });
  });
});

describe('task human keys and bug fields', () => {
  test('create and update schemas expose bug fields and get_project_task accepts B keys', async () => {
    await withMcpClient(['pm:read', 'pm:write'], {}, async (client) => {
      const listed = await client.listTools();
      for (const name of ['create_project_task', 'update_project_task']) {
        const tool = listed.tools.find((item) => item.name === name);
        const props = (tool?.inputSchema as { properties?: Record<string, unknown> }).properties ?? {};
        for (const field of BUG_FIELDS) {
          expect(props[field], `${name}.${field}`).toBeTruthy();
        }
      }
      const getTask = listed.tools.find((item) => item.name === 'get_project_task');
      expect(getTask?.description).toContain('HL1-B-4');
      const updateTask = listed.tools.find((item) => item.name === 'update_project_task');
      expect(updateTask?.description).toContain('HL1-B-4');
      const activities = listed.tools.find((item) => item.name === 'list_project_task_activities');
      expect(
        (activities?.inputSchema as { properties?: Record<string, unknown> }).properties?.fullText,
      ).toBeTruthy();
      expect(activities?.description).toMatch(/full/);
    });
  });
});

describe('delivery dependency required arguments', () => {
  test('schemas and descriptions say projectId is required', async () => {
    await withMcpClient(['pm:read', 'pm:write'], {}, async (client) => {
      const listed = await client.listTools();
      for (const name of ['list_delivery_dependencies', 'set_delivery_dependency'] as const) {
        const tool = listed.tools.find((item) => item.name === name);
        const input = tool?.inputSchema as {
          required?: string[];
          properties?: Record<string, { description?: string }>;
        };
        expect(tool?.description, name).toMatch(/projectId \(UUID\)/);
        expect(tool?.description, name).toMatch(/required/i);
        expect(input.required, name).toContain('projectId');
        expect(input.properties?.projectId?.description, name).toMatch(/Required project id/);
      }
      const list = listed.tools.find((item) => item.name === 'list_delivery_dependencies');
      const listInput = list?.inputSchema as { required?: string[] };
      expect(listInput.required).toEqual(expect.arrayContaining(['projectId', 'entityId']));

      for (const tool of listed.tools) {
        const input = tool.inputSchema as {
          required?: string[];
          properties?: Record<string, { description?: string }>;
        };
        for (const field of input.required ?? []) {
          expect(input.properties?.[field]?.description, `${tool.name}.${field}`).toMatch(
            /required/i,
          );
        }
      }
    });
  });

  test('omitting projectId is a validation error and does not call the handler', async () => {
    const listDeliveryDependencies = vi.fn(async () => {
      throw new Error('postgres://user:secret@db/knowledge');
    });
    const setDeliveryDependency = vi.fn(async () => {
      throw new Error('postgres://user:secret@db/knowledge');
    });
    await withMcpClient(
      ['pm:read', 'pm:write'],
      { listDeliveryDependencies, setDeliveryDependency },
      async (client) => {
        const list = await client.callTool({
          name: 'list_delivery_dependencies',
          arguments: { entityId: 'PRO-T-1' },
        });
        const set = await client.callTool({
          name: 'set_delivery_dependency',
          arguments: {
            predecessorId: 'PRO-T-1',
            successorId: 'PRO-B-1',
            linkType: 'FS',
          },
        });
        expect(list.isError).toBe(true);
        expect(set.isError).toBe(true);
        expect(toolText(list)).toContain('projectId');
        expect(toolText(set)).toContain('projectId');
        expect(toolText(list)).not.toContain('Internal error');
        expect(toolText(set)).not.toContain('Internal error');
        expect(toolText(list)).not.toContain('postgres://');
        expect(listDeliveryDependencies).not.toHaveBeenCalled();
        expect(setDeliveryDependency).not.toHaveBeenCalled();
      },
    );
  });

  test('call_hub_tool reports a missing projectId instead of an internal error', async () => {
    const listDeliveryDependencies = vi.fn();
    const setDeliveryDependency = vi.fn();
    const server = createKnowledgeHubMcpServer(
      testClient(['projects:read', 'pm:read', 'pm:write']),
      { listDeliveryDependencies, setDeliveryDependency } as McpToolHandlers,
      {
        oauth: {
          resourceMetadataUrl: 'https://knowledge.example.com/.well-known/oauth-protected-resource',
          profile: { id: 'user-1', name: 'Ada' },
        },
      },
    );
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'dependency-validation', version: '0.0.0' });
    await Promise.all([
      client.connect(clientTransport),
      server.connect(serverTransport),
    ]);
    try {
      const list = await client.callTool({
        name: 'call_hub_tool',
        arguments: {
          toolName: 'list_delivery_dependencies',
          arguments: { entityId: 'PRO-T-1' },
        },
      });
      const set = await client.callTool({
        name: 'call_hub_tool',
        arguments: {
          toolName: 'set_delivery_dependency',
          arguments: { predecessorId: 'PRO-T-1', successorId: 'PRO-B-1', linkType: 'FS' },
        },
      });
      expect(list.isError).toBe(true);
      expect(set.isError).toBe(true);
        expect(toolText(list)).toBe('Missing required field: projectId');
        expect(toolText(set)).toBe('Missing required field: projectId');
      expect(toolText(list)).not.toContain('Internal error');
      expect(toolText(set)).not.toContain('Internal error');
      expect(listDeliveryDependencies).not.toHaveBeenCalled();
      expect(setDeliveryDependency).not.toHaveBeenCalled();
    } finally {
      await client.close();
      await server.close();
    }
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

  test('an oversized list_projects is a tool error without structuredContent', async () => {
    const listProjects = vi.fn(async () => ({
      blob: 'x'.repeat(MCP_MAX_RESPONSE_BYTES),
    }));

    await withMcpClient(['projects:read'], { listProjects }, async (client) => {
      const result = await client.callTool({
        name: 'list_projects',
        arguments: {},
      });
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toBeUndefined();
      expect(JSON.parse(toolText(result))).toEqual({
        error: 'Response exceeds size limit',
        hint:
          'Pass a smaller limit, follow nextCursor, or page get_knowledge_record with contentOffset. suggestedLimit is a smaller list page size.',
        suggestedLimit: 10,
      });
    });
  });
});
