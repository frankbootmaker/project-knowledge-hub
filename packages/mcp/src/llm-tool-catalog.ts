/**
 * Shared LLM / OpenAPI / Gemini tool catalog.
 * ChatGPT Actions hard-limit ~30 operations — mark a curated subset with openApi: true
 * and expose the rest via call_hub_tool.
 */

import { AppError, RECORD_TYPES } from '@project-knowledge-hub/domain';
import { hasMcpScope, type McpScope } from './scopes.js';
import {
  annotateRequiredFieldDescriptions,
  assertToolInput,
  type ToolInputSchema,
} from './tool-input.js';

export type LlmToolDef = {
  name: string;
  description: string;
  scope: McpScope;
  /** Draft/live write tool. */
  write?: boolean;
  /**
   * Include as a first-class OpenAPI path (ChatGPT Actions ≤30 ops).
   * Tools without this flag remain available via call_hub_tool / Gemini / native MCP.
   */
  openApi?: boolean;
  body: Record<string, unknown>;
  /** JSON Schema of a successful result, when the shape is stable. */
  output?: Record<string, unknown>;
  /** Merged into the request body before invoking the MCP handler. */
  defaults?: Record<string, unknown>;
};

function uuidProp(description: string) {
  return { type: 'string', format: 'uuid', description };
}

function entityRefProp(description: string) {
  return {
    type: 'string',
    minLength: 1,
    maxLength: 80,
    description: `${description} (UUID or human key, e.g. HL1-T-12 / HL1-B-4)`,
  };
}

function stringProp(description: string, opts?: { minLength?: number; maxLength?: number }) {
  return {
    type: 'string',
    description,
    ...(opts?.minLength != null ? { minLength: opts.minLength } : {}),
    ...(opts?.maxLength != null ? { maxLength: opts.maxLength } : {}),
  };
}

const ymd = {
  type: 'string',
  pattern: '^\\d{4}-\\d{2}-\\d{2}$',
  description: 'Date YYYY-MM-DD',
};

const money = {
  oneOf: [{ type: 'number' }, { type: 'string' }],
  nullable: true,
  description: 'Money or hours amount',
};

/** Read models return money as a JSON number (PRO-T-6). Inputs may still accept a string. */
const moneyNumber = {
  type: 'number',
  nullable: true,
  description: 'Money amount as a JSON number. Null when unset.',
};

const ragStatus = {
  type: 'string',
  enum: ['green', 'amber', 'red'],
};

const riskReasonOutput = {
  type: 'object',
  additionalProperties: false,
  required: ['count', 'severity', 'kind', 'cause'],
  description:
    'One grouped reason for an amber or red risk RAG. dueInDays is present only when cause is due_soon (0 means due today).',
  properties: {
    count: { type: 'integer', minimum: 1, description: 'Open or mitigating items in this group.' },
    severity: { type: 'string', description: 'RAID severity: critical, high, medium, or low.' },
    kind: {
      type: 'string',
      description: 'RAID kind: risk, assumption, issue, or dependency.',
    },
    cause: {
      type: 'string',
      enum: ['issue', 'overdue', 'due_soon', 'severity'],
      description:
        'issue: critical materialised issue. overdue: due before today. due_soon: due within 7 days. severity: critical or high that is not near its due date.',
    },
    dueInDays: {
      type: 'integer',
      minimum: 0,
      description: 'Calendar days until due. Only for cause due_soon.',
    },
  },
};

const projectHealthOutput = {
  type: 'object',
  additionalProperties: false,
  required: ['overall', 'timeline', 'risk', 'financial', 'riskReasons'],
  description:
    'Delivery health. status is the lifecycle stage; health.overall is the RAG. financial is null when the budget summary failed. riskReasons explains an amber or red risk RAG and is empty when risk is green.',
  properties: {
    overall: {
      ...ragStatus,
      description: 'Worst of timeline, risk, and financial.',
    },
    timeline: {
      ...ragStatus,
      description: 'Schedule RAG. Amber when due within 7 days.',
    },
    risk: {
      ...ragStatus,
      description:
        'Open or mitigating RAID RAG. Red: critical overdue, due within 7 days, or kind issue; or high overdue. Amber: any other critical (later or no due date), any other high, or any overdue item. Green otherwise. Closed, accepted, cancelled, and archived items are ignored.',
    },
    financial: {
      ...ragStatus,
      nullable: true,
      description: 'Budget RAG. Null when the budget summary failed.',
    },
    riskReasons: {
      type: 'array',
      description:
        'Why risk is amber or red. Same rule as get_project_budget_summary riskRag. Empty when risk is green.',
      items: riskReasonOutput,
    },
  },
};

const taskStatus = {
  type: 'string',
  enum: ['todo', 'in_progress', 'blocked', 'done', 'cancelled'],
};

const taskItemType = {
  type: 'string',
  enum: ['task', 'bug'],
  description: 'Work item type. Set at create. task uses a T key, bug uses a B key.',
};

const bugFields = {
  itemType: taskItemType,
  severity: {
    type: 'string',
    enum: ['low', 'medium', 'high', 'critical'],
    nullable: true,
    description: 'Bug severity. Defaults to medium. Rejected on a task.',
  },
  foundIn: {
    type: 'string',
    enum: ['development', 'test', 'staging', 'production'],
    nullable: true,
  },
  foundInNote: {
    type: 'string',
    maxLength: 200,
    nullable: true,
    description: 'Build or version where the bug was found.',
  },
  stepsToReproduce: { type: 'string', maxLength: 10000, nullable: true },
  expectedBehavior: { type: 'string', maxLength: 10000, nullable: true },
  actualBehavior: { type: 'string', maxLength: 10000, nullable: true },
  resolution: {
    type: 'string',
    enum: [
      'fixed',
      'duplicate',
      'wont_fix',
      'cannot_reproduce',
      'works_as_designed',
    ],
    nullable: true,
  },
  regression: { type: 'boolean', nullable: true },
  affectedSystemId: {
    type: 'string',
    format: 'uuid',
    nullable: true,
    description: 'Catalogue system linked to the project.',
  },
  duplicateOfTaskId: {
    ...entityRefProp('Bug this duplicates. UUID or human key. Only when resolution is duplicate.'),
    nullable: true,
  },
};

const milestoneStatus = {
  type: 'string',
  enum: ['planned', 'active', 'in_progress', 'blocked', 'done', 'cancelled'],
  description:
    'Derived from included links when any remain: done, blocked, in_progress, or planned. Otherwise the stored status, including active.',
};

const epicStatus = {
  type: 'string',
  enum: ['planned', 'active', 'in_progress', 'blocked', 'done', 'cancelled'],
  description:
    'Derived from included child tasks and bugs when any remain: done, blocked, in_progress, or planned. Otherwise the stored status, including active.',
};

const sprintStatus = {
  type: 'string',
  enum: ['planned', 'active', 'completed', 'cancelled'],
};

const raciRole = { type: 'string', enum: ['R', 'A', 'C', 'I'] };

const nullableString = { type: 'string', nullable: true };

const pinnedRecordOutput = {
  type: 'object',
  nullable: true,
  additionalProperties: false,
  required: ['id', 'title', 'slug', 'recordType'],
  properties: {
    id: uuidProp('Pinned knowledge record id'),
    title: stringProp('Record title'),
    slug: stringProp('Record slug'),
    recordType: stringProp('Knowledge record type'),
  },
};

/** Shared result of get_project and update_project_baseline. */
const projectBaselineResult = {
  type: 'object',
  required: ['project'],
  additionalProperties: false,
  properties: {
    project: {
      type: 'object',
      additionalProperties: false,
      required: [
        'id',
        'workspaceId',
        'name',
        'slug',
        'status',
        'summary',
        'description',
        'startDate',
        'endDate',
        'hoursPerWorkday',
        'workdaysPerWeek',
        'nonWorkingDays',
        'finishDate',
        'durationWorkingDays',
        'charterRecordId',
        'charterRecord',
        'initialPlanRecordId',
        'initialPlanRecord',
        'definitionOfDone',
        'currency',
        'initialBudget',
        'approvedBudget',
        'keyPrefix',
        'methodology',
        'createdVia',
        'createdByApiClientId',
        'createdByOauthGrantId',
        'createdByUserId',
        'generatedByModel',
        'scheduleSlipRiskEnabled',
        'scheduleSlipThresholdDays',
        'scheduleSlipItemTypes',
        'url',
        'health',
      ],
      properties: {
        id: uuidProp('Project id'),
        workspaceId: uuidProp('Workspace id'),
        workspaceName: { type: 'string', nullable: true, description: 'Workspace name' },
        workspaceSlug: { type: 'string', nullable: true, description: 'Workspace slug' },
        name: stringProp('Project name'),
        slug: stringProp('Project slug'),
        status: stringProp('Lifecycle stage (idea, planned, active, …). Not the RAG.'),
        health: projectHealthOutput,
        summary: nullableString,
        description: nullableString,
        startDate: { ...ymd, nullable: true },
        endDate: { ...ymd, nullable: true },
        hoursPerWorkday: {
          type: 'number',
          exclusiveMinimum: 0,
          maximum: 24,
          description: 'Hours in one working day. Default 8.',
        },
        workdaysPerWeek: {
          type: 'integer',
          minimum: 1,
          maximum: 7,
          description: 'Monday-first working days. 5 is Monday–Friday. 7 is every day.',
        },
        nonWorkingDays: {
          type: 'array',
          items: ymd,
          description: 'Public holidays and other non-working dates (YYYY-MM-DD).',
        },
        finishDate: {
          ...ymd,
          nullable: true,
          description: 'Latest scheduled delivery finish. Calculated. Not an input.',
        },
        durationWorkingDays: {
          type: 'integer',
          nullable: true,
          description:
            'Working days from the earliest scheduled start to finishDate. Calculated. Not an input.',
        },
        charterRecordId: { ...uuidProp('Pinned charter id'), nullable: true },
        charterRecord: pinnedRecordOutput,
        initialPlanRecordId: { ...uuidProp('Pinned plan id'), nullable: true },
        initialPlanRecord: pinnedRecordOutput,
        definitionOfDone: {
          type: 'string',
          nullable: true,
          maxLength: 20000,
          description: 'Scrum Definition of Done. Null when unset.',
        },
        currency: stringProp('Project currency'),
        initialBudget: moneyNumber,
        approvedBudget: moneyNumber,
        keyPrefix: {
          type: 'string',
          nullable: true,
          description: 'Issue key prefix AAA or AA0',
        },
        methodology: {
          type: 'string',
          nullable: true,
          enum: ['scrum', 'kanban', 'waterfall', 'hybrid'],
          description: 'Delivery approach. Null when unset.',
        },
        createdVia: {
          type: 'string',
          nullable: true,
          enum: ['mcp'],
          description: 'mcp when an agent created the project. Null for a human-created project.',
        },
        createdByApiClientId: {
          type: 'string',
          nullable: true,
          description:
            'Bearer API client id when that client created the project. Null for OAuth grants.',
        },
        createdByOauthGrantId: {
          type: 'string',
          nullable: true,
          description:
            'OAuth grant id when ChatGPT created the project. Null for bearer clients.',
        },
        createdByUserId: {
          type: 'string',
          nullable: true,
          description: 'Acting user id when created via MCP.',
        },
        generatedByModel: {
          type: 'string',
          nullable: true,
          description: 'Model id supplied at MCP create. Null when unset.',
        },
        scheduleSlipRiskEnabled: {
          type: 'boolean',
          description: 'When true, a slipping delivery item raises one open RAID risk.',
        },
        scheduleSlipThresholdDays: {
          type: 'integer',
          minimum: 1,
          maximum: 3650,
          description: 'Minimum working days of slip before that risk is raised.',
        },
        scheduleSlipItemTypes: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['task', 'user_story', 'epic', 'milestone'],
          },
          description: 'Delivery types watched for a schedule slip.',
        },
        url: {
          type: 'string',
          nullable: true,
          description: 'Hub URL for the project.',
        },
      },
    },
  },
};

const targetPercentProp = {
  type: 'integer',
  minimum: 0,
  maximum: 100,
  nullable: true,
  description:
    'Planned percent from start through end. 0 on the start day, 100 on the end day. Null when the window is missing. Read-only.',
};

const parentScheduleProps = {
  startDate: {
    ...ymd,
    nullable: true,
    description: 'YYYY-MM-DD. Child rollup when startDateDerived is true.',
  },
  endDate: {
    ...ymd,
    nullable: true,
    description: 'YYYY-MM-DD. Child rollup when endDateDerived is true.',
  },
  startDateDerived: {
    type: 'boolean',
    description: 'True when startDate comes from included children. Read-only.',
  },
  endDateDerived: {
    type: 'boolean',
    description: 'True when endDate comes from included children. Read-only.',
  },
  targetPercent: targetPercentProp,
};

const pageProps = {
  total: { type: 'integer', description: 'Total rows matching the filter.' },
  limit: { type: 'integer', description: 'Page size used for this response.' },
  nextCursor: {
    type: 'string',
    nullable: true,
    description: 'Pass as cursor to read the next page. Null when hasMore is false.',
  },
  hasMore: { type: 'boolean' },
};

function pagedResult(rowKey: string, item: Record<string, unknown>) {
  return {
    type: 'object',
    required: [rowKey, 'total', 'limit', 'nextCursor', 'hasMore'],
    properties: {
      [rowKey]: { type: 'array', items: item },
      ...pageProps,
    },
  };
}

function wrappedResult(key: string, item: Record<string, unknown>) {
  return {
    type: 'object',
    required: [key],
    properties: { [key]: item },
  };
}

const taskRowResult = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    startDate: {
      ...ymd,
      nullable: true,
      description: 'Stored start date. Writable.',
    },
    completionPercent: {
      type: 'integer',
      minimum: 0,
      maximum: 100,
      nullable: true,
      description: 'Displayed percent. Done is 100, cancelled is 0.',
    },
    targetPercent: {
      type: 'integer',
      minimum: 0,
      maximum: 100,
      nullable: true,
      description: 'Tasks have no planned target. Always null.',
    },
  },
};

const parentRowResult = {
  type: 'object',
  required: [
    'id',
    'startDate',
    'endDate',
    'startDateDerived',
    'endDateDerived',
    'targetPercent',
  ],
  properties: {
    id: { type: 'string' },
    ...parentScheduleProps,
  },
};

const milestoneRowResult = {
  type: 'object',
  required: ['id', 'startDate', 'targetDate', 'targetPercent'],
  properties: {
    id: { type: 'string' },
    startDate: {
      ...ymd,
      nullable: true,
      description: 'Stored start date. Writable. Not derived from linked items.',
    },
    targetDate: {
      ...ymd,
      nullable: true,
      description: 'Stored due date. Writable. Not derived from linked items.',
    },
    targetPercent: {
      type: 'integer',
      minimum: 0,
      maximum: 100,
      nullable: true,
      description: 'Milestones have no planned target. Always null.',
    },
  },
};

const dependencyLinkResult = {
  type: 'object',
  required: ['id', 'linkType', 'lagDays'],
  properties: {
    id: { type: 'string' },
    linkType: { type: 'string', enum: ['FS', 'SS', 'FF', 'SF'] },
    lagDays: {
      type: 'integer',
      minimum: -3650,
      maximum: 3650,
      description: 'Whole days. Negative is a lead.',
    },
  },
};

