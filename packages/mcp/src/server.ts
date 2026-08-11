import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { hasMcpScope, type McpScope } from './scopes.js';
import { enforceResponseSize, MCP_MAX_LIST_LIMIT } from './limits.js';

export type McpClientContext = {
  id: string;
  name: string;
  organizationId: string;
  scopes: string[];
  allowedWorkspaceIds: string[];
  allowedProjectIds: string[];
  actingUserId: string | null;
};

export type McpToolHandlers = {
  listProjects: (input: { workspaceId?: string; limit: number }) => Promise<unknown>;
  listSystems: (input: {
    workspaceId?: string;
    projectId?: string;
    limit: number;
  }) => Promise<unknown>;
  getProject: (input: { projectId: string }) => Promise<unknown>;
  updateProjectBaseline: (input: {
    projectId: string;
    startDate?: string | null;
    endDate?: string | null;
    charterRecordId?: string | null;
    initialPlanRecordId?: string | null;
    currency?: string;
    initialBudget?: number | string | null;
    approvedBudget?: number | string | null;
    keyPrefix?: string;
  }) => Promise<unknown>;
  getProjectBudgetSummary: (input: { projectId: string }) => Promise<unknown>;
  getProjectResourceUtilization: (input: {
    projectId: string;
    view?: 'planned' | 'burn' | 'combined';
  }) => Promise<unknown>;
  listProjectInitialStakeholders: (input: {
    projectId: string;
  }) => Promise<unknown>;
  setProjectInitialStakeholders: (input: {
    projectId: string;
    stakeholders: Array<{
      userId: string;
      projectRole?: string;
      sortOrder?: number;
    }>;
  }) => Promise<unknown>;
  getSystem: (input: { systemId: string }) => Promise<unknown>;
  listKnowledgeRecords: (input: {
    workspaceId: string;
    projectId?: string;
    systemId?: string;
    language?: string;
    limit: number;
  }) => Promise<unknown>;
  searchKnowledge: (input: {
    workspaceId: string;
    query: string;
    projectIds?: string[];
    systemIds?: string[];
    recordTypes?: string[];
    statuses?: string[];
    language?: string;
    limit: number;
    mode?: 'fts' | 'hybrid';
  }) => Promise<unknown>;
  getKnowledgeRecord: (input: { recordId: string }) => Promise<unknown>;
  getRecordProvenance: (input: { recordId: string }) => Promise<unknown>;
  listRecordTranslations: (input: { recordId: string }) => Promise<unknown>;
  createRecordTranslation: (input: {
    recordId: string;
    language: string;
    slug?: string;
    translateWithAi?: boolean;
    title?: string;
    summary?: string | null;
    contentMarkdown?: string;
  }) => Promise<unknown>;
  listRecordMetadata: () => Promise<unknown>;
  createKnowledgeRecord: (input: {
    workspaceId: string;
    title: string;
    recordType: string;
    contentMarkdown: string;
    summary?: string;
    slug?: string;
    projectId?: string;
    systemId?: string;
    tags?: string[];
    language?: string;
    translationGroupId?: string | null;
    generatedByModel?: string;
    sourceTitle?: string;
  }) => Promise<unknown>;
  updateKnowledgeRecord: (input: {
    recordId: string;
    changeMessage: string;
    title?: string;
    summary?: string | null;
    recordType?: string;
    contentMarkdown?: string;
    projectId?: string | null;
    systemId?: string | null;
    tags?: string[];
    language?: string | null;
    translationGroupId?: string | null;
    generatedByModel?: string;
    sourceTitle?: string;
  }) => Promise<unknown>;
  uploadWorkspaceMedia: (input: {
    workspaceId: string;
    contentBase64: string;
    contentType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
    filename?: string;
    alt?: string;
    knowledgeRecordId?: string;
    /** When true with knowledgeRecordId, append markdownSnippet into the record body. */
    insertIntoRecord?: boolean;
  }) => Promise<unknown>;
  /** ChatGPT Actions: start a Redis-backed chunked base64 upload (prefer over single-shot). */
  beginWorkspaceMediaUpload: (input: {
    workspaceId: string;
    contentType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
    filename?: string;
    alt?: string;
    knowledgeRecordId?: string;
    insertIntoRecord?: boolean;
  }) => Promise<unknown>;
  appendWorkspaceMediaUpload: (input: {
    uploadId: string;
    chunkBase64: string;
    index?: number;
  }) => Promise<unknown>;
  finalizeWorkspaceMediaUpload: (input: { uploadId: string }) => Promise<unknown>;
  listWorkspaceMedia: (input: {
    workspaceId: string;
    knowledgeRecordId?: string;
    limit: number;
  }) => Promise<unknown>;
  deleteWorkspaceMedia: (input: { mediaId: string }) => Promise<unknown>;
  /** NF-014 — redacted platform health snapshot (requires monitoring:read). */
  getPlatformStatus: () => Promise<unknown>;
  /** NF-018 Project Delivery */
  listProjectMilestones: (input: {
    projectId: string;
    includeArchived?: boolean;
  }) => Promise<unknown>;
  listProjectTasks: (input: {
    projectId: string;
    milestoneId?: string;
    unassignedMilestone?: boolean;
    includeArchived?: boolean;
  }) => Promise<unknown>;
  getProjectTask: (input: { taskId: string }) => Promise<unknown>;
  createProjectMilestone: (input: {
    projectId: string;
    title: string;
    description?: string | null;
    status?: string;
    startDate?: string | null;
    targetDate?: string | null;
    sortOrder?: number;
  }) => Promise<unknown>;
  updateProjectMilestone: (input: {
    milestoneId: string;
    title?: string;
    description?: string | null;
    status?: string;
    startDate?: string | null;
    targetDate?: string | null;
    sortOrder?: number;
    archived?: boolean;
  }) => Promise<unknown>;
  createProjectTask: (input: {
    projectId: string;
    title: string;
    description?: string | null;
    status?: string;
    dueDate?: string | null;
    forecastHours?: number | string | null;
    actualHours?: number | string | null;
    tokensUsed?: number | null;
    aiSystemId?: string | null;
    milestoneId?: string | null;
    userStoryId?: string | null;
    currentOwnerUserId?: string | null;
    sortOrder?: number;
    raci?: Array<{ userId: string; role: 'R' | 'A' | 'C' | 'I' }>;
  }) => Promise<unknown>;
  updateProjectTask: (input: {
    taskId: string;
    title?: string;
    description?: string | null;
    status?: string;
    dueDate?: string | null;
    forecastHours?: number | string | null;
    actualHours?: number | string | null;
    tokensUsed?: number | null;
    aiSystemId?: string | null;
    milestoneId?: string | null;
    userStoryId?: string | null;
    currentOwnerUserId?: string | null;
    sortOrder?: number;
    archived?: boolean;
  }) => Promise<unknown>;
  reportProjectTaskAiUsage: (input: {
    taskId: string;
    tokensUsed: number;
    aiSystemId?: string | null;
  }) => Promise<unknown>;
  setProjectTaskRaci: (input: {
    taskId: string;
    entries: Array<{ userId: string; role: 'R' | 'A' | 'C' | 'I' }>;
  }) => Promise<unknown>;
  listProjectEpics: (input: {
    projectId: string;
    includeArchived?: boolean;
  }) => Promise<unknown>;
  createProjectEpic: (input: {
    projectId: string;
    title: string;
    description?: string | null;
    status?: string;
    startDate?: string | null;
    endDate?: string | null;
    sortOrder?: number;
  }) => Promise<unknown>;
  updateProjectEpic: (input: {
    epicId: string;
    title?: string;
    description?: string | null;
    status?: string;
    startDate?: string | null;
    endDate?: string | null;
    sortOrder?: number;
    archived?: boolean;
  }) => Promise<unknown>;
  listProjectUserStories: (input: {
    projectId: string;
    epicId?: string;
    includeArchived?: boolean;
  }) => Promise<unknown>;
  createProjectUserStory: (input: {
    projectId: string;
    epicId: string;
    title: string;
    description?: string | null;
    status?: string;
    startDate?: string | null;
    endDate?: string | null;
    sortOrder?: number;
  }) => Promise<unknown>;
  updateProjectUserStory: (input: {
    storyId: string;
    title?: string;
    description?: string | null;
    status?: string;
    epicId?: string;
    startDate?: string | null;
    endDate?: string | null;
    sortOrder?: number;
    archived?: boolean;
  }) => Promise<unknown>;
  listProjectTaskActivities: (input: { taskId: string }) => Promise<unknown>;
  addProjectTaskComment: (input: {
    taskId: string;
    body: string;
  }) => Promise<unknown>;
  handoffProjectTask: (input: {
    taskId: string;
    toUserId: string;
    note?: string | null;
  }) => Promise<unknown>;
  listProjectStakeholders: (input: { projectId: string }) => Promise<unknown>;
  createProjectStakeholder: (input: {
    projectId: string;
    userId: string;
    projectRole: string;
    jobTitle?: string | null;
    notes?: string | null;
    reportsToUserId?: string | null;
    hourlyRate?: number | string | null;
    sortOrder?: number;
    engagementType?: 'employee' | 'contractor' | null;
    assignmentStart?: string | null;
    assignmentEnd?: string | null;
    allocatedDailyHours?: number | string | null;
    contractRef?: string | null;
    contractedBudget?: number | string | null;
    contractStart?: string | null;
    contractEnd?: string | null;
  }) => Promise<unknown>;
  updateProjectStakeholder: (input: {
    stakeholderId: string;
    projectRole?: string;
    jobTitle?: string | null;
    notes?: string | null;
    reportsToUserId?: string | null;
    hourlyRate?: number | string | null;
    sortOrder?: number;
    engagementType?: 'employee' | 'contractor' | null;
    assignmentStart?: string | null;
    assignmentEnd?: string | null;
    allocatedDailyHours?: number | string | null;
    contractRef?: string | null;
    contractedBudget?: number | string | null;
    contractStart?: string | null;
    contractEnd?: string | null;
  }) => Promise<unknown>;
  updateProjectAiAssistantCost: (input: {
    systemId: string;
    aiCostMode?: 'flat' | 'api' | 'mixed' | 'note_only' | null;
    aiFlatMonthlyFee?: number | string | null;
    aiTokenRatePer1k?: number | string | null;
    aiBudgetAllocation?: number | string | null;
  }) => Promise<unknown>;
  deleteProjectStakeholder: (input: {
    stakeholderId: string;
  }) => Promise<unknown>;
  listProjectRaidItems: (input: {
    projectId: string;
    includeArchived?: boolean;
  }) => Promise<unknown>;
  createProjectRaidItem: (input: {
    projectId: string;
    kind: string;
    title: string;
    description?: string | null;
    status?: string;
    severity?: string;
    ownerUserId?: string | null;
    dueDate?: string | null;
    sortOrder?: number;
    taskIds?: string[];
  }) => Promise<unknown>;
  updateProjectRaidItem: (input: {
    raidItemId: string;
    kind?: string;
    title?: string;
    description?: string | null;
    status?: string;
    severity?: string;
    ownerUserId?: string | null;
    dueDate?: string | null;
    sortOrder?: number;
    archived?: boolean;
  }) => Promise<unknown>;
  transferProjectRaidItem: (input: {
    raidItemId: string;
    targetKind: 'issue' | 'risk';
  }) => Promise<unknown>;
  setProjectRaidTaskLinks: (input: {
    raidItemId: string;
    taskIds: string[];
  }) => Promise<unknown>;
  listProjectChangeItems: (input: {
    projectId: string;
    includeArchived?: boolean;
  }) => Promise<unknown>;
  createProjectChangeItem: (input: {
    projectId: string;
    kind: string;
    title: string;
    description?: string | null;
    rationale?: string | null;
    status?: string;
    requestedByUserId?: string | null;
    approvedByUserId?: string | null;
    effectiveDate?: string | null;
    baselineStartBefore?: string | null;
    baselineStartAfter?: string | null;
    baselineEndBefore?: string | null;
    baselineEndAfter?: string | null;
    knowledgeRecordId?: string | null;
    sortOrder?: number;
    deliveryLinks?: Array<{ entityType: string; entityId: string }>;
  }) => Promise<unknown>;
  updateProjectChangeItem: (input: {
    changeId: string;
    kind?: string;
    title?: string;
    description?: string | null;
    rationale?: string | null;
    status?: string;
    requestedByUserId?: string | null;
    approvedByUserId?: string | null;
    effectiveDate?: string | null;
    baselineStartBefore?: string | null;
    baselineStartAfter?: string | null;
    baselineEndBefore?: string | null;
    baselineEndAfter?: string | null;
    knowledgeRecordId?: string | null;
    sortOrder?: number;
    archived?: boolean;
    deliveryLinks?: Array<{ entityType: string; entityId: string }>;
  }) => Promise<unknown>;
  getKnowledgeRecordDeliveryLinks: (input: {
    recordId: string;
  }) => Promise<unknown>;
  setKnowledgeRecordDeliveryLinks: (input: {
    recordId: string;
    links: Array<{ entityType: string; entityId: string }>;
  }) => Promise<unknown>;
  onToolCall?: (
    toolName: string,
    ok: boolean,
    context?: McpToolCallContext,
  ) => Promise<void>;
};

