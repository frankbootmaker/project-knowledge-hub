import { AsyncLocalStorage } from 'node:async_hooks';
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
  classifyMcpToolError,
  classifyMcpToolErrorMessage,
  sanitizeAuditErrorMessage,
  sanitizeClientInfo,
  type McpAuditClientInfo,
  type McpToolErrorDetail,
} from './audit-error.js';
import { openMcpToolOutputSchemas } from './open-output-schema.js';
import {
  aiModelPriceToolDescription,
  dependencyLagDaysSchema,
  hoursPerWorkdaySchema,
  isoDateNullableSchema,
  knowledgeRecordRelationTypeSchema,
  nonWorkingDaysSchema,
  projectCurrencySchema,
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
  /**
   * Set for an OAuth grant. `id` is then the grant id, not an api_clients row,
   * and must not be written to created_by_api_client_id.
   */
  oauthGrantId?: string | null;
  /** External OAuth client id (not the grant uuid). */
  oauthClientId?: string | null;
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
    scheduleSlipRiskEnabled?: boolean;
    scheduleSlipThresholdDays?: number;
    scheduleSlipItemTypes?: Array<'task' | 'user_story' | 'epic' | 'milestone'>;
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
    aiTokenRateCurrency?: string | null;
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
    aiTokenRateCurrency?: string | null;
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
    includeRecordRelations?: boolean;
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
  importDocumentKnowledgeRecord: (input: {
    workspaceId: string;
    projectId?: string;
    title?: string;
    recordType?: string;
    language?: string;
    acknowledgeSecrets?: boolean;
    filename?: string;
    contentType?: string;
    contentBase64?: string;
    mediaId?: string;
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
    /** Explicit URL slug. Lowercase a-z, digits, and hyphens. */
    slug?: string;
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
  getWorkspaceMedia: (input: {
    mediaId: string;
    maxDimension?: number;
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
    cloudAgentId?: string | null;
    cloudAgentIds?: string[] | null;
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
    cloudAgentId?: string | null;
    cloudAgentIds?: string[] | null;
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
    tokensCacheWrite?: number | null;
    modelId?: string | null;
    pricingTier?: string | null;
    usageOccurredAt?: string | null;
    billingPeriod?: string | null;
    aiSystemId?: string | null;
    cloudAgentId?: string | null;
    cloudAgentIds?: string[] | null;
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
    aiTokenRateCurrency?: string | null;
    aiCostNotes?: string | null;
    aiBudgetAllocation?: number | string | null;
  }) => Promise<unknown>;
  listAiBillingEntries: (input: {
    workspaceId: string;
    period?: string;
    aiSystemId?: string;
    servicePeriodStart?: string;
    servicePeriodEnd?: string;
  }) => Promise<unknown>;
  getPlatformAiCost: (input: {
    from?: string;
    to?: string;
    reportingCurrency?: string;
  }) => Promise<unknown>;
  getAiUsageTheoreticalCost: (input: {
    workspaceId: string;
    from?: string;
    to?: string;
  }) => Promise<unknown>;
  listAiModelPrices: (input: { workspaceId: string }) => Promise<unknown>;
  upsertAiModelPrice: (input: {
    scope: 'global' | 'workspace';
    workspaceId?: string;
    model: string;
    inputPerMillion: number;
    outputPerMillion: number;
    cacheReadPerMillion: number;
    cacheWritePerMillion: number;
    blendedPerMillion: number;
    currency: string;
    effectiveFrom: string;
    sourceNote: string;
  }) => Promise<unknown>;
  retireAiModelPrice: (input: {
    scope: 'global' | 'workspace';
    workspaceId?: string;
    priceId?: string;
    model?: string;
    effectiveFrom?: string;
  }) => Promise<unknown>;
  createAiBillingEntry: (input: {
    workspaceId: string;
    period?: string;
    servicePeriodStart?: string | null;
    servicePeriodEnd?: string | null;
    provider: string;
    type: 'subscription' | 'plan_change' | 'on_demand';
    amount: number | string;
    currency: string;
    aiSystemId?: string | null;
    plan?: string | null;
    paidAt?: string | null;
    note?: string | null;
    externalRef?: string | null;
  }) => Promise<unknown>;
  updateAiBillingEntry: (input: {
    entryId: string;
    period?: string;
    servicePeriodStart?: string | null;
    servicePeriodEnd?: string | null;
    provider?: string;
    type?: 'subscription' | 'plan_change' | 'on_demand';
    amount?: number | string;
    currency?: string;
    aiSystemId?: string | null;
    plan?: string | null;
    paidAt?: string | null;
    note?: string | null;
    externalRef?: string | null;
  }) => Promise<unknown>;
  deleteAiBillingEntry: (input: { entryId: string }) => Promise<unknown>;
  listAiUsageImports: (input: {
    workspaceId: string;
    limit?: number;
  }) => Promise<unknown>;
  listAiUsageImportSummaries: (input: {
    workspaceId: string;
    importId?: string;
    limit?: number;
    cursor?: string;
    unassignedLimit?: number;
    unassignedCursor?: string;
  }) => Promise<unknown>;
  importAiUsageCsv: (input: {
    workspaceId: string;
    csv: string;
    fileName?: string | null;
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
    confirmBaseline?: boolean;
    deliveryLinks?: Array<{ entityType: string; entityId: string }>;
  }) => Promise<unknown>;
  applyProjectChangeToBaseline: (input: {
    changeId: string;
  }) => Promise<unknown>;
  getKnowledgeRecordDeliveryLinks: (input: {
    recordId: string;
  }) => Promise<unknown>;
  setKnowledgeRecordDeliveryLinks: (input: {
    recordId: string;
    links: Array<{ entityType: string; entityId: string }>;
  }) => Promise<unknown>;
  getKnowledgeRecordRelations: (input: {
    recordId: string;
  }) => Promise<unknown>;
  setKnowledgeRecordRelations: (input: {
    recordId: string;
    links: Array<{ targetRecordId: string; relationType: string }>;
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
  /** Set on failures. Message is already shortened and sanitized. */
  error?: McpToolErrorDetail;
  /** MCP initialize clientInfo when this session completed initialize. */
  clientInfo?: McpAuditClientInfo;
  /** call_hub_tool target name. Never argument values. */
  nestedTool?: string;
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

type McpToolContent =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string };

type McpToolResult = {
  content: McpToolContent[];
  isError?: true;
  structuredContent?: Record<string, unknown>;
};

function textResult(data: unknown): McpToolResult {
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
 * tools/list advertises open output schemas so stale clients accept new
 * fields; structuredContent is still stripped to the declared Zod shape.
 */
function structuredTextResult(data: unknown, outputShape?: z.ZodRawShape): McpToolResult {
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

const workspaceMediaReadOutput = {
  media: z.object({
    id: z.string(),
    mediaId: z.string(),
    workspaceId: z.string(),
    knowledgeRecordId: z.string().nullable(),
    contentType: z.string(),
    byteSize: z.number(),
    originalFilename: z.string().nullable(),
    altText: z.string().nullable(),
    url: z.string(),
    markdownSnippet: z.string(),
    width: z.number().int().nullable(),
    height: z.number().int().nullable(),
    resized: z.boolean(),
    imageIncluded: z.boolean(),
    hint: z.string(),
  }),
  signedUrl: z.string(),
  expiresAt: z.string(),
};

function imageContentBlock(
  image: unknown,
): { type: 'image'; data: string; mimeType: string } | null {
  if (!image || typeof image !== 'object') return null;
  const row = image as { data?: unknown; mimeType?: unknown };
  if (typeof row.data !== 'string' || row.data.length === 0) return null;
  if (typeof row.mimeType !== 'string' || !row.mimeType.startsWith('image/')) return null;
  if (row.mimeType === 'image/svg+xml') return null;
  return { type: 'image', data: row.data, mimeType: row.mimeType };
}

/** Metadata stays in structuredContent. Pixels are an MCP image block, not JSON. */
function presentWorkspaceMediaRead(data: unknown): McpToolResult {
  const record = data && typeof data === 'object' && !Array.isArray(data)
    ? { ...(data as Record<string, unknown>) }
    : null;
  const image = record?.imageContent;
  if (record) delete record.imageContent;
  const structured = structuredTextResult(record ?? data, workspaceMediaReadOutput);
  if (structured.isError) return structured;
  const block = imageContentBlock(image);
  if (!block) return structured;
  return {
    content: [...structured.content, block],
    structuredContent: structured.structuredContent,
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

const mcpAuditFlag = new AsyncLocalStorage<{ logged: boolean }>();

function readMcpClientInfo(server: McpServer): McpAuditClientInfo | undefined {
  const info = sanitizeClientInfo(server.server.getClientVersion());
  return info ?? undefined;
}

function toolNameFromRequest(request: unknown): string {
  if (!request || typeof request !== 'object') return 'unknown';
  const params = (request as { params?: { name?: unknown } }).params;
  const name = params?.name;
  if (typeof name === 'string' && /^[A-Za-z0-9_]{1,80}$/.test(name)) return name;
  return 'unknown';
}

/** Only the hub tool name, never the arguments object. */
function nestedToolFromRequest(request: unknown, toolName: string): string | undefined {
  if (toolName !== 'call_hub_tool') return undefined;
  if (!request || typeof request !== 'object') return undefined;
  const params = (request as { params?: { arguments?: unknown } }).params;
  const args = params?.arguments;
  if (!args || typeof args !== 'object') return undefined;
  const nested = (args as { toolName?: unknown }).toolName;
  if (typeof nested === 'string' && /^[a-z0-9_]{1,80}$/.test(nested)) return nested;
  return undefined;
}

function errorTextFromResult(result: unknown): string {
  if (!result || typeof result !== 'object') return 'MCP tool error';
  const content = (result as { content?: Array<{ text?: unknown }> }).content;
  const text = content?.find((block) => typeof block?.text === 'string')?.text;
  return typeof text === 'string' && text.trim() ? text : 'MCP tool error';
}

function isToolErrorResult(result: unknown): boolean {
  return Boolean(
    result && typeof result === 'object' && (result as { isError?: unknown }).isError === true,
  );
}

async function recordMcpToolError(
  handlers: McpToolHandlers,
  server: McpServer,
  toolName: string,
  error: unknown,
  result: { content?: Array<{ text?: string }> },
  argContext?: McpToolCallContext,
  nestedTool?: string,
): Promise<void> {
  const flag = mcpAuditFlag.getStore();
  if (flag?.logged) return;
  if (flag) flag.logged = true;
  if (!handlers.onToolCall) return;
  const rawMessage = result.content?.[0]?.text
    ?? (error instanceof Error ? error.message : 'MCP tool error');
  const errorType = typeof error === 'string'
    ? classifyMcpToolErrorMessage(error)
    : classifyMcpToolError(error);
  const message = sanitizeAuditErrorMessage(rawMessage, errorType);
  const clientInfo = readMcpClientInfo(server);
  try {
    await handlers.onToolCall(toolName, false, {
      ...argContext,
      error: { errorType, message },
      ...(clientInfo ? { clientInfo } : {}),
      ...(nestedTool ? { nestedTool } : {}),
    });
  } catch (auditError) {
    handlers.logger?.error({ err: auditError }, 'MCP tool error audit failed');
  }
}

/**
 * Schema checks run before the tool callback, so -32602 / input validation
 * never enters wrap(). Audit those results here. Handler errors set the
 * flag inside wrap() and are not recorded twice.
 */
function installMcpToolErrorAudit(server: McpServer, handlers: McpToolHandlers): void {
  const protocol = server.server as unknown as {
    _requestHandlers?: Map<string, (request: unknown, extra: unknown) => Promise<unknown>>;
  };
  const handlersMap = protocol._requestHandlers;
  const current = handlersMap?.get('tools/call');
  if (!handlersMap || !current) return;
  handlersMap.set('tools/call', (request, extra) => {
    const flag = { logged: false };
    return mcpAuditFlag.run(flag, async () => {
      try {
        const result = await current(request, extra);
        if (isToolErrorResult(result) && !flag.logged) {
          const toolName = toolNameFromRequest(request);
          const text = errorTextFromResult(result);
          await recordMcpToolError(
            handlers,
            server,
            toolName,
            text,
            { content: [{ text }] },
            undefined,
            nestedToolFromRequest(request, toolName),
          );
        }
        return result;
      } catch (error) {
        if (!flag.logged) {
          const toolName = toolNameFromRequest(request);
          const text = error instanceof Error ? error.message : 'MCP tool error';
          await recordMcpToolError(
            handlers,
            server,
            toolName,
            error,
            { content: [{ text }] },
            undefined,
            nestedToolFromRequest(request, toolName),
          );
        }
        throw error;
      }
    });
  });
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
      present: (data: unknown) => McpToolResult = textResult,
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
        const result = toMcpErrorResult(error, handlers.logger);
        await recordMcpToolError(handlers, server, toolName, error, result, argContext);
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
    'List accessible projects in allowed workspaces. Each project includes workspaceName, workspaceSlug, status (lifecycle stage), and health. health.overall is the RAG. Filter with status or stage (idea, planned, active, maintenance, paused, completed, archived).',
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
    'Create a catalogue system (IT resource) in an allowlisted workspace. Prefer linking projectId when the system serves a project. Fill itDetails whenever known. Set itCostMode (flat|one_time|note_only) plus fees so OpEx rolls into project budget AC. Money fields accept number or string; returned as JSON numbers. Token list prices are the model price catalog (per 1,000,000 tokens), not fields on the system. Sending aiTokenRateCurrency returns TOKEN_RATES_RETIRED. Requires catalogue:write.',
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
      aiTokenRateCurrency: z.string().length(3).nullable().optional(),
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
    'Update a catalogue system (fields, IT inventory itDetails, IT OpEx itCostMode/fees, tags). Money fields accept number or string; returned as JSON numbers. Token list prices are the model price catalog (per 1,000,000 tokens). Sending aiTokenRateCurrency returns TOKEN_RATES_RETIRED. Does not archive/purge. itDetails updates are merged by key: omitted keys are preserved, keys set to null are removed, and array fields (ports, endpoints, ipAddresses, dependencies) are replaced entirely. Requires catalogue:write.',
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
      aiTokenRateCurrency: z.string().length(3).nullable().optional(),
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
  // Fresh enums. A shared Zod enum is emitted as $ref, which clients cannot resolve.
  // These fields have no .describe(): ChatGPT's tool list must stay under 12,000
  // characters. status vs health.overall is stated on the tool descriptions.
  const ragStatus = () => z.enum(['green', 'amber', 'red']);
  // Fresh objects. A shared Zod schema is emitted as $ref, which clients
  // that validate one project cannot resolve.
  const riskReasonOutput = () =>
    z
      .object({
        count: z.number().int(),
        severity: z.string(),
        kind: z.string(),
        cause: z.enum(['issue', 'overdue', 'due_soon', 'severity']),
        dueInDays: z.number().int().optional(),
      })
      .strict();
  const projectHealthOutput = () =>
    z
      .object({
        overall: ragStatus(),
        timeline: ragStatus(),
        risk: ragStatus(),
        financial: ragStatus().nullable(),
        riskReasons: z.array(riskReasonOutput()),
      })
      .strict();
  const pinnedRecordOutput = () =>
    z
      .object({
        id: z.string(),
        title: z.string(),
        slug: z.string(),
        recordType: z.string(),
        humanKey: z.string().nullable(),
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
      forecastFinishDate: nullableOutputText(),
      baselineFinishDate: nullableOutputText(),
      durationWorkingDays: z.number().int().nullable(),
      forecastDurationWorkingDays: z.number().int().nullable().optional(),
      charterRecordId: nullableOutputText(),
      charterRecord: pinnedRecordOutput(),
      initialPlanRecordId: nullableOutputText(),
      initialPlanRecord: pinnedRecordOutput(),
      definitionOfDone: nullableOutputText(),
      currency: projectCurrencyEnum,
      initialBudget: z.number().nullable(),
      approvedBudget: z.number().nullable(),
      keyPrefix: nullableOutputText(),
      methodology: z.enum(['scrum', 'kanban', 'waterfall', 'hybrid']).nullable(),
      createdVia: z.enum(['mcp']).nullable(),
      createdByApiClientId: nullableOutputText(),
      createdByOauthGrantId: nullableOutputText(),
      createdByUserId: nullableOutputText(),
      generatedByModel: nullableOutputText(),
      scheduleSlipRiskEnabled: z.boolean(),
      scheduleSlipThresholdDays: z.number().int(),
      scheduleSlipItemTypes: z.array(
        z.enum(['task', 'user_story', 'epic', 'milestone']),
      ),
      url: nullableOutputText(),
      health: projectHealthOutput(),
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
      createdByApiClientId: nullableOutputText().describe(
        'Bearer API client id. Null when an OAuth grant created the project.',
      ),
      createdByOauthGrantId: nullableOutputText().describe(
        'OAuth grant id when ChatGPT created the project. Null for a bearer API client.',
      ),
      createdByUserId: z.string(),
      generatedByModel: nullableOutputText(),
      warning: nullableOutputText(),
    }),
  };

  server.registerTool(
    'get_project',
    {
      description:
        'Get a project by id or slug. Returns status (lifecycle stage), health.overall, finishDate, forecastFinishDate, baselineFinishDate, durationWorkingDays, forecast duration, definitionOfDone, and url.',
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

  /** UUID or human key such as HL1-T-12 / HL1-RR-3. A retired project prefix still resolves to that project. When the prefix matches multiple projects across accessible workspaces (including a retired prefix) and the key exists in more than one, returns an ambiguous key error with candidate project names; use the full UUID or specify projectId in that case (PRO-T-3). */
  const entityRef = z.string().min(1).max(80);

  server.registerTool(
    'update_project_baseline',
    {
      description:
        'Update project baseline window, working calendar, pinned docs, definitionOfDone, currency, budgets, and issue key prefix. Changing keyPrefix keeps the previous prefix resolvable and reserves it in the workspace until a workspace admin releases it. The same prefix in another workspace can make an unscoped key ambiguous (PRO-T-3). charterRecordId and initialPlanRecordId accept a UUID or document key in this project, any record type. hoursPerWorkday, workdaysPerWeek (Monday-first, 1–7), and nonWorkingDays (YYYY-MM-DD, replaces the list) drive scheduling. endDate is the approved baseline finish. finishDate, forecastFinishDate, baselineFinishDate, and durationWorkingDays are calculated and are not inputs. Apply an approved schedule change with apply_project_change_to_baseline. Returns the saved project, including definitionOfDone and pinned key and title. Budget fields accept number or string and are returned as JSON numbers. Requires pm:write.',
      inputSchema: {
        projectId: z.string().uuid(),
        startDate: isoDateNullableSchema.optional(),
        endDate: isoDateNullableSchema.optional(),
        hoursPerWorkday: hoursPerWorkdaySchema.optional(),
        workdaysPerWeek: workdaysPerWeekSchema.optional(),
        nonWorkingDays: nonWorkingDaysSchema.nullable().optional(),
        charterRecordId: entityRef.nullable().optional(),
        initialPlanRecordId: entityRef.nullable().optional(),
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
        'Create a project in an allowlisted workspace. Requires projects:write and an acting user who is maintainer, workspace_admin, or system_admin. Call list_workspaces, then list_project_metadata. The project is always created in stage idea; a human promotes it to active. keyPrefix is AAA or AA0 — omit it to auto-assign, or read the suggested prefix when the value is taken, including a retired prefix another project still reserves. A similar name is rejected unless confirmDuplicateName is true. Returns id, keyPrefix, and url. generatedByModel is stored as provenance.',
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
        'Update a project name, description, methodology, or currency. Requires projects:write and an acting user who can create projects in that workspace. status (alias stage) may change only within MCP transitions. Promoting idea to active is rejected — a human does that in the hub. A similar new name needs confirmDuplicateName. Writes an audit entry. Returns the project, including provenance. scheduleSlipRiskEnabled, scheduleSlipThresholdDays, and scheduleSlipItemTypes control auto schedule-slip RAID risks.',
      inputSchema: {
        projectId: z.string().uuid(),
        name: z.string().min(1).max(160).optional(),
        description: z.string().max(10000).nullable().optional(),
        methodology: projectMethodologyEnum.nullable().optional(),
        currency: projectCurrencyEnum.optional(),
        status: z.string().min(1).max(40).optional(),
        stage: z.string().min(1).max(40).optional(),
        confirmDuplicateName: z.boolean().optional(),
        scheduleSlipRiskEnabled: z.boolean().optional(),
        scheduleSlipThresholdDays: z.number().int().min(1).max(3650).optional(),
        scheduleSlipItemTypes: z
          .array(z.enum(['task', 'user_story', 'epic', 'milestone']))
          .max(4)
          .optional(),
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
    'Get project EVM summary (BAC/EV/AC/CPI/SPI), financialRag, riskRag, riskReasons, burndown snapshots, and epic cost rollups. riskRag counts open or mitigating RAID only (closed, accepted, cancelled, and archived stay out) and uses the same 7-day window as timeline health. Red: a critical item that is overdue, due within 7 days, or kind issue; or a high item that is overdue. Amber: any other critical item (later due date or none), any other high item, or any overdue item. Green otherwise. riskReasons explains that colour (count, severity, kind, cause, and dueInDays when cause is due_soon) and is empty when green. Includes person vs AI vs IT-system OpEx. aiAc and aiPaidAc are the allocated paid AI cost: ledger rows for that month, or the aiFlatMonthlyFee fallback (plus legacy token cost for api/mixed) when the month has no ledger rows. A cost entry with service dates is split across those months by days before allocation; an entry without service dates stays entirely in its period. aiTheoreticalApiCost is task tokens priced from the model catalog (workspace pattern, then global, per 1,000,000 tokens) using the task model at usageOccurredAt, else completedAt, else updatedAt. A model with no row is unpriced and listed, not counted as a silent zero. Imported usage for the same cloud agent replaces the task. It is not added to AC. aiPeriods is paid vs theoretical by month. aiPaidAc is in the project currency: each pool share is converted at the entry paid-at date, or the service start when paid-at is missing, using one rate for every project in that pool. aiPaidReporting and aiTheoreticalReporting are those figures in the workspace reporting currency (default EUR). aiCostFx lists originalAmount, originalCurrency, amount, currency, rate, rateDate, and source. aiBillingEntries keep the original amount and currency and include convertedAmount, convertedCurrency, fxRate, fxRateDate, and fxSource. A missing quote day uses the previous quote. aiFlatAc and aiTokenAc stay the legacy parts. All money fields are JSON numbers. Requires pm:read.',
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
    'Get a catalogue system by id including description, tags, owner, environment, version, criticality, and itDetails inventory. Money fields (itFlatMonthlyFee, itBudgetAllocation, aiFlatMonthlyFee, aiBudgetAllocation) are JSON numbers. Per-system token rates are retired and are not used to price usage. Prices live on the model catalog (per 1,000,000 tokens). aiCostNotes is a short string. Requires systems:read.',
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
        recordRelations: z
          .any()
          .optional()
          .describe('Counts and summaries on every page unless includeRecordRelations is false.'),
        language: z.string().nullable().optional(),
        translationGroupId: z.string().nullable().optional(),
        translations: z
          .array(
            z.object({
              id: z.string(),
              key: z.string().nullable(),
              language: z.string().nullable(),
              slug: z.string(),
            }),
          )
          .optional(),
      })
      .passthrough(),
  };

  server.registerTool(
    'get_knowledge_record',
    {
      description:
        'Get a knowledge record with markdown. Returns language, translationGroupId, and translations (id, key, language, slug). key is the human document key. Tags, media, and linkedItems (deliveryLinks: epic, user story, milestone, task including bugs, sprint; raidLinks; changeItems; each id, humanKey, title, type, kind; archived omitted) are on the first page only. Pages are 50000 characters. contentLength and contentSha256 cover the full body. contentTruncated and nextOffset (null at the end) page it. contentOffset or contentLimit returns raw slices to concatenate; otherwise the first page still appends …[truncated] when more remains. boundary paragraph or line snaps to a break in the second half (default is a hard cut). inCodeFence is true inside a fence. expectSha256 yields 409 if the body changed. Follow nextOffset until null before rewriting. Images: ![alt](/api/v1/media/{id}), never data: URIs. Read pixels with call_hub_tool get_workspace_media. recordId is a UUID or document key (HL1-VIS-2). recordRelations (counts, up to 20 summaries) is on every page unless includeRecordRelations is false.',
      inputSchema: {
        recordId: z.string().min(1).max(80),
        contentOffset: z.number().int().min(0).optional(),
        contentLimit: z.number().int().min(1).max(MCP_MAX_CONTENT_CHARS).optional(),
        boundary: z.enum(['none', 'paragraph', 'line']).optional(),
        expectSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
        includeRecordRelations: z
          .boolean()
          .optional()
          .describe('Include recordRelations. Default true.'),
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
    'import_document_knowledge_record',
    'Import a PDF or DOCX as a draft Markdown knowledge record. Pass contentBase64, filename, and contentType, or mediaId of a file already in the workspace. Optional projectId, title, recordType, language. Same type and size checks as the web import. Requires knowledge:write and a workspace maintainer. Returns id, humanKey, and contentMarkdown.',
    {
      workspaceId: z.string().uuid(),
      projectId: z.string().uuid().optional(),
      title: z.string().min(1).max(300).optional(),
      recordType: z.string().min(1).max(64).optional(),
      language: z.string().min(2).max(16).optional(),
      acknowledgeSecrets: z.boolean().optional(),
      filename: z.string().min(1).max(200).optional(),
      contentType: z.string().min(1).max(200).optional(),
      contentBase64: z.string().min(1).max(40_000_000).optional(),
      mediaId: z.string().uuid().optional(),
    },
    async (args) =>
      wrap(
        'import_document_knowledge_record',
        'knowledge:write',
        () => handlers.importDocumentKnowledgeRecord(args),
        {
          workspaceId: args.workspaceId,
          projectId: args.projectId,
        },
      )(),
  );

  server.tool(
    'update_knowledge_record',
    'Update a knowledge record as draft (requires knowledge:write and a changeMessage). Send the full markdown body: a value ending in the get_knowledge_record truncation marker is rejected. Page that read until nextOffset is null before rewriting. Set archived=true to soft-archive (or false to restore). Optional slug renames the URL (lowercase a-z, 0-9, hyphens). For images: begin → append → finalize_workspace_media_upload (not upload_workspace_media); paste media.markdownSnippet or use insertIntoRecord on begin. Never data:image URIs. recordId may be a UUID or project document key (e.g. HL1-VIS-2).',
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
    'List recent workspace media (JPEG/PNG/WebP/GIF) with urls, markdown snippets, and a short usedBy list. Each item includes mediaId. Call get_workspace_media to read image bytes (OAuth: call_hub_tool). Optional filename query. Optional entityType+entityId (both required together) filters to images linked to that item; entityId may be a UUID or human key and the item must be in workspaceId. Readers are read-only. Requires knowledge:read.',
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

  server.registerTool(
    'get_workspace_media',
    {
      description:
        'Read one workspace media file by mediaId. Raster images return MCP image content (longest side at most 1568 px and about 1 MB; never upscaled) plus metadata. SVG and non-images return metadata only. signedUrl is an absolute URL bound to this media and workspace for 10 minutes. Requires knowledge:read.',
      inputSchema: {
        mediaId: z.string().uuid(),
        maxDimension: z
          .number()
          .int()
          .min(1)
          .max(1568)
          .optional()
          .describe(
            'Optional longest-side cap in pixels. The server never exceeds 1568 or upscales.',
          ),
      },
      outputSchema: workspaceMediaReadOutput,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args) =>
      wrap(
        'get_workspace_media',
        'knowledge:read',
        () => handlers.getWorkspaceMedia(args),
        { mediaId: args.mediaId },
        presentWorkspaceMediaRead,
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
    'Redacted platform health snapshot (ready checks, backup ages, MCP error counts, audit retention and log size). Requires monitoring:read. No secrets or content.',
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

  const targetPercentOutput = z
    .number()
    .int()
    .min(0)
    .max(100)
    .nullable()
    .describe(
      'Planned percent from the start through the end. 0 on the start day, 100 on the end day. Null when the window is missing. Read-only.',
    );
  const taskRowOutput = z
    .object({
      startDate: z
        .string()
        .nullable()
        .describe('Stored start date (YYYY-MM-DD). Writable on create and update.')
        .optional(),
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
      targetPercent: z
        .number()
        .int()
        .min(0)
        .max(100)
        .nullable()
        .describe('Tasks have no planned target. Always null.')
        .optional(),
      dueDate: z
        .string()
        .nullable()
        .describe('Forecast finish (YYYY-MM-DD). Not the approved baseline finish.')
        .optional(),
      baselineFinishDate: z
        .string()
        .nullable()
        .describe('Approved task finish. Null until a baseline is stored.')
        .optional(),
      durationDays: z
        .number()
        .int()
        .nullable()
        .describe('Stored scheduling span. Due date is the start plus this many working days.')
        .optional(),
      durationWorkingDays: z
        .number()
        .int()
        .nullable()
        .describe(
          'Inclusive working days from startDate through dueDate on the project calendar. One working day is 1. A weekend start does not count. Null when a date is missing.',
        )
        .optional(),
      cloudAgentId: z
        .string()
        .nullable()
        .describe(
          'First sorted cloud agent id on this task. The same id may be linked to other tasks.',
        )
        .optional(),
      cloudAgentIds: z
        .array(z.string())
        .describe('Cloud agent ids linked to this task, sorted.')
        .optional(),
      cloudAgentLinks: z
        .array(
          z
            .object({
              cloudAgentId: z.string(),
              tasks: z.array(
                z
                  .object({
                    id: z.string(),
                    projectId: z.string(),
                    title: z.string(),
                    humanKey: z.string().nullable(),
                  })
                  .passthrough(),
              ),
            })
            .passthrough(),
        )
        .describe(
          'Each linked cloud agent and the non-archived tasks in this workspace that share it.',
        )
        .optional(),
    })
    .passthrough();
  const taskListOutput = {
    tasks: z.array(taskRowOutput),
    total: z.number().int(),
    limit: z.number().int(),
    nextCursor: z
      .string()
      .nullable()
      .describe('Pass as cursor for the next page. Null when hasMore is false.'),
    hasMore: z.boolean(),
  };
  const taskResultOutput = { task: taskRowOutput };
  const parentScheduleOutput = {
    startDate: z
      .string()
      .nullable()
      .describe(
        'YYYY-MM-DD. The earliest included child start when startDateDerived is true; otherwise the stored date.',
      ),
    endDate: z
      .string()
      .nullable()
      .describe(
        'YYYY-MM-DD. The latest included child end when endDateDerived is true; otherwise the stored date.',
      ),
    startDateDerived: z
      .boolean()
      .describe('True when startDate comes from included children. That side is read-only.'),
    endDateDerived: z
      .boolean()
      .describe('True when endDate comes from included children. That side is read-only.'),
    targetPercent: targetPercentOutput,
  };
  const epicRowOutput = z.object({ id: z.string(), ...parentScheduleOutput }).passthrough();
  const storyRowOutput = z.object({ id: z.string(), ...parentScheduleOutput }).passthrough();
  const milestoneRowOutput = z
    .object({
      id: z.string(),
      startDate: z
        .string()
        .nullable()
        .describe('Stored start date (YYYY-MM-DD). Writable. Not derived from linked items.'),
      targetDate: z
        .string()
        .nullable()
        .describe('Stored due date (YYYY-MM-DD). Writable. Not derived from linked items.'),
      targetPercent: z
        .number()
        .int()
        .min(0)
        .max(100)
        .nullable()
        .describe('Milestones have no planned target. Always null.'),
    })
    .passthrough();
  const listPageFields = {
    total: z.number().int(),
    limit: z.number().int(),
    nextCursor: z
      .string()
      .nullable()
      .describe('Pass as cursor for the next page. Null when hasMore is false.'),
    hasMore: z.boolean(),
  };
  const epicListOutput = { epics: z.array(epicRowOutput), ...listPageFields };
  const storyListOutput = { userStories: z.array(storyRowOutput), ...listPageFields };
  const milestoneListOutput = {
    milestones: z.array(milestoneRowOutput),
    ...listPageFields,
  };
  const dependencyLinkOutput = z
    .object({
      id: z.string(),
      linkType: z.enum(['FS', 'SS', 'FF', 'SF']),
      lagDays: dependencyLagDaysSchema.describe(
        'Lag in working days. Negative is a lead. Whole days only.',
      ),
    })
    .passthrough();
  const dependencyListOutput = {
    predecessors: z.array(dependencyLinkOutput),
    successors: z.array(dependencyLinkOutput),
    scheduleDriven: z.boolean(),
  };
  const dependencyWriteOutput = {
    dependency: dependencyLinkOutput.optional(),
    dependencies: z.array(dependencyLinkOutput).optional(),
    schedule: z
      .array(
        z
          .object({
            id: z.string(),
            startDate: z.string().nullable(),
            finishDate: z.string().nullable(),
          })
          .passthrough(),
      )
      .optional(),
  };

  server.registerTool(
    'list_project_milestones',
    {
      description:
        'List milestones for a project (Project Delivery). Pages at 25. Descriptions are excerpts of the note. Pass cursor from nextCursor until hasMore is false. Each row includes completionPercent (0 or 100 from linked items and predecessor dependencies: 100 only when every included item is done or 100 percent, cancelled items are left out, otherwise 0; no included items leaves it null). completion.done counts included linked items and predecessor dependencies that are done or 100 percent. completion.total is that included set, so a partial milestone can report done greater than 0 while completionPercent stays 0. Each row also includes linkedItems, plus mediaLinks and mediaLinkCount for the Media tab. Status follows those same links: all complete is done, a non-done blocked link is blocked, completion above 0 or any started link is in progress, and nothing started is planned. No included links keeps the stored status. Recompute skips an archived milestone and never overwrites a cancelled status. startDate and targetDate are the stored start and due date. They are writable and are not derived from linked items. targetPercent is null. A predecessor moves the due date. Duration is always 0. Requires pm:read.',
      inputSchema: {
        projectId: z.string().uuid(),
        includeArchived: z.boolean().optional(),
        ...listPage,
      },
      outputSchema: milestoneListOutput,
    },
    async (args) =>
      wrap(
        'list_project_milestones',
        'pm:read',
        () => handlers.listProjectMilestones(args),
        { projectId: args.projectId },
        (data) => structuredTextResult(data, milestoneListOutput),
      )(),
  );

  server.registerTool(
    'list_project_tasks',
    {
      description:
        'List tasks for a project (optional milestone, sprint, and itemType filters). itemType bug returns bugs only. milestoneId and sprintId must belong to the given project. Includes RACI. Optional limit (1-25, default 25) and cursor page the list. Descriptions and bug notes are excerpts; use get_project_task for the full text. The result includes nextCursor (null when hasMore is false). completionPercent is the displayed value: done is 100, cancelled is 0, otherwise the stored step. startDate is the stored start and is writable. targetPercent is null because a task has no planned target. Each task includes cloudAgentIds and cloudAgentLinks. The same cloud agent id may be linked to several tasks. Each task includes mediaLinks and mediaLinkCount for the Media tab (workspace images and titled http(s) URLs). Requires pm:read.',
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

  server.registerTool(
    'get_project_task',
    {
      description:
        'Get one project task or bug with RACI. The raci array is the current standing set (userId and role R/A/C/I) and includes the latest set_project_task_raci replacement. Hour fields (forecastHours, actualHours) returned as JSON numbers. startDate is the stored start and is writable. targetPercent is null because a task has no planned target. taskId may be a UUID or any human key (HL1-T-12 or HL1-B-4). Returns cloudAgentIds and cloudAgentLinks. The same cloud agent id may be linked to several tasks; cloudAgentId is the first sorted id. Includes mediaLinks and mediaLinkCount for the Media tab (workspace images and titled http(s) URLs). Each media link includes mediaId. Call get_workspace_media (OAuth: call_hub_tool) to read the image. Requires pm:read.',
      inputSchema: { taskId: entityRef },
      outputSchema: taskResultOutput,
    },
    async (args) =>
      wrap(
        'get_project_task',
        'pm:read',
        () => handlers.getProjectTask(args),
        undefined,
        (data) => structuredTextResult(data, taskResultOutput),
      )(),
  );

  const ymdDate = isoDateNullableSchema;

  server.registerTool(
    'create_project_milestone',
    {
      description:
        'Create a project milestone (live state). description is the note. targetDate is the due date. startDate is the stored start, writable, and not shown in the form. Neither date is derived from linked items. targetPercent is null. Requires pm:write.',
      inputSchema: {
        projectId: z.string().uuid(),
        title: z.string().min(1).max(200),
        description: z.string().max(5000).nullable().optional(),
        status: milestoneStatusSchema.optional(),
        startDate: ymdDate.optional(),
        targetDate: ymdDate.optional(),
        sortOrder: z.number().int().min(0).max(100000).optional(),
      },
      outputSchema: { milestone: milestoneRowOutput },
    },
    async (args) =>
      wrap(
        'create_project_milestone',
        'pm:write',
        () => handlers.createProjectMilestone(args),
        { projectId: args.projectId },
        (data) => structuredTextResult(data, { milestone: milestoneRowOutput }),
      )(),
  );

  server.registerTool(
    'update_project_milestone',
    {
      description:
        'Update a project milestone (live state). milestoneId may be UUID or human key (e.g. HL1-M-1). description is the note. targetDate is the due date. startDate is the stored start. Omitting either date leaves it unchanged. Dates are not derived from linked items. targetPercent is null. When included links remain, status is replaced by the status derived from those links. Recompute skips an archived milestone and never overwrites a cancelled status. A milestone with no included links keeps the status you set. Requires pm:write.',
      inputSchema: {
        milestoneId: entityRef,
        title: z.string().min(1).max(200).optional(),
        description: z.string().max(5000).nullable().optional(),
        status: milestoneStatusSchema.optional(),
        startDate: ymdDate.optional(),
        targetDate: ymdDate.optional(),
        sortOrder: z.number().int().min(0).max(100000).optional(),
        archived: z.boolean().optional(),
      },
      outputSchema: { milestone: milestoneRowOutput },
    },
    async (args) =>
      wrap(
        'update_project_milestone',
        'pm:write',
        () => handlers.updateProjectMilestone(args),
        undefined,
        (data) => structuredTextResult(data, { milestone: milestoneRowOutput }),
      )(),
  );

  server.registerTool(
    'get_project_milestone',
    {
      description:
        'Get one milestone with its note (description), start date (startDate), due date (targetDate), completionPercent, and linkedItems (epics, user stories, tasks, and bugs). completionPercent is 100 only when every included linked item and every predecessor dependency is done or 100 percent. Cancelled items are left out. Anything else included is 0. No included items leaves it null. completion.done counts included linked items and predecessor dependencies that are done or 100 percent. completion.total is that same included set. completion.percent stays 0 or 100. Status follows those links: all complete is done, a non-done blocked link is blocked, completion above 0 or any started link is in progress, and nothing started is planned. No included links keeps the stored status. Recompute skips an archived milestone and never overwrites a cancelled status. startDate and targetDate are stored and writable, not derived from linked items. targetPercent is null. milestoneId may be a UUID or human key (HL1-M-1). Includes mediaLinks and mediaLinkCount. Requires pm:read.',
      inputSchema: { milestoneId: entityRef },
      outputSchema: { milestone: milestoneRowOutput },
    },
    async (args) =>
      wrap(
        'get_project_milestone',
        'pm:read',
        () => handlers.getProjectMilestone(args),
        undefined,
        (data) => structuredTextResult(data, { milestone: milestoneRowOutput }),
      )(),
  );

  server.tool(
    'set_project_milestone_item_links',
    'Replace the epics, user stories, tasks, and bugs linked to a milestone. Bugs use entityType task and a B key. Items must belong to the milestone project. An archived milestone is rejected until it is unarchived, and nothing is written. Recompute skips an archived milestone and never overwrites a cancelled status. The returned milestone includes completionPercent, linkedItems, and the status derived from those links. Requires pm:write.',
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

  server.registerTool(
    'create_project_task',
    {
      description:
        'Create a project task or bug (itemType task or bug, default task). Type is fixed at create: tasks get a T key and bugs a B key. Bug fields (severity, foundIn, foundInNote, stepsToReproduce, expectedBehavior, actualBehavior, resolution, regression, affectedSystemId, duplicateOfTaskId) are rejected on a task. Severity defaults to medium on a bug. duplicateOfTaskId is stored only when resolution is duplicate and may be a UUID or human key. affectedSystemId must be a catalogue system linked to the project. Optional startDate and durationDays. startDate is stored and returned. targetPercent is null. When durationDays is set, dueDate is startDate plus that many working days on the project calendar. When both startDate and dueDate are set without duration, duration is the gap and startDate must be on or before dueDate. Bugs use the same start date and duration. Optional RACI, user story, sprint, story points, and current owner. Hour fields (forecastHours, actualHours) accept number or string; returned as JSON numbers. milestoneId, sprintId, and userStoryId must belong to the given project. Linking to an archived milestone, story, or sprint is rejected until it is unarchived. Optional AI usage: tokensUsed alone bills the blended rate; tokensInput/tokensOutput/tokensCache bill split rates and set tokensUsed to their sum when omitted. aiSystemId must be an AI assistant system linked to the project. Optional cloudAgentIds (up to 20, null or empty clears) links Cursor cloud agents. The same id may be on several tasks. Imported usage is stored once and split in equal whole tokens across those tasks; the earliest task id gets any remainder. cloudAgentId sets one link when cloudAgentIds is omitted. completionPercent written is 0, 25, 50, 75, or 100; status done stores 100 and cancelled stores null. Creating as done, including completionPercent 100, sets completedAt to now. Reads return the displayed percent, so cancelled is 0. Requires pm:write.',
      inputSchema: {
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
      tokensCacheWrite: tokenCountSchema.nullable().optional(),
      modelId: z.string().max(80).nullable().optional(),
      pricingTier: z.string().max(32).nullable().optional(),
      usageOccurredAt: z.string().max(40).nullable().optional(),
      billingPeriod: z.string().max(7).nullable().optional(),
      aiSystemId: z.string().uuid().nullable().optional(),
      cloudAgentId: z.string().max(80).nullable().optional(),
      cloudAgentIds: z.array(z.string().min(1).max(80)).max(20).nullable().optional(),
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
      outputSchema: taskResultOutput,
    },
    async (args) =>
      wrap(
        'create_project_task',
        'pm:write',
        () => handlers.createProjectTask(args),
        { projectId: args.projectId },
        (data) => structuredTextResult(data, taskResultOutput),
      )(),
  );

  server.registerTool(
    'update_project_task',
    {
      description:
        'Update a project task or bug. taskId may be a UUID or any human key (HL1-T-12 or HL1-B-4). itemType cannot change after create. Bug fields are rejected on a task. duplicateOfTaskId is stored only when resolution is duplicate and may be a UUID or human key. affectedSystemId must be a catalogue system linked to the project. Optional startDate and durationDays; null clears them. startDate is stored and returned. targetPercent is null. When durationDays is set, dueDate is startDate plus that many working days on the project calendar. Bugs use the same start date and duration. When both startDate and dueDate are set, startDate must be on or before dueDate. Hour fields (forecastHours, actualHours) accept number or string; returned as JSON numbers. milestoneId, sprintId, and userStoryId must belong to the task\'s project. tokensUsed alone keeps blended-rate billing and clears a stored breakdown. tokensInput/tokensOutput/tokensCache bill split rates; tokensUsed is their sum when omitted and must match when both are sent. Optional modelId, pricingTier, usageOccurredAt, billingPeriod. aiSystemId must be an AI assistant system linked to the project. Optional cloudAgentIds (up to 20, null or empty clears) replaces the Cursor cloud agent links. The same id may be linked to several tasks. Imported usage is stored once and split in equal whole tokens across those tasks; the earliest task id gets any remainder. cloudAgentId sets one link when cloudAgentIds is omitted and is returned as the first sorted id. Reads also return cloudAgentLinks. completionPercent written is 0, 25, 50, 75, or 100; status done stores 100 and cancelled stores null. A transition into done sets completedAt to now. Reopening a done task or bug (status back to todo, in_progress, or blocked) clears completedAt and resets completionPercent to 0, because the step from before done is not stored. An explicit completionPercent on that call is kept. Reads return the displayed percent, so cancelled is 0. A status, completion, date, or story change recomputes the story, its epic, and milestones linked to them. Recompute skips an archived story, epic, or milestone and never overwrites a cancelled status. Linking to an archived milestone, story, or sprint is rejected until it is unarchived. Parent start and end follow included children. Requires pm:write.',
      inputSchema: {
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
      tokensCacheWrite: tokenCountSchema.nullable().optional(),
      modelId: z.string().max(80).nullable().optional(),
      pricingTier: z.string().max(32).nullable().optional(),
      usageOccurredAt: z.string().max(40).nullable().optional(),
      billingPeriod: z.string().max(7).nullable().optional(),
      aiSystemId: z.string().uuid().nullable().optional(),
      cloudAgentId: z.string().max(80).nullable().optional(),
      cloudAgentIds: z.array(z.string().min(1).max(80)).max(20).nullable().optional(),
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
      outputSchema: taskResultOutput,
    },
    async (args) =>
      wrap(
        'update_project_task',
        'pm:write',
        () => handlers.updateProjectTask(args),
        undefined,
        (data) => structuredTextResult(data, taskResultOutput),
      )(),
  );

  server.tool(
    'report_project_task_ai_usage',
    'Record AI token usage on a task (prefer when marking done), then refresh the cost snapshot. Send modelId. Tokens are priced from the model catalog (per 1,000,000 tokens): workspace pattern, then global. No matching row is unpriced and listed, not a silent zero. tokensUsed alone uses the blended catalog rate and clears any stored breakdown. tokensInput, tokensOutput, tokensCache (cache read), and tokensCacheWrite use the split rates. tokensUsed is stored as the sum when omitted and must equal the sum when both are sent. That product is the theoretical API cost. Optional pricingTier, usageOccurredAt, and billingPeriod (YYYY-MM) place the tokens for paid-cost allocation and do not change flat-fee accrual. Billable for api/mixed only when the month has no billing-ledger entries; flat ignores tokens; note_only records usage at $0. cloudAgentIds replaces the Cursor cloud agent links (the same id may be on several tasks). Imported usage is stored once and split in equal whole tokens across those tasks, so it is not counted twice. cloudAgentId sets one link when cloudAgentIds is omitted. aiSystemId must be an AI assistant system linked to the project. Requires pm:write.',
    {
      taskId: entityRef,
      tokensUsed: tokenCountSchema.optional(),
      tokensInput: tokenCountSchema.nullable().optional(),
      tokensOutput: tokenCountSchema.nullable().optional(),
      tokensCache: tokenCountSchema.nullable().optional(),
      tokensCacheWrite: tokenCountSchema.nullable().optional(),
      modelId: z.string().max(80).nullable().optional(),
      pricingTier: z.string().max(32).nullable().optional(),
      usageOccurredAt: z.string().max(40).nullable().optional(),
      billingPeriod: z.string().max(7).nullable().optional(),
      aiSystemId: z.string().uuid().nullable().optional(),
      cloudAgentId: z.string().max(80).nullable().optional(),
      cloudAgentIds: z.array(z.string().min(1).max(80)).max(20).nullable().optional(),
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

  server.registerTool(
    'list_delivery_dependencies',
    {
      description:
        'List every predecessor link on one delivery item and the successors derived from other items that name it as a predecessor. An item may have many predecessors. Each link includes lagDays, a whole number of working days (negative is a lead). The successor start is the latest constraint across them (FS uses predecessor finish, SS predecessor start, FF predecessor finish minus duration, SF predecessor start minus duration, each plus lag). projectId (UUID) and entityId are required. entityId is a UUID or human key (PRO-T-1, PRO-B-1, PRO-E-1, PRO-S-1, PRO-M-1, PRO-SP-1). entityType is required for a UUID and optional when the key encodes the type (B is a bug and uses entity type task). scheduleDriven is true when a predecessor date currently sets this item’s start. Requires pm:read.',
      inputSchema: {
        projectId: z.string().uuid().describe('Required project id (UUID).'),
        entityId: dependencyRef.describe(
          'Required delivery item id (UUID or human key such as PRO-T-1 or PRO-B-1).',
        ),
        entityType: dependencyEntityType.optional().describe(
          'Required when entityId is a UUID. Optional when the human key encodes the type.',
        ),
      },
      outputSchema: dependencyListOutput,
    },
    async (args) =>
      wrap(
        'list_delivery_dependencies',
        'pm:read',
        () => handlers.listDeliveryDependencies(args),
        { projectId: args.projectId },
        (data) => structuredTextResult(data, dependencyListOutput),
      )(),
  );

  const lagDaysInput = (description: string) =>
    dependencyLagDaysSchema.describe(description).optional();

  const dependencyLink = z.object({
    predecessorId: dependencyRef,
    predecessorType: dependencyEntityType.optional(),
    successorId: dependencyRef,
    successorType: dependencyEntityType.optional(),
    linkType: dependencyLinkType,
    lagDays: lagDaysInput('Whole days on this link. Negative is a lead. Defaults to 0.'),
  });

  server.registerTool(
    'set_delivery_dependency',
    {
      description:
        'Add predecessor links between delivery items in the same project. projectId (UUID) is required. Pass predecessorId, successorId, and linkType for one link, or links (1–50) to add several at once. An item may have many predecessors; each ordered pair is stored once. linkType is FS, SS, FF, or SF. lagDays is optional, defaults to 0, must be an integer from -3650 to 3650, is counted in working days, and may be negative (lead). The saved link returns lagDays. Non-working days are skipped. The successor start is the latest constraint across its predecessors. For a task or bug, due date is start plus durationDays. Successors are not entered separately. Rejects self-links, cross-project links, a second link on the same ordered pair, and cycles. Ids are UUIDs or human keys (PRO-T-1, PRO-B-1). Pass a type when the id is a UUID. Requires pm:write.',
      inputSchema: {
        projectId: z.string().uuid().describe('Required project id (UUID).'),
        predecessorId: dependencyRef.optional(),
        predecessorType: dependencyEntityType.optional(),
        successorId: dependencyRef.optional(),
        successorType: dependencyEntityType.optional(),
        linkType: dependencyLinkType.optional(),
        lagDays: lagDaysInput('Whole days. Negative is a lead. Defaults to 0.'),
        links: z.array(dependencyLink).min(1).max(50).optional(),
      },
      outputSchema: dependencyWriteOutput,
    },
    async (args) =>
      wrap(
        'set_delivery_dependency',
        'pm:write',
        () => handlers.setDeliveryDependency(args),
        { projectId: args.projectId },
        (data) => structuredTextResult(data, dependencyWriteOutput),
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

  const parentDateNote =
    'targetPercent is the planned percent from start through end (0 on the start day, 100 on the end day, null when the window is missing) and is read-only. startDateDerived and endDateDerived are true when that side comes from included children. A write to a derived side is rejected. A side with no child date stays the stored date and is writable.';
  const parentFreezeNote =
    'Recompute skips an archived story, epic, or milestone and never overwrites a cancelled status. Linking an item to an archived milestone, story, epic, or sprint is rejected until that item is unarchived.';

  server.registerTool(
    'list_project_epics',
    {
      description:
        `List epics for a project. Pages at 25. Descriptions are excerpts. Pass cursor from nextCursor until hasMore is false. Each epic includes completionPercent: done is 100, cancelled is 0, otherwise the average of non-cancelled child tasks and bugs, or null when none remain. Status is derived from those children: all done is done, a non-done blocked child is blocked, completion above 0 or any started child is in progress, and nothing started is planned. Cancelled children are left out. An epic with no included children keeps its stored status. ${parentFreezeNote} startDate is the earliest child start and endDate the latest child end; a side with no child date keeps the stored date. ${parentDateNote} Each epic includes mediaLinks and mediaLinkCount for the Media tab (workspace images and titled http(s) URLs). Requires pm:read.`,
      inputSchema: {
        projectId: z.string().uuid(),
        includeArchived: z.boolean().optional(),
        ...listPage,
      },
      outputSchema: epicListOutput,
    },
    async (args) =>
      wrap(
        'list_project_epics',
        'pm:read',
        () => handlers.listProjectEpics(args),
        { projectId: args.projectId },
        (data) => structuredTextResult(data, epicListOutput),
      )(),
  );

  server.registerTool(
    'create_project_epic',
    {
      description:
        `Create a project epic. startDate and endDate are writable until included children supply that side. ${parentDateNote} Requires pm:write.`,
      inputSchema: {
        projectId: z.string().uuid(),
        title: z.string().min(1).max(200),
        description: z.string().max(5000).nullable().optional(),
        status: epicStatusEnum.optional(),
        startDate: ymdDate.optional(),
        endDate: ymdDate.optional(),
        sortOrder: z.number().int().min(0).max(100000).optional(),
      },
      outputSchema: { epic: epicRowOutput },
    },
    async (args) =>
      wrap(
        'create_project_epic',
        'pm:write',
        () => handlers.createProjectEpic(args),
        { projectId: args.projectId },
        (data) => structuredTextResult(data, { epic: epicRowOutput }),
      )(),
  );

  server.registerTool(
    'update_project_epic',
    {
      description:
        `Update a project epic. When the epic has included child tasks or bugs, status is replaced by the derived status (done, blocked, in progress, or planned). An epic with no included children keeps the status you set. ${parentFreezeNote} ${parentDateNote} Requires pm:write.`,
      inputSchema: {
        epicId: entityRef,
        title: z.string().min(1).max(200).optional(),
        description: z.string().max(5000).nullable().optional(),
        status: epicStatusEnum.optional(),
        startDate: ymdDate.optional(),
        endDate: ymdDate.optional(),
        sortOrder: z.number().int().min(0).max(100000).optional(),
        archived: z.boolean().optional(),
      },
      outputSchema: { epic: epicRowOutput },
    },
    async (args) =>
      wrap(
        'update_project_epic',
        'pm:write',
        () => handlers.updateProjectEpic(args),
        undefined,
        (data) => structuredTextResult(data, { epic: epicRowOutput }),
      )(),
  );

  server.registerTool(
    'list_project_user_stories',
    {
      description:
        `List user stories for a project (optional epic filter). epicId must belong to the given project. Pages at 25. Descriptions are excerpts. Pass cursor from nextCursor until hasMore is false. Each story includes completionPercent: done is 100, cancelled is 0, otherwise the average of non-cancelled child tasks and bugs, or null when none remain. Status is derived from those children: all done is done, a non-done blocked child is blocked, completion above 0 or any started child is in progress, and nothing started is planned. Cancelled children are left out. A story with no included children keeps its stored status. ${parentFreezeNote} startDate is the earliest child start and endDate the latest child end; a side with no child date keeps the stored date. ${parentDateNote} Each story includes mediaLinks and mediaLinkCount for the Media tab (workspace images and titled http(s) URLs). Requires pm:read.`,
      inputSchema: {
        projectId: z.string().uuid(),
        epicId: entityRef.optional(),
        includeArchived: z.boolean().optional(),
        ...listPage,
      },
      outputSchema: storyListOutput,
    },
    async (args) =>
      wrap(
        'list_project_user_stories',
        'pm:read',
        () => handlers.listProjectUserStories(args),
        { projectId: args.projectId },
        (data) => structuredTextResult(data, storyListOutput),
      )(),
  );

  server.registerTool(
    'create_project_user_story',
    {
      description:
        `Create a user story under an epic. epicId must belong to the given project and must not be archived. startDate and endDate are writable until included children supply that side. ${parentFreezeNote} ${parentDateNote} Requires pm:write.`,
      inputSchema: {
        projectId: z.string().uuid(),
        epicId: entityRef,
        title: z.string().min(1).max(200),
        description: z.string().max(5000).nullable().optional(),
        status: epicStatusEnum.optional(),
        startDate: ymdDate.optional(),
        endDate: ymdDate.optional(),
        sortOrder: z.number().int().min(0).max(100000).optional(),
      },
      outputSchema: { userStory: storyRowOutput },
    },
    async (args) =>
      wrap(
        'create_project_user_story',
        'pm:write',
        () => handlers.createProjectUserStory(args),
        { projectId: args.projectId },
        (data) => structuredTextResult(data, { userStory: storyRowOutput }),
      )(),
  );

  server.registerTool(
    'update_project_user_story',
    {
      description:
        `Update a user story. epicId must belong to the story's project. Moving the story onto an archived epic is rejected. Moving the story recomputes the old and new epic. When the story has included child tasks or bugs, status is replaced by the derived status. A story with no included children keeps the status you set. ${parentFreezeNote} ${parentDateNote} Requires pm:write.`,
      inputSchema: {
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
      outputSchema: { userStory: storyRowOutput },
    },
    async (args) =>
      wrap(
        'update_project_user_story',
        'pm:write',
        () => handlers.updateProjectUserStory(args),
        undefined,
        (data) => structuredTextResult(data, { userStory: storyRowOutput }),
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
    'List project stakeholders (people, open roles, AI assistants, RACI-derived) with role description and competencies. Money and hour fields (hourlyRate, allocatedDailyHours, contractedBudget, aiFlatMonthlyFee, aiBudgetAllocation) are JSON numbers. Per-system token rates are retired. Task tokens use the model catalog (per 1,000,000 tokens). AI rows include aiCostNotes. Requires pm:read.',
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
    'Set AI assistant cost mode (flat|api|mixed|note_only) on a project AI system. Token prices are not set here. Use upsert_ai_model_price (per 1,000,000 tokens). Sending aiTokenRatePer1k, aiTokenRateInputPer1k, aiTokenRateOutputPer1k, aiTokenRateCachePer1k, or aiTokenRateCurrency returns TOKEN_RATES_RETIRED. Theoretical cost uses the catalog row for the task model at usageOccurredAt, else completedAt, else updatedAt. Mixed AC is the flat monthly fee accrued over the project dates plus that token cost. aiCostNotes is a short note (max 500). Money fields accept number or string. Requires pm:write.',
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
      aiTokenRateCurrency: projectCurrencyEnum.nullable().optional(),
      aiCostNotes: z.string().max(500).nullable().optional(),
      aiBudgetAllocation: moneyInput.optional(),
    },
    async (args) =>
      wrap('update_project_ai_assistant_cost', 'pm:write', () =>
        handlers.updateProjectAiAssistantCost(args),
      )(),
  );

  const billingType = z.enum(['subscription', 'plan_change', 'on_demand']);
  const billingPeriod = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
  const serviceDate = z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/);
  const billingEntryOutput = () =>
    z.object({
      id: z.string(),
      workspaceId: z.string(),
      aiSystemId: z.string().nullable(),
      period: z.string().describe('Start month YYYY-MM. Derived from servicePeriodStart when set.'),
      servicePeriodStart: z
        .string()
        .nullable()
        .describe('Inclusive service start YYYY-MM-DD. Null keeps the whole amount in period.'),
      servicePeriodEnd: z
        .string()
        .nullable()
        .describe(
          'Exclusive renewal date YYYY-MM-DD (not included). Days are end minus start. Null with the start.',
        ),
      provider: z.string(),
      plan: z.string().nullable(),
      type: z.enum(['subscription', 'plan_change', 'on_demand']),
      amount: z.number().describe('Original amount.'),
      currency: z.string().describe('Original currency.'),
      convertedAmount: z
        .number()
        .optional()
        .describe('Amount in the workspace reporting currency.'),
      convertedCurrency: z
        .string()
        .optional()
        .describe('Reporting currency. Same as currency when no rate was found.'),
      fxRate: z
        .number()
        .nullable()
        .optional()
        .describe('Multiplier from the original currency into convertedCurrency. Null when missing.'),
      fxRateDate: z
        .string()
        .nullable()
        .optional()
        .describe('YYYY-MM-DD of the quote. Earlier than paid-at when that day has no quote.'),
      fxSource: z
        .string()
        .nullable()
        .optional()
        .describe('ecb, mnb, manual, identity, or mixed.'),
      paidAt: z.string().nullable(),
      note: z.string().nullable(),
      externalRef: z.string().nullable(),
      createdAt: z.string(),
      updatedAt: z.string(),
    });
  const listBillingOutput = { entries: z.array(billingEntryOutput()) };
  const createBillingOutput = { entry: billingEntryOutput() };
  const updateBillingOutput = { entry: billingEntryOutput() };

  server.tool(
    'get_ai_usage_theoretical_cost',
    'Per-month theoretical API cost for imported usage and task usage that was not replaced by an import. linked is allocated to a project task. unassigned is workspace-level. Amounts are in the workspace reporting currency. Unpriced models are listed and are not treated as zero without a flag. from and to are YYYY-MM or YYYY-MM-DD. An invalid from or to is rejected and names that field; it does not fall back to the last 12 months. Omit both for that default. Requires pm:read. Via call_hub_tool.',
    {
      workspaceId: z.string().uuid(),
      from: z.string().optional().describe('YYYY-MM or YYYY-MM-DD. Invalid values are rejected.'),
      to: z.string().optional().describe('YYYY-MM or YYYY-MM-DD. Invalid values are rejected.'),
    },
    async (args) =>
      wrap('get_ai_usage_theoretical_cost', 'pm:read', () =>
        handlers.getAiUsageTheoreticalCost(args),
      )(),
  );

  const modelPriceRate = z
    .number()
    .min(0)
    .max(1_000_000)
    .describe('Amount per 1,000,000 tokens (unit per_1m_tokens).');
  server.tool(
    'list_ai_model_prices',
    aiModelPriceToolDescription('list'),
    {
      workspaceId: z.string().uuid(),
    },
    async (args) =>
      wrap('list_ai_model_prices', 'pm:read', () => handlers.listAiModelPrices(args))(),
  );

  server.tool(
    'upsert_ai_model_price',
    aiModelPriceToolDescription('upsert'),
    {
      scope: z.enum(['global', 'workspace']),
      workspaceId: z
        .string()
        .uuid()
        .optional()
        .describe('Required when scope is workspace.'),
      model: z.string().min(1).max(80).describe('Pattern or exact model id.'),
      inputPerMillion: modelPriceRate,
      outputPerMillion: modelPriceRate,
      cacheReadPerMillion: modelPriceRate,
      cacheWritePerMillion: modelPriceRate,
      blendedPerMillion: modelPriceRate.describe(
        'Undifferentiated rate per 1,000,000 tokens. A blank split rate falls back to this.',
      ),
      currency: z.string().length(3),
      effectiveFrom: z.string().describe('YYYY-MM-DD the price takes effect.'),
      sourceNote: z
        .string()
        .min(1)
        .max(500)
        .describe('Provider price page or short note. Required.'),
    },
    async (args) =>
      wrap('upsert_ai_model_price', 'pm:write', () => handlers.upsertAiModelPrice(args))(),
  );

  server.tool(
    'retire_ai_model_price',
    aiModelPriceToolDescription('retire'),
    {
      scope: z.enum(['global', 'workspace']),
      workspaceId: z.string().uuid().optional(),
      priceId: z.string().uuid().optional(),
      model: z.string().min(1).max(80).optional(),
      effectiveFrom: z.string().optional(),
    },
    async (args) =>
      wrap('retire_ai_model_price', 'pm:write', () => handlers.retireAiModelPrice(args))(),
  );

  server.tool(
    'get_platform_ai_cost',
    'Platform AI cost summary across workspaces: paid cost by type, theoretical API cost, difference, and ratio, converted into one reporting currency (default EUR). Multi-month entries are prorated by days before conversion. Paid amounts convert on paid-at, or the service start when paid-at is missing. Theoretical cost converts on the usage date. Months and totals include fxRate, fxRateDate, and fxSource. Entries keep the original amount and currency and add convertedAmount, convertedCurrency, fxRate, fxRateDate, and fxSource. A missing quote day uses the previous quote. reportingCurrency overrides the total currency. Allowed codes: EUR, USD, GBP, CHF, HUF, PLN, CZK, RON, SEK, NOK, DKK, CAD, AUD, JPY. Lowercase is normalised (usd is USD). An unsupported code such as XXX is rejected and the error names reportingCurrency; it does not fall back to EUR. from and to are YYYY-MM. An invalid from or to is rejected and names that field; it does not fall back to the last 12 months. Omit both for that default. System administrator only. Requires pm:read.',
    {
      from: z.string().optional().describe('YYYY-MM. Invalid values are rejected.'),
      to: z.string().optional().describe('YYYY-MM. Invalid values are rejected.'),
      reportingCurrency: z
        .string()
        .trim()
        .min(3)
        .max(3)
        .optional()
        .describe(
          'Reporting currency. Allowed: EUR, USD, GBP, CHF, HUF, PLN, CZK, RON, SEK, NOK, DKK, CAD, AUD, JPY. Lowercase is normalised (usd is USD). An unsupported code such as XXX is a validation error that names reportingCurrency. Default EUR.',
        ),
    },
    async (args) =>
      wrap('get_platform_ai_cost', 'pm:read', () =>
        handlers.getPlatformAiCost(args),
      )(),
  );

  server.registerTool(
    'list_ai_billing_entries',
    {
      description:
        'List workspace AI cost entries (subscription, plan_change, on_demand). Each row includes servicePeriodStart (inclusive) and servicePeriodEnd (exclusive renewal date, not included). period is the start month. A span is prorated by days (end minus start) when paid cost is computed. amount and currency are the original figures. convertedAmount and convertedCurrency are the workspace reporting currency, with fxRate, fxRateDate, and fxSource for the quote used (paid-at, or the service start when paid-at is missing). A missing quote day uses the previous quote. Optional period matches any month the row contributes to. Optional servicePeriodStart and servicePeriodEnd keep rows whose window overlaps that range. The stored end is not a billed day. Optional aiSystemId filter. Amounts are JSON numbers. Requires pm:read.',
      inputSchema: {
        workspaceId: z.string().uuid(),
        period: billingPeriod.optional(),
        aiSystemId: z.string().uuid().optional(),
        servicePeriodStart: serviceDate
          .optional()
          .describe(
            'YYYY-MM-DD overlap filter. Keep rows whose exclusive service end is after this date.',
          ),
        servicePeriodEnd: serviceDate
          .optional()
          .describe(
            'YYYY-MM-DD overlap filter. Keep rows whose service window starts on or before this date.',
          ),
      },
      outputSchema: listBillingOutput,
    },
    async (args) =>
      wrap(
        'list_ai_billing_entries',
        'pm:read',
        () => handlers.listAiBillingEntries(args),
        { workspaceId: args.workspaceId },
        (data) => structuredTextResult(data, listBillingOutput),
      )(),
  );

  server.registerTool(
    'create_ai_billing_entry',
    {
      description:
        'Add a paid AI cost entry. type is subscription, plan_change (amount may be negative), or on_demand. currency is an ISO 4217 code from the project currency list; lowercase is stored as uppercase. Optional servicePeriodStart and servicePeriodEnd (YYYY-MM-DD) prorate the amount across months by days. servicePeriodStart is included. servicePeriodEnd is exclusive: the renewal or next billing date, not included. Days are end minus start. A one-day entry has end = start + 1, and end must be after start. period is then the start month and may be omitted. Omit both dates to keep the whole amount in period (YYYY-MM). aiSystemId omitted is workspace-wide, allocated across all projects. provider is a free string. Does not fetch invoices. Requires pm:write.',
      inputSchema: {
        workspaceId: z.string().uuid(),
        period: billingPeriod.optional().describe('YYYY-MM. Derived from servicePeriodStart when that date is set.'),
        servicePeriodStart: serviceDate.nullable().optional().describe('Inclusive service start YYYY-MM-DD. Set with servicePeriodEnd.'),
        servicePeriodEnd: serviceDate
          .nullable()
          .optional()
          .describe(
            'Exclusive renewal date YYYY-MM-DD (not included). Must be after the start. A one-day entry ends the next day.',
          ),
        provider: z.string().min(1).max(80),
        type: billingType,
        amount: z.union([z.number(), z.string()]),
        currency: z
          .string()
          .trim()
          .min(3)
          .max(3)
          .describe(
            `ISO 4217 currency. Lowercase is stored as uppercase. Allowed: ${projectCurrencySchema.options.join(', ')}.`,
          ),
        aiSystemId: z.string().uuid().nullable().optional(),
        plan: z.string().max(80).nullable().optional(),
        paidAt: z.string().max(40).nullable().optional(),
        note: z.string().max(500).nullable().optional(),
        externalRef: z.string().max(120).nullable().optional(),
      },
      outputSchema: createBillingOutput,
    },
    async (args) =>
      wrap(
        'create_ai_billing_entry',
        'pm:write',
        () => handlers.createAiBillingEntry(args),
        { workspaceId: args.workspaceId },
        (data) => structuredTextResult(data, createBillingOutput),
      )(),
  );

  server.registerTool(
    'update_ai_billing_entry',
    {
      description:
        'Update one AI cost entry by entryId. plan_change may be negative. currency is an ISO 4217 code from the project currency list; lowercase is stored as uppercase. Optional servicePeriodStart (inclusive) and servicePeriodEnd (exclusive renewal date, not included) replace the service window. Days are end minus start, and end must be after start. A one-day entry has end = start + 1. period is then the start month. Send both dates, or null both to clear them. provider stays a free string. Requires pm:write.',
      inputSchema: {
        entryId: z.string().uuid(),
        period: billingPeriod.optional(),
        servicePeriodStart: serviceDate
          .nullable()
          .optional()
          .describe('Inclusive service start YYYY-MM-DD.'),
        servicePeriodEnd: serviceDate
          .nullable()
          .optional()
          .describe(
            'Exclusive renewal date YYYY-MM-DD (not included). Must be after the start.',
          ),
        provider: z.string().min(1).max(80).optional(),
        type: billingType.optional(),
        amount: z.union([z.number(), z.string()]).optional(),
        currency: z
          .string()
          .trim()
          .min(3)
          .max(3)
          .describe(
            `ISO 4217 currency. Lowercase is stored as uppercase. Allowed: ${projectCurrencySchema.options.join(', ')}.`,
          )
          .optional(),
        aiSystemId: z.string().uuid().nullable().optional(),
        plan: z.string().max(80).nullable().optional(),
        paidAt: z.string().max(40).nullable().optional(),
        note: z.string().max(500).nullable().optional(),
        externalRef: z.string().max(120).nullable().optional(),
      },
      outputSchema: updateBillingOutput,
    },
    async (args) =>
      wrap(
        'update_ai_billing_entry',
        'pm:write',
        () => handlers.updateAiBillingEntry(args),
        undefined,
        (data) => structuredTextResult(data, updateBillingOutput),
      )(),
  );

  server.tool(
    'delete_ai_billing_entry',
    'Delete one AI cost entry by entryId. Requires pm:write.',
    { entryId: z.string().uuid() },
    async (args) =>
      wrap('delete_ai_billing_entry', 'pm:write', () =>
        handlers.deleteAiBillingEntry(args),
      )(),
  );

  const usageImportRowOutput = z
    .object({
      id: z.string(),
      workspaceId: z.string(),
      source: z.string(),
      fileName: z.string().nullable(),
      createdAt: z.string(),
      rowCountTotal: z.number().int(),
      rowCountInserted: z.number().int(),
      rowCountDuplicate: z.number().int(),
      rowCountLinked: z.number().int(),
      rowCountErrors: z.number().int(),
      rowCountNoTokens: z.number().int(),
    })
    .passthrough();
  const usageImportErrorOutput = z
    .object({
      rowNumber: z.number().int(),
      message: z.string(),
    })
    .passthrough();
  const listUsageImportsOutput = {
    imports: z.array(usageImportRowOutput),
  };
  const importUsageOutput = {
    import: usageImportRowOutput.extend({
      errors: z.array(usageImportErrorOutput).optional(),
    }),
  };

  server.registerTool(
    'list_ai_usage_imports',
    {
      description:
        'List workspace AI usage imports (CSV today). Each row records who imported it, the file name, source, and counts for total, inserted, duplicate, linked, error, and no-token rows. Rows with every token column empty are skipped, not stored, and not errors. Read-only. Requires pm:read. Workspace members can read; importing is workspace-admin only.',
      inputSchema: {
        workspaceId: z.string().uuid(),
        limit: z.number().int().min(1).max(100).optional(),
      },
      outputSchema: listUsageImportsOutput,
    },
    async (args) =>
      wrap(
        'list_ai_usage_imports',
        'pm:read',
        () => handlers.listAiUsageImports(args),
        { workspaceId: args.workspaceId },
        (data) => structuredTextResult(data, listUsageImportsOutput),
      )(),
  );

  const usageSummaryOutput = z
    .object({
      dateFrom: z.string().nullable(),
      dateTo: z.string().nullable(),
      totals: z
        .object({
          tokensInput: z.number(),
          tokensCacheWrite: z.number(),
          tokensCache: z.number(),
          tokensOutput: z.number(),
          tokensTotal: z.number(),
        })
        .passthrough(),
      models: z.array(
        z
          .object({
            model: z.string(),
            rowCount: z.number(),
            tokensTotal: z.number(),
          })
          .passthrough(),
      ),
      linkedCount: z.number(),
      unassignedCount: z.number(),
    })
    .passthrough();
  const usageSummaryRowOutput = usageImportRowOutput
    .extend({
      summary: usageSummaryOutput.nullable(),
    })
    .passthrough();
  const unassignedUsageRowOutput = z
    .object({
      id: z.string(),
      importId: z.string().nullable(),
      occurredAt: z.string(),
      cloudAgentId: z.string().nullable(),
      model: z.string(),
      tokensInput: z.number(),
      tokensCacheWrite: z.number(),
      tokensCache: z.number(),
      tokensOutput: z.number(),
      tokensTotal: z.number(),
    })
    .passthrough();
  const listUsageSummariesOutput = {
    summaries: z.array(usageSummaryRowOutput),
    summaryTotal: z.number().int(),
    summaryLimit: z.number().int(),
    summaryNextCursor: z.string().nullable(),
    summaryHasMore: z.boolean(),
    unassigned: z.array(unassignedUsageRowOutput),
    unassignedTotal: z.number().int(),
    unassignedLimit: z.number().int(),
    unassignedNextCursor: z.string().nullable(),
    unassignedHasMore: z.boolean(),
  };

  server.registerTool(
    'list_ai_usage_import_summaries',
    {
      description:
        'List saved AI usage import summaries and unassigned usage rows, both paged. Each summary keeps the usage date range, token totals (input, cache write, cache read, output), per-model row counts, and linked versus unassigned counts from the moment the import was confirmed. Pass cursor from summaryNextCursor and unassignedCursor from unassignedNextCursor until the matching hasMore flag is false. importId limits both lists to one import. Read-only. Requires pm:read.',
      inputSchema: {
        workspaceId: z.string().uuid(),
        importId: z.string().uuid().optional(),
        limit: z.number().int().min(1).max(100).optional(),
        cursor: z.string().min(1).max(200).optional(),
        unassignedLimit: z.number().int().min(1).max(100).optional(),
        unassignedCursor: z.string().min(1).max(200).optional(),
      },
      outputSchema: listUsageSummariesOutput,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async (args) =>
      wrap(
        'list_ai_usage_import_summaries',
        'pm:read',
        () => handlers.listAiUsageImportSummaries(args),
        { workspaceId: args.workspaceId },
        (data) => structuredTextResult(data, listUsageSummariesOutput),
      )(),
  );

  server.registerTool(
    'import_ai_usage_csv',
    {
      description:
        'Import a Cursor usage CSV into the workspace. Dedupes on Date + Cloud Agent ID + Model + Total Tokens. Rows with a Cloud Agent ID link to the task that stores that id. Rows with every token column empty are counted as no token data and are not inserted. Re-importing the same rows does not double count. csv is the file text. Workspace administrator only, plus pm:write. The Cursor Admin API source is not available on this tool.',
      inputSchema: {
        workspaceId: z.string().uuid(),
        csv: z.string().min(1).max(8_000_000),
        fileName: z.string().max(200).nullable().optional(),
      },
      outputSchema: importUsageOutput,
    },
    async (args) =>
      wrap(
        'import_ai_usage_csv',
        'pm:write',
        () => handlers.importAiUsageCsv(args),
        { workspaceId: args.workspaceId },
        (data) => structuredTextResult(data, importUsageOutput),
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
    'List RAID register items (risks, assumptions, issues, dependencies) for a project. Pages at 25. Descriptions are excerpts. Pass cursor from nextCursor until hasMore is false. Each item includes records[] (linked knowledge records: id, title, slug, recordType, humanKey) plus mediaLinks and mediaLinkCount for the Media tab (workspace images and titled http(s) URLs). auto is true on schedule-slip risks. Requires pm:read.',
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
    'Create a change-management item. Optional delivery links cover epics, stories, milestones, and tasks (bugs use task). knowledgeRecordId links one document. recordIds replaces that set, and the first id is also stored as knowledgeRecordId. Documents must belong to the project. A validation error creates nothing and does not consume a change key. Requires pm:write.',
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
      confirmBaseline: z.boolean().optional().describe(
        'When true, an approved schedule change is written with apply_project_change_to_baseline. Omit it to leave the baseline unchanged. Cancel in the hub does not send this.',
      ),
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

  server.tool(
    'apply_project_change_to_baseline',
    'Apply an approved change request that stores a baseline start or finish. Same function as confirming approval in the hub. Writes those dates onto the project, marks the change implemented, sets baselineAppliedAt and baselineAppliedBy, and writes one audit entry with the change key, actor, before and after dates, working-day duration, and budget delta. A second call does not write again. changeId may be a UUID or human key. Requires pm:write.',
    {
      changeId: entityRef,
    },
    async (args) =>
      wrap('apply_project_change_to_baseline', 'pm:write', () =>
        handlers.applyProjectChangeToBaseline(args),
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

  const relationRecordOutput = () =>
    z.object({
      id: z.string(),
      humanKey: z.string().nullable(),
      title: z.string(),
      slug: z.string(),
      recordType: z.string(),
      lifecycleStatus: z.string(),
      archivedAt: z.string().nullable(),
    });
  const relationEdgeOutput = () =>
    z.object({
      relationType: z.string(),
      record: relationRecordOutput(),
    });
  const knowledgeRecordRelationsOutput = {
    relations: z.object({
      outbound: z.array(relationEdgeOutput()),
      inbound: z.array(relationEdgeOutput()),
    }),
    lifecycleSuccessor: relationRecordOutput().nullable(),
    lifecyclePredecessor: relationRecordOutput().nullable(),
  };

  server.registerTool(
    'get_knowledge_record_relations',
    {
      description:
        'List typed relations for a knowledge record (relates_to, depends_on, refines, derived_from, contradicts) plus the lifecycle successor and predecessor from supersedes_record_id. Inbound edges use inverse labels (required_by, refined_by, source_for). relates_to and contradicts are symmetric and listed as outbound on both records, regardless of uuid order. recordId may be a UUID or document key. Requires knowledge:read.',
      inputSchema: { recordId: entityRef },
      outputSchema: knowledgeRecordRelationsOutput,
    },
    async (args) =>
      wrap(
        'get_knowledge_record_relations',
        'knowledge:read',
        () => handlers.getKnowledgeRecordRelations(args),
        { recordId: args.recordId },
        (data) => structuredTextResult(data, knowledgeRecordRelationsOutput),
      )(),
  );

  server.registerTool(
    'set_knowledge_record_relations',
    {
      description:
        'Replace relations for this record. Directed types are depends_on, refines, and derived_from. Inbound directed edges owned by the other record are kept. relates_to and contradicts are stored once with canonical uuid order and can be added or removed from either record. Responses list those symmetric relations as outbound on both records. Rejects self-links, cross-workspace or cross-project targets, cycles for depends_on and refines, and changes that touch an archived record. recordId and targetRecordId may be UUID or document key. Does not change lifecycle. Requires knowledge:write.',
      inputSchema: {
        recordId: entityRef,
        links: z
          .array(
            z.object({
              targetRecordId: entityRef,
              relationType: knowledgeRecordRelationTypeSchema,
            }),
          )
          .max(200),
      },
      outputSchema: knowledgeRecordRelationsOutput,
    },
    async (args) =>
      wrap(
        'set_knowledge_record_relations',
        'knowledge:write',
        () => handlers.setKnowledgeRecordRelations(args),
        { recordId: args.recordId },
        (data) => structuredTextResult(data, knowledgeRecordRelationsOutput),
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
        wrap(
          'call_hub_tool',
          'projects:read',
          () =>
            invokeNamedHubTool(handlers, client.scopes, 'call_hub_tool', {
              toolName: args.toolName,
              arguments: args.arguments ?? {},
            }),
          /^[a-z0-9_]{1,80}$/.test(args.toolName)
            ? { nestedTool: args.toolName }
            : undefined,
          args.toolName === 'get_workspace_media' ? presentWorkspaceMediaRead : textResult,
        )(),
    );
    limitOauthToolSurface(server);
    stampOauthSecuritySchemes(server, client.scopes);
  }

  openMcpToolOutputSchemas(server);
  rejectUnknownToolArguments(server);
  describeRequiredToolInputs(server);
  installMcpToolErrorAudit(server, handlers);
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