const projectMethodology = {
  type: 'string',
  enum: ['scrum', 'kanban', 'waterfall', 'hybrid'],
  description: 'scrum, kanban, waterfall, or hybrid',
};

const projectStage = {
  type: 'string',
  enum: ['idea', 'planned', 'active', 'maintenance', 'paused', 'completed', 'archived'],
  description: 'Lifecycle stage. MCP creates are idea until a human promotes them.',
};

/** Paged list_project_tasks result. nextCursor is null on the last page. */
const taskListPageResult = {
  type: 'object',
  required: ['tasks', 'total', 'limit', 'nextCursor', 'hasMore'],
  properties: {
    tasks: {
      type: 'array',
      description:
        'Task or bug rows. Descriptions and bug notes are excerpts. startDate is writable. targetPercent is null.',
      items: taskRowResult,
    },
    total: { type: 'integer', description: 'Total rows matching the filter.' },
    limit: { type: 'integer', description: 'Page size used for this response.' },
    nextCursor: {
      type: 'string',
      nullable: true,
      description: 'Pass as cursor to read the next page. Null when hasMore is false.',
    },
    hasMore: { type: 'boolean' },
  },
};

const recordLinkedItem = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'humanKey', 'title', 'type', 'kind', 'projectId', 'projectSlug'],
  properties: {
    id: uuidProp('Item id'),
    humanKey: {
      type: 'string',
      nullable: true,
      description: 'Human key such as HL1-T-1',
    },
    title: stringProp('Item title'),
    type: {
      type: 'string',
      enum: ['epic', 'user_story', 'milestone', 'task', 'sprint', 'raid', 'change'],
      description: 'Bugs stay type task. kind is bug.',
    },
    kind: {
      type: 'string',
      nullable: true,
      description: 'Task item type, RAID kind, or change kind. Null for other delivery types.',
    },
    projectId: uuidProp('Project id'),
    projectSlug: stringProp('Project slug'),
  },
};

/** get_knowledge_record output. Later pages omit linkedItems. recordRelations stays on every page. */
const knowledgeRecordResult = {
  type: 'object',
  required: ['knowledgeRecord'],
  additionalProperties: false,
  properties: {
    knowledgeRecord: {
      type: 'object',
      required: ['id'],
      additionalProperties: true,
      properties: {
        id: uuidProp('Knowledge record id'),
        recordRelations: {
          type: 'object',
          additionalProperties: false,
          description:
            'Counts plus up to cap related records. Present on every page unless includeRecordRelations is false.',
          required: ['outboundCount', 'inboundCount', 'cap', 'truncated', 'items'],
          properties: {
            outboundCount: { type: 'integer' },
            inboundCount: { type: 'integer' },
            cap: { type: 'integer' },
            truncated: { type: 'boolean' },
            items: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['direction', 'relationType', 'record'],
                properties: {
                  direction: { type: 'string', enum: ['outbound', 'inbound'] },
                  relationType: { type: 'string' },
                  record: {
                    type: 'object',
                    additionalProperties: false,
                    required: [
                      'id',
                      'humanKey',
                      'title',
                      'recordType',
                      'lifecycleStatus',
                      'archivedAt',
                    ],
                    properties: {
                      id: { type: 'string' },
                      humanKey: { type: 'string', nullable: true },
                      title: { type: 'string' },
                      recordType: { type: 'string' },
                      lifecycleStatus: { type: 'string' },
                      archivedAt: { type: 'string', nullable: true },
                    },
                  },
                },
              },
            },
          },
        },
        linkedItems: {
          type: 'object',
          additionalProperties: false,
          required: ['deliveryLinks', 'raidLinks', 'changeItems'],
          description:
            'Same-project reverse links. Present on the first page only. Archived items are omitted.',
          properties: {
            deliveryLinks: {
              type: 'array',
              items: recordLinkedItem,
              description: 'Epics, stories, milestones, tasks, bugs, and sprints.',
            },
            raidLinks: {
              type: 'array',
              items: recordLinkedItem,
              description: 'RAID items. Archived rows are omitted.',
            },
            changeItems: {
              type: 'array',
              items: recordLinkedItem,
              description: 'Change items linked through project_change_record_links.',
            },
          },
        },
      },
    },
  },
};