export type McpToolCallContext = {
  recordId?: string;
  projectId?: string;
  systemId?: string;
  workspaceId?: string;
  mediaId?: string;
};

function requireScope(client: McpClientContext, scope: McpScope): void {
  if (!hasMcpScope(client.scopes, scope)) {
    throw new Error(`Missing required scope: ${scope}`);
  }
}

function textResult(data: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(enforceResponseSize(data), null, 2),
      },
    ],
  };
}

function extractToolContext(data: unknown): McpToolCallContext {
  if (!data || typeof data !== 'object') {
    return {};
  }
  const root = data as Record<string, unknown>;
  const ctx: McpToolCallContext = {};

  const take = (obj: Record<string, unknown>) => {
    if (typeof obj.id === 'string') {
      if ('contentMarkdown' in obj || 'lifecycleStatus' in obj || 'recordType' in obj) {
        ctx.recordId = obj.id;
      } else if ('criticality' in obj || 'systemType' in obj) {
        ctx.systemId = obj.id;
      } else if ('businessDomain' in obj || 'slug' in obj) {
        // project-like
        if (!ctx.projectId && !ctx.systemId) {
          ctx.projectId = ctx.projectId ?? obj.id;
        }
      }
    }
    if (typeof obj.workspaceId === 'string') ctx.workspaceId = obj.workspaceId;
    if (typeof obj.projectId === 'string') ctx.projectId = obj.projectId;
    if (typeof obj.systemId === 'string') ctx.systemId = obj.systemId;
    if (typeof obj.recordId === 'string') ctx.recordId = obj.recordId;
    if (typeof obj.mediaId === 'string') ctx.mediaId = obj.mediaId;
    if (typeof obj.id === 'string' && 'markdownSnippet' in obj) {
      ctx.mediaId = obj.id;
    }
  };

  take(root);
  for (const key of [
    'knowledgeRecord',
    'project',
    'system',
    'record',
    'media',
  ] as const) {
    const nested = root[key];
    if (nested && typeof nested === 'object') {
      take(nested as Record<string, unknown>);
    }
  }
  if (typeof root.mediaId === 'string') ctx.mediaId = root.mediaId;
  return ctx;
}

