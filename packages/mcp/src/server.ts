import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  createKnowledgeRecordInputSchema,
  tokenCountSchema,
  updateKnowledgeRecordInputSchema,
} from '@project-knowledge-hub/domain';
import { invokeNamedHubTool } from './llm-tool-catalog.js';
import { hasMcpScope, type McpScope } from './scopes.js';
import {
  enforceResponseSize,
  MCP_MAX_CONTENT_CHARS,
  MCP_MAX_LIST_LIMIT,
} from './limits.js';
import {
  hoursPerWorkdaySchema,
  isoDateNullableSchema,
  nonWorkingDaysSchema,
  workdaysPerWeekSchema,
  sanitizeError,
  AppError,
  epicStatusSchema,
  milestoneStatusSchema,
} from '@project-knowledge-hub/domain';

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
  listWorkspaces: () => Promise<unknown>;
  listProjects: (input: {
    workspaceId?: string;
    workspaceSlug?: string;
    status?: string;
    stage?: string;
    limit: number;
  }) => Promise<unknown>;
  listProjectMetadata: () => Promise<unknown>;
  createProject: (input: {
    workspaceId: string;
    name: string;
    description?: string | null;
    keyPrefix?: string;
    currency?: string;
    methodology?: string | null;
    confirmDuplicateName?: boolean;
    generatedByModel?: string | null;
  }) => Promise<unknown>;
  updateProject: (input: {
    projectId: string;
    name?: string;
    description?: string | null;
    methodology?: string | null;
    currency?: string;
    status?: string;
    stage?: string;
    confirmDuplicateName?: boolean;
  }) => Promise<unknown>;
  listSystems: (input: {
    workspaceId?: string;
    projectId?: string;
    limit: number;
  }) => Promise<unknown>;
  createSystem: (input: {
    workspaceId: string;
    projectId?: string | null;
    name: string;
    slug?: string;
    summary?: string | null;
    description?: string | null;
    systemType?: string | null;
    status?: string;
    ownerUserId?: string | null;
    environment?: string | null;
    version?: string | null;
    criticality?: string | null;
    itDetails?: Record<string, unknown>;
    itCostMode?: 'flat' | 'one_time' | 'note_only' | null;
    itFlatMonthlyFee?: number | string | null;
    itOneTimeCost?: number | string | null;
    itBudgetAllocation?: number | string | null;
    tags?: string[];
    metadata?: Record<string, unknown> | null;
  }) => Promise<unknown>;
  updateSystem: (input: {
    systemId: string;
    projectId?: string | null;
    name?: string;
    summary?: string | null;
    description?: string | null;
    systemType?: string | null;
    status?: string;
    ownerUserId?: string | null;
    environment?: string | null;
    version?: string | null;
    criticality?: string | null;
    itDetails?: Record<string, unknown> | null;
    itCostMode?: 'flat' | 'one_time' | 'note_only' | null;
    itFlatMonthlyFee?: number | string | null;
    itOneTimeCost?: number | string | null;
    itBudgetAllocation?: number | string | null;
    tags?: string[];
    metadata?: Record<string, unknown> | null;
  }) => Promise<unknown>;
  getProject: (input: {
    projectId?: string;
    projectSlug?: string;
    workspaceId?: string;
    workspaceSlug?: string;
  }) => Promise<unknown>;
  updateProjectBaseline: (input: {
    projectId: string;
    startDate?: string | null;
    endDate?: string | null;
    charterRecordId?: string | null;
    initialPlanRecordId?: string | null;
    definitionOfDone?: string | null;
    currency?: string;
    initialBudget?: number | string | null;
    approvedBudget?: number | string | null;
    keyPrefix?: string;
    hoursPerWorkday?: number;
    workdaysPerWeek?: number;
    nonWorkingDays?: string[] | null;
  }) => Promise<unknown>;
  moveProject: (input: {
    projectId: string;
    targetWorkspaceId: string;
    dryRun?: boolean;
    confirmCrossOrganization?: boolean;
  }) => Promise<unknown>;
  getProjectBudgetSummary: (input: { projectId: string }) => Promise<unknown>;
  getProjectResourceUtilization: (input: {
    projectId: string;
    view?: 'planned' | 'burn' | 'combined';
    includeSystemUsers?: boolean;
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
  getKnowledgeRecord: (input: {
    recordId: string;
    contentOffset?: number;
    contentLimit?: number;
    boundary?: 'none' | 'paragraph' | 'line';
    expectSha256?: string;
  }) => Promise<unknown>;
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
    generatedByModel?: string;
    sourceTitle?: string;
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
    /** Soft-archive (true) or restore (false). */
    archived?: boolean;
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
    targetEntityType?: 'epic' | 'user_story' | 'milestone' | 'task' | 'sprint' | 'raid' | 'change';
    targetEntityId?: string;
  }) => Promise<unknown>;
  /** ChatGPT Actions: start a Redis-backed chunked base64 upload (prefer over single-shot). */
  beginWorkspaceMediaUpload: (input: {
    workspaceId: string;
    contentType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
    filename?: string;
    alt?: string;
    knowledgeRecordId?: string;
    insertIntoRecord?: boolean;
    targetEntityType?: 'epic' | 'user_story' | 'milestone' | 'task' | 'sprint' | 'raid' | 'change';
    targetEntityId?: string;
  }) => Promise<unknown>;
  appendWorkspaceMediaUpload: (input: {
    uploadId: string;
    chunkBase64: string;
    index?: number;
  }) => Promise<unknown>;
  finalizeWorkspaceMediaUpload: (input: { uploadId: string }) => Promise<unknown>;
  beginRecordContentUpload: (input: { recordId: string }) => Promise<unknown>;
  appendRecordContent: (input: {
    uploadId: string;
    chunk: string;
    index?: number;
  }) => Promise<unknown>;
  finalizeRecordContentUpload: (input: {
    uploadId: string;
    changeMessage: string;
    expectedLength?: number;
  }) => Promise<unknown>;
  listWorkspaceMedia: (input: {
    workspaceId: string;
    knowledgeRecordId?: string;
    query?: string;
    entityType?: 'epic' | 'user_story' | 'milestone' | 'task' | 'sprint' | 'raid' | 'change';
    entityId?: string;
    limit: number;
  }) => Promise<unknown>;
  deleteWorkspaceMedia: (input: { mediaId: string }) => Promise<unknown>;
  /** NF-014 — redacted platform health snapshot (requires monitoring:read). */
  getPlatformStatus: () => Promise<unknown>;
  /** NF-018 Project Delivery */
  listProjectMilestones: (input: {
    projectId: string;
    includeArchived?: boolean;
    limit?: number;
    cursor?: string;
  }) => Promise<unknown>;
  listProjectTasks: (input: {
    projectId: string;
    milestoneId?: string;
    unassignedMilestone?: boolean;
    sprintId?: string;
    unassignedSprint?: boolean;
    itemType?: 'task' | 'bug';
    includeArchived?: boolean;
    limit?: number;
    cursor?: string;
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
  getProjectMilestone: (input: { milestoneId: string }) => Promise<unknown>;
  setProjectMilestoneItemLinks: (input: {
    milestoneId: string;
    items: Array<{
      entityType: 'epic' | 'user_story' | 'task';
      entityId: string;
    }>;
  }) => Promise<unknown>;
  listProjectSprints: (input: {
    projectId: string;
    includeArchived?: boolean;
    limit?: number;
    cursor?: string;
  }) => Promise<unknown>;
  createProjectSprint: (input: {
    projectId: string;
    name: string;
    goal?: string | null;
    status?: string;
    startDate?: string | null;
    endDate?: string | null;
    capacityPoints?: number | null;
    sortOrder?: number;
  }) => Promise<unknown>;
  updateProjectSprint: (input: {
    sprintId: string;
    name?: string;
    goal?: string | null;
    status?: string;
    startDate?: string | null;
    endDate?: string | null;
    capacityPoints?: number | null;
    sortOrder?: number;
    archived?: boolean;
    unfinishedDestination?: 'backlog' | { sprintId: string };
  }) => Promise<unknown>;
  getProjectSprintBurndown: (input: { sprintId: string }) => Promise<unknown>;
  getProjectScrumVelocity: (input: {
    projectId: string;
    lastN?: number;
  }) => Promise<unknown>;
  listMyProjectTasks: (input: {
    role?: 'R' | 'A' | 'C' | 'I';
    includeArchived?: boolean;
    limit?: number;
    cursor?: string;
  }) => Promise<unknown>;
  getMyDashboardInsights: () => Promise<unknown>;
  setDeliveryMediaLinks: (input: {
    projectId: string;
    entityType: 'epic' | 'user_story' | 'milestone' | 'task' | 'sprint' | 'raid' | 'change';
    entityId: string;
    links: Array<
      | {
          kind: 'media';
          mediaId: string;
          title?: string | null;
          description?: string | null;
        }
      | {
          kind: 'url';
          url: string;
          title: string;
          description?: string | null;
        }
    >;
  }) => Promise<unknown>;
  listProjectDeliveryDocumentLinks: (input: {
    projectId: string;
    entityType?: string;
    entityId?: string;
  }) => Promise<unknown>;
  listDeliveryDependencies: (input: {
    projectId: string;
    entityId: string;
    entityType?: 'epic' | 'user_story' | 'task' | 'milestone' | 'sprint';
  }) => Promise<unknown>;
  setDeliveryDependency: (input: {
    projectId: string;
    predecessorId?: string;
    predecessorType?: 'epic' | 'user_story' | 'task' | 'milestone' | 'sprint';
    successorId?: string;
    successorType?: 'epic' | 'user_story' | 'task' | 'milestone' | 'sprint';
    linkType?: 'FS' | 'SS' | 'FF' | 'SF';
    lagDays?: number;
    links?: Array<{
      predecessorId: string;
      predecessorType?: 'epic' | 'user_story' | 'task' | 'milestone' | 'sprint';
      successorId: string;
      successorType?: 'epic' | 'user_story' | 'task' | 'milestone' | 'sprint';
      linkType: 'FS' | 'SS' | 'FF' | 'SF';
      lagDays?: number;
    }>;
  }) => Promise<unknown>;
  removeDeliveryDependency: (input: {
    projectId: string;
    linkId?: string;
    predecessorId?: string;
    predecessorType?: 'epic' | 'user_story' | 'task' | 'milestone' | 'sprint';
    successorId?: string;
    successorType?: 'epic' | 'user_story' | 'task' | 'milestone' | 'sprint';
  }) => Promise<unknown>;
  createProjectTask: (input: {
    projectId: string;
    title: string;
    description?: string | null;
    status?: string;
    startDate?: string | null;
    dueDate?: string | null;
    durationDays?: number | null;
    forecastHours?: number | string | null;
    actualHours?: number | string | null;
    tokensUsed?: number | null;
    tokensInput?: number | null;
    tokensOutput?: number | null;
    tokensCache?: number | null;
    modelId?: string | null;
    pricingTier?: string | null;
    usageOccurredAt?: string | null;
    billingPeriod?: string | null;
    aiSystemId?: string | null;
    milestoneId?: string | null;
    userStoryId?: string | null;
    sprintId?: string | null;
    storyPoints?: number | null;
    completionPercent?: number | null;
    currentOwnerUserId?: string | null;
    sortOrder?: number;
    raci?: Array<{ userId: string; role: 'R' | 'A' | 'C' | 'I' }>;
    itemType?: 'task' | 'bug';
    severity?: 'low' | 'medium' | 'high' | 'critical' | null;
    foundIn?: 'development' | 'test' | 'staging' | 'production' | null;
    foundInNote?: string | null;
    stepsToReproduce?: string | null;
    expectedBehavior?: string | null;
    actualBehavior?: string | null;
    resolution?:
      | 'fixed'
      | 'duplicate'
      | 'wont_fix'
      | 'cannot_reproduce'
      | 'works_as_designed'
      | null;
    regression?: boolean | null;
    affectedSystemId?: string | null;
    duplicateOfTaskId?: string | null;
  }) => Promise<unknown>;
  updateProjectTask: (input: {
    taskId: string;
    title?: string;
    description?: string | null;
    status?: string;
    startDate?: string | null;
    dueDate?: string | null;
    durationDays?: number | null;
    forecastHours?: number | string | null;
    actualHours?: number | string | null;
    tokensUsed?: number | null;
    tokensInput?: number | null;
    tokensOutput?: number | null;
    tokensCache?: number | null;
    modelId?: string | null;
    pricingTier?: string | null;
    usageOccurredAt?: string | null;
    billingPeriod?: string | null;
    aiSystemId?: string | null;
    milestoneId?: string | null;
    userStoryId?: string | null;
    sprintId?: string | null;
    storyPoints?: number | null;
    completionPercent?: number | null;
    currentOwnerUserId?: string | null;
    sortOrder?: number;
    archived?: boolean;
    itemType?: 'task' | 'bug';
    severity?: 'low' | 'medium' | 'high' | 'critical' | null;
    foundIn?: 'development' | 'test' | 'staging' | 'production' | null;
    foundInNote?: string | null;
    stepsToReproduce?: string | null;
    expectedBehavior?: string | null;
    actualBehavior?: string | null;
    resolution?:
      | 'fixed'
      | 'duplicate'
      | 'wont_fix'
      | 'cannot_reproduce'
      | 'works_as_designed'
      | null;
    regression?: boolean | null;
    affectedSystemId?: string | null;
    duplicateOfTaskId?: string | null;
  }) => Promise<unknown>;
  reportProjectTaskAiUsage: (input: {
    taskId: string;
    tokensUsed?: number;
    tokensInput?: number | null;
    tokensOutput?: number | null;
    tokensCache?: number | null;
    modelId?: string | null;
    pricingTier?: string | null;
    usageOccurredAt?: string | null;
    billingPeriod?: string | null;
    aiSystemId?: string | null;
  }) => Promise<unknown>;
  setProjectTaskRaci: (input: {
    taskId: string;
    entries: Array<{ userId: string; role: 'R' | 'A' | 'C' | 'I' }>;
  }) => Promise<unknown>;
  listProjectEpics: (input: {
    projectId: string;
    includeArchived?: boolean;
    limit?: number;
    cursor?: string;
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
    limit?: number;
    cursor?: string;
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
  listProjectTaskActivities: (input: {
    taskId: string;
    limit?: number;
    cursor?: string;
    /** When false, comment bodies are excerpted. Defaults to full text. */
    fullText?: boolean;
  }) => Promise<unknown>;
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
  listWorkspaceMembers: (input: {
    workspaceId: string;
    includeSystemUsers?: boolean;
  }) => Promise<unknown>;
  createProjectStakeholder: (input: {
    projectId: string;
    /** Omit or null to create an open job role (jobTitle required). */
    userId?: string | null;
    projectRole: string;
    jobTitle?: string | null;
    roleDescription?: string | null;
    competencies?: Array<string | { name: string; skillId?: string | null }>;
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
    projectId?: string;
    stakeholderId: string;
    projectRole?: string;
    jobTitle?: string | null;
    roleDescription?: string | null;
    competencies?: Array<string | { name: string; skillId?: string | null }>;
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
  assignProjectStakeholder: (input: {
    projectId?: string;
    stakeholderId: string;
    userId: string;
  }) => Promise<unknown>;
  unassignProjectStakeholder: (input: {
    projectId?: string;
    stakeholderId: string;
  }) => Promise<unknown>;
  updateProjectAiAssistantCost: (input: {
    systemId: string;
    aiCostMode?: 'flat' | 'api' | 'mixed' | 'note_only' | null;
    aiFlatMonthlyFee?: number | string | null;
    aiTokenRatePer1k?: number | string | null;
    aiTokenRateInputPer1k?: number | string | null;
    aiTokenRateOutputPer1k?: number | string | null;
    aiTokenRateCachePer1k?: number | string | null;
    aiCostNotes?: string | null;
    aiBudgetAllocation?: number | string | null;
  }) => Promise<unknown>;
  deleteProjectStakeholder: (input: {
    projectId?: string;
    stakeholderId: string;
  }) => Promise<unknown>;
  listProjectRaidItems: (input: {
    projectId: string;
    includeArchived?: boolean;
    limit?: number;
    cursor?: string;
  }) => Promise<unknown>;
  createProjectRaidItem: (input: {
    projectId: string;
    kind: string;
    title: string;
    description?: string | null;
    status?: string;
    severity?: string;
    probability?: string | null;
    impact?: string | null;
    ownerUserId?: string | null;
    dueDate?: string | null;
    sortOrder?: number;
    taskIds?: string[];
    recordIds?: string[];
  }) => Promise<unknown>;
  updateProjectRaidItem: (input: {
    raidItemId: string;
    kind?: string;
    title?: string;
    description?: string | null;
    status?: string;
    severity?: string;
    probability?: string | null;
    impact?: string | null;
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
  setProjectRaidRecordLinks: (input: {
    raidItemId: string;
    recordIds: string[];
  }) => Promise<unknown>;
  getKnowledgeRecordRaidLinks: (input: {
    recordId: string;
  }) => Promise<unknown>;
  setKnowledgeRecordRaidLinks: (input: {
    recordId: string;
    raidItemIds: string[];
  }) => Promise<unknown>;
  listProjectChangeItems: (input: {
    projectId: string;
    includeArchived?: boolean;
    limit?: number;
    cursor?: string;
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
  /**
   * Optional logger for error reporting. If not provided, falls back to console.error.
   */
  logger?: {
    error: (obj: Record<string, unknown>, msg?: string) => void;
  };
};

export type McpToolCallContext = {
  recordId?: string;
  projectId?: string;
  systemId?: string;
  workspaceId?: string;
  mediaId?: string;
};

/**
 * Permission failures must be AppError. A plain Error is sanitized to
 * "Internal error (ref: …)" and the missing scope never reaches the client.
 */
function requireScope(client: McpClientContext, scope: McpScope): void {
  if (!hasMcpScope(client.scopes, scope)) {
    throw new AppError({
      code: 'FORBIDDEN',
      message: `Missing required scope: ${scope}`,
      statusCode: 403,
      details: { scope },
    });
  }
}

/** ChatGPT treats this hint as a login prompt. Send it only for real auth failures. */
function oauthReauthError(error: unknown): boolean {
  return error instanceof AppError && (error.statusCode === 401 || error.statusCode === 403);
}

/**
 * Convert an error to an MCP error result, sanitizing sensitive information.
 * Only AppError messages are returned verbatim; all other errors are sanitized.
 * 
 * @param error - The error to convert
 * @param logger - Optional logger for server-side error logging
 * @returns MCP error result with safe message
 */
export function toMcpErrorResult(
  error: unknown,
  logger?: { error: (obj: Record<string, unknown>, msg?: string) => void },
): { isError: true; content: Array<{ type: 'text'; text: string }> } {
  // Only return safe error messages to MCP clients
  if (error instanceof AppError) {
    return {
      isError: true,
      content: [{ type: 'text' as const, text: error.message }],
    };
  }

  // Sanitize all other errors (database, internal, etc.)
  const sanitized = sanitizeError(error);
  if (sanitized.logPayload) {
    if (logger) {
      logger.error({ err: error, ...sanitized.logPayload }, 'MCP tool error');
    } else {
      console.error('[MCP Error]', { err: error, ...sanitized.logPayload });
    }
  }
  
  return {
    isError: true,
    content: [{ type: 'text' as const, text: sanitized.message }],
  };
}

function textResult(data: unknown) {
  const sized = enforceResponseSize(data);
  const text = JSON.stringify(sized, null, 2);
  if (sized !== data) {
    return {
      isError: true as const,
      content: [{ type: 'text' as const, text }],
    };
  }
  return {
    content: [{ type: 'text' as const, text }],
  };
}

/**
 * Result for tools that declare an outputSchema. structuredContent is what
 * the SDK validates. An oversized payload does not match that schema, so it
 * is returned as text with isError set, which skips output validation.
 *
 * Within the size limit, objects are reduced to the declared shape first.
 * The client validates the raw structuredContent against a schema that
 * rejects additional properties, while the server's Zod parse only strips
 * those keys. Sending the reduced object keeps that validation in place.
 */
function structuredTextResult(data: unknown, outputShape?: z.ZodRawShape) {
  const sized = enforceResponseSize(data);
  if (sized !== data) {
    const text = JSON.stringify(sized, null, 2);
    return {
      isError: true as const,
      content: [{ type: 'text' as const, text }],
    };
  }
  const shaped = outputShape ? stripToSchema(z.object(outputShape), data) : data;
  const text = JSON.stringify(shaped, null, 2);
  return {
    content: [{ type: 'text' as const, text }],
    structuredContent: shaped as Record<string, unknown>,
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
  options?: {
    oauth?: {
      resourceMetadataUrl: string;
      profile?: { id: string; name?: string; email?: string };
    };
  },
): McpServer {
  const server = new McpServer(
    {
      name: 'project-knowledge-hub',
      version: '0.1.0',
    },
    options?.oauth
      ? {
          instructions:
            'Call list_workspaces, then list_projects or get_project, to find a project. Use search_knowledge to find records. For a tool that is not in this list, call list_hub_tools, then call_hub_tool with that toolName and arguments.',
        }
      : undefined,
  );

  const wrap =
    (
      toolName: string,
      scope: McpScope,
      fn: () => Promise<unknown>,
      argContext?: McpToolCallContext,
      present: (data: unknown) => {
        content: Array<{ type: 'text'; text: string }>;
        isError?: true;
        structuredContent?: Record<string, unknown>;
      } = textResult,
    ) =>
    async () => {
      try {
        requireScope(client, scope);
        const data = await fn();
        await handlers.onToolCall?.(toolName, true, {
          ...argContext,
          ...extractToolContext(data),
        });
        return present(data);
      } catch (error) {
        await handlers.onToolCall?.(toolName, false, argContext);
        const result = toMcpErrorResult(error, handlers.logger);
        if (!options?.oauth || !oauthReauthError(error)) {
          return result;
        }
        const description = result.content[0]?.text ?? 'Authentication required';
        return {
          ...result,
          _meta: {
            'mcp/www_authenticate': [
              `Bearer resource_metadata="${options.oauth.resourceMetadataUrl}", error="insufficient_scope", error_description="${description.replaceAll('"', "'")}"`,
            ],
          },
        };
      }
    };

  server.tool(
    'list_workspaces',
    'List workspaces this client can access. Each row has id, name, slug, organization (id, name, slug), writesAllowed (true only when the workspace is on this client allow-list), and role (acting user membership, or system_admin). Requires projects:read. Call this before create_project.',
    {},
    async () =>
      wrap('list_workspaces', 'projects:read', () => handlers.listWorkspaces())(),
  );

  server.tool(
    'list_projects',
    'List accessible projects in allowed workspaces. Each project includes workspaceName, workspaceSlug, and status (the lifecycle stage). Filter with status or stage (idea, planned, active, maintenance, paused, completed, archived).',
    {
      workspaceId: z.string().uuid().optional(),
      workspaceSlug: z.string().min(1).max(64).optional(),
      status: z.string().min(1).max(40).optional(),
      stage: z.string().min(1).max(40).optional(),
      limit: z.number().int().min(1).max(MCP_MAX_LIST_LIMIT).optional(),
    },
    async (args) => {
      if (args.status && args.stage && args.status !== args.stage) {
        throw new AppError({
          code: 'VALIDATION_ERROR',
          message: 'status and stage must be the same value when both are sent.',
          statusCode: 400,
        });
      }
      return wrap('list_projects', 'projects:read', () =>
        handlers.listProjects({
          workspaceId: args.workspaceId,
          workspaceSlug: args.workspaceSlug,
          status: args.status ?? args.stage,
          limit: args.limit ?? MCP_MAX_LIST_LIMIT,
        }),
      )();
    },
  );

  server.tool(
    'list_project_metadata',
    'Field guide for create_project and update_project: stages, methodologies, key prefix rules, and the idea-stage constraint. Call this before create_project. Requires projects:read.',
    {},
    async () =>
      wrap('list_project_metadata', 'projects:read', () => handlers.listProjectMetadata())(),
  );

  const moneyInput = z.union([z.number(), z.string()]).nullable();
  const systemStatusEnum = z.enum([
    'proposed',
    'experimental',
    'active',
    'degraded',
    'maintenance',
    'deprecated',
    'retired',
    'archived',
  ]);
  const systemCriticalityEnum = z.enum(['low', 'medium', 'high', 'critical']);
  const systemItCostModeEnum = z.enum(['flat', 'one_time', 'note_only']);
  const systemItDetailsObject = z.object({
    hostname: z.string().max(253).optional(),
    primaryUrl: z.string().max(2000).optional(),
    ipAddresses: z.array(z.string().max(80)).max(20).optional(),
    ports: z
      .array(
        z.object({
          port: z.number().int().min(1).max(65535),
          protocol: z.string().max(40).optional(),
          service: z.string().max(80).optional(),
        }),
      )
      .max(40)
      .optional(),
    endpoints: z
      .array(
        z.object({
          name: z.string().max(120),
          url: z.string().max(2000),
        }),
      )
      .max(20)
      .optional(),
    networkZone: z.string().max(80).optional(),
    location: z.string().max(200).optional(),
    deploymentModel: z
      .enum([
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
      ])
      .optional(),
    vendor: z.string().max(120).optional(),
    product: z.string().max(120).optional(),
    platform: z.string().max(120).optional(),
    dataClassification: z
      .enum(['public', 'internal', 'confidential', 'restricted'])
      .optional(),
    backupPolicy: z.string().max(500).optional(),
    supportContact: z.string().max(200).optional(),
    documentationUrl: z.string().max(2000).optional(),
    assetTag: z.string().max(80).optional(),
    externalId: z.string().max(120).optional(),
    dependencies: z.array(z.string().max(200)).max(50).optional(),
    notes: z.string().max(5000).optional(),
  });

  const systemItDetailsPatchObject = z.object({
    hostname: z.string().max(253).nullable().optional(),
    primaryUrl: z.string().max(2000).nullable().optional(),
    ipAddresses: z.array(z.string().max(80)).max(20).nullable().optional(),
    ports: z
      .array(
        z.object({
          port: z.number().int().min(1).max(65535),
          protocol: z.string().max(40).optional(),
          service: z.string().max(80).optional(),
        }),
      )
      .max(40)
      .nullable()
      .optional(),
    endpoints: z
      .array(
        z.object({
          name: z.string().max(120),
          url: z.string().max(2000),
        }),
      )
      .max(20)
      .nullable()
      .optional(),
    networkZone: z.string().max(80).nullable().optional(),
    location: z.string().max(200).nullable().optional(),
    deploymentModel: z
      .enum([
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
      ])
      .nullable()
      .optional(),
    vendor: z.string().max(120).nullable().optional(),
    product: z.string().max(120).nullable().optional(),
    platform: z.string().max(120).nullable().optional(),
    dataClassification: z
      .enum(['public', 'internal', 'confidential', 'restricted'])
      .nullable()
      .optional(),
    backupPolicy: z.string().max(500).nullable().optional(),
    supportContact: z.string().max(200).nullable().optional(),
    documentationUrl: z.string().max(2000).nullable().optional(),
    assetTag: z.string().max(80).nullable().optional(),
    externalId: z.string().max(120).nullable().optional(),
    dependencies: z.array(z.string().max(200)).max(50).nullable().optional(),
    notes: z.string().max(5000).nullable().optional(),
  });

  server.tool(
    'list_systems',
    'List accessible systems (IT catalogue) with type, environment, criticality, version, and primary URL when set. Requires systems:read.',
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
    'create_system',
    'Create a catalogue system (IT resource) in an allowlisted workspace. Prefer linking projectId when the system serves a project. Fill itDetails whenever known. Set itCostMode (flat|one_time|note_only) plus fees so OpEx rolls into project budget AC. Money/rate fields accept number or string; returned as JSON numbers. Requires catalogue:write.',
    {
      workspaceId: z.string().uuid(),
      projectId: z.string().uuid().nullable().optional(),
      name: z.string().min(1).max(160),
      slug: z.string().min(1).max(64).optional(),
      summary: z.string().max(500).nullable().optional(),
      description: z.string().max(10000).nullable().optional(),
      systemType: z.string().max(120).nullable().optional(),
      status: systemStatusEnum.optional(),
      ownerUserId: z.string().uuid().nullable().optional(),
      environment: z.string().max(80).nullable().optional(),
      version: z.string().max(80).nullable().optional(),
      criticality: systemCriticalityEnum.nullable().optional(),
      itDetails: systemItDetailsObject.optional(),
      itCostMode: systemItCostModeEnum.nullable().optional(),
      itFlatMonthlyFee: moneyInput.optional(),
      itOneTimeCost: moneyInput.optional(),
      itBudgetAllocation: moneyInput.optional(),
      tags: z.array(z.string().min(1).max(64)).max(30).optional(),
      metadata: z.record(z.unknown()).nullable().optional(),
    },
    async (args) =>
      wrap(
        'create_system',
        'catalogue:write',
        () => handlers.createSystem(args),
        {
          workspaceId: args.workspaceId,
          projectId: args.projectId ?? undefined,
        },
      )(),
  );

  server.tool(
    'update_system',
    'Update a catalogue system (fields, IT inventory itDetails, IT OpEx itCostMode/fees, tags). Money/rate fields accept number or string; returned as JSON numbers. Does not archive/purge. itDetails updates are merged by key: omitted keys are preserved, keys set to null are removed, and array fields (ports, endpoints, ipAddresses, dependencies) are replaced entirely. Requires catalogue:write.',
    {
      systemId: z.string().uuid(),
      projectId: z.string().uuid().nullable().optional(),
      name: z.string().min(1).max(160).optional(),
      summary: z.string().max(500).nullable().optional(),
      description: z.string().max(10000).nullable().optional(),
      systemType: z.string().max(120).nullable().optional(),
      status: systemStatusEnum.optional(),
      ownerUserId: z.string().uuid().nullable().optional(),
      environment: z.string().max(80).nullable().optional(),
      version: z.string().max(80).nullable().optional(),
      criticality: systemCriticalityEnum.nullable().optional(),
      itDetails: systemItDetailsPatchObject.nullable().optional(),
      itCostMode: systemItCostModeEnum.nullable().optional(),
      itFlatMonthlyFee: moneyInput.optional(),
      itOneTimeCost: moneyInput.optional(),
      itBudgetAllocation: moneyInput.optional(),
      tags: z.array(z.string().min(1).max(64)).max(30).optional(),
      metadata: z.record(z.unknown()).nullable().optional(),
    },
    async (args) =>
      wrap('update_system', 'catalogue:write', () => handlers.updateSystem(args), {
        systemId: args.systemId,
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
  // Fresh instances. A shared Zod object is emitted as $ref, and a client
  // that validates the project object alone cannot resolve those pointers.
  // Unresolved properties then fail as additional properties.
  const nullableOutputText = () => z.string().nullable();
  const pinnedRecordOutput = () =>
    z
      .object({
        id: z.string(),
        title: z.string(),
        slug: z.string(),
        recordType: z.string(),
      })
      .nullable();
  const projectBaselineOutput = {
    project: z.object({
      id: z.string(),
      workspaceId: z.string(),
      workspaceName: z.string().nullable().optional(),
      workspaceSlug: z.string().nullable().optional(),
      name: z.string(),
      slug: z.string(),
      status: z.string(),
      summary: nullableOutputText(),
      description: nullableOutputText(),
      startDate: nullableOutputText(),
      endDate: nullableOutputText(),
      hoursPerWorkday: z.number(),
      workdaysPerWeek: z.number().int(),
      nonWorkingDays: z.array(z.string()),
      finishDate: nullableOutputText(),
      durationWorkingDays: z.number().int().nullable(),
      charterRecordId: nullableOutputText(),
      charterRecord: pinnedRecordOutput(),
      initialPlanRecordId: nullableOutputText(),
      initialPlanRecord: pinnedRecordOutput(),
      definitionOfDone: nullableOutputText().describe(
        'Scrum Definition of Done. Null when unset.',
      ),
      currency: projectCurrencyEnum,
      initialBudget: z.number().nullable(),
      approvedBudget: z.number().nullable(),
      keyPrefix: nullableOutputText(),
      methodology: z.enum(['scrum', 'kanban', 'waterfall', 'hybrid']).nullable(),
      createdVia: z.enum(['mcp']).nullable().describe(
        'mcp when an agent created the project. Null for a human-created project.',
      ),
      createdByApiClientId: nullableOutputText().describe(
        'API client id when created via MCP. Null otherwise.',
      ),
      createdByUserId: nullableOutputText().describe(
        'Acting user id when created via MCP. Null otherwise.',
      ),
      generatedByModel: nullableOutputText().describe(
        'Optional model id supplied at MCP create. Null when unset.',
      ),
      url: nullableOutputText().describe(
        'Hub URL for the project. Null when the workspace slug is unknown.',
      ),
    }),
  };
  const projectMethodologyEnum = z.enum(['scrum', 'kanban', 'waterfall', 'hybrid']);
  const createProjectOutput = {
    project: z.object({
      id: z.string(),
      name: z.string(),
      slug: z.string(),
      workspaceId: z.string(),
      status: z.literal('idea'),
      keyPrefix: z.string(),
      url: z.string(),
      methodology: projectMethodologyEnum.nullable(),
      currency: projectCurrencyEnum,
      description: nullableOutputText(),
      createdVia: z.literal('mcp'),
      createdByApiClientId: z.string(),
      createdByUserId: z.string(),
      generatedByModel: nullableOutputText(),
      warning: nullableOutputText(),
    }),
  };

  server.registerTool(
    'get_project',
    {
      description:
        'Get a project by id, or by projectSlug plus workspaceSlug when the slug is shared. Returns workspaceName, workspaceSlug, status (lifecycle stage), methodology, baseline dates, the working calendar, plan finishDate and durationWorkingDays, pinned charter/plan, keyPrefix, budgets, definitionOfDone, url, and MCP provenance (createdVia, createdByApiClientId, createdByUserId, generatedByModel). createdVia is mcp or null. finishDate is calculated. Money fields are JSON numbers.',
      inputSchema: {
        projectId: z.string().uuid().optional(),
        projectSlug: z.string().min(1).max(80).optional(),
        workspaceId: z.string().uuid().optional(),
        workspaceSlug: z.string().min(1).max(64).optional(),
      },
      outputSchema: projectBaselineOutput,
    },
    async (args) =>
      wrap(
        'get_project',
        'projects:read',
        () => handlers.getProject(args),
        { projectId: args.projectId },
        (data) => structuredTextResult(data, projectBaselineOutput),
      )(),
  );

  /** UUID or human key such as HL1-T-12 / HL1-RR-3. When using a human key, if the prefix matches multiple projects across accessible workspaces and the key exists in more than one, returns an ambiguous key error with candidate project names; use the full UUID or specify projectId in that case. */
  const entityRef = z.string().min(1).max(80);

  server.registerTool(
    'update_project_baseline',
    {
      description:
        'Update project baseline window, working calendar, pinned docs, definitionOfDone, currency, budgets, and issue key prefix. hoursPerWorkday, workdaysPerWeek (Monday-first, 1–7), and nonWorkingDays (YYYY-MM-DD, replaces the list) drive scheduling. finishDate and durationWorkingDays are calculated from the plan and are not inputs. Returns the saved project, including definitionOfDone (string or null). Budget fields accept number or string and are returned as JSON numbers. Requires pm:write.',
      inputSchema: {
        projectId: z.string().uuid(),
        startDate: isoDateNullableSchema.optional(),
        endDate: isoDateNullableSchema.optional(),
        hoursPerWorkday: hoursPerWorkdaySchema.optional(),
        workdaysPerWeek: workdaysPerWeekSchema.optional(),
        nonWorkingDays: nonWorkingDaysSchema.nullable().optional(),
        charterRecordId: z.string().uuid().nullable().optional(),
        initialPlanRecordId: z.string().uuid().nullable().optional(),
        definitionOfDone: z.string().max(20000).nullable().optional(),
        currency: projectCurrencyEnum.optional(),
        initialBudget: moneyInput.optional(),
        approvedBudget: moneyInput.optional(),
        keyPrefix: z
          .string()
          .trim()
          .regex(/^([A-Za-z]{3}|[A-Za-z]{2}[0-9])$/)
          .optional(),
      },
      outputSchema: projectBaselineOutput,
    },
    async (args) =>
      wrap(
        'update_project_baseline',
        'pm:write',
        () => handlers.updateProjectBaseline(args),
        { projectId: args.projectId },
        (data) => structuredTextResult(data, projectBaselineOutput),
      )(),
  );

  const updateProjectOutput = {
    project: projectBaselineOutput.project,
    warning: z.string().nullable().describe(
      'Set when a rename was confirmed despite a similar existing name. Otherwise null.',
    ),
  };

  server.registerTool(
    'create_project',
    {
      description:
        'Create a project in an allowlisted workspace. Requires projects:write and an acting user who is maintainer, workspace_admin, or system_admin. Call list_workspaces, then list_project_metadata. The project is always created in stage idea; a human promotes it to active. keyPrefix is AAA or AA0 — omit it to auto-assign, or read the suggested prefix when the value is taken. A similar name is rejected unless confirmDuplicateName is true. Returns id, keyPrefix, and url. generatedByModel is stored as provenance.',
      inputSchema: {
        workspaceId: z.string().uuid(),
        name: z.string().min(1).max(160),
        description: z.string().max(10000).nullable().optional(),
        keyPrefix: z
          .string()
          .trim()
          .regex(/^([A-Za-z]{3}|[A-Za-z]{2}[0-9])$/)
          .optional(),
        currency: projectCurrencyEnum.optional(),
        methodology: projectMethodologyEnum.nullable().optional(),
        confirmDuplicateName: z.boolean().optional(),
        generatedByModel: z.string().max(200).nullable().optional(),
      },
      outputSchema: createProjectOutput,
    },
    async (args) =>
      wrap(
        'create_project',
        'projects:write',
        () => handlers.createProject(args),
        { workspaceId: args.workspaceId },
        (data) => structuredTextResult(data, createProjectOutput),
      )(),
  );

  server.registerTool(
    'update_project',
    {
      description:
        'Update a project name, description, methodology, or currency. Requires projects:write and an acting user who can create projects in that workspace. status (alias stage) may change only within MCP transitions. Promoting idea to active is rejected — a human does that in the hub. A similar new name needs confirmDuplicateName. Writes an audit entry. Returns the project, including provenance.',
      inputSchema: {
        projectId: z.string().uuid(),
        name: z.string().min(1).max(160).optional(),
        description: z.string().max(10000).nullable().optional(),
        methodology: projectMethodologyEnum.nullable().optional(),
        currency: projectCurrencyEnum.optional(),
        status: z.string().min(1).max(40).optional(),
        stage: z.string().min(1).max(40).optional(),
        confirmDuplicateName: z.boolean().optional(),
      },
      outputSchema: updateProjectOutput,
    },
    async (args) =>
      wrap(
        'update_project',
        'projects:write',
        () => handlers.updateProject(args),
        { projectId: args.projectId },
        (data) => structuredTextResult(data, updateProjectOutput),
      )(),
  );

  server.tool(
    'move_project',
    'Move a project to another workspace, including a workspace in another organization. Requires pm:write and an acting user who maintains both workspaces. Same-organization destinations must be on the client allowlist. Cross-organization moves require confirmCrossOrganization and the client loses access afterwards. dryRun lists conflicts without writing.',
    {
      projectId: z.string().uuid(),
      targetWorkspaceId: z.string().uuid(),
      dryRun: z.boolean().optional(),
      confirmCrossOrganization: z.boolean().optional(),
    },
    async (args) =>
      wrap(
        'move_project',
        'pm:write',
        () => handlers.moveProject(args),
        { projectId: args.projectId, workspaceId: args.targetWorkspaceId },
      )(),
  );

  server.tool(
    'get_project_budget_summary',
    'Get project EVM summary (BAC/EV/AC/CPI/SPI), financial/risk RAG, burndown snapshots, and epic cost rollups. Includes person vs AI vs IT-system OpEx, plus aiFlatAc and aiTokenAc. Mixed AI AC is the flat fee accrued over the project dates plus token cost. All money/budget fields returned as JSON numbers. Requires pm:read.',
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
    'Get per-person capacity vs planned/burn demand for roster stakeholders. System users are omitted unless includeSystemUsers is true. view=planned|burn|combined. Requires pm:read.',
    {
      projectId: z.string().uuid(),
      view: z.enum(['planned', 'burn', 'combined']).optional(),
      includeSystemUsers: z.boolean().optional(),
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
                'project_manager',
                'scrum_master',
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
    'Get a catalogue system by id including description, tags, owner, environment, version, criticality, and itDetails inventory. Money/rate fields (itFlatMonthlyFee, itBudgetAllocation, aiFlatMonthlyFee, aiTokenRatePer1k, aiTokenRateInputPer1k, aiTokenRateOutputPer1k, aiTokenRateCachePer1k, aiBudgetAllocation) returned as JSON numbers. aiCostNotes is a short string. Requires systems:read.',
    { systemId: z.string().uuid() },
    async (args) =>
      wrap('get_system', 'systems:read', () => handlers.getSystem(args), {
        systemId: args.systemId,
      })(),
  );

  server.tool(
    'list_knowledge_records',
    'List knowledge records in a workspace (excludes archived by default). Each record includes tags as a string array of tag names, the same shape as search_knowledge. Prefer language: "en" unless the user asks for another locale.',
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

  const recordLinkedItemOutput = z.object({
    id: z.string(),
    humanKey: z.string().nullable(),
    title: z.string(),
    type: z.enum([
      'epic',
      'user_story',
      'milestone',
      'task',
      'sprint',
      'raid',
      'change',
    ]),
    kind: z.string().nullable(),
    projectId: z.string(),
    projectSlug: z.string(),
  });
  const knowledgeRecordOutput = {
    knowledgeRecord: z
      .object({
        id: z.string(),
        linkedItems: z
          .object({
            deliveryLinks: z.array(recordLinkedItemOutput),
            raidLinks: z.array(recordLinkedItemOutput),
            changeItems: z.array(recordLinkedItemOutput),
          })
          .optional()
          .describe(
            'Reverse links in the record project. First page only. Archived RAID, change, and delivery items are omitted.',
          ),
      })
      .passthrough(),
  };

  server.registerTool(
    'get_knowledge_record',
    {
      description:
        'Retrieve a knowledge record including markdown content. Tags, linked workspace media, and linkedItems are included on the first page only. linkedItems has deliveryLinks (epic, user story, milestone, task including bugs, sprint), raidLinks, and changeItems for the same project. Each item has id, humanKey, title, type, and kind. Archived RAID, change, and delivery items are omitted. Content is paged at 50,000 characters: contentLength is the full length, contentSha256 is the hash of the full body, contentTruncated is true when this page is not the end, and nextOffset is the contentOffset for the next call (null when the page reaches the end). returnedChars, chunkIndex (0-based page index: 0 on the first page, then ceil(contentOffset/contentLimit)), and totalChunks describe the page (chunk counts are approximate when a page is shorter than the limit). When you pass contentOffset or contentLimit, each page is a raw slice (concatenate contentMarkdown across pages). The default call with neither parameter still appends …[truncated] on the first page when more remains. boundary paragraph or line snaps the cut to a break in the second half of the window; the default is a hard cut. inCodeFence is true when the page ends inside a code fence. Pass expectSha256 to reject with 409 when the stored body changed. Omit contentOffset for the first page. Call again with contentOffset set to nextOffset until nextOffset is null before rewriting the record. Images use ![alt](/api/v1/media/{id}) — never data: URIs. recordId may be a UUID or project document key (e.g. HL1-VIS-2).',
      inputSchema: {
        recordId: z.string().min(1).max(80),
        contentOffset: z.number().int().min(0).optional(),
        contentLimit: z.number().int().min(1).max(MCP_MAX_CONTENT_CHARS).optional(),
        boundary: z.enum(['none', 'paragraph', 'line']).optional(),
        expectSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
      },
      outputSchema: knowledgeRecordOutput,
    },
    async (args) =>
      wrap(
        'get_knowledge_record',
        'knowledge:read',
        () => handlers.getKnowledgeRecord(args),
        { recordId: args.recordId },
        (data) => structuredTextResult(data, knowledgeRecordOutput),
      )(),
  );

  server.tool(
    'get_record_provenance',
    'Retrieve verification and source provenance for a knowledge record. recordId may be a UUID or project document key (e.g. HL1-VIS-2).',
    { recordId: entityRef },
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
    'List translation siblings for a knowledge record (same translationGroupId). Includes the source record. Prefer English siblings for default work. recordId may be a UUID or project document key.',
    { recordId: entityRef },
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
    'REQUIRED for locale siblings (hu/de/…). Creates a linked draft with shared translationGroupId. NEVER use create_knowledge_record for another language of an existing record — that makes unlinked duplicates. Prefer translateWithAi=true when hub AI is configured; if AI is unavailable or fails, call again WITHOUT translateWithAi and pass title/summary/contentMarkdown yourself. Do not overwrite the EN source. recordId may be a UUID or project document key.',
    {
      recordId: entityRef,
      language: z.string().min(2).max(16),
      slug: z.string().min(1).max(96).optional(),
      translateWithAi: z.boolean().optional(),
      title: z.string().min(1).max(300).optional(),
      summary: z.string().max(1000).nullable().optional(),
      contentMarkdown: z.string().max(500_000).optional(),
      generatedByModel: z.string().max(160).optional(),
      sourceTitle: z.string().max(300).optional(),
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
    'REQUIRED default for LLM/MCP/ChatGPT image uploads: start a chunked PNG/JPEG/WebP/GIF upload. Do NOT use upload_workspace_media. Returns uploadId + recommendedChunkChars (~8000). Next: append_workspace_media_upload for each ~8000-char raw base64 chunk, then finalize_workspace_media_upload. Optional insertIntoRecord+knowledgeRecordId embeds on finalize. Optional targetEntityType+targetEntityId links the new image to a delivery, RAID, or change item on finalize (UUID or human key such as PRO-T-1, PRO-B-1, PRO-S-1, PRO-E-1). Bugs use task. The item must be in workspaceId. Linking requires pm:write in addition to knowledge:write. PDF and Office files are documents, not media. Allowed types: image/png, image/jpeg, image/gif, image/webp. File bytes are verified against declared type on finalize.',
    {
      workspaceId: z.string().uuid(),
      contentType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
      filename: z.string().min(1).max(200).optional(),
      alt: z.string().max(300).optional(),
      knowledgeRecordId: entityRef.optional(),
      insertIntoRecord: z
        .boolean()
        .optional()
        .describe(
          'When true, requires knowledgeRecordId; finalize appends media.markdownSnippet to that record',
        ),
      targetEntityType: z
        .enum(['epic', 'user_story', 'milestone', 'task', 'sprint', 'raid', 'change'])
        .optional(),
      targetEntityId: entityRef.optional(),
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
    'Step 2 of image upload (after begin_workspace_media_upload): append one raw base64 chunk (no data: prefix). Use ~recommendedChunkChars (8000); max 12000. Repeat until the full base64 string is sent, then call finalize_workspace_media_upload. Bytes verified on finalize. Requires knowledge:write.',
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
    'Step 3 of image upload: assemble all chunks, verify bytes match declared type, store media, return media.markdownSnippet. Honors insertIntoRecord and the target item from begin. linkedTo is set when the image was linked. Linking requires pm:write. Do not call upload_workspace_media instead. Requires knowledge:write.',
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
    'AVOID for LLM/MCP/ChatGPT clients — single-shot upload often fails when base64 is large. Use begin_workspace_media_upload → append_workspace_media_upload → finalize_workspace_media_upload instead. Kept only for tiny files or non-LLM integrations. contentBase64 = raw base64 (no data: prefix). Allowed types: image/png, image/jpeg, image/gif, image/webp. Optional targetEntityType+targetEntityId (UUID or human key) links the image to an item in this workspace in the same step and requires pm:write. File bytes are verified against declared type. Requires knowledge:write.',
    {
      workspaceId: z.string().uuid(),
      contentBase64: z.string().min(1).max(10_000_000),
      contentType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
      filename: z.string().min(1).max(200).optional(),
      alt: z.string().max(300).optional(),
      knowledgeRecordId: entityRef.optional(),
      insertIntoRecord: z
        .boolean()
        .optional()
        .describe(
          'When true, requires knowledgeRecordId and appends media.markdownSnippet to that record as a new draft version',
        ),
      targetEntityType: z
        .enum(['epic', 'user_story', 'milestone', 'task', 'sprint', 'raid', 'change'])
        .optional(),
      targetEntityId: entityRef.optional(),
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
    createKnowledgeRecordInputSchema.shape,
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
    'Update a knowledge record as draft (requires knowledge:write and a changeMessage). Send the full markdown body: a value ending in the get_knowledge_record truncation marker is rejected. Page that read until nextOffset is null before rewriting. Set archived=true to soft-archive (or false to restore). For images: begin → append → finalize_workspace_media_upload (not upload_workspace_media); paste media.markdownSnippet or use insertIntoRecord on begin. Never data:image URIs. recordId may be a UUID or project document key (e.g. HL1-VIS-2).',
    updateKnowledgeRecordInputSchema.shape,
    async (args) =>
      wrap('update_knowledge_record', 'knowledge:write', () =>
        handlers.updateKnowledgeRecord(args),
      )(),
  );

  server.tool(
    'begin_record_content_upload',
    'Start a chunked markdown update for a knowledge record (knowledge:write). Returns uploadId, maxChunkChars (40000), contentSha256, contentLength, and currentVersionNumber. Then append_record_content and finalize_record_content_upload. One version per session. The session expires in 15 minutes. recordId may be a UUID or project document key.',
    { recordId: z.string().min(1).max(80) },
    async (args) =>
      wrap('begin_record_content_upload', 'knowledge:write', () =>
        handlers.beginRecordContentUpload(args),
      )(),
  );

  server.tool(
    'append_record_content',
    'Append one markdown chunk (max 40000 characters) to a begin_record_content_upload session. index, when set, must be the next chunk index. The joined body cannot exceed 500000 characters. Requires knowledge:write.',
    {
      uploadId: z.string().uuid(),
      chunk: z.string().min(1).max(40_000),
      index: z.number().int().min(0).optional(),
    },
    async (args) =>
      wrap('append_record_content', 'knowledge:write', () =>
        handlers.appendRecordContent(args),
      )(),
  );

  server.tool(
    'finalize_record_content_upload',
    'Join the appended chunks and save them as one draft version (knowledge:write). Requires changeMessage. expectedLength, when set, must match the joined body. Rejects a body that ends with the truncation marker, and returns 409 CONTENT_CHANGED when the record changed after begin. The session is deleted on success.',
    {
      uploadId: z.string().uuid(),
      changeMessage: z.string().min(1).max(500),
      expectedLength: z.number().int().min(0).max(500_000).optional(),
    },
    async (args) =>
      wrap('finalize_record_content_upload', 'knowledge:write', () =>
        handlers.finalizeRecordContentUpload(args),
      )(),
  );

  server.tool(
    'list_workspace_media',
    'List recent workspace media (JPEG/PNG/WebP/GIF) with urls, markdown snippets, and a short usedBy list. Optional filename query. Optional entityType+entityId (both required together) filters to images linked to that item; entityId may be a UUID or human key and the item must be in workspaceId. Readers are read-only. Requires knowledge:read.',
    {
      workspaceId: z.string().uuid(),
      knowledgeRecordId: entityRef.optional(),
      query: z.string().max(200).optional(),
      entityType: z
        .enum(['epic', 'user_story', 'milestone', 'task', 'sprint', 'raid', 'change'])
        .optional(),
      entityId: entityRef.optional(),
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

  const listPage = {
    limit: z.number().int().min(1).max(MCP_MAX_LIST_LIMIT).optional(),
    cursor: z.string().min(1).max(200).optional(),
  };

  server.tool(
    'list_project_milestones',
    'List milestones for a project (Project Delivery). Pages at 25. Descriptions are excerpts of the note. Pass cursor from nextCursor until hasMore is false. Each row includes completionPercent (0 or 100 from linked items and predecessor dependencies: 100 only when every included item is done or 100 percent, cancelled items are left out, otherwise 0; no included items leaves it null), linkedItems, and mediaLinks plus mediaLinkCount for the Media tab. Status follows those same links: all complete is done, a non-done blocked link is blocked, completion above 0 or any started link is in progress, and nothing started is planned. No included links keeps the stored status. targetDate is the due date and is not derived from linked items. A predecessor moves that due date. Duration is always 0. Requires pm:read.',
    {
      projectId: z.string().uuid(),
      includeArchived: z.boolean().optional(),
      ...listPage,
    },
    async (args) =>
      wrap(
        'list_project_milestones',
        'pm:read',
        () => handlers.listProjectMilestones(args),
        { projectId: args.projectId },
      )(),
  );

  const taskListOutput = {
    tasks: z.array(
      z
        .object({
          completionPercent: z
            .number()
            .int()
            .min(0)
            .max(100)
            .nullable()
            .describe(
              'Displayed percent. Done is 100, cancelled is 0, otherwise the stored step.',
            )
            .optional(),
        })
        .passthrough(),
    ),
    total: z.number().int(),
    limit: z.number().int(),
    nextCursor: z
      .string()
      .nullable()
      .describe('Pass as cursor for the next page. Null when hasMore is false.'),
    hasMore: z.boolean(),
  };

  server.registerTool(
    'list_project_tasks',
    {
      description:
        'List tasks for a project (optional milestone, sprint, and itemType filters). itemType bug returns bugs only. milestoneId and sprintId must belong to the given project. Includes RACI. Optional limit (1-25, default 25) and cursor page the list. Descriptions and bug notes are excerpts; use get_project_task for the full text. The result includes nextCursor (null when hasMore is false). completionPercent is the displayed value: done is 100, cancelled is 0, otherwise the stored step. Each task includes mediaLinks and mediaLinkCount for the Media tab (workspace images and titled http(s) URLs). Requires pm:read.',
      inputSchema: {
        projectId: z.string().uuid(),
        milestoneId: entityRef.optional(),
        unassignedMilestone: z.boolean().optional(),
        sprintId: entityRef.optional(),
        unassignedSprint: z.boolean().optional(),
        itemType: z.enum(['task', 'bug']).optional(),
        includeArchived: z.boolean().optional(),
        limit: z
          .number()
          .int()
          .min(1)
          .max(MCP_MAX_LIST_LIMIT)
          .describe('Page size from 1 to 25. Defaults to 25.')
          .optional(),
        cursor: z
          .string()
          .min(1)
          .max(200)
          .describe('Opaque page cursor returned as nextCursor. Omit for the first page.')
          .optional(),
      },
      outputSchema: taskListOutput,
    },
    async (args) =>
      wrap(
        'list_project_tasks',
        'pm:read',
        () => handlers.listProjectTasks(args),
        { projectId: args.projectId },
        (data) => structuredTextResult(data, taskListOutput),
      )(),
  );

  server.tool(
    'get_project_task',
    'Get one project task or bug with RACI. The raci array is the current standing set (userId and role R/A/C/I) and includes the latest set_project_task_raci replacement. Hour fields (forecastHours, actualHours) returned as JSON numbers. taskId may be a UUID or any human key (HL1-T-12 or HL1-B-4). Includes mediaLinks and mediaLinkCount for the Media tab (workspace images and titled http(s) URLs). Requires pm:read.',
    { taskId: entityRef },
    async (args) =>
      wrap('get_project_task', 'pm:read', () => handlers.getProjectTask(args))(),
  );

  const ymdDate = isoDateNullableSchema;

  server.tool(
    'create_project_milestone',
    'Create a project milestone (live state). description is the note. targetDate is the due date. startDate is accepted for older clients and is not shown in the form. Requires pm:write.',
    {
      projectId: z.string().uuid(),
      title: z.string().min(1).max(200),
      description: z.string().max(5000).nullable().optional(),
      status: milestoneStatusSchema.optional(),
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
    'Update a project milestone (live state). milestoneId may be UUID or human key (e.g. HL1-M-1). description is the note. targetDate is the due date. Omitting startDate leaves a stored start date unchanged. When included links remain, status is replaced by the status derived from those links. A milestone with no included links keeps the status you set. Requires pm:write.',
    {
      milestoneId: entityRef,
      title: z.string().min(1).max(200).optional(),
      description: z.string().max(5000).nullable().optional(),
      status: milestoneStatusSchema.optional(),
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
    'get_project_milestone',
    'Get one milestone with its note (description), due date (targetDate), completionPercent, and linkedItems (epics, user stories, tasks, and bugs). completionPercent is 100 only when every included linked item and every predecessor dependency is done or 100 percent. Cancelled items are left out. Anything else included is 0. No included items leaves it null. Status follows those links: all complete is done, a non-done blocked link is blocked, completion above 0 or any started link is in progress, and nothing started is planned. No included links keeps the stored status. targetDate is the stored due date. milestoneId may be a UUID or human key (HL1-M-1). Includes mediaLinks and mediaLinkCount. Requires pm:read.',
    { milestoneId: entityRef },
    async (args) =>
      wrap('get_project_milestone', 'pm:read', () =>
        handlers.getProjectMilestone(args),
      )(),
  );

  server.tool(
    'set_project_milestone_item_links',
    'Replace the epics, user stories, tasks, and bugs linked to a milestone. Bugs use entityType task and a B key. Items must belong to the milestone project. The returned milestone includes completionPercent, linkedItems, and the status derived from those links. Requires pm:write.',
    {
      milestoneId: entityRef,
      items: z
        .array(
          z.object({
            entityType: z.enum(['epic', 'user_story', 'task']),
            entityId: entityRef,
          }),
        )
        .max(100),
    },
    async (args) =>
      wrap('set_project_milestone_item_links', 'pm:write', () =>
        handlers.setProjectMilestoneItemLinks(args),
      )(),
  );

  server.tool(
    'list_project_sprints',
    'List Scrum sprints for a project (committed/done points). Pages at 25. Goals are excerpts. Pass cursor from nextCursor until hasMore is false. Each sprint includes mediaLinks and mediaLinkCount for the Media tab. Requires pm:read.',
    {
      projectId: z.string().uuid(),
      includeArchived: z.boolean().optional(),
      ...listPage,
    },
    async (args) =>
      wrap(
        'list_project_sprints',
        'pm:read',
        () => handlers.listProjectSprints(args),
        { projectId: args.projectId },
      )(),
  );

  server.tool(
    'create_project_sprint',
    'Create a Scrum sprint (SP human key). At most one active sprint per project. Requires pm:write.',
    {
      projectId: z.string().uuid(),
      name: z.string().min(1).max(200),
      goal: z.string().max(5000).nullable().optional(),
      status: z
        .enum(['planned', 'active', 'completed', 'cancelled'])
        .optional(),
      startDate: ymdDate.optional(),
      endDate: ymdDate.optional(),
      capacityPoints: z.number().int().min(0).max(100000).nullable().optional(),
      sortOrder: z.number().int().min(0).max(100000).optional(),
    },
    async (args) =>
      wrap(
        'create_project_sprint',
        'pm:write',
        () => handlers.createProjectSprint(args),
        { projectId: args.projectId },
      )(),
  );

  server.tool(
    'update_project_sprint',
    'Update a sprint (activate/close). On complete/cancel, unfinishedDestination moves incomplete tasks to backlog or another sprint. sprintId may be UUID or human key (e.g. HL1-SP-1). Requires pm:write. Do not auto-close without a human actor.',
    {
      sprintId: entityRef,
      name: z.string().min(1).max(200).optional(),
      goal: z.string().max(5000).nullable().optional(),
      status: z
        .enum(['planned', 'active', 'completed', 'cancelled'])
        .optional(),
      startDate: ymdDate.optional(),
      endDate: ymdDate.optional(),
      capacityPoints: z.number().int().min(0).max(100000).nullable().optional(),
      sortOrder: z.number().int().min(0).max(100000).optional(),
      archived: z.boolean().optional(),
      unfinishedDestination: z
        .union([
          z.literal('backlog'),
          z.object({ sprintId: entityRef }),
        ])
        .optional(),
    },
    async (args) =>
      wrap('update_project_sprint', 'pm:write', () =>
        handlers.updateProjectSprint(args),
      )(),
  );

  server.tool(
    'get_project_sprint_burndown',
    'Get story-point burndown for a sprint (ideal vs remaining by day). sprintId may be UUID or human key (e.g. HL1-SP-1). Requires pm:read.',
    { sprintId: entityRef },
    async (args) =>
      wrap('get_project_sprint_burndown', 'pm:read', () =>
        handlers.getProjectSprintBurndown(args),
      )(),
  );

  server.tool(
    'get_project_scrum_velocity',
    'Average done story points over the last N completed sprints (default 5). Requires pm:read.',
    {
      projectId: z.string().uuid(),
      lastN: z.number().int().min(1).max(20).optional(),
    },
    async (args) =>
      wrap(
        'get_project_scrum_velocity',
        'pm:read',
        () => handlers.getProjectScrumVelocity(args),
        { projectId: args.projectId },
      )(),
  );

  server.tool(
    'list_my_project_tasks',
    'List tasks where the API client acting user is on RACI (My tasks). Pages at 25 items. Descriptions and bug notes are excerpts; use get_project_task for the full text. Pass cursor from nextCursor until hasMore is false. Each task includes mediaLinks and mediaLinkCount for the Media tab. Requires pm:read and actingUserId.',
    {
      role: z.enum(['R', 'A', 'C', 'I']).optional(),
      includeArchived: z.boolean().optional(),
      limit: z.number().int().min(1).max(MCP_MAX_LIST_LIMIT).optional(),
      cursor: z.string().min(1).max(200).optional(),
    },
    async (args) =>
      wrap('list_my_project_tasks', 'pm:read', () =>
        handlers.listMyProjectTasks(args),
      )(),
  );

  server.tool(
    'get_my_dashboard_insights',
    'Dashboard insight rollups for the acting user (task due buckets, project health RAG, open RAID, budget attention). Requires pm:read and actingUserId.',
    {},
    async () =>
      wrap('get_my_dashboard_insights', 'pm:read', () =>
        handlers.getMyDashboardInsights(),
      )(),
  );

  server.tool(
    'list_project_delivery_document_links',
    'List knowledge records linked to delivery entities in a project (ceremonies, specs, etc.). Optional entityType/entityId filter; entityId may be UUID or human key. Requires pm:read.',
    {
      projectId: z.string().uuid(),
      entityType: z.enum(['epic', 'user_story', 'milestone', 'task', 'sprint']).optional(),
      entityId: entityRef.optional(),
    },
    async (args) =>
      wrap(
        'list_project_delivery_document_links',
        'pm:read',
        () => handlers.listProjectDeliveryDocumentLinks(args),
        { projectId: args.projectId },
      )(),
  );

  server.tool(
    'create_project_task',
    'Create a project task or bug (itemType task or bug, default task). Type is fixed at create: tasks get a T key and bugs a B key. Bug fields (severity, foundIn, foundInNote, stepsToReproduce, expectedBehavior, actualBehavior, resolution, regression, affectedSystemId, duplicateOfTaskId) are rejected on a task. Severity defaults to medium on a bug. duplicateOfTaskId is stored only when resolution is duplicate and may be a UUID or human key. affectedSystemId must be a catalogue system linked to the project. Optional startDate and durationDays. When durationDays is set, dueDate is startDate plus that many working days on the project calendar. When both startDate and dueDate are set without duration, duration is the gap and startDate must be on or before dueDate. Bugs use the same start date and duration. Optional RACI, user story, sprint, story points, and current owner. Hour fields (forecastHours, actualHours) accept number or string; returned as JSON numbers. milestoneId, sprintId, and userStoryId must belong to the given project. Optional AI usage: tokensUsed alone bills the blended rate; tokensInput/tokensOutput/tokensCache bill split rates and set tokensUsed to their sum when omitted. aiSystemId must be an AI assistant system linked to the project. completionPercent written is 0, 25, 50, 75, or 100; status done stores 100 and cancelled stores null. Reads return the displayed percent, so cancelled is 0. Requires pm:write.',
    {
      projectId: z.string().uuid(),
      title: z.string().min(1).max(200),
      description: z.string().max(10000).nullable().optional(),
      status: z
        .enum(['todo', 'in_progress', 'blocked', 'done', 'cancelled'])
        .optional(),
      startDate: isoDateNullableSchema.optional(),
      dueDate: isoDateNullableSchema.optional(),
      durationDays: z.number().int().min(0).max(3650).nullable().optional(),
      forecastHours: moneyInput.optional(),
      actualHours: moneyInput.optional(),
      tokensUsed: tokenCountSchema.nullable().optional(),
      tokensInput: tokenCountSchema.nullable().optional(),
      tokensOutput: tokenCountSchema.nullable().optional(),
      tokensCache: tokenCountSchema.nullable().optional(),
      modelId: z.string().max(80).nullable().optional(),
      pricingTier: z.string().max(32).nullable().optional(),
      usageOccurredAt: z.string().max(40).nullable().optional(),
      billingPeriod: z.string().max(7).nullable().optional(),
      aiSystemId: z.string().uuid().nullable().optional(),
      milestoneId: entityRef.nullable().optional(),
      userStoryId: entityRef.nullable().optional(),
      sprintId: entityRef.nullable().optional(),
      storyPoints: z.number().int().min(0).max(1000).nullable().optional(),
      completionPercent: z
        .union([z.literal(0), z.literal(25), z.literal(50), z.literal(75), z.literal(100)])
        .nullable()
        .optional(),
      currentOwnerUserId: z.string().uuid().nullable().optional(),
      sortOrder: z.number().int().min(0).max(100000).optional(),
      itemType: z.enum(['task', 'bug']).optional(),
      severity: z.enum(['low', 'medium', 'high', 'critical']).nullable().optional(),
      foundIn: z
        .enum(['development', 'test', 'staging', 'production'])
        .nullable()
        .optional(),
      foundInNote: z.string().max(200).nullable().optional(),
      stepsToReproduce: z.string().max(10000).nullable().optional(),
      expectedBehavior: z.string().max(10000).nullable().optional(),
      actualBehavior: z.string().max(10000).nullable().optional(),
      resolution: z
        .enum([
          'fixed',
          'duplicate',
          'wont_fix',
          'cannot_reproduce',
          'works_as_designed',
        ])
        .nullable()
        .optional(),
      regression: z.boolean().nullable().optional(),
      affectedSystemId: z.string().uuid().nullable().optional(),
      duplicateOfTaskId: entityRef.nullable().optional(),
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
    'Update a project task or bug. taskId may be a UUID or any human key (HL1-T-12 or HL1-B-4). itemType cannot change after create. Bug fields are rejected on a task. duplicateOfTaskId is stored only when resolution is duplicate and may be a UUID or human key. affectedSystemId must be a catalogue system linked to the project. Optional startDate and durationDays; null clears them. When durationDays is set, dueDate is startDate plus that many working days on the project calendar. Bugs use the same start date and duration. When both startDate and dueDate are set, startDate must be on or before dueDate. Hour fields (forecastHours, actualHours) accept number or string; returned as JSON numbers. milestoneId, sprintId, and userStoryId must belong to the task\'s project. tokensUsed alone keeps blended-rate billing and clears a stored breakdown. tokensInput/tokensOutput/tokensCache bill split rates; tokensUsed is their sum when omitted and must match when both are sent. Optional modelId, pricingTier, usageOccurredAt, billingPeriod. aiSystemId must be an AI assistant system linked to the project. completionPercent written is 0, 25, 50, 75, or 100; status done stores 100 and cancelled stores null. Reads return the displayed percent, so cancelled is 0. A status, completion, date, or story change recomputes the story, its epic, and milestones linked to them. Parent start and end follow included children. Requires pm:write.',
    {
      taskId: entityRef,
      title: z.string().min(1).max(200).optional(),
      description: z.string().max(10000).nullable().optional(),
      status: z
        .enum(['todo', 'in_progress', 'blocked', 'done', 'cancelled'])
        .optional(),
      startDate: isoDateNullableSchema.optional(),
      dueDate: isoDateNullableSchema.optional(),
      durationDays: z.number().int().min(0).max(3650).nullable().optional(),
      forecastHours: moneyInput.optional(),
      actualHours: moneyInput.optional(),
      tokensUsed: tokenCountSchema.nullable().optional(),
      tokensInput: tokenCountSchema.nullable().optional(),
      tokensOutput: tokenCountSchema.nullable().optional(),
      tokensCache: tokenCountSchema.nullable().optional(),
      modelId: z.string().max(80).nullable().optional(),
      pricingTier: z.string().max(32).nullable().optional(),
      usageOccurredAt: z.string().max(40).nullable().optional(),
      billingPeriod: z.string().max(7).nullable().optional(),
      aiSystemId: z.string().uuid().nullable().optional(),
      milestoneId: entityRef.nullable().optional(),
      userStoryId: entityRef.nullable().optional(),
      sprintId: entityRef.nullable().optional(),
      storyPoints: z.number().int().min(0).max(1000).nullable().optional(),
      completionPercent: z
        .union([z.literal(0), z.literal(25), z.literal(50), z.literal(75), z.literal(100)])
        .nullable()
        .optional(),
      currentOwnerUserId: z.string().uuid().nullable().optional(),
      sortOrder: z.number().int().min(0).max(100000).optional(),
      archived: z.boolean().optional(),
      itemType: z.enum(['task', 'bug']).optional(),
      severity: z.enum(['low', 'medium', 'high', 'critical']).nullable().optional(),
      foundIn: z
        .enum(['development', 'test', 'staging', 'production'])
        .nullable()
        .optional(),
      foundInNote: z.string().max(200).nullable().optional(),
      stepsToReproduce: z.string().max(10000).nullable().optional(),
      expectedBehavior: z.string().max(10000).nullable().optional(),
      actualBehavior: z.string().max(10000).nullable().optional(),
      resolution: z
        .enum([
          'fixed',
          'duplicate',
          'wont_fix',
          'cannot_reproduce',
          'works_as_designed',
        ])
        .nullable()
        .optional(),
      regression: z.boolean().nullable().optional(),
      affectedSystemId: z.string().uuid().nullable().optional(),
      duplicateOfTaskId: entityRef.nullable().optional(),
    },
    async (args) =>
      wrap('update_project_task', 'pm:write', () => handlers.updateProjectTask(args))(),
  );

  server.tool(
    'report_project_task_ai_usage',
    'Record AI token usage on a task (prefer when marking done), then refresh the cost snapshot. tokensUsed alone bills the blended aiTokenRatePer1k and clears any stored breakdown (legacy). tokensInput, tokensOutput, and tokensCache bill split rates; a null split rate falls back to the blended rate. tokensUsed is stored as the sum when omitted and must equal the sum when both are sent. Optional modelId (e.g. grok-4.7), pricingTier (e.g. standard or fast), usageOccurredAt (ISO datetime or YYYY-MM-DD), and billingPeriod (YYYY-MM) are audit tags and do not change flat-fee accrual. Billable for api/mixed; flat ignores tokens; note_only records usage at $0. aiSystemId must be an AI assistant system linked to the project. Requires pm:write.',
    {
      taskId: entityRef,
      tokensUsed: tokenCountSchema.optional(),
      tokensInput: tokenCountSchema.nullable().optional(),
      tokensOutput: tokenCountSchema.nullable().optional(),
      tokensCache: tokenCountSchema.nullable().optional(),
      modelId: z.string().max(80).nullable().optional(),
      pricingTier: z.string().max(32).nullable().optional(),
      usageOccurredAt: z.string().max(40).nullable().optional(),
      billingPeriod: z.string().max(7).nullable().optional(),
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

  const dependencyEntityType = z.enum([
    'epic',
    'user_story',
    'task',
    'milestone',
    'sprint',
  ]);
  const dependencyLinkType = z.enum(['FS', 'SS', 'FF', 'SF']);
  const dependencyRef = z.string().trim().min(1).max(80);

  server.tool(
    'list_delivery_dependencies',
    'List every predecessor link on one delivery item and the successors derived from other items that name it as a predecessor. An item may have many predecessors. The successor start is the latest constraint across them (FS uses predecessor finish, SS predecessor start, FF predecessor finish minus duration, SF predecessor start minus duration, each plus lag). projectId (UUID) and entityId are required. entityId is a UUID or human key (PRO-T-1, PRO-B-1, PRO-E-1, PRO-S-1, PRO-M-1, PRO-SP-1). entityType is required for a UUID and optional when the key encodes the type (B is a bug and uses entity type task). scheduleDriven is true when a predecessor date currently sets this item’s start. Requires pm:read.',
    {
      projectId: z.string().uuid().describe('Required project id (UUID).'),
      entityId: dependencyRef.describe(
        'Required delivery item id (UUID or human key such as PRO-T-1 or PRO-B-1).',
      ),
      entityType: dependencyEntityType.optional().describe(
        'Required when entityId is a UUID. Optional when the human key encodes the type.',
      ),
    },
    async (args) =>
      wrap(
        'list_delivery_dependencies',
        'pm:read',
        () => handlers.listDeliveryDependencies(args),
        { projectId: args.projectId },
      )(),
  );

  const dependencyLink = z.object({
    predecessorId: dependencyRef,
    predecessorType: dependencyEntityType.optional(),
    successorId: dependencyRef,
    successorType: dependencyEntityType.optional(),
    linkType: dependencyLinkType,
    lagDays: z.number().int().min(-3650).max(3650).optional(),
  });

  server.tool(
    'set_delivery_dependency',
    'Add predecessor links between delivery items in the same project. projectId (UUID) is required. Pass predecessorId, successorId, and linkType for one link, or links (1–50) to add several at once. An item may have many predecessors; each ordered pair is stored once. linkType is FS, SS, FF, or SF. lagDays defaults to 0, is counted in working days, and may be negative (lead). Non-working days are skipped. The successor start is the latest constraint across its predecessors. For a task or bug, due date is start plus durationDays. Successors are not entered separately. Rejects self-links, cross-project links, a second link on the same ordered pair, and cycles. Ids are UUIDs or human keys (PRO-T-1, PRO-B-1). Pass a type when the id is a UUID. Requires pm:write.',
    {
      projectId: z.string().uuid().describe('Required project id (UUID).'),
      predecessorId: dependencyRef.optional(),
      predecessorType: dependencyEntityType.optional(),
      successorId: dependencyRef.optional(),
      successorType: dependencyEntityType.optional(),
      linkType: dependencyLinkType.optional(),
      lagDays: z.number().int().min(-3650).max(3650).optional(),
      links: z.array(dependencyLink).min(1).max(50).optional(),
    },
    async (args) =>
      wrap(
        'set_delivery_dependency',
        'pm:write',
        () => handlers.setDeliveryDependency(args),
        { projectId: args.projectId },
      )(),
  );

  server.tool(
    'remove_delivery_dependency',
    'Remove one dependency link. projectId (UUID) is required. Pass linkId, or both predecessorId and successorId (UUID or human key such as PRO-T-1 or PRO-B-1). Types are required when an id is a UUID. Requires pm:write.',
    {
      projectId: z.string().uuid().describe('Required project id (UUID).'),
      linkId: z.string().uuid().optional(),
      predecessorId: dependencyRef.optional(),
      predecessorType: dependencyEntityType.optional(),
      successorId: dependencyRef.optional(),
      successorType: dependencyEntityType.optional(),
    },
    async (args) =>
      wrap(
        'remove_delivery_dependency',
        'pm:write',
        () => handlers.removeDeliveryDependency(args),
        { projectId: args.projectId },
      )(),
  );

  const epicStatusEnum = epicStatusSchema;

  server.tool(
    'list_project_epics',
    'List epics for a project. Pages at 25. Descriptions are excerpts. Pass cursor from nextCursor until hasMore is false. Each epic includes completionPercent: done is 100, cancelled is 0, otherwise the average of non-cancelled child tasks and bugs, or null when none remain. Status is derived from those children: all done is done, a non-done blocked child is blocked, completion above 0 or any started child is in progress, and nothing started is planned. Cancelled children are left out. An epic with no included children keeps its stored status. startDate is the earliest child start and endDate the latest child end; a side with no child date keeps the stored date. Each epic includes mediaLinks and mediaLinkCount for the Media tab (workspace images and titled http(s) URLs). Requires pm:read.',
    {
      projectId: z.string().uuid(),
      includeArchived: z.boolean().optional(),
      ...listPage,
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
    'Update a project epic. When the epic has included child tasks or bugs, status is replaced by the derived status (done, blocked, in progress, or planned). An epic with no included children keeps the status you set. Requires pm:write.',
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
    'List user stories for a project (optional epic filter). epicId must belong to the given project. Pages at 25. Descriptions are excerpts. Pass cursor from nextCursor until hasMore is false. Each story includes completionPercent: done is 100, cancelled is 0, otherwise the average of non-cancelled child tasks and bugs, or null when none remain. Status is derived from those children: all done is done, a non-done blocked child is blocked, completion above 0 or any started child is in progress, and nothing started is planned. Cancelled children are left out. A story with no included children keeps its stored status. startDate is the earliest child start and endDate the latest child end; a side with no child date keeps the stored date. Each story includes mediaLinks and mediaLinkCount for the Media tab (workspace images and titled http(s) URLs). Requires pm:read.',
    {
      projectId: z.string().uuid(),
      epicId: entityRef.optional(),
      includeArchived: z.boolean().optional(),
      ...listPage,
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
    'Create a user story under an epic. epicId must belong to the given project. Requires pm:write.',
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
    'Update a user story. epicId must belong to the story\'s project. Moving the story recomputes the old and new epic. When the story has included child tasks or bugs, status is replaced by the derived status. A story with no included children keeps the status you set. Requires pm:write.',
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
    'List activity timeline for a task or bug. Pages at 25. Comment text is returned in full; set fullText to false to excerpt comments at 200 characters. Pass cursor from nextCursor until hasMore is false. taskId may be a UUID or any human key (HL1-T-12 or HL1-B-4). Requires pm:read.',
    {
      taskId: entityRef,
      fullText: z
        .boolean()
        .describe(
          'When false, comment bodies are excerpted at 200 characters. Defaults to true (full comment text).',
        )
        .optional(),
      ...listPage,
    },
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
    'project_manager',
    'scrum_master',
    'product_owner',
    'tech_lead',
    'contributor',
    'stakeholder',
    'other',
  ]);

  server.tool(
    'list_project_stakeholders',
    'List project stakeholders (people, open roles, AI assistants, RACI-derived) with role description and competencies. Money/rate/hour fields (hourlyRate, allocatedDailyHours, contractedBudget, aiFlatMonthlyFee, aiTokenRatePer1k, aiTokenRateInputPer1k, aiTokenRateOutputPer1k, aiTokenRateCachePer1k, aiBudgetAllocation) returned as JSON numbers. AI rows include aiCostNotes. Requires pm:read.',
    { projectId: z.string().uuid() },
    async (args) =>
      wrap(
        'list_project_stakeholders',
        'pm:read',
        () => handlers.listProjectStakeholders(args),
        { projectId: args.projectId },
      )(),
  );

  server.tool(
    'list_workspace_members',
    'List active workspace members (userId, name, email, role, userType) for staffing. System users are omitted unless includeSystemUsers is true. Requires projects:read.',
    {
      workspaceId: z.string().uuid(),
      includeSystemUsers: z.boolean().optional(),
    },
    async (args) =>
      wrap(
        'list_workspace_members',
        'projects:read',
        () => handlers.listWorkspaceMembers(args),
        { workspaceId: args.workspaceId },
      )(),
  );

  const engagementEnum = z.enum(['employee', 'contractor']);
  const ymdNullable = isoDateNullableSchema;
  const competencyItemSchema = z.union([
    z.string().trim().min(1).max(80),
    z.object({
      name: z.string().trim().min(1).max(80),
      skillId: z.string().uuid().nullable().optional(),
    }),
  ]);
  const competenciesInput = z.array(competencyItemSchema).max(40).optional();

  server.tool(
    'create_project_stakeholder',
    'Add or upsert a project stakeholder. Omit userId to create an open job role (jobTitle required). Accepts roleDescription and competency tags. Money/rate/hour fields accept number or string; returned as JSON numbers. Requires pm:write.',
    {
      projectId: z.string().uuid(),
      userId: z.string().uuid().nullable().optional(),
      projectRole: stakeholderRoleEnum,
      jobTitle: z.string().max(200).nullable().optional(),
      roleDescription: z.string().max(10000).nullable().optional(),
      competencies: competenciesInput,
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
    'Update a project stakeholder roster row (role, description, competencies, rate, capacity). Money/rate/hour fields accept number or string; returned as JSON numbers. stakeholderId must be the roster row ID (rosterId from list_project_stakeholders), not the userId. Optional projectId enables helpful userId→rosterId hints. Requires pm:write.',
    {
      projectId: z.string().uuid().optional(),
      stakeholderId: z.string().uuid(),
      projectRole: stakeholderRoleEnum.optional(),
      jobTitle: z.string().max(200).nullable().optional(),
      roleDescription: z.string().max(10000).nullable().optional(),
      competencies: competenciesInput,
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
    'assign_project_stakeholder',
    'Fill an open job role by assigning a workspace member (userId). stakeholderId must be the roster row ID (rosterId from list_project_stakeholders), not the userId. Optional projectId enables helpful userId→rosterId hints. Target must be open. Requires pm:write.',
    {
      projectId: z.string().uuid().optional(),
      stakeholderId: z.string().uuid(),
      userId: z.string().uuid(),
    },
    async (args) =>
      wrap('assign_project_stakeholder', 'pm:write', () =>
        handlers.assignProjectStakeholder(args),
      )(),
  );

  server.tool(
    'unassign_project_stakeholder',
    'Reopen a filled roster seat (clear userId; keeps role description and competencies). stakeholderId must be the roster row ID (rosterId from list_project_stakeholders), not the userId. Optional projectId enables helpful userId→rosterId hints. Requires pm:write.',
    { projectId: z.string().uuid().optional(), stakeholderId: z.string().uuid() },
    async (args) =>
      wrap('unassign_project_stakeholder', 'pm:write', () =>
        handlers.unassignProjectStakeholder(args),
      )(),
  );

  server.tool(
    'update_project_ai_assistant_cost',
    'Set AI assistant cost mode (flat|api|mixed|note_only) on a project AI system. aiTokenRatePer1k is the blended per-1k fallback. Optional aiTokenRateInputPer1k, aiTokenRateOutputPer1k, and aiTokenRateCachePer1k bill a usage breakdown; null falls back to the blended rate. Mixed AC is the flat monthly fee accrued over the project dates plus token cost. aiCostNotes is a short note (max 500). Money fields accept number or string. Requires pm:write.',
    {
      systemId: z.string().uuid(),
      aiCostMode: z
        .enum(['flat', 'api', 'mixed', 'note_only'])
        .nullable()
        .optional(),
      aiFlatMonthlyFee: moneyInput.optional(),
      aiTokenRatePer1k: moneyInput.optional(),
      aiTokenRateInputPer1k: moneyInput.optional(),
      aiTokenRateOutputPer1k: moneyInput.optional(),
      aiTokenRateCachePer1k: moneyInput.optional(),
      aiCostNotes: z.string().max(500).nullable().optional(),
      aiBudgetAllocation: moneyInput.optional(),
    },
    async (args) =>
      wrap('update_project_ai_assistant_cost', 'pm:write', () =>
        handlers.updateProjectAiAssistantCost(args),
      )(),
  );

  server.tool(
    'delete_project_stakeholder',
    'Remove a durable project stakeholder roster row (RACI-derived people remain). stakeholderId must be the roster row ID (rosterId from list_project_stakeholders), not the userId. Optional projectId enables helpful userId→rosterId hints. Requires pm:write.',
    { projectId: z.string().uuid().optional(), stakeholderId: z.string().uuid() },
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

  server.tool(
    'list_project_raid_items',
    'List RAID register items (risks, assumptions, issues, dependencies) for a project. Pages at 25. Descriptions are excerpts. Pass cursor from nextCursor until hasMore is false. Each item includes records[] (linked knowledge records: id, title, slug, recordType, humanKey) plus mediaLinks and mediaLinkCount for the Media tab (workspace images and titled http(s) URLs). Requires pm:read.',
    {
      projectId: z.string().uuid(),
      includeArchived: z.boolean().optional(),
      ...listPage,
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
    'Create a RAID register item. Optional taskIds link delivery tasks. Optional recordIds link knowledge records in the same project (UUID or human key). A record from another project is rejected. Requires pm:write.',
    {
      projectId: z.string().uuid(),
      kind: raidKindEnum,
      title: z.string().min(1).max(300),
      description: z.string().max(10000).nullable().optional(),
      status: raidStatusEnum.optional(),
      severity: raidSeverityEnum.optional(),
      probability: raidSeverityEnum.nullable().optional(),
      impact: raidSeverityEnum.nullable().optional(),
      ownerUserId: z.string().uuid().nullable().optional(),
      dueDate: isoDateNullableSchema.optional(),
      sortOrder: z.number().int().min(0).max(100000).optional(),
      taskIds: z.array(entityRef).max(100).optional(),
      recordIds: z
        .array(entityRef)
        .max(100)
        .optional()
        .describe(
          'Optional knowledge record ids in the same project. UUID or human key.',
        ),
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
      probability: raidSeverityEnum.nullable().optional(),
      impact: raidSeverityEnum.nullable().optional(),
      ownerUserId: z.string().uuid().nullable().optional(),
      dueDate: isoDateNullableSchema.optional(),
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

  server.tool(
    'set_project_raid_record_links',
    'Replace the knowledge records linked to a RAID item. record ids may be UUID or human keys and must belong to the same project. Requires pm:write.',
    {
      raidItemId: entityRef,
      recordIds: z.array(entityRef).max(100),
    },
    async (args) =>
      wrap('set_project_raid_record_links', 'pm:write', () =>
        handlers.setProjectRaidRecordLinks(args),
      )(),
  );

  server.tool(
    'get_knowledge_record_raid_links',
    'List RAID items linked to a knowledge record. Requires knowledge:read.',
    {
      recordId: entityRef,
    },
    async (args) =>
      wrap(
        'get_knowledge_record_raid_links',
        'knowledge:read',
        () => handlers.getKnowledgeRecordRaidLinks(args),
        { recordId: args.recordId },
      )(),
  );

  server.tool(
    'set_knowledge_record_raid_links',
    'Replace the RAID items linked to a project-scoped knowledge record. raid item ids may be UUID or human keys. Requires knowledge:write.',
    {
      recordId: entityRef,
      raidItemIds: z.array(entityRef).max(100),
    },
    async (args) =>
      wrap(
        'set_knowledge_record_raid_links',
        'knowledge:write',
        () => handlers.setKnowledgeRecordRaidLinks(args),
        { recordId: args.recordId },
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
    'List change-management register items for a project. Pages at 25. Descriptions and rationale are excerpts. Pass cursor from nextCursor until hasMore is false. Each item includes mediaLinks and mediaLinkCount for the Media tab (workspace images and titled http(s) URLs). Requires pm:read.',
    {
      projectId: z.string().uuid(),
      includeArchived: z.boolean().optional(),
      ...listPage,
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
    'Create a change-management item. Optional delivery links cover epics, stories, milestones, and tasks (bugs use task). Optional recordIds link documents; knowledgeRecordId still sets a single document. Requires pm:write.',
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
      knowledgeRecordId: entityRef.nullable().optional(),
      recordIds: z.array(entityRef).max(100).optional(),
      sortOrder: z.number().int().min(0).max(100000).optional(),
      deliveryLinks: z
        .array(
          z.object({
            entityType: changeDeliveryEntityEnum,
            entityId: entityRef,
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
    'Update a change-management item. changeId and linked entity/knowledge ids may be UUID or human keys. Requires pm:write.',
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
      knowledgeRecordId: entityRef.nullable().optional(),
      recordIds: z.array(entityRef).max(100).optional(),
      sortOrder: z.number().int().min(0).max(100000).optional(),
      archived: z.boolean().optional(),
      deliveryLinks: z
        .array(
          z.object({
            entityType: changeDeliveryEntityEnum,
            entityId: entityRef,
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

  const deliveryEntityEnum = z.enum([
    'epic',
    'user_story',
    'milestone',
    'task',
    'sprint',
  ]);

  server.tool(
    'get_knowledge_record_delivery_links',
    'List delivery entity links (epic / user story / milestone / task / sprint) for a knowledge record. Bugs use task. recordId may be UUID or document key. Requires knowledge:read.',
    { recordId: entityRef },
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
    'Replace delivery entity links for a project-scoped knowledge record (epic / user story / milestone / task / sprint). Bugs use task. recordId and entityId may be UUID or human keys. Requires knowledge:write.',
    {
      recordId: entityRef,
      links: z
        .array(
          z.object({
            entityType: deliveryEntityEnum,
            entityId: entityRef,
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

  const itemMediaEntityEnum = z.enum([
    'epic',
    'user_story',
    'milestone',
    'task',
    'sprint',
    'raid',
    'change',
  ]);

  server.tool(
    'set_delivery_media_links',
    'Replace Media tab links for one delivery, RAID, or change item. entityId accepts a UUID or human key (PRO-T-1, PRO-B-1, PRO-S-1, PRO-E-1, milestone, sprint, RAID, or change). Bugs use entity type task. Send the full ordered list. Omitting a link unlinks it and does not delete the workspace image. A media link references a library image in the project workspace. A url link must be http or https and needs a title. Readers are read-only. Requires pm:write.',
    {
      projectId: z.string().uuid(),
      entityType: itemMediaEntityEnum,
      entityId: entityRef,
      links: z
        .array(
          z.discriminatedUnion('kind', [
            z
              .object({
                kind: z.literal('media'),
                mediaId: z.string().uuid(),
                title: z.string().max(200).nullable().optional(),
                description: z.string().max(2000).nullable().optional(),
              })
              .strict(),
            z
              .object({
                kind: z.literal('url'),
                url: z.string().min(1).max(2000),
                title: z.string().min(1).max(200),
                description: z.string().max(2000).nullable().optional(),
              })
              .strict(),
          ]),
        )
        .max(100),
    },
    async (args) =>
      wrap(
        'set_delivery_media_links',
        'pm:write',
        () => handlers.setDeliveryMediaLinks(args),
        { projectId: args.projectId },
      )(),
  );

  if (options?.oauth) {
    const profile = options.oauth.profile;
    server.registerTool(
      'get_profile',
      {
        description:
          'Return the profile represented by this request credentials. The id is the KnowHub user id and stays the same across token refresh.',
        inputSchema: {},
        outputSchema: {
          id: z.string(),
          name: z.string().optional(),
          email: z.string().optional(),
        },
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          openWorldHint: false,
        },
        _meta: {
          'openai/profile': true,
        },
      },
      async () => {
        if (!profile?.id.trim()) {
          return {
            isError: true,
            content: [{ type: 'text' as const, text: 'Profile identity unavailable.' }],
          };
        }
        const body: { id: string; name?: string; email?: string } = { id: profile.id };
        if (profile.name) {
          body.name = profile.name;
        }
        if (profile.email) {
          body.email = profile.email;
        }
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(body) }],
          structuredContent: body,
        };
      },
    );
    server.tool(
      'list_hub_tools',
      'List hub tools by name, scope, and a short description, including omitted tools. Requires projects:read.',
      {},
      async () =>
        wrap('list_hub_tools', 'projects:read', () =>
          invokeNamedHubTool(handlers, client.scopes, 'list_hub_tools', {}),
        )(),
    );
    server.tool(
      'call_hub_tool',
      'Invoke a hub tool by name from list_hub_tools, including omitted tools. Requires that tool scope.',
      {
        toolName: z.string().min(1).max(80),
        arguments: z.record(z.string(), z.unknown()).optional(),
      },
      async (args) =>
        wrap('call_hub_tool', 'projects:read', () =>
          invokeNamedHubTool(handlers, client.scopes, 'call_hub_tool', {
            toolName: args.toolName,
            arguments: args.arguments ?? {},
          }),
        )(),
    );
    limitOauthToolSurface(server);
    stampOauthSecuritySchemes(server, client.scopes);
  }

  rejectUnknownToolArguments(server);
  describeRequiredToolInputs(server);
  return server;
}

/**
 * Zod objects strip unknown keys by default, so a typo in a tool argument
 * never reached the handler. Strict objects return a validation error that
 * names the field. Nested records (metadata, call_hub_tool arguments) stay open.
 */
function rejectUnknownToolArguments(server: McpServer): void {
  const tools = (
    server as unknown as {
      _registeredTools?: Record<
        string,
        { inputSchema?: { strict?: () => unknown } }
      >;
    }
  )._registeredTools;
  if (!tools) return;
  for (const tool of Object.values(tools)) {
    const schema = tool.inputSchema;
    if (schema && typeof schema.strict === 'function') {
      tool.inputSchema = schema.strict() as typeof schema;
    }
  }
}

type ZodDef = {
  typeName?: string;
  innerType?: z.ZodTypeAny;
  type?: z.ZodTypeAny;
  options?: z.ZodTypeAny[];
  discriminator?: string;
  unknownKeys?: string;
  description?: string;
  minLength?: { value: number } | null;
  maxLength?: { value: number } | null;
  defaultValue?: () => unknown;
  checks?: Array<{ kind?: string }>;
};

function zodDef(schema: z.ZodTypeAny): ZodDef {
  if (!schema || typeof schema !== 'object') return {};
  const def = (schema as unknown as { _def?: ZodDef })._def;
  if (!def) return {};
  return def;
}

/**
 * Drop keys the output schema does not declare. Passthrough objects, such as
 * task rows, keep their extra fields. Types are left for output validation.
 */
function stripToSchema(schema: z.ZodTypeAny, value: unknown): unknown {
  let current = schema;
  let def = zodDef(current);
  while (
    def.typeName === 'ZodOptional'
    || def.typeName === 'ZodNullable'
    || def.typeName === 'ZodDefault'
  ) {
    if (value == null) return value;
    if (!def.innerType) break;
    current = def.innerType;
    def = zodDef(current);
  }
  if (def.typeName === 'ZodArray' && Array.isArray(value) && def.type) {
    return value.map((item) => stripToSchema(def.type as z.ZodTypeAny, item));
  }
  if (
    def.typeName === 'ZodObject'
    && value
    && typeof value === 'object'
    && !Array.isArray(value)
  ) {
    const shape = (current as z.ZodObject<z.ZodRawShape>).shape;
    const record = value as Record<string, unknown>;
    const next: Record<string, unknown> = def.unknownKeys === 'passthrough'
      ? { ...record }
      : {};
    for (const [key, field] of Object.entries(shape)) {
      if (key in record) next[key] = stripToSchema(field, record[key]);
    }
    return next;
  }
  return value;
}

function isUuidField(field: z.ZodTypeAny): boolean {
  let current = field;
  let def = zodDef(current);
  while (
    def.typeName === 'ZodOptional'
    || def.typeName === 'ZodNullable'
    || def.typeName === 'ZodDefault'
  ) {
    if (!def.innerType) break;
    current = def.innerType;
    def = zodDef(current);
  }
  return Boolean(def.checks?.some((check) => check.kind === 'uuid'));
}

function requiredFieldDescription(key: string, field: z.ZodTypeAny): string {
  if (key === 'projectId' && isUuidField(field)) return 'Required project id (UUID).';
  if (isUuidField(field)) return `Required ${key} (UUID).`;
  if (key === 'entityId') return 'Required entity id (UUID or human key).';
  return `Required ${key}.`;
}

/**
 * Copy a tool input schema, adding "Required" to required fields that lack it.
 * The copy is assigned only to the MCP tool. Shared domain schemas stay as written.
 */
function withRequiredDescriptions(schema: z.ZodTypeAny): z.ZodTypeAny {
  const def = zodDef(schema);
  if (def.typeName === 'ZodOptional' && def.innerType) {
    const inner = withRequiredDescriptions(def.innerType);
    if (inner === def.innerType) return schema;
    const next = inner.optional();
    return schema.description ? next.describe(schema.description) : next;
  }
  if (def.typeName === 'ZodNullable' && def.innerType) {
    const inner = withRequiredDescriptions(def.innerType);
    if (inner === def.innerType) return schema;
    const next = inner.nullable();
    return schema.description ? next.describe(schema.description) : next;
  }
  if (def.typeName === 'ZodDefault' && def.innerType && def.defaultValue) {
    const inner = withRequiredDescriptions(def.innerType);
    if (inner === def.innerType) return schema;
    const next = inner.default(def.defaultValue());
    return schema.description ? next.describe(schema.description) : next;
  }
  if (def.typeName === 'ZodArray' && def.type) {
    const inner = withRequiredDescriptions(def.type);
    if (inner === def.type) return schema;
    let array = z.array(inner);
    if (def.minLength) array = array.min(def.minLength.value);
    if (def.maxLength) array = array.max(def.maxLength.value);
    return schema.description ? array.describe(schema.description) : array;
  }
  if (
    (def.typeName === 'ZodUnion' || def.typeName === 'ZodDiscriminatedUnion')
    && def.options
    && def.options.length >= 2
  ) {
    const options = def.options.map((option) => withRequiredDescriptions(option));
    if (options.every((option, index) => option === def.options?.[index])) return schema;
    const tuple = options as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]];
    const next = def.typeName === 'ZodDiscriminatedUnion' && def.discriminator
      ? z.discriminatedUnion(
        def.discriminator,
        tuple as unknown as [
          z.ZodDiscriminatedUnionOption<string>,
          ...z.ZodDiscriminatedUnionOption<string>[],
        ],
      )
      : z.union(tuple);
    return schema.description ? next.describe(schema.description) : next;
  }
  if (def.typeName !== 'ZodObject') return schema;

  const shape = (schema as z.ZodObject<z.ZodRawShape>).shape;
  const nextShape: z.ZodRawShape = {};
  let changed = false;
  for (const [key, field] of Object.entries(shape)) {
    let updated = withRequiredDescriptions(field);
    const description = updated.description ?? '';
    if (!field.isOptional() && !/required/i.test(description)) {
      updated = updated.describe(
        description ? `Required. ${description}` : requiredFieldDescription(key, field),
      );
    }
    if (updated !== field) changed = true;
    nextShape[key] = updated;
  }
  if (!changed) return schema;
  const object = def.unknownKeys === 'strict' ? z.object(nextShape).strict() : z.object(nextShape);
  return schema.description ? object.describe(schema.description) : object;
}

function describeRequiredToolInputs(server: McpServer): void {
  const tools = (
    server as unknown as {
      _registeredTools?: Record<string, { inputSchema?: z.ZodTypeAny }>;
    }
  )._registeredTools;
  if (!tools) return;
  for (const tool of Object.values(tools)) {
    if (!tool.inputSchema || typeof tool.inputSchema.safeParse !== 'function') continue;
    const next = withRequiredDescriptions(tool.inputSchema);
    if (next !== tool.inputSchema) tool.inputSchema = next;
  }
}

/**
 * ChatGPT rejects the whole tools/list when the combined definitions exceed
 * about 16,000 tokens. Keep only navigation tools here. The handlers stay
 * registered, so call_hub_tool can still run the rest. Bearer /mcp is unchanged.
 */
const CHATGPT_OAUTH_LISTED_TOOLS = new Set([
  'get_profile',
  'list_workspaces',
  'list_projects',
  'get_project',
  'search_knowledge',
  'get_knowledge_record',
  'list_hub_tools',
  'call_hub_tool',
]);

function limitOauthToolSurface(server: McpServer): void {
  const tools = (
    server as unknown as {
      _registeredTools?: Record<string, { disable?: () => void }>;
    }
  )._registeredTools;
  if (!tools) {
    return;
  }
  for (const [name, tool] of Object.entries(tools)) {
    if (!CHATGPT_OAUTH_LISTED_TOOLS.has(name)) {
      tool.disable?.();
    }
  }
}

function stampOauthSecuritySchemes(server: McpServer, scopes: string[]): void {
  const tools = (
    server as unknown as {
      _registeredTools?: Record<string, { _meta?: Record<string, unknown> }>;
    }
  )._registeredTools;
  if (!tools) {
    return;
  }
  const securitySchemes = [{ type: 'oauth2', scopes }];
  for (const tool of Object.values(tools)) {
    tool._meta = {
      ...tool._meta,
      securitySchemes,
    };
  }
}