/** Full tool surface for Gemini + call_hub_tool. */
export const LLM_TOOL_CATALOG: LlmToolDef[] = [
  // —— Knowledge / catalogue (OpenAPI first-class) ——
  {
    name: 'list_projects',
    description:
      'List accessible projects. status is the lifecycle stage. health.overall is the RAG (worst of timeline, risk, and financial). health.riskReasons explains an amber or red risk RAG and is empty when risk is green. Filter by status or stage (idea, planned, active, maintenance, paused, completed, archived).',
    scope: 'projects:read',
    openApi: true,
    defaults: { limit: 50 },
    body: {
      type: 'object',
      additionalProperties: false,
      properties: {
        workspaceId: uuidProp('Optional workspace filter'),
        workspaceSlug: stringProp('Optional workspace slug', { maxLength: 64 }),
        status: projectStage,
        stage: projectStage,
        limit: { type: 'integer', minimum: 1, maximum: 50, description: 'Max results' },
      },
    },
  },
  {
    name: 'list_systems',
    description:
      'List accessible systems (type, environment, criticality, version, primaryUrl). Requires systems:read.',
    scope: 'systems:read',
    openApi: true,
    defaults: { limit: 50 },
    body: {
      type: 'object',
      properties: {
        workspaceId: uuidProp('Optional workspace filter'),
        projectId: uuidProp('Optional project filter'),
        limit: { type: 'integer', minimum: 1, maximum: 50, description: 'Max results' },
      },
    },
  },
  {
    name: 'get_project',
    description:
      'Get a project by id. projectId (UUID) is required. status is the lifecycle stage. health.overall is the RAG (worst of timeline, risk, and financial; financial is null when the budget summary failed). health.riskReasons explains an amber or red risk RAG (empty when green) using the same rule as get_project_budget_summary riskRag. Returns baseline, working calendar, finishDate, durationWorkingDays, definitionOfDone, keyPrefix, budgets, methodology, url, health, and MCP provenance (createdVia, createdByApiClientId, createdByOauthGrantId, createdByUserId, generatedByModel).',
    scope: 'projects:read',
    openApi: true,
    output: projectBaselineResult,
    body: {
      type: 'object',
      required: ['projectId'],
      properties: { projectId: uuidProp('Project id') },
    },
  },
  {
    name: 'get_system',
    description:
      'Get a catalogue system including description, tags, owner, and itDetails inventory. Requires systems:read.',
    scope: 'systems:read',
    openApi: true,
    body: {
      type: 'object',
      required: ['systemId'],
      properties: { systemId: uuidProp('System id') },
    },
  },
  {
    name: 'list_knowledge_records',
    description:
      'List knowledge records (excludes archived). Prefer language en unless asked otherwise. Returns humanKey when present and tags as a string array of tag names (same shape as search_knowledge).',
    scope: 'knowledge:read',
    openApi: true,
    defaults: { limit: 50 },
    body: {
      type: 'object',
      required: ['workspaceId'],
      properties: {
        workspaceId: uuidProp('Workspace id'),
        projectId: uuidProp('Optional project filter'),
        systemId: uuidProp('Optional system filter'),
        language: stringProp('Optional content language filter', {
          minLength: 2,
          maxLength: 16,
        }),
        limit: { type: 'integer', minimum: 1, maximum: 50 },
      },
    },
  },
  {
    name: 'search_knowledge',
    description: 'Search knowledge records (fts or hybrid). Prefer language en unless asked.',
    scope: 'knowledge:search',
    openApi: true,
    defaults: { limit: 10 },
    body: {
      type: 'object',
      required: ['workspaceId', 'query'],
      properties: {
        workspaceId: uuidProp('Workspace id'),
        query: stringProp('Search query', { minLength: 1, maxLength: 300 }),
        projectIds: { type: 'array', items: { type: 'string', format: 'uuid' } },
        systemIds: { type: 'array', items: { type: 'string', format: 'uuid' } },
        recordTypes: { type: 'array', items: { type: 'string' } },
        statuses: { type: 'array', items: { type: 'string' } },
        language: stringProp('Optional language', { minLength: 2, maxLength: 16 }),
        limit: { type: 'integer', minimum: 1, maximum: 50 },
        mode: { type: 'string', enum: ['fts', 'hybrid'] },
      },
    },
  },
  {
    name: 'get_knowledge_record',
    description:
      'Get a knowledge record (paged markdown). Tags, media, and linkedItems are on the first page only. linkedItems has deliveryLinks, raidLinks, and changeItems for the same project. Archived RAID, change, and delivery items are omitted. Each page is at most 50,000 characters. contentLength is the full length and contentSha256 hashes the full body. When contentTruncated is true, call again with contentOffset set to nextOffset until nextOffset is null before rewriting the record. With contentOffset or contentLimit, pages are raw slices (concatenate contentMarkdown); chunkIndex is the 0-based page index (ceil(contentOffset/contentLimit) after the first). The default call without those params still ends the first page with …[truncated] when more remains. Pass expectSha256 to get 409 when the body changed. boundary snaps the cut (none, paragraph, or line). Read pixels with call_hub_tool get_workspace_media. recordId may be UUID or document key. recordRelations (counts and up to 20 summaries) is included on every page unless includeRecordRelations is false.',
    scope: 'knowledge:read',
    openApi: true,
    output: knowledgeRecordResult,
    body: {
      type: 'object',
      required: ['recordId'],
      properties: {
        recordId: entityRefProp('Knowledge record id'),
        contentOffset: {
          type: 'integer',
          minimum: 0,
          description: 'Character offset. Omit or use 0 for the first page. Then use nextOffset.',
        },
        contentLimit: {
          type: 'integer',
          minimum: 1,
          maximum: 50_000,
          description: 'Max characters in this page. Defaults to 50000.',
        },
        boundary: {
          type: 'string',
          enum: ['none', 'paragraph', 'line'],
          description:
            'Where to end the page. none is a hard cut. paragraph or line snaps to a break in the second half of the window.',
        },
        expectSha256: {
          type: 'string',
          minLength: 64,
          maxLength: 64,
          description: 'SHA-256 hex of the full body. 409 CONTENT_CHANGED when it does not match.',
        },
        includeRecordRelations: {
          type: 'boolean',
          description:
            'Include compact recordRelations. Defaults to true. Set false to omit them.',
        },
      },
    },
  },
  {
    name: 'list_record_metadata',
    description:
      'Field guides, allowed recordType values, and media upload workflow. Call before create_knowledge_record.',
    scope: 'knowledge:read',
    openApi: true,
    body: { type: 'object', properties: {} },
  },
  {
    name: 'create_knowledge_record',
    description:
      'Create a NEW draft knowledge topic (not a delivery task). For locale siblings use create_record_translation. Requires knowledge:write.',
    scope: 'knowledge:write',
    write: true,
    openApi: true,
    body: {
      type: 'object',
      required: ['workspaceId', 'title', 'recordType', 'contentMarkdown'],
      properties: {
        workspaceId: uuidProp('Workspace id'),
        title: stringProp('Title', { minLength: 1, maxLength: 300 }),
        recordType: {
          type: 'string',
          enum: [...RECORD_TYPES],
          description: 'From list_record_metadata — not a delivery task type',
        },
        contentMarkdown: stringProp('Markdown body', { maxLength: 500_000 }),
        summary: stringProp('Optional summary', { maxLength: 1000 }),
        slug: stringProp('Optional slug', { minLength: 1, maxLength: 96 }),
        projectId: uuidProp('Optional project id'),
        systemId: uuidProp('Optional system id'),
        tags: {
          type: 'array',
          items: { type: 'string', minLength: 1, maxLength: 64 },
          maxItems: 30,
        },
        language: stringProp('Language for a brand-new topic', {
          minLength: 2,
          maxLength: 16,
        }),
        generatedByModel: stringProp('Optional model name', { maxLength: 160 }),
        sourceTitle: stringProp('Optional source title', { maxLength: 300 }),
      },
    },
  },
  {
    name: 'create_record_translation',
    description:
      'Create a linked locale sibling (hu/de/…). Prefer translateWithAi when hub AI is configured. Requires knowledge:write.',
    scope: 'knowledge:write',
    write: true,
    openApi: true,
    body: {
      type: 'object',
      required: ['recordId', 'language'],
      properties: {
        recordId: entityRefProp('Source knowledge record'),
        language: stringProp('Target language (e.g. hu, de)', {
          minLength: 2,
          maxLength: 16,
        }),
        slug: stringProp('Optional slug', { minLength: 1, maxLength: 96 }),
        translateWithAi: { type: 'boolean' },
        title: stringProp('Translated title when AI is off', {
          minLength: 1,
          maxLength: 300,
        }),
        summary: { type: 'string', nullable: true, maxLength: 1000 },
        contentMarkdown: stringProp('Translated body when AI is off', {
          maxLength: 500_000,
        }),
      },
    },
  },
  {
    name: 'update_knowledge_record',
    description:
      'Update a knowledge record. Content edits stay draft. Send the full markdown body; a value ending in the get_knowledge_record truncation marker is rejected. Page that read until nextOffset is null before rewriting. archived=true sets archivedAt and leaves lifecycleStatus unchanged. Optional slug renames the URL (lowercase a-z, 0-9, hyphens). Requires knowledge:write.',
    scope: 'knowledge:write',
    write: true,
    openApi: true,
    body: {
      type: 'object',
      required: ['recordId', 'changeMessage'],
      properties: {
        recordId: entityRefProp('Knowledge record id'),
        changeMessage: stringProp('Why this change was made', {
          minLength: 1,
          maxLength: 500,
        }),
        title: stringProp('Title', { minLength: 1, maxLength: 300 }),
        slug: stringProp('URL slug (lowercase a-z, 0-9, hyphens)', {
          minLength: 1,
          maxLength: 96,
        }),
        summary: { type: 'string', nullable: true, maxLength: 1000 },
        recordType: { type: 'string', enum: [...RECORD_TYPES] },
        contentMarkdown: stringProp('Markdown body', { maxLength: 500_000 }),
        projectId: { type: 'string', format: 'uuid', nullable: true },
        systemId: { type: 'string', format: 'uuid', nullable: true },
        tags: {
          type: 'array',
          items: { type: 'string', minLength: 1, maxLength: 64 },
          maxItems: 30,
        },
        language: { type: 'string', nullable: true, minLength: 2, maxLength: 16 },
        archived: {
          type: 'boolean',
          description: 'Set true to soft-archive (hide from catalogues); false to restore',
        },
        generatedByModel: stringProp('Optional model name', { maxLength: 160 }),
        sourceTitle: stringProp('Optional source title', { maxLength: 300 }),
      },
    },
  },
  {
    name: 'begin_record_content_upload',
    description:
      'Start a chunked markdown update. Then append_record_content and finalize_record_content_upload. One draft version per session. Requires knowledge:write.',
    scope: 'knowledge:write',
    write: true,
    body: {
      type: 'object',
      required: ['recordId'],
      properties: {
        recordId: entityRefProp('Knowledge record id'),
      },
    },
  },
  {
    name: 'append_record_content',
    description:
      'Append one markdown chunk (max 40000 characters) to a record content upload. Requires knowledge:write.',
    scope: 'knowledge:write',
    write: true,
    body: {
      type: 'object',
      required: ['uploadId', 'chunk'],
      properties: {
        uploadId: uuidProp('Upload session id'),
        chunk: stringProp('Markdown chunk', { minLength: 1, maxLength: 40_000 }),
        index: { type: 'integer', minimum: 0 },
      },
    },
  },
  {
    name: 'finalize_record_content_upload',
    description:
      'Save appended chunks as one draft version. 409 CONTENT_CHANGED when the record changed after begin. Requires knowledge:write.',
    scope: 'knowledge:write',
    write: true,
    body: {
      type: 'object',
      required: ['uploadId', 'changeMessage'],
      properties: {
        uploadId: uuidProp('Upload session id'),
        changeMessage: stringProp('Why this change was made', {
          minLength: 1,
          maxLength: 500,
        }),
        expectedLength: { type: 'integer', minimum: 0, maximum: 500_000 },
      },
    },
  },
  {
    name: 'begin_workspace_media_upload',
    description:
      'Start chunked image upload (ChatGPT-safe). Next: append then finalize. Optional targetEntityType+targetEntityId (UUID or human key) links the image on finalize and requires pm:write. The item must be in workspaceId. Requires knowledge:write.',
    scope: 'knowledge:write',
    write: true,
    openApi: true,
    body: {
      type: 'object',
      required: ['workspaceId', 'contentType'],
      properties: {
        workspaceId: uuidProp('Workspace id'),
        contentType: {
          type: 'string',
          enum: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
        },
        filename: stringProp('Optional filename', { maxLength: 200 }),
        alt: stringProp('Optional alt text', { maxLength: 300 }),
        knowledgeRecordId: entityRefProp('Optional record to link'),
        insertIntoRecord: { type: 'boolean' },
        targetEntityType: {
          type: 'string',
          enum: ['epic', 'user_story', 'milestone', 'task', 'sprint', 'raid', 'change'],
        },
        targetEntityId: entityRefProp('Optional item to link on finalize'),
      },
    },
  },
  {
    name: 'append_workspace_media_upload',
    description: 'Append one ~8000-char raw base64 chunk. Requires knowledge:write.',
    scope: 'knowledge:write',
    write: true,
    openApi: true,
    body: {
      type: 'object',
      required: ['uploadId', 'chunkBase64'],
      properties: {
        uploadId: uuidProp('Upload session id'),
        chunkBase64: { type: 'string', minLength: 1, maxLength: 12_000 },
        index: { type: 'integer', minimum: 0 },
      },
    },
  },
  {
    name: 'finalize_workspace_media_upload',
    description:
      'Finish chunked upload; returns media.markdownSnippet and linkedTo when begin named an item. Requires knowledge:write. Linking requires pm:write.',
    scope: 'knowledge:write',
    write: true,
    openApi: true,
    body: {
      type: 'object',
      required: ['uploadId'],
      properties: { uploadId: uuidProp('Upload session id') },
    },
  },

  // —— Project Delivery first-class (OpenAPI) ——
  {
    name: 'list_project_tasks',
    description:
      'List delivery tasks. Optional milestone, sprint, and itemType filters. Optional limit (1-25, default 25) and cursor. Result includes nextCursor (null when hasMore is false). Descriptions are excerpts. completionPercent is displayed: done is 100, cancelled is 0, otherwise the stored step. startDate is the stored start and is writable. targetPercent is null. Each task includes mediaLinks and mediaLinkCount for the Media tab. Requires pm:read.',
    scope: 'pm:read',
    openApi: true,
    output: taskListPageResult,
    body: {
      type: 'object',
      required: ['projectId'],
      properties: {
        projectId: uuidProp('Project id'),
        milestoneId: entityRefProp('Optional milestone filter'),
        unassignedMilestone: { type: 'boolean' },
        sprintId: entityRefProp('Optional sprint filter'),
        unassignedSprint: { type: 'boolean' },
        itemType: taskItemType,
        includeArchived: { type: 'boolean' },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 25,
          description: 'Page size from 1 to 25. Defaults to 25.',
        },
        cursor: stringProp('Opaque page cursor from the previous nextCursor', {
          maxLength: 200,
        }),
      },
    },
  },
  {
    name: 'get_project_task',
    description:
      'Get one task or bug with RACI. The raci array is the current standing set and includes the latest set_project_task_raci replacement. startDate is the stored start and is writable. targetPercent is null. taskId may be a UUID or human key (HL1-T-12 or HL1-B-4). Includes mediaLinks and mediaLinkCount for the Media tab. Each media link includes mediaId. Call get_workspace_media (OAuth: call_hub_tool) to read the image. Requires pm:read.',
    scope: 'pm:read',
    openApi: true,
    output: wrappedResult('task', taskRowResult),
    body: {
      type: 'object',
      required: ['taskId'],
      properties: { taskId: entityRefProp('Task id') },
    },
  },
  {
    name: 'create_project_task',
    description:
      'Create a live delivery task or bug (itemType, default task). startDate is stored and returned. targetPercent is null. Optional durationDays makes dueDate equal startDate plus that many working days on the project calendar. Bugs use the same start date and duration. Bug fields are rejected on a task. Requires pm:write.',
    scope: 'pm:write',
    write: true,
    openApi: true,
    output: wrappedResult('task', taskRowResult),
    body: {
      type: 'object',
      required: ['projectId', 'title'],
      properties: {
        projectId: uuidProp('Project id'),
        title: stringProp('Task title', { minLength: 1, maxLength: 200 }),
        description: { type: 'string', nullable: true, maxLength: 10000 },
        status: taskStatus,
        startDate: { ...ymd, nullable: true },
        dueDate: { ...ymd, nullable: true },
        durationDays: {
          type: 'integer',
          minimum: 0,
          maximum: 3650,
          nullable: true,
          description: 'Calendar days. Due date becomes start date plus duration.',
        },
        forecastHours: money,
        actualHours: money,
        tokensUsed: { type: 'integer', minimum: 0, nullable: true },
        tokensInput: { type: 'integer', minimum: 0, nullable: true },
        tokensOutput: { type: 'integer', minimum: 0, nullable: true },
        tokensCache: { type: 'integer', minimum: 0, nullable: true },
        modelId: { type: 'string', maxLength: 80, nullable: true },
        pricingTier: { type: 'string', maxLength: 32, nullable: true },
        usageOccurredAt: { type: 'string', maxLength: 40, nullable: true },
        billingPeriod: { type: 'string', maxLength: 7, nullable: true },
        aiSystemId: { type: 'string', format: 'uuid', nullable: true },
        milestoneId: { ...entityRefProp('Milestone'), nullable: true },
        userStoryId: { ...entityRefProp('User story'), nullable: true },
        sprintId: { ...entityRefProp('Sprint'), nullable: true },
        storyPoints: { type: 'integer', minimum: 0, maximum: 1000, nullable: true },
        completionPercent: {
          type: 'integer',
          enum: [0, 25, 50, 75, 100],
          nullable: true,
        },
        currentOwnerUserId: { type: 'string', format: 'uuid', nullable: true },
        sortOrder: { type: 'integer', minimum: 0 },
        ...bugFields,
        raci: {
          type: 'array',
          maxItems: 50,
          items: {
            type: 'object',
            required: ['userId', 'role'],
            properties: {
              userId: uuidProp('Workspace member user id'),
              role: raciRole,
            },
          },
        },
      },
    },
  },
  {
    name: 'update_project_task',
    description:
      'Update a task or bug. taskId is a UUID or human key (T or B, e.g. HL1-B-4). itemType cannot change. startDate is stored and returned; null clears it. targetPercent is null. Optional durationDays; when set, dueDate is startDate plus that many working days on the project calendar. Null clears a date or duration. Bugs use the same start date and duration. Bug fields are rejected on a task. tokensUsed alone bills the blended rate. A token breakdown, including tokensCacheWrite, bills split rates. Optional cloudAgentId links imported Cursor usage with that id onto this task. completionPercent written is 0, 25, 50, 75, or 100; done stores 100 and cancelled stores null. Reopening a done task or bug (status back to todo, in_progress, or blocked) clears completedAt and resets completionPercent to 0, because the step from before done is not stored. An explicit completionPercent on that call is kept. Reads return the displayed percent, so cancelled is 0. A status, completion, date, or story change recomputes the story, its epic, and milestones linked to them. Recompute skips an archived story, epic, or milestone and never overwrites a cancelled status. Linking to an archived milestone, story, or sprint is rejected until it is unarchived. Parent start and end follow included children. Requires pm:write.',
    scope: 'pm:write',
    write: true,
    openApi: true,
    output: wrappedResult('task', taskRowResult),
    body: {
      type: 'object',
      required: ['taskId'],
      properties: {
        taskId: entityRefProp('Task id'),
        title: stringProp('Title', { minLength: 1, maxLength: 200 }),
        description: { type: 'string', nullable: true, maxLength: 10000 },
        status: taskStatus,
        startDate: { ...ymd, nullable: true },
        dueDate: { ...ymd, nullable: true },
        durationDays: {
          type: 'integer',
          minimum: 0,
          maximum: 3650,
          nullable: true,
          description: 'Calendar days. Due date becomes start date plus duration.',
        },
        forecastHours: money,
        actualHours: money,
        tokensUsed: { type: 'integer', minimum: 0, nullable: true },
        tokensInput: { type: 'integer', minimum: 0, nullable: true },
        tokensOutput: { type: 'integer', minimum: 0, nullable: true },
        tokensCache: { type: 'integer', minimum: 0, nullable: true },
        tokensCacheWrite: { type: 'integer', minimum: 0, nullable: true },
        modelId: { type: 'string', maxLength: 80, nullable: true },
        pricingTier: { type: 'string', maxLength: 32, nullable: true },
        usageOccurredAt: { type: 'string', maxLength: 40, nullable: true },
        billingPeriod: { type: 'string', maxLength: 7, nullable: true },
        aiSystemId: { type: 'string', format: 'uuid', nullable: true },
        cloudAgentId: {
          type: 'string',
          maxLength: 80,
          nullable: true,
          description:
            'Cursor cloud agent id. Links imported usage onto this task. Null clears it.',
        },
        milestoneId: { ...entityRefProp('Milestone'), nullable: true },
        userStoryId: { ...entityRefProp('User story'), nullable: true },
        sprintId: { ...entityRefProp('Sprint'), nullable: true },
        storyPoints: { type: 'integer', minimum: 0, maximum: 1000, nullable: true },
        completionPercent: {
          type: 'integer',
          enum: [0, 25, 50, 75, 100],
          nullable: true,
        },
        currentOwnerUserId: { type: 'string', format: 'uuid', nullable: true },
        sortOrder: { type: 'integer', minimum: 0 },
        archived: { type: 'boolean' },
        ...bugFields,
      },
    },
  },
  {
    name: 'list_project_milestones',
    description:
      'List project milestones. Pages at 25. The note (description) is an excerpt. Pass cursor until hasMore is false. completionPercent is 0 or 100 from linked items and predecessor dependencies. 100 only when every included item is done or 100 percent. Cancelled items are left out. Otherwise 0. No included items leaves it null. completion.done counts included linked items and predecessor dependencies that are done or 100 percent. completion.total is that included set, so a partial milestone can report done greater than 0 while completionPercent stays 0. Status follows those links: all complete is done, a non-done blocked link is blocked, completion above 0 or any started link is in progress, otherwise planned. No included links keeps the stored status. Recompute skips an archived milestone and never overwrites a cancelled status. startDate and targetDate are stored and writable, not derived from linked items. targetPercent is null. A predecessor moves the due date. Duration is always 0. Each row includes mediaLinks and mediaLinkCount for the Media tab. Requires pm:read.',
    scope: 'pm:read',
    openApi: true,
    output: pagedResult('milestones', milestoneRowResult),
    body: {
      type: 'object',
      required: ['projectId'],
      properties: {
        projectId: uuidProp('Project id'),
        includeArchived: { type: 'boolean' },
        limit: { type: 'integer', minimum: 1, maximum: 25 },
        cursor: stringProp('Page cursor from nextCursor', { maxLength: 200 }),
      },
    },
  },
  {
    name: 'create_project_milestone',
    description:
      'Create a live milestone. description is the note. targetDate is the due date. startDate is the stored start and is writable. Dates are not derived from linked items. targetPercent is null. Requires pm:write.',
    scope: 'pm:write',
    write: true,
    openApi: true,
    output: wrappedResult('milestone', milestoneRowResult),
    body: {
      type: 'object',
      required: ['projectId', 'title'],
      properties: {
        projectId: uuidProp('Project id'),
        title: stringProp('Title', { minLength: 1, maxLength: 200 }),
        description: { type: 'string', nullable: true, maxLength: 10000 },
        status: milestoneStatus,
        startDate: { ...ymd, nullable: true },
        targetDate: { ...ymd, nullable: true },
        sortOrder: { type: 'integer', minimum: 0 },
      },
    },
  },
  {
    name: 'update_project_milestone',
    description:
      'Update a milestone. milestoneId may be UUID or HL1-M-1. description is the note. startDate and targetDate are stored and writable. Dates are not derived from linked items. targetPercent is null. Recompute skips an archived milestone and never overwrites a cancelled status. Requires pm:write.',
    scope: 'pm:write',
    write: true,
    output: wrappedResult('milestone', milestoneRowResult),
    body: {
      type: 'object',
      required: ['milestoneId'],
      properties: {
        milestoneId: entityRefProp('Milestone id'),
        title: stringProp('Title', { minLength: 1, maxLength: 200 }),
        description: { type: 'string', nullable: true, maxLength: 10000 },
        status: milestoneStatus,
        startDate: { ...ymd, nullable: true },
        targetDate: { ...ymd, nullable: true },
        sortOrder: { type: 'integer', minimum: 0 },
        archived: { type: 'boolean' },
      },
    },
  },
  {
    name: 'get_project_milestone',
    description:
      'Get one milestone with its note, start date, due date, completionPercent, linkedItems, and status derived from those links. completionPercent is 0 or 100. completion.done counts included linked items and predecessor dependencies that are done or 100 percent. completion.total is that same included set. completion.percent stays 0 or 100. startDate and targetDate are stored and writable, not derived from linked items. targetPercent is null. No included links keeps the stored status. Recompute skips an archived milestone and never overwrites a cancelled status. milestoneId may be UUID or HL1-M-1. Requires pm:read. Via call_hub_tool on ChatGPT.',
    scope: 'pm:read',
    output: wrappedResult('milestone', milestoneRowResult),
    body: {
      type: 'object',
      required: ['milestoneId'],
      properties: {
        milestoneId: entityRefProp('Milestone id'),
      },
    },
  },
  {
    name: 'set_project_milestone_item_links',
    description:
      'Replace epics, stories, tasks, and bugs linked to a milestone. Bugs use entityType task. An archived milestone is rejected until it is unarchived, and nothing is written. Recompute skips an archived milestone and never overwrites a cancelled status. Requires pm:write. Via call_hub_tool on ChatGPT.',
    scope: 'pm:write',
    write: true,
    body: {
      type: 'object',
      required: ['milestoneId', 'items'],
      properties: {
        milestoneId: entityRefProp('Milestone id'),
        items: {
          type: 'array',
          maxItems: 100,
          items: {
            type: 'object',
            required: ['entityType', 'entityId'],
            properties: {
              entityType: {
                type: 'string',
                enum: ['epic', 'user_story', 'task'],
              },
              entityId: entityRefProp('Epic, story, task, or bug id'),
            },
          },
        },
      },
    },
  },
  {
    name: 'list_project_epics',
    description:
      'List epics for a project. Pages at 25. Descriptions are excerpts. Pass cursor until hasMore is false. completionPercent is 100 when done, 0 when cancelled, otherwise the average of non-cancelled children, or null. Status follows those children: all done, blocked when a non-done child is blocked, in progress when completion is above 0 or a child has started, otherwise planned. No included children keeps the stored status. startDate is the earliest child start and endDate the latest child end; a side with no child date keeps the stored date. startDateDerived and endDateDerived mark a read-only child rollup. targetPercent is the planned percent and is read-only. Each epic includes mediaLinks and mediaLinkCount for the Media tab. Requires pm:read.',
    scope: 'pm:read',
    openApi: true,
    output: pagedResult('epics', parentRowResult),
    body: {
      type: 'object',
      required: ['projectId'],
      properties: {
        projectId: uuidProp('Project id'),
        includeArchived: { type: 'boolean' },
        limit: { type: 'integer', minimum: 1, maximum: 25 },
        cursor: stringProp('Page cursor from nextCursor', { maxLength: 200 }),
      },
    },
  },
  {
    name: 'create_project_epic',
    description:
      'Create an epic. startDate and endDate are writable until included children supply that side. A derived side is read-only. targetPercent is the planned percent and is read-only. Requires pm:write.',
    scope: 'pm:write',
    write: true,
    openApi: true,
    output: wrappedResult('epic', parentRowResult),
    body: {
      type: 'object',
      required: ['projectId', 'title'],
      properties: {
        projectId: uuidProp('Project id'),
        title: stringProp('Title', { minLength: 1, maxLength: 200 }),
        description: { type: 'string', nullable: true, maxLength: 10000 },
        status: epicStatus,
        startDate: { ...ymd, nullable: true },
        endDate: { ...ymd, nullable: true },
        sortOrder: { type: 'integer', minimum: 0 },
      },
    },
  },
  {
    name: 'list_project_user_stories',
    description:
      'List user stories (optional epic filter). Pages at 25. Descriptions are excerpts. Pass cursor until hasMore is false. completionPercent is 100 when done, 0 when cancelled, otherwise the average of non-cancelled children, or null. Status follows those children: all done, blocked when a non-done child is blocked, in progress when completion is above 0 or a child has started, otherwise planned. No included children keeps the stored status. startDate is the earliest child start and endDate the latest child end; a side with no child date keeps the stored date. startDateDerived and endDateDerived mark a read-only child rollup. targetPercent is the planned percent and is read-only. Each story includes mediaLinks and mediaLinkCount for the Media tab. Requires pm:read.',
    scope: 'pm:read',
    openApi: true,
    output: pagedResult('userStories', parentRowResult),
    body: {
      type: 'object',
      required: ['projectId'],
      properties: {
        projectId: uuidProp('Project id'),
        epicId: entityRefProp('Optional epic filter'),
        includeArchived: { type: 'boolean' },
        limit: { type: 'integer', minimum: 1, maximum: 25 },
        cursor: stringProp('Page cursor from nextCursor', { maxLength: 200 }),
      },
    },
  },
  {
    name: 'create_project_user_story',
    description:
      'Create a user story under an epic. startDate and endDate are writable until included children supply that side. A derived side is read-only. targetPercent is the planned percent and is read-only. Requires pm:write.',
    scope: 'pm:write',
    write: true,
    openApi: true,
    output: wrappedResult('userStory', parentRowResult),
    body: {
      type: 'object',
      required: ['projectId', 'epicId', 'title'],
      properties: {
        projectId: uuidProp('Project id'),
        epicId: entityRefProp('Parent epic'),
        title: stringProp('Title', { minLength: 1, maxLength: 200 }),
        description: { type: 'string', nullable: true, maxLength: 10000 },
        status: epicStatus,
        startDate: { ...ymd, nullable: true },
        endDate: { ...ymd, nullable: true },
        sortOrder: { type: 'integer', minimum: 0 },
      },
    },
  },
  {
    name: 'list_project_sprints',
    description:
      'List Scrum sprints (committed/done points). Pages at 25. Goals are excerpts. Pass cursor until hasMore is false. Each sprint includes mediaLinks and mediaLinkCount for the Media tab. Requires pm:read.',
    scope: 'pm:read',
    openApi: true,
    body: {
      type: 'object',
      required: ['projectId'],
      properties: {
        projectId: uuidProp('Project id'),
        includeArchived: { type: 'boolean' },
        limit: { type: 'integer', minimum: 1, maximum: 25 },
        cursor: stringProp('Page cursor from nextCursor', { maxLength: 200 }),
      },
    },
  },
  {
    name: 'create_project_sprint',
    description: 'Create a Scrum sprint (SP key). At most one active sprint. Requires pm:write.',
    scope: 'pm:write',
    write: true,
    openApi: true,
    body: {
      type: 'object',
      required: ['projectId', 'name'],
      properties: {
        projectId: uuidProp('Project id'),
        name: stringProp('Sprint name', { minLength: 1, maxLength: 200 }),
        goal: { type: 'string', nullable: true, maxLength: 5000 },
        status: sprintStatus,
        startDate: { ...ymd, nullable: true },
        endDate: { ...ymd, nullable: true },
        capacityPoints: { type: 'integer', minimum: 0, nullable: true },
        sortOrder: { type: 'integer', minimum: 0 },
      },
    },
  },
  {
    name: 'update_project_sprint',
    description:
      'Update/activate/close a sprint. On complete, unfinishedDestination moves incomplete tasks. Requires pm:write.',
    scope: 'pm:write',
    write: true,
    openApi: true,
    body: {
      type: 'object',
      required: ['sprintId'],
      properties: {
        sprintId: entityRefProp('Sprint id'),
        name: stringProp('Name', { minLength: 1, maxLength: 200 }),
        goal: { type: 'string', nullable: true, maxLength: 5000 },
        status: sprintStatus,
        startDate: { ...ymd, nullable: true },
        endDate: { ...ymd, nullable: true },
        capacityPoints: { type: 'integer', minimum: 0, nullable: true },
        sortOrder: { type: 'integer', minimum: 0 },
        archived: { type: 'boolean' },
        unfinishedDestination: {
          oneOf: [
            { type: 'string', enum: ['backlog'] },
            {
              type: 'object',
              required: ['sprintId'],
              properties: { sprintId: entityRefProp('Target sprint') },
            },
          ],
        },
      },
    },
  },
  {
    name: 'list_my_project_tasks',
    description:
      'List tasks where the API client acting user is on RACI (My tasks). Pages at 25. Descriptions are excerpts; use get_project_task for the full text. Pass cursor until hasMore is false. Each task includes mediaLinks and mediaLinkCount for the Media tab. Requires pm:read + actingUserId.',
    scope: 'pm:read',
    openApi: true,
    body: {
      type: 'object',
      properties: {
        role: raciRole,
        includeArchived: { type: 'boolean' },
        limit: { type: 'integer', minimum: 1, maximum: 25 },
        cursor: stringProp('Page cursor from nextCursor', { maxLength: 200 }),
      },
    },
  },

  // —— Extended tools (Gemini + call_hub_tool; not first-class OpenAPI) ——
  {
    name: 'list_workspaces',
    description:
      'List workspaces this client can access: id, name, slug, organization, writesAllowed, and the acting user role. writesAllowed is true only when the workspace is on the client allow-list. Via call_hub_tool on ChatGPT. Requires projects:read.',
    scope: 'projects:read',
    body: { type: 'object', additionalProperties: false, properties: {} },
  },
  {
    name: 'list_project_metadata',
    description:
      'Field guide for create_project and update_project: stages, methodologies, key prefixes, and the idea-stage rule. Call before create_project. Requires projects:read. Via call_hub_tool on ChatGPT.',
    scope: 'projects:read',
    body: { type: 'object', additionalProperties: false, properties: {} },
  },
  {
    name: 'create_project',
    description:
      'Create a project in an allowlisted workspace. Always stage idea; a human promotes it to active. Returns id, keyPrefix, and url. Requires projects:write. Via call_hub_tool on ChatGPT.',
    scope: 'projects:write',
    write: true,
    body: {
      type: 'object',
      additionalProperties: false,
      required: ['workspaceId', 'name'],
      properties: {
        workspaceId: uuidProp('Workspace id from list_workspaces'),
        name: stringProp('Project name', { minLength: 1, maxLength: 160 }),
        description: { type: 'string', nullable: true, maxLength: 10000 },
        keyPrefix: {
          type: 'string',
          description: 'AAA or AA0. Omit to auto-assign. Taken prefixes return a suggestion.',
        },
        currency: stringProp('Currency, default EUR'),
        methodology: { ...projectMethodology, nullable: true },
        confirmDuplicateName: {
          type: 'boolean',
          description: 'Required when a similar project name already exists.',
        },
        generatedByModel: {
          type: 'string',
          nullable: true,
          maxLength: 200,
          description: 'Optional model id stored as provenance.',
        },
      },
    },
  },
  {
    name: 'update_project',
    description:
      'Update name, description, methodology, currency, or schedule-slip risk settings. Stage changes cannot promote idea to active. Requires projects:write. Writes an audit entry. Via call_hub_tool on ChatGPT.',
    scope: 'projects:write',
    write: true,
    body: {
      type: 'object',
      additionalProperties: false,
      required: ['projectId'],
      properties: {
        projectId: uuidProp('Project id'),
        name: stringProp('Project name', { minLength: 1, maxLength: 160 }),
        description: { type: 'string', nullable: true, maxLength: 10000 },
        methodology: { ...projectMethodology, nullable: true },
        currency: stringProp('Project currency'),
        status: projectStage,
        stage: projectStage,
        confirmDuplicateName: {
          type: 'boolean',
          description: 'Required when the new name is similar to another project.',
        },
        scheduleSlipRiskEnabled: { type: 'boolean' },
        scheduleSlipThresholdDays: { type: 'integer', minimum: 1, maximum: 3650 },
        scheduleSlipItemTypes: {
          type: 'array',
          maxItems: 4,
          items: {
            type: 'string',
            enum: ['task', 'user_story', 'epic', 'milestone'],
          },
        },
      },
    },
  },
  {
    name: 'create_system',
    description:
      'Create a catalogue system (IT resource). Fill itDetails when known. Requires catalogue:write. Via call_hub_tool on ChatGPT.',
    scope: 'catalogue:write',
    write: true,
    body: {
      type: 'object',
      required: ['workspaceId', 'name'],
      properties: {
        workspaceId: uuidProp('Workspace id'),
        projectId: { type: 'string', format: 'uuid', nullable: true },
        name: stringProp('System name', { minLength: 1, maxLength: 160 }),
        slug: stringProp('Optional slug', { maxLength: 64 }),
        summary: { type: 'string', nullable: true, maxLength: 500 },
        description: { type: 'string', nullable: true, maxLength: 10000 },
        systemType: { type: 'string', nullable: true, maxLength: 120 },
        status: {
          type: 'string',
          enum: [
            'proposed',
            'experimental',
            'active',
            'degraded',
            'maintenance',
            'deprecated',
            'retired',
            'archived',
          ],
        },
        ownerUserId: { type: 'string', format: 'uuid', nullable: true },
        environment: { type: 'string', nullable: true, maxLength: 80 },
        version: { type: 'string', nullable: true, maxLength: 80 },
        criticality: {
          type: 'string',
          enum: ['low', 'medium', 'high', 'critical'],
          nullable: true,
        },
        itDetails: {
          type: 'object',
          description: 'Structured IT inventory (hostname, primaryUrl, IPs, deployment, …)',
          additionalProperties: true,
          properties: {
            hostname: { type: 'string' },
            primaryUrl: { type: 'string' },
            vendor: { type: 'string' },
            deploymentModel: {
              type: 'string',
              enum: [
                'saas',
                'paas',
                'iaas',
                'on_prem',
                'vm',
                'container',
                'kubernetes',
                'network',
                'endpoint',
                'other',
              ],
            },
            dataClassification: {
              type: 'string',
              enum: ['public', 'internal', 'confidential', 'restricted'],
            },
            supportContact: { type: 'string' },
            documentationUrl: { type: 'string' },
          },
        },
        aiTokenRateCurrency: {
          type: 'string',
          minLength: 3,
          maxLength: 3,
          nullable: true,
          description: 'Currency of AI token list prices. Null uses the project currency.',
        },
        tags: {
          type: 'array',
          maxItems: 30,
          items: { type: 'string', minLength: 1, maxLength: 64 },
        },
      },
    },
  },
  {
    name: 'update_system',
    description:
      'Update a catalogue system / IT inventory. Requires catalogue:write. Via call_hub_tool on ChatGPT.',
    scope: 'catalogue:write',
    write: true,
    body: {
      type: 'object',
      required: ['systemId'],
      properties: {
        systemId: uuidProp('System id'),
        projectId: { type: 'string', format: 'uuid', nullable: true },
        name: stringProp('System name', { minLength: 1, maxLength: 160 }),
        summary: { type: 'string', nullable: true, maxLength: 500 },
        description: { type: 'string', nullable: true, maxLength: 10000 },
        systemType: { type: 'string', nullable: true, maxLength: 120 },
        status: {
          type: 'string',
          enum: [
            'proposed',
            'experimental',
            'active',
            'degraded',
            'maintenance',
            'deprecated',
            'retired',
            'archived',
          ],
        },
        ownerUserId: { type: 'string', format: 'uuid', nullable: true },
        environment: { type: 'string', nullable: true, maxLength: 80 },
        version: { type: 'string', nullable: true, maxLength: 80 },
        criticality: {
          type: 'string',
          enum: ['low', 'medium', 'high', 'critical'],
          nullable: true,
        },
        itDetails: {
          type: 'object',
          nullable: true,
          additionalProperties: true,
          properties: {},
        },
        aiTokenRateCurrency: {
          type: 'string',
          minLength: 3,
          maxLength: 3,
          nullable: true,
          description: 'Currency of AI token list prices. Null uses the project currency.',
        },
        tags: {
          type: 'array',
          maxItems: 30,
          items: { type: 'string', minLength: 1, maxLength: 64 },
        },
      },
    },
  },
  {
    name: 'get_record_provenance',
    description: 'Verification and source provenance for a knowledge record.',
    scope: 'provenance:read',
    body: {
      type: 'object',
      required: ['recordId'],
      properties: { recordId: entityRefProp('Knowledge record id') },
    },
  },
  {
    name: 'list_record_translations',
    description: 'List translation siblings for a knowledge record.',
    scope: 'knowledge:read',
    body: {
      type: 'object',
      required: ['recordId'],
      properties: { recordId: entityRefProp('Knowledge record id') },
    },
  },
  {
    name: 'list_workspace_media',
    description:
      'List recent workspace media with markdownSnippet, mediaId, and usedBy. Call get_workspace_media to read image bytes (OAuth: call_hub_tool). Optional filename query. Optional entityType+entityId filters to images linked to that item in this workspace. Requires knowledge:read.',
    scope: 'knowledge:read',
    defaults: { limit: 20 },
    body: {
      type: 'object',
      required: ['workspaceId'],
      properties: {
        workspaceId: uuidProp('Workspace id'),
        knowledgeRecordId: entityRefProp('Optional record filter'),
        query: stringProp('Optional filename search', { maxLength: 200 }),
        entityType: {
          type: 'string',
          enum: ['epic', 'user_story', 'milestone', 'task', 'sprint', 'raid', 'change'],
        },
        entityId: entityRefProp('Optional item filter'),
        limit: { type: 'integer', minimum: 1, maximum: 50 },
      },
    },
  },
  {
    name: 'get_workspace_media',
    description:
      'Read one workspace media file by mediaId. Raster images return MCP image content (longest side at most 1568 px and about 1 MB; never upscaled) plus metadata. SVG and non-images return metadata only. signedUrl is an absolute URL bound to this media and workspace for 10 minutes. Requires knowledge:read.',
    scope: 'knowledge:read',
    body: {
      type: 'object',
      additionalProperties: false,
      required: ['mediaId'],
      properties: {
        mediaId: uuidProp('Media id'),
        maxDimension: {
          type: 'integer',
          minimum: 1,
          maximum: 1568,
          description: 'Optional longest-side cap in pixels. Never upscales. Server cap is 1568.',
        },
      },
    },
  },
  {
    name: 'delete_workspace_media',
    description: 'Soft-delete workspace media. Requires knowledge:write.',
    scope: 'knowledge:write',
    write: true,
    body: {
      type: 'object',
      required: ['mediaId'],
      properties: { mediaId: uuidProp('Media id') },
    },
  },
  {
    name: 'get_platform_status',
    description: 'Redacted platform health, including audit retention and log size. Requires monitoring:read.',
    scope: 'monitoring:read',
    body: { type: 'object', properties: {} },
  },
  {
    name: 'update_project_epic',
    description:
      'Update an epic. startDate and endDate are writable only when that side is not derived from included children. A derived side is read-only and a write is rejected. targetPercent is the planned percent and is read-only. Recompute skips an archived epic and never overwrites a cancelled status. Requires pm:write.',
    scope: 'pm:write',
    write: true,
    output: wrappedResult('epic', parentRowResult),
    body: {
      type: 'object',
      required: ['epicId'],
      properties: {
        epicId: entityRefProp('Epic id'),
        title: stringProp('Title', { minLength: 1, maxLength: 200 }),
        description: { type: 'string', nullable: true, maxLength: 10000 },
        status: epicStatus,
        startDate: { ...ymd, nullable: true },
        endDate: { ...ymd, nullable: true },
        sortOrder: { type: 'integer', minimum: 0 },
        archived: { type: 'boolean' },
      },
    },
  },
  {
    name: 'update_project_user_story',
    description:
      'Update a user story. startDate and endDate are writable only when that side is not derived from included children. A derived side is read-only and a write is rejected. targetPercent is the planned percent and is read-only. Recompute skips an archived story and never overwrites a cancelled status. Moving the story onto an archived epic is rejected. Requires pm:write.',
    scope: 'pm:write',
    write: true,
    output: wrappedResult('userStory', parentRowResult),
    body: {
      type: 'object',
      required: ['storyId'],
      properties: {
        storyId: entityRefProp('Story id'),
        title: stringProp('Title', { minLength: 1, maxLength: 200 }),
        description: { type: 'string', nullable: true, maxLength: 10000 },
        status: epicStatus,
        epicId: entityRefProp('Epic id'),
        startDate: { ...ymd, nullable: true },
        endDate: { ...ymd, nullable: true },
        sortOrder: { type: 'integer', minimum: 0 },
        archived: { type: 'boolean' },
      },
    },
  },
  {
    name: 'list_delivery_dependencies',
    description:
      'List every predecessor link on one delivery item and the successors derived from them. Each link includes lagDays, a whole number of days (negative is a lead). An item may have many predecessors. The successor start is the latest constraint (FS uses predecessor finish, SS predecessor start, FF predecessor finish minus duration, SF predecessor start minus duration, each plus lag). projectId (UUID) and entityId are required. entityId is a UUID or human key (PRO-T-1, PRO-B-1). entityType is required for a UUID. Requires pm:read. Via call_hub_tool on ChatGPT.',
    scope: 'pm:read',
    output: {
      type: 'object',
      required: ['predecessors', 'successors', 'scheduleDriven'],
      properties: {
        predecessors: { type: 'array', items: dependencyLinkResult },
        successors: { type: 'array', items: dependencyLinkResult },
        scheduleDriven: { type: 'boolean' },
      },
    },
    body: {
      type: 'object',
      additionalProperties: false,
      required: ['projectId', 'entityId'],
      properties: {
        projectId: uuidProp('Project id'),
        entityId: entityRefProp('Delivery item id (PRO-T-1, PRO-B-1, PRO-E-1, PRO-S-1, PRO-M-1, PRO-SP-1)'),
        entityType: {
          type: 'string',
          enum: ['epic', 'user_story', 'task', 'milestone', 'sprint'],
          description: 'Required when entityId is a UUID. B keys are tasks.',
        },
      },
    },
  },
  {
    name: 'set_delivery_dependency',
    description:
      'Add predecessor links (FS, SS, FF, or SF) with optional integer lagDays counted in working days. projectId (UUID) is required. Pass predecessorId, successorId, and linkType for one link, or links (1–50) to add several. An item may have many predecessors; each ordered pair is stored once. The saved link returns lagDays. The successor start is the latest constraint. Non-working days are skipped. Rejects self-links, cross-project links, duplicates, and cycles. Ids are UUIDs or human keys such as PRO-T-1 and PRO-B-1. Requires pm:write. Via call_hub_tool on ChatGPT.',
    scope: 'pm:write',
    write: true,
    output: {
      type: 'object',
      properties: {
        dependency: dependencyLinkResult,
        dependencies: { type: 'array', items: dependencyLinkResult },
        schedule: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              startDate: { type: 'string', nullable: true },
              finishDate: { type: 'string', nullable: true },
            },
          },
        },
      },
    },
    body: {
      type: 'object',
      additionalProperties: false,
      required: ['projectId'],
      properties: {
        projectId: uuidProp('Project id'),
        predecessorId: entityRefProp('Predecessor id'),
        predecessorType: {
          type: 'string',
          enum: ['epic', 'user_story', 'task', 'milestone', 'sprint'],
        },
        successorId: entityRefProp('Successor id. This item depends on the predecessor.'),
        successorType: {
          type: 'string',
          enum: ['epic', 'user_story', 'task', 'milestone', 'sprint'],
        },
        linkType: {
          type: 'string',
          enum: ['FS', 'SS', 'FF', 'SF'],
          description: 'FS finish-to-start, SS start-to-start, FF finish-to-finish, SF start-to-finish.',
        },
        lagDays: {
          type: 'integer',
          minimum: -3650,
          maximum: 3650,
          description: 'Whole days. Negative is a lead. Defaults to 0.',
        },
        links: {
          type: 'array',
          maxItems: 50,
          description: 'Several predecessor links saved in one call. Each item needs predecessorId, successorId, and linkType.',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['predecessorId', 'successorId', 'linkType'],
            properties: {
              predecessorId: entityRefProp('Predecessor id'),
              predecessorType: {
                type: 'string',
                enum: ['epic', 'user_story', 'task', 'milestone', 'sprint'],
              },
              successorId: entityRefProp('Successor id'),
              successorType: {
                type: 'string',
                enum: ['epic', 'user_story', 'task', 'milestone', 'sprint'],
              },
              linkType: {
                type: 'string',
                enum: ['FS', 'SS', 'FF', 'SF'],
              },
              lagDays: {
                type: 'integer',
                minimum: -3650,
                maximum: 3650,
                description: 'Whole days. Negative is a lead. Defaults to 0.',
              },
            },
          },
        },
      },
    },
  },
  {
    name: 'remove_delivery_dependency',
    description:
      'Remove one dependency by linkId or by predecessorId plus successorId (UUID or human key such as PRO-T-1). projectId (UUID) is required. Requires pm:write. Via call_hub_tool on ChatGPT.',
    scope: 'pm:write',
    write: true,
    body: {
      type: 'object',
      additionalProperties: false,
      required: ['projectId'],
      properties: {
        projectId: uuidProp('Project id'),
        linkId: uuidProp('Dependency link id'),
        predecessorId: entityRefProp('Predecessor id'),
        predecessorType: {
          type: 'string',
          enum: ['epic', 'user_story', 'task', 'milestone', 'sprint'],
        },
        successorId: entityRefProp('Successor id'),
        successorType: {
          type: 'string',
          enum: ['epic', 'user_story', 'task', 'milestone', 'sprint'],
        },
      },
    },
  },
  {
    name: 'set_project_task_raci',
    description: 'Replace RACI for a task. Requires pm:write.',
    scope: 'pm:write',
    write: true,
    body: {
      type: 'object',
      required: ['taskId', 'entries'],
      properties: {
        taskId: entityRefProp('Task id'),
        entries: {
          type: 'array',
          maxItems: 50,
          items: {
            type: 'object',
            required: ['userId', 'role'],
            properties: { userId: uuidProp('User id'), role: raciRole },
          },
        },
      },
    },
  },
  {
    name: 'handoff_project_task',
    description: 'Hand off current owner (does not change RACI). Requires pm:write.',
    scope: 'pm:write',
    write: true,
    body: {
      type: 'object',
      required: ['taskId', 'toUserId'],
      properties: {
        taskId: entityRefProp('Task id'),
        toUserId: uuidProp('New owner user id'),
        note: { type: 'string', nullable: true, maxLength: 5000 },
      },
    },
  },
  {
    name: 'add_project_task_comment',
    description: 'Add a comment to the task activity timeline. Requires pm:write.',
    scope: 'pm:write',
    write: true,
    body: {
      type: 'object',
      required: ['taskId', 'body'],
      properties: {
        taskId: entityRefProp('Task id'),
        body: stringProp('Comment body', { minLength: 1, maxLength: 10000 }),
      },
    },
  },
  {
    name: 'list_project_task_activities',
    description:
      'List activity for a task or bug. Pages at 25. Comment text is full by default; fullText false excerpts comments at 200 characters. Pass cursor from nextCursor until hasMore is false. taskId may be a UUID or human key (T or B). Requires pm:read.',
    scope: 'pm:read',
    body: {
      type: 'object',
      required: ['taskId'],
      properties: {
        taskId: entityRefProp('Task id'),
        fullText: {
          type: 'boolean',
          description:
            'When false, comment bodies are excerpted at 200 characters. Defaults to true (full comment text).',
        },
        limit: { type: 'integer', minimum: 1, maximum: 25 },
        cursor: stringProp('Page cursor from nextCursor', { maxLength: 200 }),
      },
    },
  },
  {
    name: 'get_project_sprint_burndown',
    description: 'Story-point burndown for a sprint. Requires pm:read.',
    scope: 'pm:read',
    body: {
      type: 'object',
      required: ['sprintId'],
      properties: { sprintId: entityRefProp('Sprint id') },
    },
  },
  {
    name: 'get_project_scrum_velocity',
    description: 'Average done points over last N completed sprints. Requires pm:read.',
    scope: 'pm:read',
    body: {
      type: 'object',
      required: ['projectId'],
      properties: {
        projectId: uuidProp('Project id'),
        lastN: { type: 'integer', minimum: 1, maximum: 20 },
      },
    },
  },
  {
    name: 'get_my_dashboard_insights',
    description:
      'Dashboard insight rollups for the acting user. Requires pm:read + actingUserId.',
    scope: 'pm:read',
    body: { type: 'object', properties: {} },
  },
  {
    name: 'get_project_budget_summary',
    description:
      'EVM summary, financialRag, riskRag, riskReasons, burndown, and epic cost rollups. riskRag uses open or mitigating RAID only (closed, accepted, cancelled, and archived are ignored) and the same 7-day window as timeline health. Red: a critical item that is overdue, due within 7 days, or kind issue; or a high item that is overdue. Amber: any other critical item (later due date or none), any other high item, or any overdue item. Green otherwise. riskReasons lists that colour (count, severity, kind, cause, dueInDays) and is empty when green. aiPaidAc is the allocated paid AI cost in the project currency (ledger, or flat-fee fallback when a month has no entries). A cost entry with service dates is split across those months by days before allocation; an entry without service dates stays entirely in its period. Each pool share is converted into the project currency at the entry paid-at date, or the service start when paid-at is missing. aiPaidReporting and aiTheoreticalReporting are the reporting-currency figures (workspace setting, default EUR). aiCostFx lists originalAmount, originalCurrency, amount, currency, rate, rateDate, and source. aiBillingEntries keep the original amount and currency and include convertedAmount, fxRate, fxRateDate, and fxSource. A missing quote day uses the previous quote. aiTheoreticalApiCost is list-price token cost and is not added to AC. aiPeriods breaks that down by month. Requires pm:read.',
    scope: 'pm:read',
    body: {
      type: 'object',
      required: ['projectId'],
      properties: { projectId: uuidProp('Project id') },
    },
  },
  {
    name: 'get_project_resource_utilization',
    description:
      'Per-person capacity vs demand for roster members. System users omitted unless includeSystemUsers is true. Requires pm:read.',
    scope: 'pm:read',
    body: {
      type: 'object',
      required: ['projectId'],
      properties: {
        projectId: uuidProp('Project id'),
        view: { type: 'string', enum: ['planned', 'burn', 'combined'] },
        includeSystemUsers: {
          type: 'boolean',
          description: 'Include system users in the roster totals',
        },
      },
    },
  },
  {
    name: 'list_project_stakeholders',
    description:
      'List project stakeholders (people, open roles, AI assistants, RACI-derived) with roleDescription and competencies. Requires pm:read.',
    scope: 'pm:read',
    body: {
      type: 'object',
      required: ['projectId'],
      properties: { projectId: uuidProp('Project id') },
    },
  },
  {
    name: 'list_workspace_members',
    description:
      'List active workspace members (userId, name, email, role, userType). System users omitted unless includeSystemUsers is true. Requires projects:read. Via call_hub_tool on ChatGPT.',
    scope: 'projects:read',
    body: {
      type: 'object',
      required: ['workspaceId'],
      properties: {
        workspaceId: uuidProp('Workspace id'),
        includeSystemUsers: {
          type: 'boolean',
          description: 'Include system users in the member list',
        },
      },
    },
  },
  {
    name: 'create_project_stakeholder',
    description:
      'Add or upsert a stakeholder. Omit userId for an open job role (jobTitle required). Accepts roleDescription and competency tags. Requires pm:write. Via call_hub_tool on ChatGPT.',
    scope: 'pm:write',
    write: true,
    body: {
      type: 'object',
      required: ['projectId', 'projectRole'],
      properties: {
        projectId: uuidProp('Project id'),
        userId: {
          type: 'string',
          format: 'uuid',
          nullable: true,
          description: 'Workspace member; omit/null for open role',
        },
        projectRole: {
          type: 'string',
          enum: [
            'sponsor',
            'owner',
            'project_manager',
            'scrum_master',
            'product_owner',
            'tech_lead',
            'contributor',
            'stakeholder',
            'other',
          ],
        },
        jobTitle: { type: 'string', nullable: true, maxLength: 200 },
        roleDescription: { type: 'string', nullable: true, maxLength: 10000 },
        competencies: {
          type: 'array',
          maxItems: 40,
          items: {
            oneOf: [
              { type: 'string', minLength: 1, maxLength: 80 },
              {
                type: 'object',
                required: ['name'],
                properties: {
                  name: { type: 'string', minLength: 1, maxLength: 80 },
                  skillId: { type: 'string', format: 'uuid', nullable: true },
                },
              },
            ],
          },
          description: 'Competency tags; skillId reserved for future catalog',
        },
        notes: { type: 'string', nullable: true, maxLength: 5000 },
        reportsToUserId: { type: 'string', format: 'uuid', nullable: true },
        hourlyRate: money,
        engagementType: {
          type: 'string',
          enum: ['employee', 'contractor'],
          nullable: true,
        },
        assignmentStart: { ...ymd, nullable: true },
        assignmentEnd: { ...ymd, nullable: true },
        allocatedDailyHours: money,
        contractRef: { type: 'string', nullable: true, maxLength: 200 },
        contractedBudget: money,
        contractStart: { ...ymd, nullable: true },
        contractEnd: { ...ymd, nullable: true },
        sortOrder: { type: 'integer', minimum: 0 },
      },
    },
  },
  {
    name: 'update_project_stakeholder',
    description:
      'Update stakeholder role, description, competencies, rate, or capacity. Requires pm:write. Via call_hub_tool on ChatGPT.',
    scope: 'pm:write',
    write: true,
    body: {
      type: 'object',
      required: ['stakeholderId'],
      properties: {
        stakeholderId: uuidProp('Roster stakeholder id'),
        projectRole: {
          type: 'string',
          enum: [
            'sponsor',
            'owner',
            'project_manager',
            'scrum_master',
            'product_owner',
            'tech_lead',
            'contributor',
            'stakeholder',
            'other',
          ],
        },
        jobTitle: { type: 'string', nullable: true, maxLength: 200 },
        roleDescription: { type: 'string', nullable: true, maxLength: 10000 },
        competencies: {
          type: 'array',
          maxItems: 40,
          items: {
            oneOf: [
              { type: 'string', minLength: 1, maxLength: 80 },
              {
                type: 'object',
                required: ['name'],
                properties: {
                  name: { type: 'string', minLength: 1, maxLength: 80 },
                  skillId: { type: 'string', format: 'uuid', nullable: true },
                },
              },
            ],
          },
        },
        notes: { type: 'string', nullable: true, maxLength: 5000 },
        reportsToUserId: { type: 'string', format: 'uuid', nullable: true },
        hourlyRate: money,
        engagementType: {
          type: 'string',
          enum: ['employee', 'contractor'],
          nullable: true,
        },
        assignmentStart: { ...ymd, nullable: true },
        assignmentEnd: { ...ymd, nullable: true },
        allocatedDailyHours: money,
        contractRef: { type: 'string', nullable: true, maxLength: 200 },
        contractedBudget: money,
        contractStart: { ...ymd, nullable: true },
        contractEnd: { ...ymd, nullable: true },
        sortOrder: { type: 'integer', minimum: 0 },
      },
    },
  },
  {
    name: 'assign_project_stakeholder',
    description:
      'Fill an open job role with a workspace member. Requires pm:write. Via call_hub_tool on ChatGPT.',
    scope: 'pm:write',
    write: true,
    body: {
      type: 'object',
      required: ['stakeholderId', 'userId'],
      properties: {
        stakeholderId: uuidProp('Open-role roster id'),
        userId: uuidProp('Workspace member to assign'),
      },
    },
  },
  {
    name: 'unassign_project_stakeholder',
    description:
      'Reopen a filled seat (clear userId; keep role metadata). Requires pm:write. Via call_hub_tool on ChatGPT.',
    scope: 'pm:write',
    write: true,
    body: {
      type: 'object',
      required: ['stakeholderId'],
      properties: { stakeholderId: uuidProp('Roster stakeholder id') },
    },
  },
  {
    name: 'delete_project_stakeholder',
    description:
      'Remove a durable roster row (RACI-derived people remain). Requires pm:write. Via call_hub_tool on ChatGPT.',
    scope: 'pm:write',
    write: true,
    body: {
      type: 'object',
      required: ['stakeholderId'],
      properties: { stakeholderId: uuidProp('Roster stakeholder id') },
    },
  },
  {
    name: 'list_project_raid_items',
    description:
      'List RAID register items. Pages at 25. Descriptions are excerpts. Pass cursor until hasMore is false. Each item includes records[] (id, title, slug, recordType, humanKey) plus mediaLinks and mediaLinkCount for the Media tab. auto is true on schedule-slip risks. Requires pm:read.',
    scope: 'pm:read',
    body: {
      type: 'object',
      required: ['projectId'],
      properties: {
        projectId: uuidProp('Project id'),
        includeArchived: { type: 'boolean' },
        limit: { type: 'integer', minimum: 1, maximum: 25 },
        cursor: stringProp('Page cursor from nextCursor', { maxLength: 200 }),
      },
    },
  },
  {
    name: 'create_project_raid_item',
    description:
      'Create a RAID item (risk/assumption/issue/dependency). Optional recordIds link same-project knowledge records (UUID or human key). A record from another project is rejected. Requires pm:write.',
    scope: 'pm:write',
    write: true,
    body: {
      type: 'object',
      required: ['projectId', 'kind', 'title'],
      properties: {
        projectId: uuidProp('Project id'),
        kind: {
          type: 'string',
          enum: ['risk', 'assumption', 'issue', 'dependency'],
        },
        title: stringProp('Title', { minLength: 1, maxLength: 300 }),
        description: { type: 'string', nullable: true, maxLength: 10000 },
        status: {
          type: 'string',
          enum: ['open', 'mitigating', 'accepted', 'closed', 'cancelled'],
        },
        severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
        probability: {
          type: 'string',
          enum: ['low', 'medium', 'high', 'critical'],
          nullable: true,
        },
        impact: {
          type: 'string',
          enum: ['low', 'medium', 'high', 'critical'],
          nullable: true,
        },
        ownerUserId: { type: 'string', format: 'uuid', nullable: true },
        dueDate: { ...ymd, nullable: true },
        sortOrder: { type: 'integer', minimum: 0 },
        taskIds: {
          type: 'array',
          maxItems: 100,
          items: entityRefProp('Linked task'),
        },
        recordIds: {
          type: 'array',
          maxItems: 100,
          description: 'Knowledge records in the same project. UUID or human key.',
          items: entityRefProp('Linked knowledge record'),
        },
      },
    },
  },
  {
    name: 'update_project_raid_item',
    description: 'Update a RAID item. Do not change risk↔issue kind — use transfer. Requires pm:write.',
    scope: 'pm:write',
    write: true,
    body: {
      type: 'object',
      required: ['raidItemId'],
      properties: {
        raidItemId: entityRefProp('RAID item id'),
        title: stringProp('Title', { minLength: 1, maxLength: 300 }),
        description: { type: 'string', nullable: true, maxLength: 10000 },
        status: {
          type: 'string',
          enum: ['open', 'mitigating', 'accepted', 'closed', 'cancelled'],
        },
        severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
        probability: {
          type: 'string',
          enum: ['low', 'medium', 'high', 'critical'],
          nullable: true,
        },
        impact: {
          type: 'string',
          enum: ['low', 'medium', 'high', 'critical'],
          nullable: true,
        },
        ownerUserId: { type: 'string', format: 'uuid', nullable: true },
        dueDate: { ...ymd, nullable: true },
        sortOrder: { type: 'integer', minimum: 0 },
        archived: { type: 'boolean' },
      },
    },
  },
  {
    name: 'transfer_project_raid_item',
    description: 'Transfer RAID risk↔issue (new key, archive source). Requires pm:write.',
    scope: 'pm:write',
    write: true,
    body: {
      type: 'object',
      required: ['raidItemId', 'targetKind'],
      properties: {
        raidItemId: entityRefProp('Source RAID item'),
        targetKind: { type: 'string', enum: ['issue', 'risk'] },
      },
    },
  },
  {
    name: 'set_project_raid_record_links',
    description:
      'Replace knowledge records linked to a RAID item. Same project only. Requires pm:write.',
    scope: 'pm:write',
    write: true,
    body: {
      type: 'object',
      required: ['raidItemId', 'recordIds'],
      properties: {
        raidItemId: entityRefProp('RAID item id'),
        recordIds: {
          type: 'array',
          maxItems: 100,
          items: entityRefProp('Knowledge record id'),
        },
      },
    },
  },
  {
    name: 'get_knowledge_record_raid_links',
    description: 'List RAID items linked to a knowledge record. Requires knowledge:read.',
    scope: 'knowledge:read',
    body: {
      type: 'object',
      required: ['recordId'],
      properties: { recordId: entityRefProp('Knowledge record id') },
    },
  },
  {
    name: 'set_knowledge_record_raid_links',
    description:
      'Replace RAID items linked to a project-scoped knowledge record. Requires knowledge:write.',
    scope: 'knowledge:write',
    write: true,
    body: {
      type: 'object',
      required: ['recordId', 'raidItemIds'],
      properties: {
        recordId: entityRefProp('Knowledge record id'),
        raidItemIds: {
          type: 'array',
          maxItems: 100,
          items: entityRefProp('RAID item id'),
        },
      },
    },
  },
  {
    name: 'list_project_change_items',
    description:
      'List change-management register items. Pages at 25. Descriptions and rationale are excerpts. Pass cursor until hasMore is false. Each item includes mediaLinks and mediaLinkCount for the Media tab. Requires pm:read.',
    scope: 'pm:read',
    body: {
      type: 'object',
      required: ['projectId'],
      properties: {
        projectId: uuidProp('Project id'),
        includeArchived: { type: 'boolean' },
        limit: { type: 'integer', minimum: 1, maximum: 25 },
        cursor: stringProp('Page cursor from nextCursor', { maxLength: 200 }),
      },
    },
  },
  {
    name: 'create_project_change_item',
    description:
      'Create a change-management item. knowledgeRecordId links one document. recordIds replaces that set, and the first id is also stored as knowledgeRecordId. Documents must belong to the project. A validation error creates nothing and does not consume a change key. Requires pm:write.',
    scope: 'pm:write',
    write: true,
    body: {
      type: 'object',
      required: ['projectId', 'kind', 'title'],
      properties: {
        projectId: uuidProp('Project id'),
        kind: {
          type: 'string',
          enum: ['scope', 'timeline', 'stakeholder', 'budget', 'other'],
        },
        title: stringProp('Title', { minLength: 1, maxLength: 300 }),
        description: { type: 'string', nullable: true, maxLength: 10000 },
        rationale: { type: 'string', nullable: true, maxLength: 10000 },
        status: {
          type: 'string',
          enum: ['proposed', 'approved', 'rejected', 'implemented', 'cancelled'],
        },
        knowledgeRecordId: { ...entityRefProp('Linked knowledge record'), nullable: true },
        recordIds: {
          type: 'array',
          maxItems: 100,
          items: entityRefProp('Knowledge record id'),
        },
        deliveryLinks: {
          type: 'array',
          maxItems: 200,
          items: {
            type: 'object',
            required: ['entityType', 'entityId'],
            properties: {
              entityType: {
                type: 'string',
                enum: ['epic', 'user_story', 'milestone', 'task'],
              },
              entityId: entityRefProp('Entity id'),
            },
          },
        },
      },
    },
  },
  {
    name: 'update_project_baseline',
    description:
      'Update baseline window, working calendar, DoD, currency, budgets, and keyPrefix. projectId (UUID) is required. hoursPerWorkday, workdaysPerWeek (1–7, Monday-first), and nonWorkingDays replace the calendar used by scheduling. finishDate and durationWorkingDays are calculated from the plan and are not inputs. Returns saved definitionOfDone. Requires pm:write.',
    scope: 'pm:write',
    write: true,
    output: projectBaselineResult,
    body: {
      type: 'object',
      required: ['projectId'],
      properties: {
        projectId: uuidProp('Project id'),
        startDate: { ...ymd, nullable: true },
        endDate: { ...ymd, nullable: true },
        hoursPerWorkday: {
          type: 'number',
          exclusiveMinimum: 0,
          maximum: 24,
          description: 'Hours in one working day.',
        },
        workdaysPerWeek: {
          type: 'integer',
          minimum: 1,
          maximum: 7,
          description: 'Monday-first working days. 5 is Monday–Friday.',
        },
        nonWorkingDays: {
          type: 'array',
          nullable: true,
          items: ymd,
          description: 'Replaces public holidays and other non-working dates. Null clears the list.',
        },
        definitionOfDone: { type: 'string', nullable: true, maxLength: 20000 },
        currency: {
          type: 'string',
          enum: [
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
          ],
        },
        approvedBudget: money,
        keyPrefix: stringProp('Issue key prefix AAA or AA0', { minLength: 3, maxLength: 3 }),
      },
    },
  },
  {
    name: 'move_project',
    description:
      'Move a project to another workspace. Cross-organization requires confirmCrossOrganization. Requires pm:write.',
    scope: 'pm:write',
    write: true,
    body: {
      type: 'object',
      required: ['projectId', 'targetWorkspaceId'],
      properties: {
        projectId: uuidProp('Project id'),
        targetWorkspaceId: uuidProp('Destination workspace id'),
        dryRun: { type: 'boolean' },
        confirmCrossOrganization: { type: 'boolean' },
      },
    },
  },
  {
    name: 'get_knowledge_record_delivery_links',
    description:
      'List epic/story/milestone/task/sprint links for a knowledge record. Bugs use task. Requires knowledge:read.',
    scope: 'knowledge:read',
    body: {
      type: 'object',
      required: ['recordId'],
      properties: { recordId: entityRefProp('Knowledge record id') },
    },
  },
  {
    name: 'set_knowledge_record_delivery_links',
    description:
      'Replace delivery links (epic/story/milestone/task/sprint) for a project-scoped knowledge record. Bugs use task. Requires knowledge:write.',
    scope: 'knowledge:write',
    write: true,
    body: {
      type: 'object',
      required: ['recordId', 'links'],
      properties: {
        recordId: entityRefProp('Knowledge record id'),
        links: {
          type: 'array',
          maxItems: 200,
          items: {
            type: 'object',
            required: ['entityType', 'entityId'],
            properties: {
              entityType: {
                type: 'string',
                enum: ['epic', 'user_story', 'milestone', 'task', 'sprint'],
              },
              entityId: entityRefProp('Delivery entity id'),
            },
          },
        },
      },
    },
  },
  {
    name: 'get_knowledge_record_relations',
    description:
      'List typed relations for a knowledge record plus lifecycle successor and predecessor. Inbound edges use inverse labels (required_by, refined_by, source_for). relates_to and contradicts are listed as outbound on both records. recordId may be a UUID or document key. Requires knowledge:read.',
    scope: 'knowledge:read',
    body: {
      type: 'object',
      additionalProperties: false,
      required: ['recordId'],
      properties: { recordId: entityRefProp('Knowledge record id') },
    },
    output: {
      type: 'object',
      additionalProperties: false,
      required: ['relations', 'lifecycleSuccessor', 'lifecyclePredecessor'],
      properties: {
        relations: {
          type: 'object',
          additionalProperties: false,
          required: ['outbound', 'inbound'],
          properties: {
            outbound: { type: 'array', items: { type: 'object' } },
            inbound: { type: 'array', items: { type: 'object' } },
          },
        },
        lifecycleSuccessor: { type: 'object', nullable: true },
        lifecyclePredecessor: { type: 'object', nullable: true },
      },
    },
  },
  {
    name: 'set_knowledge_record_relations',
    description:
      'Replace relations for this record. Types: relates_to, depends_on, refines, derived_from, contradicts. Directed inbound edges stay. relates_to and contradicts are stored once and can be added or removed from either record. Symmetric relations are listed as outbound on both records. Rejects self-links, cross-project targets, depends_on and refines cycles, and archived endpoints. Requires knowledge:write.',
    scope: 'knowledge:write',
    write: true,
    body: {
      type: 'object',
      additionalProperties: false,
      required: ['recordId', 'links'],
      properties: {
        recordId: entityRefProp('Knowledge record id'),
        links: {
          type: 'array',
          maxItems: 200,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['targetRecordId', 'relationType'],
            properties: {
              targetRecordId: entityRefProp('Related record id'),
              relationType: {
                type: 'string',
                enum: [
                  'relates_to',
                  'depends_on',
                  'refines',
                  'derived_from',
                  'contradicts',
                ],
              },
            },
          },
        },
      },
    },
    output: {
      type: 'object',
      additionalProperties: false,
      required: ['relations', 'lifecycleSuccessor', 'lifecyclePredecessor'],
      properties: {
        relations: {
          type: 'object',
          additionalProperties: false,
          required: ['outbound', 'inbound'],
          properties: {
            outbound: { type: 'array', items: { type: 'object' } },
            inbound: { type: 'array', items: { type: 'object' } },
          },
        },
        lifecycleSuccessor: { type: 'object', nullable: true },
        lifecyclePredecessor: { type: 'object', nullable: true },
      },
    },
  },
  {
    name: 'set_delivery_media_links',
    description:
      'Replace Media tab links for one delivery, RAID, or change item. entityId is a UUID or human key (PRO-T-1, PRO-B-1, PRO-S-1, PRO-E-1, RAID, or change). Bugs use task. Send the full list; omitting a link unlinks it and does not delete the image. URLs need a title. Requires pm:write.',
    scope: 'pm:write',
    write: true,
    openApi: true,
    body: {
      type: 'object',
      required: ['projectId', 'entityType', 'entityId', 'links'],
      properties: {
        projectId: uuidProp('Project id'),
        entityType: {
          type: 'string',
          enum: ['epic', 'user_story', 'milestone', 'task', 'sprint', 'raid', 'change'],
        },
        entityId: entityRefProp('Item id or human key'),
        links: {
          type: 'array',
          maxItems: 100,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['kind'],
            properties: {
              kind: { type: 'string', enum: ['media', 'url'] },
              mediaId: uuidProp('Workspace media id'),
              url: stringProp('http or https URL', { maxLength: 2000 }),
              title: stringProp('Title', { maxLength: 200 }),
              description: stringProp('Optional description', { maxLength: 2000 }),
            },
          },
        },
      },
    },
  },
  {
    name: 'list_project_delivery_document_links',
    description:
      'List knowledge records linked to delivery entities in a project. Requires pm:read.',
    scope: 'pm:read',
    body: {
      type: 'object',
      required: ['projectId'],
      properties: {
        projectId: uuidProp('Project id'),
        entityType: {
          type: 'string',
          enum: ['epic', 'user_story', 'milestone', 'task', 'sprint'],
        },
        entityId: entityRefProp('Optional entity filter'),
      },
    },
  },
  {
    name: 'report_project_task_ai_usage',
    description:
      'Record AI token usage on a task. tokensUsed alone uses the blended rate. Optional tokensInput/tokensOutput/tokensCache/tokensCacheWrite use split rates (null rate falls back to blended). Optional cloudAgentId links imported Cursor usage onto this task. Requires pm:write.',
    scope: 'pm:write',
    write: true,
    body: {
      type: 'object',
      required: ['taskId'],
      properties: {
        taskId: entityRefProp('Task id'),
        tokensUsed: { type: 'integer', minimum: 0 },
        tokensInput: { type: 'integer', minimum: 0, nullable: true },
        tokensOutput: { type: 'integer', minimum: 0, nullable: true },
        tokensCache: { type: 'integer', minimum: 0, nullable: true },
        tokensCacheWrite: { type: 'integer', minimum: 0, nullable: true },
        modelId: { type: 'string', maxLength: 80, nullable: true },
        pricingTier: { type: 'string', maxLength: 32, nullable: true },
        usageOccurredAt: { type: 'string', maxLength: 40, nullable: true },
        billingPeriod: { type: 'string', maxLength: 7, nullable: true },
        aiSystemId: { type: 'string', format: 'uuid', nullable: true },
        cloudAgentId: {
          type: 'string',
          maxLength: 80,
          nullable: true,
          description: 'Cursor cloud agent id. Links imported usage onto this task.',
        },
      },
    },
  },
  {
    name: 'list_hub_tools',
    description:
      'List every invokable hub tool name, scope, and short description (including tools only reachable via call_hub_tool).',
    scope: 'projects:read',
    body: { type: 'object', properties: {} },
  },
  {
    name: 'call_hub_tool',
    description:
      'Invoke any hub tool by name (escape hatch for tools not listed as first-class Actions). Prefer first-class tools when available. Requires the target tool’s scope (e.g. pm:write).',
    scope: 'projects:read',
    openApi: true,
    body: {
      type: 'object',
      required: ['toolName', 'arguments'],
      properties: {
        toolName: stringProp('Exact tool name from list_hub_tools', {
          minLength: 1,
          maxLength: 80,
        }),
        arguments: {
          type: 'object',
          description: 'JSON arguments for that tool',
          additionalProperties: true,
          properties: {},
        },
      },
    },
  },
];

