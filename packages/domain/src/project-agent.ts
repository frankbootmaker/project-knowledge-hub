import { AppError, projectStatusSchema, type ProjectStatus } from './index.js';

/** Delivery approach stored on a project. Optional for human and MCP creates. */
export const PROJECT_METHODOLOGIES = [
  'scrum',
  'kanban',
  'waterfall',
  'hybrid',
] as const;

export type ProjectMethodology = (typeof PROJECT_METHODOLOGIES)[number];

const METHODOLOGY_SET = new Set<string>(PROJECT_METHODOLOGIES);

export function parseProjectMethodology(
  value: string | null | undefined,
): ProjectMethodology | null {
  if (value == null || value === '') return null;
  if (!METHODOLOGY_SET.has(value)) {
    throw new AppError({
      code: 'VALIDATION_ERROR',
      message:
        `Invalid methodology "${value}". Allowed values: ${PROJECT_METHODOLOGIES.join(', ')}.`,
      statusCode: 400,
    });
  }
  return value as ProjectMethodology;
}

/**
 * Stages an MCP client may move a project to.
 * `idea` cannot leave idea — a human promotes it to active in the hub.
 */
const MCP_STAGE_TARGETS: Record<ProjectStatus, readonly ProjectStatus[]> = {
  idea: [],
  planned: ['paused', 'maintenance', 'completed'],
  active: ['paused', 'maintenance', 'completed', 'planned'],
  maintenance: ['active', 'paused', 'completed', 'planned'],
  paused: ['active', 'planned', 'maintenance', 'completed'],
  completed: ['active', 'maintenance', 'paused'],
  archived: [],
};

export function assertMcpProjectStageChange(current: string, next: string): ProjectStatus {
  const from = projectStatusSchema.safeParse(current);
  const to = projectStatusSchema.safeParse(next);
  if (!from.success || !to.success) {
    throw new AppError({
      code: 'VALIDATION_ERROR',
      message: `Invalid project stage "${next}". Allowed stages: ${projectStatusSchema.options.join(', ')}.`,
      statusCode: 400,
    });
  }
  if (from.data === to.data) return to.data;
  if (to.data === 'archived' || from.data === 'archived') {
    throw new AppError({
      code: 'PROJECT_STAGE_FORBIDDEN',
      message:
        'MCP cannot archive or restore a project. A human changes the archived stage in the hub.',
      statusCode: 403,
    });
  }
  if (from.data === 'idea') {
    throw new AppError({
      code: 'PROJECT_STAGE_FORBIDDEN',
      message:
        `MCP cannot promote an idea project to "${to.data}". ` +
        'A human must set the stage to active in the hub. ' +
        'update_project may change name, description, methodology, and currency while the project stays in idea.',
      statusCode: 403,
    });
  }
  const allowed = MCP_STAGE_TARGETS[from.data];
  if (!allowed.includes(to.data)) {
    throw new AppError({
      code: 'PROJECT_STAGE_FORBIDDEN',
      message:
        `MCP cannot change stage from "${from.data}" to "${to.data}". ` +
        `Allowed stages from ${from.data}: ${allowed.join(', ') || 'none'}.`,
      statusCode: 403,
    });
  }
  return to.data;
}

export function normalizeProjectName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function levenshtein(left: string, right: string): number {
  const rows = left.length + 1;
  const cols = right.length + 1;
  const matrix: number[][] = Array.from({ length: rows }, () => Array(cols).fill(0));
  for (let row = 0; row < rows; row += 1) matrix[row]![0] = row;
  for (let col = 0; col < cols; col += 1) matrix[0]![col] = col;
  for (let row = 1; row < rows; row += 1) {
    for (let col = 1; col < cols; col += 1) {
      const cost = left[row - 1] === right[col - 1] ? 0 : 1;
      matrix[row]![col] = Math.min(
        matrix[row - 1]![col]! + 1,
        matrix[row]![col - 1]! + 1,
        matrix[row - 1]![col - 1]! + cost,
      );
    }
  }
  return matrix[left.length]![right.length]!;
}

/** Same name, reordered words, or a very small edit distance. */
export function projectNamesAreSimilar(left: string, right: string): boolean {
  const a = normalizeProjectName(left);
  const b = normalizeProjectName(right);
  if (!a || !b) return false;
  if (a === b) return true;
  const tokensA = a.split(' ').sort().join(' ');
  const tokensB = b.split(' ').sort().join(' ');
  if (tokensA === tokensB) return true;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen < 4 || Math.abs(a.length - b.length) > 2) return false;
  const limit = maxLen < 8 ? 1 : 2;
  return levenshtein(a.slice(0, 80), b.slice(0, 80)) <= limit;
}