export function createKnowledgeHubMcpServer(
  client: McpClientContext,
  handlers: McpToolHandlers,
): McpServer {
  const server = new McpServer({
    name: 'project-knowledge-hub',
    version: '0.1.0',
  });

  const wrap =
    (
      toolName: string,
      scope: McpScope,
      fn: () => Promise<unknown>,
      argContext?: McpToolCallContext,
    ) =>
    async () => {
      try {
        requireScope(client, scope);
        const data = await fn();
        await handlers.onToolCall?.(toolName, true, {
          ...argContext,
          ...extractToolContext(data),
        });
        return textResult(data);
      } catch (error) {
        await handlers.onToolCall?.(toolName, false, argContext);
        const message = error instanceof Error ? error.message : 'Tool failed';
        return {
          isError: true,
          content: [{ type: 'text' as const, text: message }],
        };
      }
    };

  server.tool(
    'list_projects',
    'List accessible projects in allowed workspaces',
    {
      workspaceId: z.string().uuid().optional(),
      limit: z.number().int().min(1).max(MCP_MAX_LIST_LIMIT).optional(),
    },
    async (args) =>
      wrap('list_projects', 'projects:read', () =>
        handlers.listProjects({
          workspaceId: args.workspaceId,
          limit: args.limit ?? MCP_MAX_LIST_LIMIT,
        }),
      )(),
  );

  server.tool(
    'list_systems',
    'List accessible systems in allowed workspaces',
    {
      workspaceId: z.string().uuid().optional(),
      projectId: z.string().uuid().optional(),
      limit: z.number().int().min(1).max(MCP_MAX_LIST_LIMIT).optional(),
    },
    async (args) =>
      wrap('list_systems', 'systems:read', () =>
        handlers.listSystems({
          workspaceId: args.workspaceId,
          projectId: args.projectId,
          limit: args.limit ?? MCP_MAX_LIST_LIMIT,
        }),
      )(),
  );

  server.tool(
    'get_project',
    'Get a project by id (includes baseline dates and pinned charter/plan)',
    { projectId: z.string().uuid() },
    async (args) =>
      wrap('get_project', 'projects:read', () => handlers.getProject(args), {
        projectId: args.projectId,
      })(),
  );

  const projectCurrencyEnum = z.enum([
    'EUR',
    'USD',
    'GBP',
    'CHF',
    'HUF',
    'PLN',
    'CZK',
    'RON',
    'SEK',
    'NOK',
    'DKK',
    'CAD',
    'AUD',
    'JPY',
  ]);
  const moneyInput = z.union([z.number(), z.string()]).nullable();

  /** UUID or human key such as HL1-T-12 / HL1-RR-3. */
  const entityRef = z.string().min(1).max(80);

  server.tool(
    'update_project_baseline',
    'Update project baseline window, pinned docs, currency, budgets, and issue key prefix. Requires pm:write.',
    {
      projectId: z.string().uuid(),
      startDate: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .nullable()
        .optional(),
      endDate: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .nullable()
        .optional(),
      charterRecordId: z.string().uuid().nullable().optional(),
      initialPlanRecordId: z.string().uuid().nullable().optional(),
      currency: projectCurrencyEnum.optional(),
      initialBudget: moneyInput.optional(),
      approvedBudget: moneyInput.optional(),
      keyPrefix: z
        .string()
        .trim()
        .regex(/^([A-Za-z]{3}|[A-Za-z]{2}[0-9])$/)
        .optional(),
    },
    async (args) =>
      wrap(
        'update_project_baseline',
        'pm:write',
        () => handlers.updateProjectBaseline(args),
        { projectId: args.projectId },
      )(),
  );

  server.tool(
    'get_project_budget_summary',
    'Get project EVM summary (BAC/EV/AC/CPI/SPI), financial/risk RAG, burndown snapshots, and epic cost rollups. Includes person vs AI AC breakdown. Requires pm:read.',
    { projectId: z.string().uuid() },
    async (args) =>
      wrap(
        'get_project_budget_summary',
        'pm:read',
        () => handlers.getProjectBudgetSummary(args),
        { projectId: args.projectId },
      )(),
  );

  server.tool(
    'get_project_resource_utilization',
    'Get per-person capacity vs planned/burn demand for roster stakeholders (employee/contractor windows). view=planned|burn|combined. Requires pm:read.',
    {
      projectId: z.string().uuid(),
      view: z.enum(['planned', 'burn', 'combined']).optional(),
    },
    async (args) =>
      wrap(
        'get_project_resource_utilization',
        'pm:read',
        () => handlers.getProjectResourceUtilization(args),
        { projectId: args.projectId },
      )(),
  );

  server.tool(
    'list_project_initial_stakeholders',
    'List the kickoff initial-stakeholders snapshot (separate from live roster). Requires pm:read.',
    { projectId: z.string().uuid() },
    async (args) =>
      wrap(
        'list_project_initial_stakeholders',
        'pm:read',
        () => handlers.listProjectInitialStakeholders(args),
        { projectId: args.projectId },
      )(),
  );

  server.tool(
    'set_project_initial_stakeholders',
    'Replace the kickoff initial-stakeholders snapshot. Requires pm:write.',
    {
      projectId: z.string().uuid(),
      stakeholders: z
        .array(
          z.object({
            userId: z.string().uuid(),
            projectRole: z
              .enum([
                'sponsor',
                'owner',
                'product_owner',
                'tech_lead',
                'contributor',
                'stakeholder',
                'other',
              ])
              .optional(),
            sortOrder: z.number().int().min(0).max(100000).optional(),
          }),
        )
        .max(200),
    },
    async (args) =>
      wrap(
        'set_project_initial_stakeholders',
        'pm:write',
        () => handlers.setProjectInitialStakeholders(args),
        { projectId: args.projectId },
      )(),
  );

  server.tool(
    'get_system',
    'Get a system by id',
    { systemId: z.string().uuid() },
    async (args) =>
      wrap('get_system', 'systems:read', () => handlers.getSystem(args), {
        systemId: args.systemId,
      })(),
  );

  server.tool(
    'list_knowledge_records',
    'List knowledge records in a workspace (excludes archived by default). Prefer language: "en" unless the user asks for another locale.',
    {
      workspaceId: z.string().uuid(),
      projectId: z.string().uuid().optional(),
      systemId: z.string().uuid().optional(),
      language: z.string().min(2).max(16).optional(),
      limit: z.number().int().min(1).max(MCP_MAX_LIST_LIMIT).optional(),
    },
    async (args) =>
      wrap(
        'list_knowledge_records',
        'knowledge:read',
        () =>
          handlers.listKnowledgeRecords({
            ...args,
            limit: args.limit ?? MCP_MAX_LIST_LIMIT,
          }),
        {
          workspaceId: args.workspaceId,
          projectId: args.projectId,
          systemId: args.systemId,
        },
      )(),
  );

  server.tool(
    'search_knowledge',
    'Search knowledge records (full-text by default; optional hybrid when embeddings are enabled). Prefer language: "en" unless the user asks for another locale.',
    {
      workspaceId: z.string().uuid(),
      query: z.string().min(1).max(300),
      projectIds: z.array(z.string().uuid()).optional(),
      systemIds: z.array(z.string().uuid()).optional(),
      recordTypes: z.array(z.string()).optional(),
      statuses: z.array(z.string()).optional(),
      language: z.string().min(2).max(16).optional(),
      limit: z.number().int().min(1).max(MCP_MAX_LIST_LIMIT).optional(),
      mode: z.enum(['fts', 'hybrid']).optional(),
    },
    async (args) =>
      wrap('search_knowledge', 'knowledge:search', () =>
        handlers.searchKnowledge({
          ...args,
          limit: args.limit ?? 10,
          mode: args.mode,
        }),
      )(),
  );

  server.tool(
    'get_knowledge_record',
    'Retrieve a knowledge record including truncated markdown content and linked workspace media (id, url, markdownSnippet). Images use ![alt](/api/v1/media/{id}) — never data: URIs.',
    { recordId: z.string().uuid() },
    async (args) =>
      wrap(
        'get_knowledge_record',
        'knowledge:read',
        () => handlers.getKnowledgeRecord(args),
        { recordId: args.recordId },
      )(),
  );

  server.tool(
    'get_record_provenance',
    'Retrieve verification and source provenance for a knowledge record',
    { recordId: z.string().uuid() },
    async (args) =>
      wrap(
        'get_record_provenance',
        'provenance:read',
        () => handlers.getRecordProvenance(args),
        { recordId: args.recordId },
      )(),
  );

  server.tool(
    'list_record_translations',
    'List translation siblings for a knowledge record (same translationGroupId). Includes the source record. Prefer English siblings for default work.',
    { recordId: z.string().uuid() },
    async (args) =>
      wrap(
        'list_record_translations',
        'knowledge:read',
        () => handlers.listRecordTranslations(args),
        { recordId: args.recordId },
      )(),
  );

  server.tool(
    'create_record_translation',
    'REQUIRED for locale siblings (hu/de/…). Creates a linked draft with shared translationGroupId. NEVER use create_knowledge_record for another language of an existing record — that makes unlinked duplicates. Prefer translateWithAi=true when hub AI is configured; if AI is unavailable or fails, call again WITHOUT translateWithAi and pass title/summary/contentMarkdown yourself. Do not overwrite the EN source.',
    {
      recordId: z.string().uuid(),
      language: z.string().min(2).max(16),
      slug: z.string().min(1).max(96).optional(),
      translateWithAi: z.boolean().optional(),
      title: z.string().min(1).max(300).optional(),
      summary: z.string().max(1000).nullable().optional(),
      contentMarkdown: z.string().max(500_000).optional(),
    },
    async (args) =>
      wrap(
        'create_record_translation',
        'knowledge:write',
        () => handlers.createRecordTranslation(args),
        { recordId: args.recordId },
      )(),
  );

  server.tool(
    'list_record_metadata',
    'List knowledge record field guides, allowed recordType values, lifecycle/source-of-truth enums, MCP write constraints, and the workspace media workflow. Call before create_knowledge_record. For images/charts see workspaceMedia.workflow: ALWAYS use begin → append → finalize (never single-shot upload_workspace_media from LLM/Actions clients).',
    {},
    async () =>
      wrap('list_record_metadata', 'knowledge:read', () => handlers.listRecordMetadata())(),
  );

  server.tool(
    'begin_workspace_media_upload',
    'REQUIRED default for LLM/MCP/ChatGPT image uploads: start a chunked PNG/JPEG/WebP/GIF upload. Do NOT use upload_workspace_media. Returns uploadId + recommendedChunkChars (~8000). Next: append_workspace_media_upload for each ~8000-char raw base64 chunk, then finalize_workspace_media_upload. Optional insertIntoRecord+knowledgeRecordId embeds on finalize. Requires knowledge:write.',
    {
      workspaceId: z.string().uuid(),
      contentType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
      filename: z.string().min(1).max(200).optional(),
      alt: z.string().max(300).optional(),
      knowledgeRecordId: z.string().uuid().optional(),
      insertIntoRecord: z
        .boolean()
        .optional()
        .describe(
          'When true, requires knowledgeRecordId; finalize appends media.markdownSnippet to that record',
        ),
    },
    async (args) =>
      wrap(
        'begin_workspace_media_upload',
        'knowledge:write',
        () => handlers.beginWorkspaceMediaUpload(args),
        {
          workspaceId: args.workspaceId,
          recordId: args.knowledgeRecordId,
        },
      )(),
  );

  server.tool(
    'append_workspace_media_upload',
    'Step 2 of image upload (after begin_workspace_media_upload): append one raw base64 chunk (no data: prefix). Use ~recommendedChunkChars (8000); max 12000. Repeat until the full base64 string is sent, then call finalize_workspace_media_upload. Requires knowledge:write.',
    {
      uploadId: z.string().uuid(),
      chunkBase64: z.string().min(1).max(12_000),
      index: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe('Optional 0-based index; must equal the next expected chunk index'),
    },
    async (args) =>
      wrap('append_workspace_media_upload', 'knowledge:write', () =>
        handlers.appendWorkspaceMediaUpload(args),
      )(),
  );

  server.tool(
    'finalize_workspace_media_upload',
    'Step 3 of image upload: assemble all chunks, store media, return media.markdownSnippet. Honors insertIntoRecord from begin. Do not call upload_workspace_media instead. Requires knowledge:write.',
    {
      uploadId: z.string().uuid(),
    },
    async (args) =>
      wrap('finalize_workspace_media_upload', 'knowledge:write', () =>
        handlers.finalizeWorkspaceMediaUpload(args),
      )(),
  );

  server.tool(
    'upload_workspace_media',
    'AVOID for LLM/MCP/ChatGPT clients — single-shot upload often fails when base64 is large. Use begin_workspace_media_upload → append_workspace_media_upload → finalize_workspace_media_upload instead. Kept only for tiny files or non-LLM integrations. contentBase64 = raw base64 (no data: prefix). Requires knowledge:write.',
    {
      workspaceId: z.string().uuid(),
      contentBase64: z.string().min(1).max(10_000_000),
      contentType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
      filename: z.string().min(1).max(200).optional(),
      alt: z.string().max(300).optional(),
      knowledgeRecordId: z.string().uuid().optional(),
      insertIntoRecord: z
        .boolean()
        .optional()
        .describe(
          'When true, requires knowledgeRecordId and appends media.markdownSnippet to that record as a new draft version',
        ),
    },
    async (args) =>
      wrap(
        'upload_workspace_media',
        'knowledge:write',
        () => handlers.uploadWorkspaceMedia(args),
        {
          workspaceId: args.workspaceId,
          recordId: args.knowledgeRecordId,
        },
      )(),
  );

  server.tool(
    'create_knowledge_record',
    'Create a NEW draft topic (knowledge:write; humans approve/mark-current). Prefer list_record_metadata first. Images: begin→append→finalize + media.markdownSnippet — never data:image URIs. NEVER use this for hu/de of an existing record — that creates unlinked duplicates; use create_record_translation.',
    {
      workspaceId: z.string().uuid(),
      title: z.string().min(1).max(300),
      recordType: z.string().min(1).max(64),
      contentMarkdown: z.string().max(500_000),
      summary: z.string().max(1000).optional(),
      slug: z.string().min(1).max(96).optional(),
      projectId: z.string().uuid().optional(),
      systemId: z.string().uuid().optional(),
      tags: z.array(z.string().min(1).max(64)).max(30).optional(),
      language: z.string().min(2).max(16).optional(),
      translationGroupId: z.string().uuid().nullable().optional(),
      generatedByModel: z.string().max(160).optional(),
      sourceTitle: z.string().max(300).optional(),
    },
    async (args) =>
      wrap(
        'create_knowledge_record',
        'knowledge:write',
        () => handlers.createKnowledgeRecord(args),
        {
          workspaceId: args.workspaceId,
          projectId: args.projectId,
          systemId: args.systemId,
        },
      )(),
  );

  server.tool(
    'update_knowledge_record',
    'Update a knowledge record as draft (requires knowledge:write and a changeMessage). For images: begin → append → finalize_workspace_media_upload (not upload_workspace_media); paste media.markdownSnippet or use insertIntoRecord on begin. Never data:image URIs.',
    {
      recordId: z.string().uuid(),
      changeMessage: z.string().min(1).max(500),
      title: z.string().min(1).max(300).optional(),
      summary: z.string().max(1000).nullable().optional(),
      recordType: z.string().min(1).max(64).optional(),
      contentMarkdown: z.string().max(500_000).optional(),
      projectId: z.string().uuid().nullable().optional(),
      systemId: z.string().uuid().nullable().optional(),
      tags: z.array(z.string().min(1).max(64)).max(30).optional(),
      language: z.string().min(2).max(16).nullable().optional(),
      translationGroupId: z.string().uuid().nullable().optional(),
      generatedByModel: z.string().max(160).optional(),
      sourceTitle: z.string().max(300).optional(),
    },
    async (args) =>
      wrap('update_knowledge_record', 'knowledge:write', () =>
        handlers.updateKnowledgeRecord(args),
      )(),
  );

  server.tool(
    'list_workspace_media',
    'List recent workspace media (JPEG/PNG/WebP/GIF) with urls and markdown snippets for embedding. Requires knowledge:read.',
    {
      workspaceId: z.string().uuid(),
      knowledgeRecordId: z.string().uuid().optional(),
      limit: z.number().int().min(1).max(MCP_MAX_LIST_LIMIT).default(20),
    },
    async (args) =>
      wrap(
        'list_workspace_media',
        'knowledge:read',
        () => handlers.listWorkspaceMedia(args),
        { workspaceId: args.workspaceId, recordId: args.knowledgeRecordId },
      )(),
  );

  server.tool(
    'delete_workspace_media',
    'Soft-delete workspace media and remove stored bytes. Requires knowledge:write.',
    {
      mediaId: z.string().uuid(),
    },
    async (args) =>
      wrap('delete_workspace_media', 'knowledge:write', () =>
        handlers.deleteWorkspaceMedia(args),
      )(),
  );

  server.tool(
    'get_platform_status',
    'Redacted platform health snapshot (ready checks, backup ages, MCP error counts). Requires monitoring:read. No secrets or content.',
    {},
    async () =>
      wrap('get_platform_status', 'monitoring:read', () =>
        handlers.getPlatformStatus(),
      )(),
  );

  server.tool(
    'list_project_milestones',
    'List milestones for a project (Project Delivery). Requires pm:read.',
    {
      projectId: z.string().uuid(),
      includeArchived: z.boolean().optional(),
    },
    async (args) =>
      wrap(
        'list_project_milestones',
        'pm:read',
        () => handlers.listProjectMilestones(args),
        { projectId: args.projectId },
      )(),
  );

  server.tool(
    'list_project_tasks',
    'List tasks for a project (optional milestone filter). Includes RACI. Requires pm:read.',
    {
      projectId: z.string().uuid(),
      milestoneId: entityRef.optional(),
      unassignedMilestone: z.boolean().optional(),
      includeArchived: z.boolean().optional(),
    },
    async (args) =>
      wrap(
        'list_project_tasks',
        'pm:read',
        () => handlers.listProjectTasks(args),
        { projectId: args.projectId },
      )(),
  );

  server.tool(
    'get_project_task',
    'Get one project task with RACI. taskId may be a UUID or human key (e.g. HL1-T-12). Requires pm:read.',
    { taskId: entityRef },
    async (args) =>
      wrap('get_project_task', 'pm:read', () => handlers.getProjectTask(args))(),
  );

  const ymdDate = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable();

  server.tool(
    'create_project_milestone',
    'Create a project milestone (live state). Requires pm:write.',
    {
      projectId: z.string().uuid(),
      title: z.string().min(1).max(200),
      description: z.string().max(5000).nullable().optional(),
      status: z.enum(['planned', 'active', 'done', 'cancelled']).optional(),
      startDate: ymdDate.optional(),
      targetDate: ymdDate.optional(),
      sortOrder: z.number().int().min(0).max(100000).optional(),
    },
    async (args) =>
      wrap(
        'create_project_milestone',
        'pm:write',
        () => handlers.createProjectMilestone(args),
        { projectId: args.projectId },
      )(),
  );

  server.tool(
    'update_project_milestone',
    'Update a project milestone (live state). milestoneId may be UUID or human key (e.g. HL1-M-1). Requires pm:write.',
    {
      milestoneId: entityRef,
      title: z.string().min(1).max(200).optional(),
      description: z.string().max(5000).nullable().optional(),
      status: z.enum(['planned', 'active', 'done', 'cancelled']).optional(),
      startDate: ymdDate.optional(),
      targetDate: ymdDate.optional(),
      sortOrder: z.number().int().min(0).max(100000).optional(),
      archived: z.boolean().optional(),
    },
    async (args) =>
      wrap('update_project_milestone', 'pm:write', () =>
        handlers.updateProjectMilestone(args),
      )(),
  );

  server.tool(
    'create_project_task',
    'Create a project task with optional RACI, user story, and current owner. Requires pm:write.',
    {
      projectId: z.string().uuid(),
      title: z.string().min(1).max(200),
      description: z.string().max(10000).nullable().optional(),
      status: z
        .enum(['todo', 'in_progress', 'blocked', 'done', 'cancelled'])
        .optional(),
      dueDate: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .nullable()
        .optional(),
      forecastHours: moneyInput.optional(),
      actualHours: moneyInput.optional(),
      tokensUsed: z.number().int().min(0).nullable().optional(),
      aiSystemId: z.string().uuid().nullable().optional(),
      milestoneId: entityRef.nullable().optional(),
      userStoryId: entityRef.nullable().optional(),
      currentOwnerUserId: z.string().uuid().nullable().optional(),
      sortOrder: z.number().int().min(0).max(100000).optional(),
      raci: z
        .array(
          z.object({
            userId: z.string().uuid(),
            role: z.enum(['R', 'A', 'C', 'I']),
          }),
        )
        .max(50)
        .optional(),
    },
    async (args) =>
      wrap(
        'create_project_task',
        'pm:write',
        () => handlers.createProjectTask(args),
        { projectId: args.projectId },
      )(),
  );

  server.tool(
    'update_project_task',
    'Update a project task fields/status/due date/story/owner/tokens. When an AI assistant completed work, set tokensUsed (+ optional aiSystemId) or use report_project_task_ai_usage. Requires pm:write.',
    {
      taskId: entityRef,
      title: z.string().min(1).max(200).optional(),
      description: z.string().max(10000).nullable().optional(),
      status: z
        .enum(['todo', 'in_progress', 'blocked', 'done', 'cancelled'])
        .optional(),
      dueDate: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .nullable()
        .optional(),
      forecastHours: moneyInput.optional(),
      actualHours: moneyInput.optional(),
      tokensUsed: z.number().int().min(0).nullable().optional(),
      aiSystemId: z.string().uuid().nullable().optional(),
      milestoneId: entityRef.nullable().optional(),
      userStoryId: entityRef.nullable().optional(),
      currentOwnerUserId: z.string().uuid().nullable().optional(),
      sortOrder: z.number().int().min(0).max(100000).optional(),
      archived: z.boolean().optional(),
    },
    async (args) =>
      wrap('update_project_task', 'pm:write', () => handlers.updateProjectTask(args))(),
  );

  server.tool(
    'report_project_task_ai_usage',
    'Record AI token usage on a task (prefer when marking done). Stores tokensUsed and optional aiSystemId, then refreshes the cost snapshot. Billable when the AI system cost mode is flat/api/mixed; note_only records usage at $0. Requires pm:write.',
    {
      taskId: entityRef,
      tokensUsed: z.number().int().min(0),
      aiSystemId: z.string().uuid().nullable().optional(),
    },
    async (args) =>
      wrap('report_project_task_ai_usage', 'pm:write', () =>
        handlers.reportProjectTaskAiUsage(args),
      )(),
  );

  server.tool(
    'set_project_task_raci',
    'Replace the RACI set for a task (workspace members only; at most one A). Requires pm:write.',
    {
      taskId: entityRef,
      entries: z
        .array(
          z.object({
            userId: z.string().uuid(),
            role: z.enum(['R', 'A', 'C', 'I']),
          }),
        )
        .max(50),
    },
    async (args) =>
      wrap('set_project_task_raci', 'pm:write', () =>
        handlers.setProjectTaskRaci(args),
      )(),
  );

  const epicStatusEnum = z.enum(['planned', 'active', 'done', 'cancelled']);

  server.tool(
    'list_project_epics',
    'List epics for a project. Requires pm:read.',
    {
      projectId: z.string().uuid(),
      includeArchived: z.boolean().optional(),
    },
    async (args) =>
      wrap(
        'list_project_epics',
        'pm:read',
        () => handlers.listProjectEpics(args),
        { projectId: args.projectId },
      )(),
  );

  server.tool(
    'create_project_epic',
    'Create a project epic. Requires pm:write.',
    {
      projectId: z.string().uuid(),
      title: z.string().min(1).max(200),
      description: z.string().max(5000).nullable().optional(),
      status: epicStatusEnum.optional(),
      startDate: ymdDate.optional(),
      endDate: ymdDate.optional(),
      sortOrder: z.number().int().min(0).max(100000).optional(),
    },
    async (args) =>
      wrap(
        'create_project_epic',
        'pm:write',
        () => handlers.createProjectEpic(args),
        { projectId: args.projectId },
      )(),
  );

  server.tool(
    'update_project_epic',
    'Update a project epic. Requires pm:write.',
    {
      epicId: entityRef,
      title: z.string().min(1).max(200).optional(),
      description: z.string().max(5000).nullable().optional(),
      status: epicStatusEnum.optional(),
      startDate: ymdDate.optional(),
      endDate: ymdDate.optional(),
      sortOrder: z.number().int().min(0).max(100000).optional(),
      archived: z.boolean().optional(),
    },
    async (args) =>
      wrap('update_project_epic', 'pm:write', () => handlers.updateProjectEpic(args))(),
  );

  server.tool(
    'list_project_user_stories',
    'List user stories for a project (optional epic filter). Requires pm:read.',
    {
      projectId: z.string().uuid(),
      epicId: entityRef.optional(),
      includeArchived: z.boolean().optional(),
    },
    async (args) =>
      wrap(
        'list_project_user_stories',
        'pm:read',
        () => handlers.listProjectUserStories(args),
        { projectId: args.projectId },
      )(),
  );

  server.tool(
    'create_project_user_story',
    'Create a user story under an epic. Requires pm:write.',
    {
      projectId: z.string().uuid(),
      epicId: entityRef,
      title: z.string().min(1).max(200),
      description: z.string().max(5000).nullable().optional(),
      status: epicStatusEnum.optional(),
      startDate: ymdDate.optional(),
      endDate: ymdDate.optional(),
      sortOrder: z.number().int().min(0).max(100000).optional(),
    },
    async (args) =>
      wrap(
        'create_project_user_story',
        'pm:write',
        () => handlers.createProjectUserStory(args),
        { projectId: args.projectId },
      )(),
  );

  server.tool(
    'update_project_user_story',
    'Update a user story. Requires pm:write.',
    {
      storyId: entityRef,
      title: z.string().min(1).max(200).optional(),
      description: z.string().max(5000).nullable().optional(),
      status: epicStatusEnum.optional(),
      epicId: entityRef.optional(),
      startDate: ymdDate.optional(),
      endDate: ymdDate.optional(),
      sortOrder: z.number().int().min(0).max(100000).optional(),
      archived: z.boolean().optional(),
    },
    async (args) =>
      wrap('update_project_user_story', 'pm:write', () =>
        handlers.updateProjectUserStory(args),
      )(),
  );

  server.tool(
    'list_project_task_activities',
    'List activity timeline for a task. Requires pm:read.',
    { taskId: entityRef },
    async (args) =>
      wrap('list_project_task_activities', 'pm:read', () =>
        handlers.listProjectTaskActivities(args),
      )(),
  );

  server.tool(
    'add_project_task_comment',
    'Add a comment to a task activity timeline. Requires pm:write.',
    {
      taskId: entityRef,
      body: z.string().min(1).max(10000),
    },
    async (args) =>
      wrap('add_project_task_comment', 'pm:write', () =>
        handlers.addProjectTaskComment(args),
      )(),
  );

  server.tool(
    'handoff_project_task',
    'Hand off current owner of a task (does not change RACI). Requires pm:write.',
    {
      taskId: entityRef,
      toUserId: z.string().uuid(),
      note: z.string().max(5000).nullable().optional(),
    },
    async (args) =>
      wrap('handoff_project_task', 'pm:write', () =>
        handlers.handoffProjectTask(args),
      )(),
  );

  const stakeholderRoleEnum = z.enum([
    'sponsor',
    'owner',
    'product_owner',
    'tech_lead',
    'contributor',
    'stakeholder',
    'other',
  ]);

  server.tool(
    'list_project_stakeholders',
    'List project stakeholders (roster + owner + RACI-derived) with contact fields. Requires pm:read.',
    { projectId: z.string().uuid() },
    async (args) =>
      wrap(
        'list_project_stakeholders',
        'pm:read',
        () => handlers.listProjectStakeholders(args),
        { projectId: args.projectId },
      )(),
  );

  const engagementEnum = z.enum(['employee', 'contractor']);
  const ymdNullable = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable();

  server.tool(
    'create_project_stakeholder',
    'Add or upsert a durable project stakeholder roster row (hourly rate, engagement, capacity, contract). Requires pm:write.',
    {
      projectId: z.string().uuid(),
      userId: z.string().uuid(),
      projectRole: stakeholderRoleEnum,
      jobTitle: z.string().max(200).nullable().optional(),
      notes: z.string().max(5000).nullable().optional(),
      hourlyRate: moneyInput.optional(),
      reportsToUserId: z.string().uuid().nullable().optional(),
      sortOrder: z.number().int().min(0).max(100000).optional(),
      engagementType: engagementEnum.nullable().optional(),
      assignmentStart: ymdNullable.optional(),
      assignmentEnd: ymdNullable.optional(),
      allocatedDailyHours: moneyInput.optional(),
      contractRef: z.string().max(200).nullable().optional(),
      contractedBudget: moneyInput.optional(),
      contractStart: ymdNullable.optional(),
      contractEnd: ymdNullable.optional(),
    },
    async (args) =>
      wrap(
        'create_project_stakeholder',
        'pm:write',
        () => handlers.createProjectStakeholder(args),
        { projectId: args.projectId },
      )(),
  );

  server.tool(
    'update_project_stakeholder',
    'Update a durable project stakeholder roster row (rate, engagement, capacity, contract). Requires pm:write.',
    {
      stakeholderId: z.string().uuid(),
      projectRole: stakeholderRoleEnum.optional(),
      jobTitle: z.string().max(200).nullable().optional(),
      notes: z.string().max(5000).nullable().optional(),
      hourlyRate: moneyInput.optional(),
      reportsToUserId: z.string().uuid().nullable().optional(),
      sortOrder: z.number().int().min(0).max(100000).optional(),
      engagementType: engagementEnum.nullable().optional(),
      assignmentStart: ymdNullable.optional(),
      assignmentEnd: ymdNullable.optional(),
      allocatedDailyHours: moneyInput.optional(),
      contractRef: z.string().max(200).nullable().optional(),
      contractedBudget: moneyInput.optional(),
      contractStart: ymdNullable.optional(),
      contractEnd: ymdNullable.optional(),
    },
    async (args) =>
      wrap('update_project_stakeholder', 'pm:write', () =>
        handlers.updateProjectStakeholder(args),
      )(),
  );

  server.tool(
    'update_project_ai_assistant_cost',
    'Set AI assistant cost mode (flat|api|mixed|note_only), fees, and soft budget allocation on a project AI system. Requires pm:write.',
    {
      systemId: z.string().uuid(),
      aiCostMode: z
        .enum(['flat', 'api', 'mixed', 'note_only'])
        .nullable()
        .optional(),
      aiFlatMonthlyFee: moneyInput.optional(),
      aiTokenRatePer1k: moneyInput.optional(),
      aiBudgetAllocation: moneyInput.optional(),
    },
    async (args) =>
      wrap('update_project_ai_assistant_cost', 'pm:write', () =>
        handlers.updateProjectAiAssistantCost(args),
      )(),
  );

  server.tool(
    'delete_project_stakeholder',
    'Remove a durable project stakeholder roster row (RACI-derived people remain). Requires pm:write.',
    { stakeholderId: z.string().uuid() },
    async (args) =>
      wrap('delete_project_stakeholder', 'pm:write', () =>
        handlers.deleteProjectStakeholder(args),
      )(),
  );

  const raidKindEnum = z.enum(['risk', 'assumption', 'issue', 'dependency']);
  const raidStatusEnum = z.enum([
    'open',
    'mitigating',
    'accepted',
    'closed',
    'cancelled',
  ]);
  const raidSeverityEnum = z.enum(['low', 'medium', 'high', 'critical']);
  const deliveryEntityEnum = z.enum(['epic', 'user_story', 'task']);

  server.tool(
    'list_project_raid_items',
    'List RAID register items (risks, assumptions, issues, dependencies) for a project. Requires pm:read.',
    {
      projectId: z.string().uuid(),
      includeArchived: z.boolean().optional(),
    },
    async (args) =>
      wrap(
        'list_project_raid_items',
        'pm:read',
        () => handlers.listProjectRaidItems(args),
        { projectId: args.projectId },
      )(),
  );

  server.tool(
    'create_project_raid_item',
    'Create a RAID register item and optionally link delivery tasks. Requires pm:write.',
    {
      projectId: z.string().uuid(),
      kind: raidKindEnum,
      title: z.string().min(1).max(300),
      description: z.string().max(10000).nullable().optional(),
      status: raidStatusEnum.optional(),
      severity: raidSeverityEnum.optional(),
      ownerUserId: z.string().uuid().nullable().optional(),
      dueDate: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .nullable()
        .optional(),
      sortOrder: z.number().int().min(0).max(100000).optional(),
      taskIds: z.array(entityRef).max(100).optional(),
    },
    async (args) =>
      wrap(
        'create_project_raid_item',
        'pm:write',
        () => handlers.createProjectRaidItem(args),
        { projectId: args.projectId },
      )(),
  );

  server.tool(
    'update_project_raid_item',
    'Update a RAID register item. raidItemId may be UUID or human key. Do not change kind between risk and issue — use transfer_project_raid_item. Requires pm:write.',
    {
      raidItemId: entityRef,
      kind: raidKindEnum.optional(),
      title: z.string().min(1).max(300).optional(),
      description: z.string().max(10000).nullable().optional(),
      status: raidStatusEnum.optional(),
      severity: raidSeverityEnum.optional(),
      ownerUserId: z.string().uuid().nullable().optional(),
      dueDate: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .nullable()
        .optional(),
      sortOrder: z.number().int().min(0).max(100000).optional(),
      archived: z.boolean().optional(),
    },
    async (args) =>
      wrap('update_project_raid_item', 'pm:write', () =>
        handlers.updateProjectRaidItem(args),
      )(),
  );

  server.tool(
    'transfer_project_raid_item',
    'Transfer a RAID risk to a new issue (or issue to a new risk): copies fields and task links, archives the source, and links both via transfer FKs. Requires pm:write.',
    {
      raidItemId: entityRef,
      targetKind: z.enum(['issue', 'risk']),
    },
    async (args) =>
      wrap('transfer_project_raid_item', 'pm:write', () =>
        handlers.transferProjectRaidItem(args),
      )(),
  );

  server.tool(
    'set_project_raid_task_links',
    'Replace the set of delivery tasks linked to a RAID item. Requires pm:write.',
    {
      raidItemId: entityRef,
      taskIds: z.array(entityRef).max(100),
    },
    async (args) =>
      wrap('set_project_raid_task_links', 'pm:write', () =>
        handlers.setProjectRaidTaskLinks(args),
      )(),
  );

  const changeKindEnum = z.enum([
    'scope',
    'timeline',
    'stakeholder',
    'budget',
    'other',
  ]);
  const changeStatusEnum = z.enum([
    'proposed',
    'approved',
    'rejected',
    'implemented',
    'cancelled',
  ]);
  const changeDeliveryEntityEnum = z.enum([
    'epic',
    'user_story',
    'milestone',
    'task',
  ]);

  server.tool(
    'list_project_change_items',
    'List change-management register items for a project. Requires pm:read.',
    {
      projectId: z.string().uuid(),
      includeArchived: z.boolean().optional(),
    },
    async (args) =>
      wrap(
        'list_project_change_items',
        'pm:read',
        () => handlers.listProjectChangeItems(args),
        { projectId: args.projectId },
      )(),
  );

  server.tool(
    'create_project_change_item',
    'Create a change-management item with optional delivery links. Requires pm:write.',
    {
      projectId: z.string().uuid(),
      kind: changeKindEnum,
      title: z.string().min(1).max(300),
      description: z.string().max(10000).nullable().optional(),
      rationale: z.string().max(10000).nullable().optional(),
      status: changeStatusEnum.optional(),
      requestedByUserId: z.string().uuid().nullable().optional(),
      approvedByUserId: z.string().uuid().nullable().optional(),
      effectiveDate: ymdDate.optional(),
      baselineStartBefore: ymdDate.optional(),
      baselineStartAfter: ymdDate.optional(),
      baselineEndBefore: ymdDate.optional(),
      baselineEndAfter: ymdDate.optional(),
      knowledgeRecordId: z.string().uuid().nullable().optional(),
      sortOrder: z.number().int().min(0).max(100000).optional(),
      deliveryLinks: z
        .array(
          z.object({
            entityType: changeDeliveryEntityEnum,
            entityId: z.string().uuid(),
          }),
        )
        .max(200)
        .optional(),
    },
    async (args) =>
      wrap(
        'create_project_change_item',
        'pm:write',
        () => handlers.createProjectChangeItem(args),
        { projectId: args.projectId },
      )(),
  );

  server.tool(
    'update_project_change_item',
    'Update a change-management item. Requires pm:write.',
    {
      changeId: entityRef,
      kind: changeKindEnum.optional(),
      title: z.string().min(1).max(300).optional(),
      description: z.string().max(10000).nullable().optional(),
      rationale: z.string().max(10000).nullable().optional(),
      status: changeStatusEnum.optional(),
      requestedByUserId: z.string().uuid().nullable().optional(),
      approvedByUserId: z.string().uuid().nullable().optional(),
      effectiveDate: ymdDate.optional(),
      baselineStartBefore: ymdDate.optional(),
      baselineStartAfter: ymdDate.optional(),
      baselineEndBefore: ymdDate.optional(),
      baselineEndAfter: ymdDate.optional(),
      knowledgeRecordId: z.string().uuid().nullable().optional(),
      sortOrder: z.number().int().min(0).max(100000).optional(),
      archived: z.boolean().optional(),
      deliveryLinks: z
        .array(
          z.object({
            entityType: changeDeliveryEntityEnum,
            entityId: z.string().uuid(),
          }),
        )
        .max(200)
        .optional(),
    },
    async (args) =>
      wrap('update_project_change_item', 'pm:write', () =>
        handlers.updateProjectChangeItem(args),
      )(),
  );

  server.tool(
    'get_knowledge_record_delivery_links',
    'List delivery entity links (epic / user story / task) for a knowledge record. Requires knowledge:read.',
    { recordId: z.string().uuid() },
    async (args) =>
      wrap(
        'get_knowledge_record_delivery_links',
        'knowledge:read',
        () => handlers.getKnowledgeRecordDeliveryLinks(args),
        { recordId: args.recordId },
      )(),
  );

  server.tool(
    'set_knowledge_record_delivery_links',
    'Replace delivery entity links for a project-scoped knowledge record. Requires knowledge:write.',
    {
      recordId: z.string().uuid(),
      links: z
        .array(
          z.object({
            entityType: deliveryEntityEnum,
            entityId: z.string().uuid(),
          }),
        )
        .max(200),
    },
    async (args) =>
      wrap(
        'set_knowledge_record_delivery_links',
        'knowledge:write',
        () => handlers.setKnowledgeRecordDeliveryLinks(args),
        { recordId: args.recordId },
      )(),
  );

  return server;
}