export function toolDefinitionsForGemini(includeWriteTools: boolean): LlmToolDef[] {
  return LLM_TOOL_CATALOG.filter((tool) => {
    if (tool.name === 'call_hub_tool' || tool.name === 'list_hub_tools') return false;
    if (!includeWriteTools && tool.write) return false;
    return true;
  });
}

/** ChatGPT Actions / OpenWebUI OpenAPI — curated ≤30 first-class ops. */
export function toolDefinitionsForOpenApi(includeWriteTools: boolean): LlmToolDef[] {
  return LLM_TOOL_CATALOG.filter((tool) => {
    if (!tool.openApi) return false;
    if (!includeWriteTools && tool.write) return false;
    return true;
  });
}

export function findLlmTool(name: string): LlmToolDef | undefined {
  return LLM_TOOL_CATALOG.find((tool) => tool.name === name);
}

export function listHubToolSummaries(includeWriteTools: boolean): Array<{
  name: string;
  description: string;
  scope: McpScope;
  write: boolean;
  openApiFirstClass: boolean;
}> {
  return LLM_TOOL_CATALOG.filter((tool) => {
    if (tool.name === 'call_hub_tool' || tool.name === 'list_hub_tools') return false;
    if (!includeWriteTools && tool.write) return false;
    return true;
  }).map((tool) => ({
    name: tool.name,
    description: tool.description,
    scope: tool.scope,
    write: Boolean(tool.write),
    openApiFirstClass: Boolean(tool.openApi),
  })).concat(
    includeWriteTools
      ? EXTRA_HUB_TOOLS.map(({ name, description, scope, write }) => ({
          name,
          description,
          scope,
          write,
          openApiFirstClass: false,
        }))
      : [],
  );
}