export type ProjectFieldGuide = {
  name: string;
  required: boolean;
  description: string;
  enum?: readonly string[];
};

export type ProjectAgentMetadata = {
  version: 1;
  stages: Array<{ value: ProjectStatus; description: string }>;
  methodologies: Array<{ value: ProjectMethodology; description: string }>;
  createProject: {
    requiredFields: string[];
    optionalFields: string[];
    fields: ProjectFieldGuide[];
    mcpWriteConstraints: {
      stage: 'idea';
      notes: string[];
    };
  };
  updateProject: {
    fields: ProjectFieldGuide[];
    stageTransitions: Record<string, readonly string[]>;
    notes: string[];
  };
};

export function buildProjectMetadata(): ProjectAgentMetadata {
  return {
    version: 1,
    stages: [
      {
        value: 'idea',
        description:
          'Proposal. MCP-created projects start here. Only a human can promote idea to active.',
      },
      { value: 'planned', description: 'Accepted and scheduled, not yet in delivery.' },
      { value: 'active', description: 'Live project. Humans set this from the hub.' },
      { value: 'maintenance', description: 'Delivered and in upkeep.' },
      { value: 'paused', description: 'Temporarily stopped.' },
      { value: 'completed', description: 'Finished.' },
      { value: 'archived', description: 'Hidden from default lists. Humans archive in the hub.' },
    ],
    methodologies: [
      { value: 'scrum', description: 'Sprints, stories, and a definition of done.' },
      { value: 'kanban', description: 'Continuous flow without a sprint cadence.' },
      { value: 'waterfall', description: 'Sequential phases.' },
      { value: 'hybrid', description: 'Mix of iterative delivery and phase gates.' },
    ],
    createProject: {
      requiredFields: ['workspaceId', 'name'],
      optionalFields: [
        'description',
        'keyPrefix',
        'currency',
        'methodology',
        'confirmDuplicateName',
        'generatedByModel',
      ],
      fields: [
        {
          name: 'workspaceId',
          required: true,
          description:
            'Workspace UUID from list_workspaces. writesAllowed must be true and role must be maintainer, workspace_admin, or system_admin.',
        },
        {
          name: 'name',
          required: true,
          description: 'Project name, 1–160 characters.',
        },
        {
          name: 'description',
          required: false,
          description: 'Optional longer description, up to 10000 characters.',
        },
        {
          name: 'keyPrefix',
          required: false,
          description:
            'Issue key prefix, AAA or AA0. Omit to auto-assign. Taken includes a retired prefix reserved in the workspace. If the value is taken, the error includes a suggested available prefix.',
        },
        {
          name: 'currency',
          required: false,
          description: 'Project currency. Defaults to EUR. No foreign exchange.',
        },
        {
          name: 'methodology',
          required: false,
          description: 'scrum, kanban, waterfall, or hybrid.',
          enum: PROJECT_METHODOLOGIES,
        },
        {
          name: 'confirmDuplicateName',
          required: false,
          description:
            'Set true only after a duplicate-name warning. Otherwise a similar name in the workspace is rejected.',
        },
        {
          name: 'generatedByModel',
          required: false,
          description: 'Optional model id stored as provenance, for example gpt-4.1.',
        },
      ],
      mcpWriteConstraints: {
        stage: 'idea',
        notes: [
          'Call list_project_metadata before create_project.',
          'Requires projects:write, a non-empty workspace allow-list, and an acting user who can create projects.',
          'MCP always creates stage idea. Do not send status or stage. A human promotes the project to active.',
          'The result includes id, keyPrefix, and url so you can create records, epics, tasks, and RAID items immediately.',
          'A similar project name returns an error naming the existing project. Retry with confirmDuplicateName true only when a second project is intended.',
        ],
      },
    },
    updateProject: {
      fields: [
        { name: 'projectId', required: true, description: 'Project UUID.' },
        { name: 'name', required: false, description: 'New name.' },
        { name: 'description', required: false, description: 'New description, or null to clear.' },
        {
          name: 'methodology',
          required: false,
          description: 'scrum, kanban, waterfall, hybrid, or null to clear.',
          enum: PROJECT_METHODOLOGIES,
        },
        { name: 'currency', required: false, description: 'Project currency.' },
        {
          name: 'status',
          required: false,
          description:
            'Stage. Alias: stage. MCP cannot promote idea to active or any other stage.',
        },
      ],
      stageTransitions: MCP_STAGE_TARGETS,
      notes: [
        'Requires projects:write and the same workspace role as create_project.',
        'Idea projects stay idea until a human promotes them.',
        'Each update writes an audit entry.',
        'Renaming into a similar existing name uses the same confirmDuplicateName flag as create.',
      ],
    },
  };
}
