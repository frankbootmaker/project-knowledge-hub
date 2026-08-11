/**
 * Shared LLM / OpenAPI / Gemini tool catalog.
 * ChatGPT Actions hard-limit ~30 operations — mark a curated subset with openApi: true
 * and expose the rest via call_hub_tool.
 */

import { RECORD_TYPES } from '@project-knowledge-hub/domain';
import type { McpScope } from './scopes.js';

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
    description: `${description} (UUID or human key, e.g. HL1-T-12 / HL1-VIS-2)`,
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

const taskStatus = {
  type: 'string',
  enum: ['todo', 'in_progress', 'blocked', 'done', 'cancelled'],
};

const milestoneStatus = {
  type: 'string',
  enum: ['planned', 'in_progress', 'done', 'cancelled'],
};

const epicStatus = {
  type: 'string',
  enum: ['planned', 'in_progress', 'done', 'cancelled'],
};

const sprintStatus = {
  type: 'string',
  enum: ['planned', 'active', 'completed', 'cancelled'],
};

const raciRole = { type: 'string', enum: ['R', 'A', 'C', 'I'] };

/** Full tool surface for Gemini + call_hub_tool. */
export const LLM_TOOL_CATALOG: LlmToolDef[] = [
  // —— Knowledge / catalogue (OpenAPI first-class) ——
  {
    name: 'list_projects',
    description: 'List accessible projects in allowed workspaces',
    scope: 'projects:read',
    openApi: true,
    defaults: { limit: 50 },
    body: {
      type: 'object',
      properties: {
        workspaceId: uuidProp('Optional workspace filter'),
        limit: { type: 'integer', minimum: 1, maximum: 50, description: 'Max results' },
      },
    },
  },
  {
    name: 'list_systems',
    description: 'List accessible systems in allowed workspaces',
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
    description: 'Get a project by id (baseline, DoD, keyPrefix, budgets)',
    scope: 'projects:read',
    openApi: true,
    body: {
      type: 'object',
      required: ['projectId'],
      properties: { projectId: uuidProp('Project id') },
    },
  },
  {
    name: 'get_system',
    description: 'Get a system by id',
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
      'List knowledge records (excludes archived). Prefer language en unless asked otherwise. Returns humanKey when present.',
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
      'Get a knowledge record (truncated markdown + media). recordId may be UUID or document key.',
    scope: 'knowledge:read',
    openApi: true,
    body: {
      type: 'object',
      required: ['recordId'],
      properties: { recordId: entityRefProp('Knowledge record id') },
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
      'Update a knowledge record as draft, or soft-archive with archived=true (+ changeMessage). Requires knowledge:write.',
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
    name: 'begin_workspace_media_upload',
    description:
      'Start chunked image upload (ChatGPT-safe). Next: append then finalize. Requires knowledge:write.',
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
    description: 'Finish chunked upload; returns media.markdownSnippet. Requires knowledge:write.',
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
    description: 'List delivery tasks for a project (optional milestone/sprint filter). Requires pm:read.',
    scope: 'pm:read',
    openApi: true,
    body: {
      type: 'object',
      required: ['projectId'],
      properties: {
        projectId: uuidProp('Project id'),
        milestoneId: entityRefProp('Optional milestone filter'),
        unassignedMilestone: { type: 'boolean' },
        sprintId: entityRefProp('Optional sprint filter'),
        unassignedSprint: { type: 'boolean' },
        includeArchived: { type: 'boolean' },
      },
    },
  },
  {
    name: 'get_project_task',
    description: 'Get one task with RACI. taskId may be UUID or HL1-T-12. Requires pm:read.',
    scope: 'pm:read',
    openApi: true,
    body: {
      type: 'object',
      required: ['taskId'],
      properties: { taskId: entityRefProp('Task id') },
    },
  },
  {
    name: 'create_project_task',
    description:
      'Create a live delivery task (not a knowledge note). Optional RACI, story, sprint, points. Requires pm:write.',
    scope: 'pm:write',
    write: true,
    openApi: true,
    body: {
      type: 'object',
      required: ['projectId', 'title'],
      properties: {
        projectId: uuidProp('Project id'),
        title: stringProp('Task title', { minLength: 1, maxLength: 200 }),
        description: { type: 'string', nullable: true, maxLength: 10000 },
        status: taskStatus,
        dueDate: { ...ymd, nullable: true },
        forecastHours: money,
        actualHours: money,
        milestoneId: { ...entityRefProp('Milestone'), nullable: true },
        userStoryId: { ...entityRefProp('User story'), nullable: true },
        sprintId: { ...entityRefProp('Sprint'), nullable: true },
        storyPoints: { type: 'integer', minimum: 0, maximum: 1000, nullable: true },
        currentOwnerUserId: { type: 'string', format: 'uuid', nullable: true },
        sortOrder: { type: 'integer', minimum: 0 },
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
    description: 'Update a delivery task (status, dates, sprint, points, archive). Requires pm:write.',
    scope: 'pm:write',
    write: true,
    openApi: true,
    body: {
      type: 'object',
      required: ['taskId'],
      properties: {
        taskId: entityRefProp('Task id'),
        title: stringProp('Title', { minLength: 1, maxLength: 200 }),
        description: { type: 'string', nullable: true, maxLength: 10000 },
        status: taskStatus,
        dueDate: { ...ymd, nullable: true },
        forecastHours: money,
        actualHours: money,
        milestoneId: { ...entityRefProp('Milestone'), nullable: true },
        userStoryId: { ...entityRefProp('User story'), nullable: true },
        sprintId: { ...entityRefProp('Sprint'), nullable: true },
        storyPoints: { type: 'integer', minimum: 0, maximum: 1000, nullable: true },
        currentOwnerUserId: { type: 'string', format: 'uuid', nullable: true },
        sortOrder: { type: 'integer', minimum: 0 },
        archived: { type: 'boolean' },
      },
    },
  },
  {
    name: 'list_project_milestones',
    description: 'List project milestones. Requires pm:read.',
    scope: 'pm:read',
    openApi: true,
    body: {
      type: 'object',
      required: ['projectId'],
      properties: {
        projectId: uuidProp('Project id'),
        includeArchived: { type: 'boolean' },
      },
    },
  },
  {
    name: 'create_project_milestone',
    description: 'Create a live milestone. Requires pm:write.',
    scope: 'pm:write',
    write: true,
    openApi: true,
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
    description: 'Update a milestone. milestoneId may be UUID or HL1-M-1. Requires pm:write.',
    scope: 'pm:write',
    write: true,
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
    name: 'list_project_epics',
    description: 'List epics for a project. Requires pm:read.',
    scope: 'pm:read',
    openApi: true,
    body: {
      type: 'object',
      required: ['projectId'],
      properties: {
        projectId: uuidProp('Project id'),
        includeArchived: { type: 'boolean' },
      },
    },
  },
  {
    name: 'create_project_epic',
    description: 'Create an epic. Requires pm:write.',
    scope: 'pm:write',
    write: true,
    openApi: true,
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
    description: 'List user stories (optional epic filter). Requires pm:read.',
    scope: 'pm:read',
    openApi: true,
    body: {
      type: 'object',
      required: ['projectId'],
      properties: {
        projectId: uuidProp('Project id'),
        epicId: entityRefProp('Optional epic filter'),
        includeArchived: { type: 'boolean' },
      },
    },
  },
  {
    name: 'create_project_user_story',
    description: 'Create a user story under an epic. Requires pm:write.',
    scope: 'pm:write',
    write: true,
    openApi: true,
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
    description: 'List Scrum sprints (committed/done points). Requires pm:read.',
    scope: 'pm:read',
    openApi: true,
    body: {
      type: 'object',
      required: ['projectId'],
      properties: {
        projectId: uuidProp('Project id'),
        includeArchived: { type: 'boolean' },
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
      'List tasks where the API client acting user is on RACI (My tasks). Requires pm:read + actingUserId.',
    scope: 'pm:read',
    openApi: true,
    body: {
      type: 'object',
      properties: {
        role: raciRole,
        includeArchived: { type: 'boolean' },
      },
    },
  },

  // —— Extended tools (Gemini + call_hub_tool; not first-class OpenAPI) ——
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
    description: 'List recent workspace media with markdownSnippet.',
    scope: 'knowledge:read',
    defaults: { limit: 20 },
    body: {
      type: 'object',
      required: ['workspaceId'],
      properties: {
        workspaceId: uuidProp('Workspace id'),
        knowledgeRecordId: entityRefProp('Optional record filter'),
        limit: { type: 'integer', minimum: 1, maximum: 50 },
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
    description: 'Redacted platform health. Requires monitoring:read.',
    scope: 'monitoring:read',
    body: { type: 'object', properties: {} },
  },
  {
    name: 'update_project_epic',
    description: 'Update an epic. Requires pm:write.',
    scope: 'pm:write',
    write: true,
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
    description: 'Update a user story. Requires pm:write.',
    scope: 'pm:write',
    write: true,
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
    description: 'List activity timeline for a task. Requires pm:read.',
    scope: 'pm:read',
    body: {
      type: 'object',
      required: ['taskId'],
      properties: { taskId: entityRefProp('Task id') },
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
    description: 'Dashboard insight rollups for the acting user. Requires pm:read + actingUserId.',
    scope: 'pm:read',
    body: { type: 'object', properties: {} },
  },
  {
    name: 'get_project_budget_summary',
    description: 'EVM summary, RAG, burndown, epic cost rollups. Requires pm:read.',
    scope: 'pm:read',
    body: {
      type: 'object',
      required: ['projectId'],
      properties: { projectId: uuidProp('Project id') },
    },
  },
  {
    name: 'get_project_resource_utilization',
    description: 'Per-person capacity vs demand. Requires pm:read.',
    scope: 'pm:read',
    body: {
      type: 'object',
      required: ['projectId'],
      properties: {
        projectId: uuidProp('Project id'),
        view: { type: 'string', enum: ['planned', 'burn', 'combined'] },
      },
    },
  },
  {
    name: 'list_project_stakeholders',
    description: 'List project stakeholders (roster + RACI-derived). Requires pm:read.',
    scope: 'pm:read',
    body: {
      type: 'object',
      required: ['projectId'],
      properties: { projectId: uuidProp('Project id') },
    },
  },
  {
    name: 'list_project_raid_items',
    description: 'List RAID register items. Requires pm:read.',
    scope: 'pm:read',
    body: {
      type: 'object',
      required: ['projectId'],
      properties: {
        projectId: uuidProp('Project id'),
        includeArchived: { type: 'boolean' },
      },
    },
  },
  {
    name: 'create_project_raid_item',
    description: 'Create a RAID item (risk/assumption/issue/dependency). Requires pm:write.',
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
        ownerUserId: { type: 'string', format: 'uuid', nullable: true },
        dueDate: { ...ymd, nullable: true },
        sortOrder: { type: 'integer', minimum: 0 },
        taskIds: {
          type: 'array',
          maxItems: 100,
          items: entityRefProp('Linked task'),
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
    name: 'list_project_change_items',
    description: 'List change-management register items. Requires pm:read.',
    scope: 'pm:read',
    body: {
      type: 'object',
      required: ['projectId'],
      properties: {
        projectId: uuidProp('Project id'),
        includeArchived: { type: 'boolean' },
      },
    },
  },
  {
    name: 'create_project_change_item',
    description: 'Create a change-management item. Requires pm:write.',
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
      'Update baseline window, DoD, currency, budgets, keyPrefix. Requires pm:write.',
    scope: 'pm:write',
    write: true,
    body: {
      type: 'object',
      required: ['projectId'],
      properties: {
        projectId: uuidProp('Project id'),
        startDate: { ...ymd, nullable: true },
        endDate: { ...ymd, nullable: true },
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
    name: 'get_knowledge_record_delivery_links',
    description:
      'List epic/story/task/sprint links for a knowledge record. Requires knowledge:read.',
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
      'Replace delivery links (epic/story/task/sprint) for a project-scoped knowledge record. Requires knowledge:write.',
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
                enum: ['epic', 'user_story', 'task', 'sprint'],
              },
              entityId: entityRefProp('Delivery entity id'),
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
          enum: ['epic', 'user_story', 'task', 'sprint'],
        },
        entityId: entityRefProp('Optional entity filter'),
      },
    },
  },
  {
    name: 'report_project_task_ai_usage',
    description: 'Record AI token usage on a task. Requires pm:write.',
    scope: 'pm:write',
    write: true,
    body: {
      type: 'object',
      required: ['taskId', 'tokensUsed'],
      properties: {
        taskId: entityRefProp('Task id'),
        tokensUsed: { type: 'integer', minimum: 0 },
        aiSystemId: { type: 'string', format: 'uuid', nullable: true },
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
  }));
}

/** snake_case tool name → camelCase McpToolHandlers method. */
export function toolNameToHandlerMethod(toolName: string): string {
  return toolName.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}