/** Cost entry row. Open object: no additionalProperties: false (PRO-T-101). */
function billingEntryResult(): Record<string, unknown> {
  return {
    type: 'object',
    required: [
      'id',
      'workspaceId',
      'aiSystemId',
      'period',
      'servicePeriodStart',
      'servicePeriodEnd',
      'provider',
      'plan',
      'type',
      'amount',
      'currency',
      'paidAt',
      'note',
      'externalRef',
      'createdAt',
      'updatedAt',
    ],
    properties: {
      id: uuidProp('Cost entry id'),
      workspaceId: uuidProp('Workspace id'),
      aiSystemId: {
        ...uuidProp('AI system id, or null when the entry is workspace-wide'),
        nullable: true,
      },
      period: {
        type: 'string',
        description:
          'Start month YYYY-MM. Derived from servicePeriodStart when that date is set.',
      },
      servicePeriodStart: {
        ...ymd,
        nullable: true,
        description:
          'Inclusive service start YYYY-MM-DD. Null keeps the whole amount in period.',
      },
      servicePeriodEnd: {
        ...ymd,
        nullable: true,
        description:
          'Exclusive renewal date YYYY-MM-DD (not included). Days are end minus start. Null with the start.',
      },
      provider: stringProp('Provider name'),
      plan: { type: 'string', nullable: true },
      type: {
        type: 'string',
        enum: ['subscription', 'plan_change', 'on_demand'],
      },
      amount: { type: 'number', description: 'Paid amount as a JSON number.' },
      currency: stringProp('Currency code'),
      paidAt: { type: 'string', nullable: true },
      note: { type: 'string', nullable: true },
      externalRef: { type: 'string', nullable: true },
      createdAt: { type: 'string' },
      updatedAt: { type: 'string' },
    },
  };
}

const EXTRA_HUB_TOOLS: Array<{
  name: string;
  description: string;
  scope: McpScope;
  write: boolean;
  body: ToolInputSchema;
  /** Open JSON Schema. Do not set additionalProperties: false (PRO-T-101). */
  output?: Record<string, unknown>;
}> = [
  {
    name: 'update_project_change_item',
    description:
      'Update a change-management item. changeId is required. Requires pm:write.',
    scope: 'pm:write',
    write: true,
    body: {
      type: 'object',
      additionalProperties: false,
      required: ['changeId'],
      properties: {
        changeId: entityRefProp('Change item id'),
        kind: {
          type: 'string',
          enum: ['scope', 'timeline', 'stakeholder', 'budget', 'other'],
        },
        title: stringProp('Title', { minLength: 1, maxLength: 300 }),
        description: { type: 'string', nullable: true, maxLength: 10000 },
        rationale: { type: 'string', nullable: true, maxLength: 10000 },
        status: {
          type: 'string',
          enum: ['proposed', 'approved', 'rejected', 'implemented', 'cancelled'],
        },
        requestedByUserId: { type: 'string', format: 'uuid', nullable: true },
        approvedByUserId: { type: 'string', format: 'uuid', nullable: true },
        effectiveDate: ymd,
        baselineStartBefore: ymd,
        baselineStartAfter: ymd,
        baselineEndBefore: ymd,
        baselineEndAfter: ymd,
        knowledgeRecordId: { ...entityRefProp('Linked knowledge record'), nullable: true },
        recordIds: {
          type: 'array',
          maxItems: 100,
          items: entityRefProp('Knowledge record id'),
        },
        sortOrder: { type: 'integer', minimum: 0, maximum: 100000 },
        archived: { type: 'boolean' },
        deliveryLinks: {
          type: 'array',
          maxItems: 200,
          items: {
            type: 'object',
            required: ['entityType', 'entityId'],
            properties: {
              entityType: {
                type: 'string',
                enum: ['epic', 'user_story', 'milestone', 'task'],
              },
              entityId: entityRefProp('Delivery entity id'),
            },
          },
        },
      },
    },
  },
  {
    name: 'update_project_ai_assistant_cost',
    description:
      'Set AI assistant cost mode on a project AI system. systemId is required. aiTokenRateCurrency is the list-price currency; null uses the project currency. Theoretical cost converts from that currency at the usage date. Requires pm:write.',
    scope: 'pm:write',
    write: true,
    body: {
      type: 'object',
      additionalProperties: false,
      required: ['systemId'],
      properties: {
        systemId: uuidProp('System id'),
        aiCostMode: {
          type: 'string',
          enum: ['flat', 'api', 'mixed', 'note_only'],
          nullable: true,
        },
        aiFlatMonthlyFee: money,
        aiTokenRatePer1k: money,
        aiTokenRateInputPer1k: money,
        aiTokenRateOutputPer1k: money,
        aiTokenRateCachePer1k: money,
        aiTokenRateCurrency: {
          type: 'string',
          minLength: 3,
          maxLength: 3,
          nullable: true,
          description: 'Currency of the token list prices. Null uses the project currency.',
        },
        aiCostNotes: { type: 'string', maxLength: 500, nullable: true },
        aiBudgetAllocation: money,
      },
    },
  },
  {
    name: 'get_ai_usage_theoretical_cost',
    description:
      'Per-month theoretical API cost. linked is allocated to a project task. unassigned is workspace-level imported usage with no task. Amounts are in the workspace reporting currency. Unpriced models are listed instead of being treated as a silent zero. from and to accept YYYY-MM or YYYY-MM-DD. Requires pm:read. Via call_hub_tool.',
    scope: 'pm:read',
    write: false,
    body: {
      type: 'object',
      additionalProperties: false,
      required: ['workspaceId'],
      properties: {
        workspaceId: uuidProp('Workspace id. Required.'),
        from: {
          type: 'string',
          description: 'Optional range start, YYYY-MM or YYYY-MM-DD.',
        },
        to: {
          type: 'string',
          description: 'Optional range end, YYYY-MM or YYYY-MM-DD.',
        },
      },
    },
  },
  {
    name: 'list_ai_model_prices',
    description:
      'List default and workspace AI model prices (input, cache write, cache read, output per 1,000,000 tokens). A workspace row overrides a matching default. Requires pm:read. Via call_hub_tool.',
    scope: 'pm:read',
    write: false,
    body: {
      type: 'object',
      additionalProperties: false,
      required: ['workspaceId'],
      properties: {
        workspaceId: uuidProp('Workspace id. Required.'),
      },
    },
  },
  {
    name: 'get_platform_ai_cost',
    description:
      'Platform AI cost summary for every workspace: paid cost by type, theoretical API cost, difference, and ratio, converted into one reporting currency (default EUR). Multi-month entries are prorated by days before conversion. Paid amounts convert on paid-at, or the service start when paid-at is missing. Theoretical cost converts from the token-rate currency at usageOccurredAt, else completedAt, else updatedAt. Months and totals include fxRate, fxRateDate, and fxSource. Entries keep the original amount and currency and add convertedAmount, convertedCurrency, fxRate, fxRateDate, and fxSource. A missing quote day uses the previous quote. reportingCurrency overrides the total currency. Defaults to the last 12 months. System administrator only. Requires pm:read. Via call_hub_tool.',
    scope: 'pm:read',
    write: false,
    body: {
      type: 'object',
      additionalProperties: false,
      properties: {
        from: {
          type: 'string',
          pattern: '^\\d{4}-(0[1-9]|1[0-2])$',
          description: 'First month YYYY-MM. Defaults to 11 months before to.',
        },
        to: {
          type: 'string',
          pattern: '^\\d{4}-(0[1-9]|1[0-2])$',
          description: 'Last month YYYY-MM. Defaults to the current UTC month.',
        },
        reportingCurrency: {
          type: 'string',
          minLength: 3,
          maxLength: 3,
          description: 'Currency of the cross-workspace total. Default EUR.',
        },
      },
    },
  },
  {
    name: 'list_ai_billing_entries',
    description:
      'List workspace AI cost entries. Each row includes servicePeriodStart (inclusive) and servicePeriodEnd (exclusive renewal date, not included). period is the start month. A span is prorated by days (end minus start) when paid cost is computed. amount and currency are original. convertedAmount, convertedCurrency, fxRate, fxRateDate, and fxSource are the workspace reporting-currency conversion (paid-at, or the service start when paid-at is missing). A missing quote day uses the previous quote. Optional period matches any month the row contributes to. Optional service dates keep rows whose window overlaps that range. The stored end is not a billed day. Requires pm:read.',
    scope: 'pm:read',
    write: false,
    body: {
      type: 'object',
      additionalProperties: false,
      required: ['workspaceId'],
      properties: {
        workspaceId: uuidProp('Workspace id'),
        period: {
          type: 'string',
          pattern: '^\\d{4}-(0[1-9]|1[0-2])$',
          description: 'Optional YYYY-MM filter. Matches any month the row contributes to.',
        },
        aiSystemId: uuidProp('Optional AI system id'),
        servicePeriodStart: {
          ...ymd,
          description:
            'Optional YYYY-MM-DD. Keep rows whose exclusive service end is after this date.',
        },
        servicePeriodEnd: {
          ...ymd,
          description:
            'Optional YYYY-MM-DD. Keep rows whose service window starts on or before this date.',
        },
      },
    },
    output: {
      type: 'object',
      required: ['entries'],
      properties: {
        entries: {
          type: 'array',
          items: billingEntryResult(),
        },
      },
    },
  },
  {
    name: 'create_ai_billing_entry',
    description:
      'Add a paid AI cost entry (subscription, plan_change, or on_demand). plan_change may be negative. currency is an ISO 4217 code from the project currency list; lowercase is stored as uppercase. Optional servicePeriodStart and servicePeriodEnd (YYYY-MM-DD) prorate the amount across months by days. servicePeriodStart is included. servicePeriodEnd is exclusive: the renewal or next billing date, not included. Days are end minus start. A one-day entry has end = start + 1, and end must be after start. period is then the start month and may be omitted. Omit both dates to keep the whole amount in period. provider is a free string. Requires pm:write.',
    scope: 'pm:write',
    write: true,
    body: {
      type: 'object',
      additionalProperties: false,
      required: ['workspaceId', 'provider', 'type', 'amount', 'currency'],
      properties: {
        workspaceId: uuidProp('Workspace id'),
        period: {
          type: 'string',
          pattern: '^\\d{4}-(0[1-9]|1[0-2])$',
          description:
            'YYYY-MM. Required when service dates are omitted. When servicePeriodStart is set, period is that month.',
        },
        servicePeriodStart: {
          ...ymd,
          nullable: true,
          description: 'Inclusive service start YYYY-MM-DD. Set with servicePeriodEnd.',
        },
        servicePeriodEnd: {
          ...ymd,
          nullable: true,
          description:
            'Exclusive renewal date YYYY-MM-DD (not included). Must be after the start. A one-day entry ends the next day.',
        },
        provider: stringProp('Provider name, for example Cursor', {
          minLength: 1,
          maxLength: 80,
        }),
        type: {
          type: 'string',
          enum: ['subscription', 'plan_change', 'on_demand'],
        },
        amount: {
          oneOf: [{ type: 'number' }, { type: 'string' }],
          description: 'Paid amount. Negative only for plan_change.',
        },
        currency: {
          type: 'string',
          minLength: 3,
          maxLength: 3,
          description:
            'ISO 4217 currency. Lowercase is stored as uppercase. Allowed: EUR, USD, GBP, CHF, HUF, PLN, CZK, RON, SEK, NOK, DKK, CAD, AUD, JPY.',
        },
        aiSystemId: { ...uuidProp('AI system id, or null for the workspace-wide pool'), nullable: true },
        plan: { type: 'string', maxLength: 80, nullable: true },
        paidAt: { type: 'string', maxLength: 40, nullable: true },
        note: { type: 'string', maxLength: 500, nullable: true },
        externalRef: { type: 'string', maxLength: 120, nullable: true },
      },
    },
    output: {
      type: 'object',
      required: ['entry'],
      properties: { entry: billingEntryResult() },
    },
  },
  {
    name: 'update_ai_billing_entry',
    description:
      'Update one AI cost entry. currency is an ISO 4217 code from the project currency list; lowercase is stored as uppercase. Optional servicePeriodStart (inclusive) and servicePeriodEnd (exclusive renewal date, not included) replace the window. Days are end minus start, and end must be after start. A one-day entry has end = start + 1. period is then the start month. Send null for both dates to clear them. provider stays a free string. Requires pm:write.',
    scope: 'pm:write',
    write: true,
    body: {
      type: 'object',
      additionalProperties: false,
      required: ['entryId'],
      properties: {
        entryId: uuidProp('Cost entry id'),
        period: { type: 'string', pattern: '^\\d{4}-(0[1-9]|1[0-2])$' },
        servicePeriodStart: {
          ...ymd,
          nullable: true,
          description: 'Inclusive service start YYYY-MM-DD.',
        },
        servicePeriodEnd: {
          ...ymd,
          nullable: true,
          description:
            'Exclusive renewal date YYYY-MM-DD (not included). Must be after the start.',
        },
        provider: stringProp('Provider name', { minLength: 1, maxLength: 80 }),
        type: {
          type: 'string',
          enum: ['subscription', 'plan_change', 'on_demand'],
        },
        amount: { oneOf: [{ type: 'number' }, { type: 'string' }] },
        currency: {
          type: 'string',
          minLength: 3,
          maxLength: 3,
          description:
            'ISO 4217 currency. Lowercase is stored as uppercase. Allowed: EUR, USD, GBP, CHF, HUF, PLN, CZK, RON, SEK, NOK, DKK, CAD, AUD, JPY.',
        },
        aiSystemId: { ...uuidProp('AI system id'), nullable: true },
        plan: { type: 'string', maxLength: 80, nullable: true },
        paidAt: { type: 'string', maxLength: 40, nullable: true },
        note: { type: 'string', maxLength: 500, nullable: true },
        externalRef: { type: 'string', maxLength: 120, nullable: true },
      },
    },
    output: {
      type: 'object',
      required: ['entry'],
      properties: { entry: billingEntryResult() },
    },
  },
  {
    name: 'delete_ai_billing_entry',
    description: 'Delete one AI cost entry. Requires pm:write.',
    scope: 'pm:write',
    write: true,
    body: {
      type: 'object',
      additionalProperties: false,
      required: ['entryId'],
      properties: { entryId: uuidProp('Cost entry id') },
    },
  },
  {
    name: 'list_ai_usage_import_summaries',
    description:
      'List saved AI usage import summaries and paged unassigned usage rows. Requires pm:read.',
    scope: 'pm:read',
    write: false,
    body: {
      type: 'object',
      additionalProperties: false,
      required: ['workspaceId'],
      properties: {
        workspaceId: uuidProp('Workspace id'),
        importId: uuidProp('Import id. Limits summaries and unassigned rows to one import.'),
        limit: { type: 'integer', minimum: 1, maximum: 100 },
        cursor: stringProp('Summary page cursor', { minLength: 1, maxLength: 200 }),
        unassignedLimit: { type: 'integer', minimum: 1, maximum: 100 },
        unassignedCursor: stringProp('Unassigned page cursor', { minLength: 1, maxLength: 200 }),
      },
    },
  },
  {
    name: 'list_ai_usage_imports',
    description:
      'List workspace AI usage imports. Counts cover total, inserted, duplicate, linked, error, and no-token rows. Requires pm:read.',
    scope: 'pm:read',
    write: false,
    body: {
      type: 'object',
      additionalProperties: false,
      required: ['workspaceId'],
      properties: {
        workspaceId: uuidProp('Workspace id'),
        limit: { type: 'integer', minimum: 1, maximum: 100 },
      },
    },
  },
  {
    name: 'import_ai_usage_csv',
    description:
      'Import a Cursor usage CSV. Dedupes on Date, Cloud Agent ID, Model, and Total Tokens. Rows with every token column empty are skipped. Workspace administrator only. Requires pm:write.',
    scope: 'pm:write',
    write: true,
    body: {
      type: 'object',
      additionalProperties: false,
      required: ['workspaceId', 'csv'],
      properties: {
        workspaceId: uuidProp('Workspace id'),
        csv: stringProp('Cursor usage CSV text', { minLength: 1, maxLength: 8_000_000 }),
        fileName: { type: 'string', maxLength: 200, nullable: true },
      },
    },
  },
];

/** Invocable by name, but kept off list_hub_tools (prefer the chunked media flow). */
const UNLISTED_INPUT_SCHEMAS: Record<string, ToolInputSchema> = {
  upload_workspace_media: {
    type: 'object',
    additionalProperties: false,
    required: ['workspaceId', 'contentBase64', 'contentType'],
    properties: {
      workspaceId: uuidProp('Workspace id'),
      contentBase64: stringProp('Raw base64 image bytes, without a data: prefix', {
        minLength: 1,
        maxLength: 10_000_000,
      }),
      contentType: {
        type: 'string',
        enum: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
      },
      filename: stringProp('Filename', { minLength: 1, maxLength: 200 }),
      alt: stringProp('Alt text', { maxLength: 300 }),
      knowledgeRecordId: entityRefProp('Knowledge record id'),
      insertIntoRecord: { type: 'boolean' },
      targetEntityType: {
        type: 'string',
        enum: ['epic', 'user_story', 'milestone', 'task', 'sprint', 'raid', 'change'],
      },
      targetEntityId: entityRefProp('Target item id'),
    },
  },
};

for (const tool of LLM_TOOL_CATALOG) {
  annotateRequiredFieldDescriptions(tool.body);
}
for (const tool of EXTRA_HUB_TOOLS) {
  annotateRequiredFieldDescriptions(tool.body);
}
for (const schema of Object.values(UNLISTED_INPUT_SCHEMAS)) {
  annotateRequiredFieldDescriptions(schema);
}

function asToolArgs(body: unknown): Record<string, unknown> {
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    return { ...(body as Record<string, unknown>) };
  }
  return {};
}

/**
 * Names of top-level arguments that are not in the tool schema.
 * Objects with additionalProperties: true (itDetails, call_hub_tool arguments) stay open.
 */
export function unknownToolFields(
  schema: Record<string, unknown> | undefined,
  value: unknown,
): string[] {
  if (!schema || schema.type !== 'object' || schema.additionalProperties === true) {
    return [];
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const properties = schema.properties;
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) {
    return [];
  }
  const props = properties as Record<string, unknown>;
  const record = value as Record<string, unknown>;
  const allowed = new Set(Object.keys(props));
  const unknown = Object.keys(record).filter((key) => !allowed.has(key));
  const nested: string[] = [];
  for (const key of allowed) {
    if (!(key in record)) continue;
    const child = props[key];
    if (!child || typeof child !== 'object') continue;
    for (const path of nestedUnknownFields(child as Record<string, unknown>, record[key])) {
      nested.push(path.startsWith('[') ? `${key}${path}` : `${key}.${path}`);
    }
  }
  return [...unknown, ...nested];
}

/**
 * Nested objects reject unknown keys only when the schema sets
 * additionalProperties: false. Open objects (itDetails, call_hub_tool) stay open.
 */
function nestedUnknownFields(
  schema: Record<string, unknown>,
  value: unknown,
): string[] {
  if (schema.type === 'array' && Array.isArray(value)) {
    const items = schema.items;
    if (!items || typeof items !== 'object' || Array.isArray(items)) return [];
    const itemSchema = items as Record<string, unknown>;
    if (itemSchema.additionalProperties !== false) return [];
    const found: string[] = [];
    value.forEach((item, index) => {
      for (const path of unknownToolFields(itemSchema, item)) {
        found.push(`[${index}].${path}`);
      }
    });
    return found;
  }
  if (schema.type === 'object' && schema.additionalProperties === false) {
    return unknownToolFields(schema, value);
  }
  return [];
}

function assertKnownToolFields(
  schema: Record<string, unknown> | undefined,
  value: unknown,
): void {
  const unknown = unknownToolFields(schema, value);
  if (unknown.length === 0) return;
  const message =
    unknown.length === 1
      ? `Unknown field: ${unknown[0]}`
      : `Unknown fields: ${unknown.join(', ')}`;
  throw new AppError({
    code: 'VALIDATION_ERROR',
    message,
    statusCode: 400,
  });
}

/** Invoke a catalog tool by name. Used by OpenAPI and the ChatGPT OAuth dispatcher. */
export async function invokeNamedHubTool(
  handlers: object,
  scopes: string[],
  toolName: string,
  body: unknown,
  depth = 0,
): Promise<unknown> {
  if (depth > 1) {
    throw new AppError({
      code: 'VALIDATION_ERROR',
      message: 'call_hub_tool cannot nest another call_hub_tool',
      statusCode: 400,
    });
  }

  if (toolName === 'list_hub_tools') {
    if (!hasMcpScope(scopes, 'projects:read')) {
      throw new AppError({
        code: 'FORBIDDEN',
        message: 'Missing required scope: projects:read',
        statusCode: 403,
      });
    }
    const includeWrite =
      hasMcpScope(scopes, 'knowledge:write')
      || hasMcpScope(scopes, 'pm:write')
      || hasMcpScope(scopes, 'catalogue:write')
      || hasMcpScope(scopes, 'projects:write');
    return { tools: listHubToolSummaries(includeWrite) };
  }

  if (toolName === 'call_hub_tool') {
    const raw = asToolArgs(body);
    if (typeof raw.toolName !== 'string' || raw.toolName.trim().length === 0) {
      throw new AppError({
        code: 'VALIDATION_ERROR',
        message: 'toolName is required',
        statusCode: 400,
      });
    }
    const innerName = raw.toolName.trim();
    if (innerName === 'call_hub_tool') {
      throw new AppError({
        code: 'VALIDATION_ERROR',
        message: 'call_hub_tool cannot invoke itself',
        statusCode: 400,
      });
    }
    const innerArgs =
      raw.arguments && typeof raw.arguments === 'object' && !Array.isArray(raw.arguments)
        ? raw.arguments
        : {};
    return invokeNamedHubTool(handlers, scopes, innerName, innerArgs, depth + 1);
  }

  const catalog = findLlmTool(toolName);
  const extra = EXTRA_HUB_TOOLS.find((tool) => tool.name === toolName);
  const requiredScope = catalog?.scope ?? extra?.scope
    ?? (toolName === 'upload_workspace_media' ? 'knowledge:write' : undefined);
  if (!requiredScope) {
    throw new AppError({
      code: 'NOT_FOUND',
      message: `Unknown tool: ${toolName}`,
      statusCode: 404,
    });
  }
  if (!hasMcpScope(scopes, requiredScope)) {
    throw new AppError({
      code: 'FORBIDDEN',
      message: `Missing required scope: ${requiredScope}`,
      statusCode: 403,
    });
  }

  const methodName = toolNameToHandlerMethod(toolName);
  const fn = (handlers as Record<string, unknown>)[methodName];
  if (typeof fn !== 'function') {
    throw new AppError({
      code: 'NOT_FOUND',
      message: `Tool handler not available: ${toolName}`,
      statusCode: 404,
    });
  }

  const rawArgs = asToolArgs(body);
  const inputSchema = catalog?.body ?? extra?.body ?? UNLISTED_INPUT_SCHEMAS[toolName];
  if (inputSchema) {
    assertKnownToolFields(inputSchema as Record<string, unknown>, rawArgs);
  }
  const args = {
    ...(catalog?.defaults ?? {}),
    ...rawArgs,
  };
  assertToolInput(inputSchema, args);
  return (fn as (input: Record<string, unknown>) => Promise<unknown>).call(handlers, args);
}

/** snake_case tool name → camelCase McpToolHandlers method. */
export function toolNameToHandlerMethod(toolName: string): string {
  return toolName.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}
