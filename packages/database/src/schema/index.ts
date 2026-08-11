import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  timestamp,
  date,
  jsonb,
  boolean,
  integer,
  numeric,
  uniqueIndex,
  index,
  customType,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

/** pgvector column fixed at 768 dims (nomic-embed-text / EMBEDDING_DIMENSIONS default). */
const vector768 = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return 'vector(768)';
  },
  toDriver(value: number[]): string {
    return `[${value.join(',')}]`;
  },
  fromDriver(value: unknown): number[] {
    if (Array.isArray(value)) {
      return value.map((entry) => Number(entry));
    }
    if (typeof value !== 'string') {
      return [];
    }
    const trimmed = value.trim().replace(/^\[/, '').replace(/\]$/, '');
    if (!trimmed) return [];
    return trimmed.split(',').map((part) => Number(part.trim()));
  },
});

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
};

export const organizations = pgTable(
  'organizations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    ...timestamps,
  },
  (table) => [uniqueIndex('organizations_slug_uidx').on(table.slug)],
);

export const workspaces = pgTable(
  'workspaces',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    description: text('description'),
    /** Curated accent key (ocean, teal, …); null → client picks stable hash color. */
    color: text('color'),
    archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'date' }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('workspaces_organization_slug_uidx').on(table.organizationId, table.slug),
    index('workspaces_organization_id_idx').on(table.organizationId),
  ],
);

export const users = pgTable(
  'users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    email: text('email').notNull(),
    displayName: text('display_name').notNull(),
    /** Formal / legal name; UI may fall back to displayName when null. */
    fullName: text('full_name'),
    passwordHash: text('password_hash'),
    status: text('status').notNull().default('active'),
    isSystemAdmin: boolean('is_system_admin').notNull().default(false),
    /** Future SSO provider key (oidc, entra, github, keycloak, …). */
    idpSource: text('idp_source'),
    /** External IdP subject / sub claim. */
    idpSubject: text('idp_subject'),
    /** MIME type when a profile avatar file exists on disk; null = monogram fallback. */
    avatarContentType: text('avatar_content_type'),
    /** UI / email locale: en | de | hu (last used or chosen language). */
    preferredLocale: text('preferred_locale').notNull().default('en'),
    /** Optional product email notification toggles (missing keys default to on). */
    emailNotificationPrefs: jsonb('email_notification_prefs')
      .$type<Record<string, boolean>>()
      .notNull()
      .default({}),
    /** Report diagram + dashboard widget visibility (missing keys default to on). */
    displayPrefs: jsonb('display_prefs')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    /** Set when signup-pending escalation mail was sent to all admins (once). */
    signupPendingEscalatedAt: timestamp('signup_pending_escalated_at', {
      withTimezone: true,
      mode: 'date',
    }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('users_email_uidx').on(table.email),
    uniqueIndex('users_idp_source_subject_uidx').on(table.idpSource, table.idpSubject),
  ],
);

export const memberships = pgTable(
  'memberships',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('memberships_user_workspace_uidx').on(table.userId, table.workspaceId),
    index('memberships_workspace_id_idx').on(table.workspaceId),
  ],
);

export const projects = pgTable(
  'projects',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    summary: text('summary'),
    description: text('description'),
    status: text('status').notNull().default('idea'),
    ownerUserId: uuid('owner_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    businessDomain: text('business_domain'),
    criticality: text('criticality'),
    startDate: date('start_date', { mode: 'string' }),
    endDate: date('end_date', { mode: 'string' }),
    /** Pinned project charter knowledge record (same project). */
    charterRecordId: uuid('charter_record_id').references(
      (): AnyPgColumn => knowledgeRecords.id,
      { onDelete: 'set null' },
    ),
    /** Pinned initial plan knowledge record (same project). */
    initialPlanRecordId: uuid('initial_plan_record_id').references(
      (): AnyPgColumn => knowledgeRecords.id,
      { onDelete: 'set null' },
    ),
    /** Project currency for budget and stakeholder rates (no FX). */
    currency: text('currency').notNull().default('EUR'),
    /** Kickoff baseline budget amount in project currency. */
    initialBudget: numeric('initial_budget', { precision: 14, scale: 2 }),
    /** Working BAC; falls back to initialBudget when null. */
    approvedBudget: numeric('approved_budget', { precision: 14, scale: 2 }),
    /** Workspace-unique 3-char prefix for human issue keys (AAA or AA0). */
    keyPrefix: text('key_prefix'),
    /** Per issue-key-type counters: { "T": 12, "RR": 3, ... }. */
    issueCounters: jsonb('issue_counters')
      .$type<Record<string, number>>()
      .notNull()
      .default({}),
    metadataJson: jsonb('metadata_json').$type<Record<string, unknown>>(),
    archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'date' }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('projects_workspace_slug_uidx').on(table.workspaceId, table.slug),
    uniqueIndex('projects_workspace_key_prefix_uidx')
      .on(table.workspaceId, sql`upper(${table.keyPrefix})`)
      .where(sql`${table.keyPrefix} IS NOT NULL`),
    index('projects_workspace_id_idx').on(table.workspaceId),
  ],
);

export const systems = pgTable(
  'systems',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').references(() => projects.id, {
      onDelete: 'set null',
    }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    summary: text('summary'),
    description: text('description'),
    systemType: text('system_type'),
    status: text('status').notNull().default('proposed'),
    ownerUserId: uuid('owner_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    environment: text('environment'),
    version: text('version'),
    criticality: text('criticality'),
    /** AI assistant cost mode: flat | api | mixed | note_only. */
    aiCostMode: text('ai_cost_mode'),
    aiFlatMonthlyFee: numeric('ai_flat_monthly_fee', { precision: 14, scale: 2 }),
    aiTokenRatePer1k: numeric('ai_token_rate_per_1k', { precision: 14, scale: 4 }),
    aiBudgetAllocation: numeric('ai_budget_allocation', { precision: 14, scale: 2 }),
    metadataJson: jsonb('metadata_json').$type<Record<string, unknown>>(),
    lastValidatedAt: timestamp('last_validated_at', {
      withTimezone: true,
      mode: 'date',
    }),
    archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'date' }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('systems_workspace_slug_uidx').on(table.workspaceId, table.slug),
    index('systems_workspace_id_idx').on(table.workspaceId),
    index('systems_project_id_idx').on(table.projectId),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('sessions_token_hash_uidx').on(table.tokenHash),
    index('sessions_user_id_idx').on(table.userId),
    index('sessions_expires_at_idx').on(table.expiresAt),
  ],
);

/** One-time tokens for password reset and invite set-password emails. */
export const authTokens = pgTable(
  'auth_tokens',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    purpose: text('purpose').notNull(),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('auth_tokens_token_hash_uidx').on(table.tokenHash),
    index('auth_tokens_user_purpose_idx').on(table.userId, table.purpose),
    index('auth_tokens_expires_at_idx').on(table.expiresAt),
  ],
);

export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id').references(() => organizations.id, {
      onDelete: 'set null',
    }),
    actorType: text('actor_type').notNull(),
    actorId: text('actor_id'),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id'),
    metadataJson: jsonb('metadata_json').$type<Record<string, unknown>>(),
    ipAddress: text('ip_address'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('audit_events_organization_id_idx').on(table.organizationId),
    index('audit_events_actor_id_idx').on(table.actorId),
    index('audit_events_created_at_idx').on(table.createdAt),
  ],
);

/** Short-lived codes users paste into an AI to request an API client. */
export const aiPairingCodes = pgTable(
  'ai_pairing_codes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    codeHash: text('code_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('ai_pairing_codes_code_hash_uidx').on(table.codeHash),
    index('ai_pairing_codes_user_id_idx').on(table.userId),
    index('ai_pairing_codes_expires_at_idx').on(table.expiresAt),
  ],
);

export const apiClients = pgTable(
  'api_clients',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    /** Null until a pending AI request is approved. */
    tokenHash: text('token_hash'),
    tokenPrefix: text('token_prefix'),
    scopes: jsonb('scopes').$type<string[]>().notNull(),
    allowedWorkspaceIds: jsonb('allowed_workspace_ids').$type<string[]>().notNull(),
    allowedProjectIds: jsonb('allowed_project_ids').$type<string[]>().notNull(),
    actingUserId: uuid('acting_user_id').references(() => users.id, {
      onDelete: 'restrict',
    }),
    status: text('status').notNull().default('active'),
    requestedByUserId: uuid('requested_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    approvedByUserId: uuid('approved_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    approvedAt: timestamp('approved_at', { withTimezone: true, mode: 'date' }),
    agentLabel: text('agent_label'),
    claimSecretHash: text('claim_secret_hash'),
    /** Plaintext token held until the AI claims it (cleared after claim). */
    unclaimedToken: text('unclaimed_token'),
    tokenClaimedAt: timestamp('token_claimed_at', { withTimezone: true, mode: 'date' }),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true, mode: 'date' }),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('api_clients_token_hash_uidx').on(table.tokenHash),
    index('api_clients_organization_id_idx').on(table.organizationId),
    index('api_clients_token_prefix_idx').on(table.tokenPrefix),
    index('api_clients_acting_user_id_idx').on(table.actingUserId),
    index('api_clients_status_idx').on(table.status),
    index('api_clients_requested_by_user_id_idx').on(table.requestedByUserId),
  ],
);

export const tags = pgTable(
  'tags',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('tags_organization_slug_uidx').on(table.organizationId, table.slug),
    index('tags_organization_id_idx').on(table.organizationId),
  ],
);

export const projectTags = pgTable(
  'project_tags',
  {
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    tagId: uuid('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
  },
  (table) => [
    uniqueIndex('project_tags_uidx').on(table.projectId, table.tagId),
    index('project_tags_tag_id_idx').on(table.tagId),
  ],
);

export const systemTags = pgTable(
  'system_tags',
  {
    systemId: uuid('system_id')
      .notNull()
      .references(() => systems.id, { onDelete: 'cascade' }),
    tagId: uuid('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
  },
  (table) => [
    uniqueIndex('system_tags_uidx').on(table.systemId, table.tagId),
    index('system_tags_tag_id_idx').on(table.tagId),
  ],
);

export const knowledgeRecords = pgTable(
  'knowledge_records',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').references(() => projects.id, {
      onDelete: 'set null',
    }),
    systemId: uuid('system_id').references(() => systems.id, {
      onDelete: 'set null',
    }),
    title: text('title').notNull(),
    slug: text('slug').notNull(),
    summary: text('summary'),
    recordType: text('record_type').notNull(),
    lifecycleStatus: text('lifecycle_status').notNull().default('draft'),
    sourceOfTruthMode: text('source_of_truth_mode').notNull().default('hub_managed'),
    contentMarkdown: text('content_markdown').notNull().default(''),
    contentHtmlCache: text('content_html_cache'),
    language: text('language').default('en'),
    /** Shared id for translation siblings (Phase 1 foundation; UI linking later). */
    translationGroupId: uuid('translation_group_id'),
    metadataJson: jsonb('metadata_json').$type<Record<string, unknown>>(),
    currentVersionNumber: integer('current_version_number').notNull().default(1),
    supersedesRecordId: uuid('supersedes_record_id').references(
      (): AnyPgColumn => knowledgeRecords.id,
      { onDelete: 'set null' },
    ),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    reviewedBy: uuid('reviewed_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    verifiedAt: timestamp('verified_at', { withTimezone: true, mode: 'date' }),
    lastValidatedAt: timestamp('last_validated_at', {
      withTimezone: true,
      mode: 'date',
    }),
    archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'date' }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('knowledge_records_workspace_slug_uidx').on(table.workspaceId, table.slug),
    index('knowledge_records_workspace_id_idx').on(table.workspaceId),
    index('knowledge_records_project_id_idx').on(table.projectId),
    index('knowledge_records_system_id_idx').on(table.systemId),
    index('knowledge_records_lifecycle_status_idx').on(table.lifecycleStatus),
    index('knowledge_records_translation_group_id_idx').on(table.translationGroupId),
  ],
);

export const knowledgeSources = pgTable(
  'knowledge_sources',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    knowledgeRecordId: uuid('knowledge_record_id')
      .notNull()
      .references(() => knowledgeRecords.id, { onDelete: 'cascade' }),
    sourceType: text('source_type').notNull(),
    sourceProvider: text('source_provider'),
    sourceReference: text('source_reference'),
    sourceTitle: text('source_title'),
    sourceUri: text('source_uri'),
    sourceCreatedAt: timestamp('source_created_at', {
      withTimezone: true,
      mode: 'date',
    }),
    generatedByModel: text('generated_by_model'),
    metadataJson: jsonb('metadata_json').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('knowledge_sources_record_id_idx').on(table.knowledgeRecordId),
  ],
);

export const knowledgeRecordTags = pgTable(
  'knowledge_record_tags',
  {
    knowledgeRecordId: uuid('knowledge_record_id')
      .notNull()
      .references(() => knowledgeRecords.id, { onDelete: 'cascade' }),
    tagId: uuid('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
  },
  (table) => [
    uniqueIndex('knowledge_record_tags_uidx').on(table.knowledgeRecordId, table.tagId),
    index('knowledge_record_tags_tag_id_idx').on(table.tagId),
  ],
);

export const knowledgeRecordVersions = pgTable(
  'knowledge_record_versions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    knowledgeRecordId: uuid('knowledge_record_id')
      .notNull()
      .references(() => knowledgeRecords.id, { onDelete: 'cascade' }),
    versionNumber: integer('version_number').notNull(),
    title: text('title').notNull(),
    summary: text('summary'),
    recordType: text('record_type').notNull(),
    lifecycleStatus: text('lifecycle_status').notNull(),
    contentMarkdown: text('content_markdown').notNull(),
    metadataJson: jsonb('metadata_json').$type<Record<string, unknown>>(),
    changeMessage: text('change_message'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('knowledge_record_versions_record_version_uidx').on(
      table.knowledgeRecordId,
      table.versionNumber,
    ),
    index('knowledge_record_versions_record_id_idx').on(table.knowledgeRecordId),
  ],
);

/** Platform-wide key/value settings (e.g. public MCP URL override). */
export const platformSettings = pgTable('platform_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedBy: uuid('updated_by').references(() => users.id, {
    onDelete: 'set null',
  }),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
});

export type GitPathMapping = {
  pattern: string;
  recordType: string;
  tags?: string[];
};

/** Git repository connection for Markdown sync into a workspace/project. */
export const gitRepositoryConnections = pgTable(
  'git_repository_connections',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').references(() => projects.id, {
      onDelete: 'set null',
    }),
    provider: text('provider').notNull().default('github'),
    owner: text('owner').notNull(),
    repo: text('repo').notNull(),
    branch: text('branch').notNull().default('main'),
    /** Instance root for Forgejo / self-hosted GitLab; optional Azure org override. */
    baseUrl: text('base_url'),
    /** Provider PAT / fine-grained token — never returned in full by the API. */
    accessToken: text('access_token').notNull(),
    includePaths: jsonb('include_paths').$type<string[]>().notNull(),
    excludePaths: jsonb('exclude_paths').$type<string[]>().notNull(),
    pathMappings: jsonb('path_mappings').$type<GitPathMapping[]>().notNull(),
    webhookSecret: text('webhook_secret'),
    status: text('status').notNull().default('active'),
    lastError: text('last_error'),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true, mode: 'date' }),
    lastSyncedCommitSha: text('last_synced_commit_sha'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    ...timestamps,
  },
  (table) => [
    index('git_repository_connections_workspace_id_idx').on(table.workspaceId),
    index('git_repository_connections_project_id_idx').on(table.projectId),
    uniqueIndex('git_repository_connections_workspace_repo_uidx').on(
      table.workspaceId,
      table.provider,
      table.owner,
      table.repo,
      table.branch,
    ),
  ],
);

export const gitSyncRuns = pgTable(
  'git_sync_runs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => gitRepositoryConnections.id, { onDelete: 'cascade' }),
    status: text('status').notNull().default('queued'),
    trigger: text('trigger').notNull(),
    commitSha: text('commit_sha'),
    statsJson: jsonb('stats_json').$type<Record<string, number>>(),
    errorMessage: text('error_message'),
    startedAt: timestamp('started_at', { withTimezone: true, mode: 'date' }),
    finishedAt: timestamp('finished_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('git_sync_runs_connection_id_idx').on(table.connectionId),
    index('git_sync_runs_created_at_idx').on(table.createdAt),
  ],
);

/** Raw pasted LLM conversation / Markdown — never indexed for MCP or FTS. */
export const conversationImports = pgTable(
  'conversation_imports',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').references(() => projects.id, {
      onDelete: 'set null',
    }),
    systemId: uuid('system_id').references(() => systems.id, {
      onDelete: 'set null',
    }),
    title: text('title').notNull(),
    contentFormat: text('content_format').notNull().default('markdown'),
    rawContent: text('raw_content').notNull(),
    /** Secret-pattern warnings (counts/labels only; never matched secret text). */
    contentWarnings: jsonb('content_warnings').$type<
      Array<{
        code: string;
        severity: 'info' | 'warning' | 'high';
        count: number;
        label: string;
      }>
    >(),
    sourceProvider: text('source_provider'),
    generatedByModel: text('generated_by_model'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'date' }),
    ...timestamps,
  },
  (table) => [
    index('conversation_imports_workspace_id_idx').on(table.workspaceId),
    index('conversation_imports_project_id_idx').on(table.projectId),
    index('conversation_imports_system_id_idx').on(table.systemId),
  ],
);

/** Links draft knowledge records created from a conversation import. */
export const conversationImportRecords = pgTable(
  'conversation_import_records',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    importId: uuid('import_id')
      .notNull()
      .references(() => conversationImports.id, { onDelete: 'cascade' }),
    knowledgeRecordId: uuid('knowledge_record_id')
      .notNull()
      .references(() => knowledgeRecords.id, { onDelete: 'cascade' }),
    excerptNote: text('excerpt_note'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('conversation_import_records_pair_uidx').on(
      table.importId,
      table.knowledgeRecordId,
    ),
    index('conversation_import_records_import_id_idx').on(table.importId),
    index('conversation_import_records_record_id_idx').on(table.knowledgeRecordId),
  ],
);

/** Registered embedding model metadata (provider + model + dimensions). */
export const embeddingModels = pgTable(
  'embedding_models',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    provider: text('provider').notNull(),
    modelName: text('model_name').notNull(),
    dimensions: integer('dimensions').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('embedding_models_provider_model_uidx').on(
      table.provider,
      table.modelName,
    ),
  ],
);

/** Chunked knowledge content with embeddings for hybrid search (Milestone 10). */
export const knowledgeRecordChunks = pgTable(
  'knowledge_record_chunks',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    knowledgeRecordId: uuid('knowledge_record_id')
      .notNull()
      .references(() => knowledgeRecords.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    chunkIndex: integer('chunk_index').notNull(),
    content: text('content').notNull(),
    tokenEstimate: integer('token_estimate'),
    embeddingModelId: uuid('embedding_model_id')
      .notNull()
      .references(() => embeddingModels.id, { onDelete: 'restrict' }),
    embedding: vector768('embedding').notNull(),
    contentHash: text('content_hash').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('knowledge_record_chunks_record_index_uidx').on(
      table.knowledgeRecordId,
      table.chunkIndex,
    ),
    index('knowledge_record_chunks_workspace_id_idx').on(table.workspaceId),
    index('knowledge_record_chunks_record_id_idx').on(table.knowledgeRecordId),
  ],
);

/** Document/image file imports converted via MarkItDown (inbound; not MCP/FTS). */
export const documentImports = pgTable(
  'document_imports',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').references(() => projects.id, {
      onDelete: 'set null',
    }),
    systemId: uuid('system_id').references(() => systems.id, {
      onDelete: 'set null',
    }),
    title: text('title').notNull(),
    /** `document` | `image` */
    lane: text('lane').notNull(),
    /** `pending` | `converting` | `ready` | `failed` */
    status: text('status').notNull().default('pending'),
    /** `none` | `vision` | `tesseract` — OCR path used during convert */
    ocrEngine: text('ocr_engine').notNull().default('none'),
    /** Tesseract `-l` primary language: `eng` | `deu` | `hun` (from UI locale). */
    ocrLang: text('ocr_lang').notNull().default('eng'),
    originalFilename: text('original_filename').notNull(),
    contentType: text('content_type').notNull(),
    byteSize: integer('byte_size').notNull(),
    blobKey: text('blob_key').notNull(),
    convertedMarkdown: text('converted_markdown'),
    contentWarnings: jsonb('content_warnings').$type<
      Array<{
        code: string;
        severity: 'info' | 'warning' | 'high';
        count: number;
        label: string;
      }>
    >(),
    conversionError: text('conversion_error'),
    conversionWarnings: jsonb('conversion_warnings').$type<string[]>(),
    /** Worker progress for import detail UI (queued/reading/ocr/…). */
    progressStage: text('progress_stage'),
    progressMessage: text('progress_message'),
    progressLog: text('progress_log'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'date' }),
    ...timestamps,
  },
  (table) => [
    index('document_imports_workspace_id_idx').on(table.workspaceId),
    index('document_imports_status_idx').on(table.status),
  ],
);

/** Links draft knowledge records created from a document import. */
export const documentImportRecords = pgTable(
  'document_import_records',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    importId: uuid('import_id')
      .notNull()
      .references(() => documentImports.id, { onDelete: 'cascade' }),
    knowledgeRecordId: uuid('knowledge_record_id')
      .notNull()
      .references(() => knowledgeRecords.id, { onDelete: 'cascade' }),
    excerptNote: text('excerpt_note'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('document_import_records_pair_uidx').on(
      table.importId,
      table.knowledgeRecordId,
    ),
    index('document_import_records_import_id_idx').on(table.importId),
  ],
);

/** Workspace media library (JPEG/PNG/WebP) for Markdown embeds (NF-013). */
export const workspaceMedia = pgTable(
  'workspace_media',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    knowledgeRecordId: uuid('knowledge_record_id').references(
      () => knowledgeRecords.id,
      { onDelete: 'set null' },
    ),
    contentType: text('content_type').notNull(),
    byteSize: integer('byte_size').notNull(),
    originalFilename: text('original_filename'),
    altText: text('alt_text'),
    createdBy: uuid('created_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('workspace_media_workspace_id_idx').on(table.workspaceId),
    index('workspace_media_record_id_idx').on(table.knowledgeRecordId),
    index('workspace_media_created_at_idx').on(table.createdAt),
  ],
);

/**
 * Doc Factory style packs (Phase E) — presentation tokens + optional logo.
 * Built-in Blank is synthetic (`blank`) and is not stored here.
 */
export const stylePacks = pgTable(
  'style_packs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    label: text('label').notNull(),
    status: text('status').notNull().default('active'),
    /** Supported export formats, e.g. `["pdf","docx"]`. */
    formats: jsonb('formats').$type<string[]>().notNull().default(['pdf', 'docx']),
    typography: jsonb('typography')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    chrome: jsonb('chrome')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    logoBlobKey: text('logo_blob_key'),
    logoContentType: text('logo_content_type'),
    /** Uploaded Word shell template for DOCX export (optional). */
    docxTemplateBlobKey: text('docx_template_blob_key'),
    docxTemplateContentType: text('docx_template_content_type'),
    /** Detected body anchor: contentControl | bookmark | placeholder. */
    docxTemplateBodyAnchor: text('docx_template_body_anchor'),
    createdBy: uuid('created_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('style_packs_organization_slug_uidx').on(
      table.organizationId,
      table.slug,
    ),
    index('style_packs_organization_status_idx').on(
      table.organizationId,
      table.status,
    ),
  ],
);

/**
 * Outbound OpenAI-compatible LLM connections (Admin AI Providers).
 * Distinct from inbound `api_clients` (MCP/OpenAPI tokens).
 */
export const llmProviders = pgTable(
  'llm_providers',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull(),
    kind: text('kind').notNull().default('openai_compatible'),
    baseUrl: text('base_url').notNull(),
    apiKey: text('api_key'),
    defaultModel: text('default_model').notNull(),
    timeoutMs: integer('timeout_ms'),
    status: text('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    updatedBy: uuid('updated_by').references(() => users.id, {
      onDelete: 'set null',
    }),
  },
  (table) => [
    uniqueIndex('llm_providers_name_uidx').on(table.name),
    index('llm_providers_status_idx').on(table.status),
  ],
);

/** Maps a hub service role to one llm_providers row (+ optional model override). */
export const llmServiceBindings = pgTable('llm_service_bindings', {
  service: text('service').primaryKey(),
  providerId: uuid('provider_id')
    .notNull()
    .references(() => llmProviders.id, { onDelete: 'restrict' }),
  modelOverride: text('model_override'),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
  updatedBy: uuid('updated_by').references(() => users.id, {
    onDelete: 'set null',
  }),
});

/** Images extracted during conversion and stored as workspace_media. */
export const documentImportMedia = pgTable(
  'document_import_media',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    importId: uuid('import_id')
      .notNull()
      .references(() => documentImports.id, { onDelete: 'cascade' }),
    workspaceMediaId: uuid('workspace_media_id')
      .notNull()
      .references(() => workspaceMedia.id, { onDelete: 'cascade' }),
    attachmentIndex: integer('attachment_index').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('document_import_media_pair_uidx').on(
      table.importId,
      table.workspaceMediaId,
    ),
    uniqueIndex('document_import_media_attachment_uidx').on(
      table.importId,
      table.attachmentIndex,
    ),
  ],
);

/** Project delivery milestones (NF-018 / ADR-015). */
export const projectMilestones = pgTable(
  'project_milestones',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description'),
    status: text('status').notNull().default('planned'),
    startDate: date('start_date', { mode: 'string' }),
    targetDate: date('target_date', { mode: 'string' }),
    sortOrder: integer('sort_order').notNull().default(0),
    issueKeyType: text('issue_key_type'),
    issueNumber: integer('issue_number'),
    archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'date' }),
    ...timestamps,
  },
  (table) => [
    index('project_milestones_project_id_idx').on(table.projectId),
    index('project_milestones_project_status_idx').on(table.projectId, table.status),
    uniqueIndex('project_milestones_project_key_uidx').on(
      table.projectId,
      table.issueKeyType,
      table.issueNumber,
    ),
  ],
);

/** Agile epics (orthogonal to milestone timeboxes). */
export const projectEpics = pgTable(
  'project_epics',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description'),
    status: text('status').notNull().default('planned'),
    startDate: date('start_date', { mode: 'string' }),
    endDate: date('end_date', { mode: 'string' }),
    sortOrder: integer('sort_order').notNull().default(0),
    issueKeyType: text('issue_key_type'),
    issueNumber: integer('issue_number'),
    archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'date' }),
    ...timestamps,
  },
  (table) => [
    index('project_epics_project_id_idx').on(table.projectId),
    index('project_epics_project_status_idx').on(table.projectId, table.status),
    uniqueIndex('project_epics_project_key_uidx').on(
      table.projectId,
      table.issueKeyType,
      table.issueNumber,
    ),
  ],
);

/** User stories under an epic. */
export const projectUserStories = pgTable(
  'project_user_stories',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    epicId: uuid('epic_id')
      .notNull()
      .references(() => projectEpics.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description'),
    status: text('status').notNull().default('planned'),
    startDate: date('start_date', { mode: 'string' }),
    endDate: date('end_date', { mode: 'string' }),
    sortOrder: integer('sort_order').notNull().default(0),
    issueKeyType: text('issue_key_type'),
    issueNumber: integer('issue_number'),
    archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'date' }),
    ...timestamps,
  },
  (table) => [
    index('project_user_stories_project_id_idx').on(table.projectId),
    index('project_user_stories_epic_id_idx').on(table.epicId),
    index('project_user_stories_project_status_idx').on(table.projectId, table.status),
    uniqueIndex('project_user_stories_project_key_uidx').on(
      table.projectId,
      table.issueKeyType,
      table.issueNumber,
    ),
  ],
);

/** Project delivery tasks (NF-018 / ADR-015). */
export const projectTasks = pgTable(
  'project_tasks',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    milestoneId: uuid('milestone_id').references(() => projectMilestones.id, {
      onDelete: 'set null',
    }),
    userStoryId: uuid('user_story_id').references(() => projectUserStories.id, {
      onDelete: 'set null',
    }),
    title: text('title').notNull(),
    description: text('description'),
    status: text('status').notNull().default('todo'),
    dueDate: date('due_date', { mode: 'string' }),
    forecastHours: numeric('forecast_hours', { precision: 10, scale: 2 }),
    actualHours: numeric('actual_hours', { precision: 10, scale: 2 }),
    sortOrder: integer('sort_order').notNull().default(0),
    createdBy: uuid('created_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    /** Ball-in-court owner; distinct from standing RACI. */
    currentOwnerUserId: uuid('current_owner_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    /** Tokens consumed by an AI assistant on this task (actuals). */
    tokensUsed: integer('tokens_used'),
    aiSystemId: uuid('ai_system_id').references(() => systems.id, {
      onDelete: 'set null',
    }),
    issueKeyType: text('issue_key_type'),
    issueNumber: integer('issue_number'),
    archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'date' }),
    ...timestamps,
  },
  (table) => [
    index('project_tasks_project_id_idx').on(table.projectId),
    index('project_tasks_milestone_id_idx').on(table.milestoneId),
    index('project_tasks_user_story_id_idx').on(table.userStoryId),
    index('project_tasks_project_user_story_idx').on(table.projectId, table.userStoryId),
    index('project_tasks_current_owner_user_id_idx').on(table.currentOwnerUserId),
    index('project_tasks_ai_system_id_idx').on(table.aiSystemId),
    index('project_tasks_project_status_idx').on(table.projectId, table.status),
    uniqueIndex('project_tasks_project_key_uidx').on(
      table.projectId,
      table.issueKeyType,
      table.issueNumber,
    ),
  ],
);

/** Append-only activity timeline for a task (comments, handoffs, status, …). */
export const projectTaskActivities = pgTable(
  'project_task_activities',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => projectTasks.id, { onDelete: 'cascade' }),
    actorUserId: uuid('actor_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    type: text('type').notNull(),
    body: text('body'),
    metadataJson: jsonb('metadata_json').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('project_task_activities_task_id_idx').on(table.taskId),
    index('project_task_activities_task_created_idx').on(table.taskId, table.createdAt),
  ],
);

/** RACI assignments for a task — at most one Accountable (A) per task. */
export const projectTaskRaci = pgTable(
  'project_task_raci',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => projectTasks.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('project_task_raci_task_user_uidx').on(table.taskId, table.userId),
    uniqueIndex('project_task_raci_one_accountable_uidx')
      .on(table.taskId)
      .where(sql`${table.role} = 'A'`),
    index('project_task_raci_user_id_idx').on(table.userId),
  ],
);

/**
 * Durable project stakeholder roster (hybrid with RACI / owner-derived people).
 * reports_to_user_id is a soft reporting line within the project stakeholder set.
 */
export const projectStakeholders = pgTable(
  'project_stakeholders',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    projectRole: text('project_role').notNull().default('stakeholder'),
    jobTitle: text('job_title'),
    notes: text('notes'),
    reportsToUserId: uuid('reports_to_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    /** Hourly rate in the project's currency. */
    hourlyRate: numeric('hourly_rate', { precision: 12, scale: 2 }),
    /** employee | contractor */
    engagementType: text('engagement_type'),
    assignmentStart: date('assignment_start', { mode: 'string' }),
    assignmentEnd: date('assignment_end', { mode: 'string' }),
    allocatedDailyHours: numeric('allocated_daily_hours', {
      precision: 6,
      scale: 2,
    }),
    contractRef: text('contract_ref'),
    contractedBudget: numeric('contracted_budget', { precision: 14, scale: 2 }),
    contractStart: date('contract_start', { mode: 'string' }),
    contractEnd: date('contract_end', { mode: 'string' }),
    sortOrder: integer('sort_order').notNull().default(0),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('project_stakeholders_project_user_uidx').on(
      table.projectId,
      table.userId,
    ),
    index('project_stakeholders_project_id_idx').on(table.projectId),
    index('project_stakeholders_reports_to_idx').on(table.reportsToUserId),
  ],
);

/** Project RAID register: Risks, Assumptions, Issues, Dependencies. */
export const projectRaidItems = pgTable(
  'project_raid_items',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    status: text('status').notNull().default('open'),
    severity: text('severity').notNull().default('medium'),
    ownerUserId: uuid('owner_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    dueDate: date('due_date', { mode: 'string' }),
    sortOrder: integer('sort_order').notNull().default(0),
    issueKeyType: text('issue_key_type'),
    issueNumber: integer('issue_number'),
    transferredToRaidItemId: uuid('transferred_to_raid_item_id').references(
      (): AnyPgColumn => projectRaidItems.id,
      { onDelete: 'set null' },
    ),
    transferredFromRaidItemId: uuid('transferred_from_raid_item_id').references(
      (): AnyPgColumn => projectRaidItems.id,
      { onDelete: 'set null' },
    ),
    archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'date' }),
    ...timestamps,
  },
  (table) => [
    index('project_raid_items_project_id_idx').on(table.projectId),
    index('project_raid_items_project_kind_idx').on(table.projectId, table.kind),
    index('project_raid_items_project_status_idx').on(table.projectId, table.status),
    uniqueIndex('project_raid_items_project_key_uidx').on(
      table.projectId,
      table.issueKeyType,
      table.issueNumber,
    ),
  ],
);

/** Links a RAID item to one or more delivery tasks (same project). */
export const projectRaidTaskLinks = pgTable(
  'project_raid_task_links',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    raidItemId: uuid('raid_item_id')
      .notNull()
      .references(() => projectRaidItems.id, { onDelete: 'cascade' }),
    taskId: uuid('task_id')
      .notNull()
      .references(() => projectTasks.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('project_raid_task_links_raid_task_uidx').on(
      table.raidItemId,
      table.taskId,
    ),
    index('project_raid_task_links_task_id_idx').on(table.taskId),
  ],
);

/**
 * Links a knowledge record to delivery entities (epic / user story / task).
 * entity_id is polymorphic; app layer validates project ownership.
 */
export const knowledgeRecordDeliveryLinks = pgTable(
  'knowledge_record_delivery_links',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    knowledgeRecordId: uuid('knowledge_record_id')
      .notNull()
      .references(() => knowledgeRecords.id, { onDelete: 'cascade' }),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('knowledge_record_delivery_links_uidx').on(
      table.knowledgeRecordId,
      table.entityType,
      table.entityId,
    ),
    index('knowledge_record_delivery_links_entity_idx').on(
      table.entityType,
      table.entityId,
    ),
    index('knowledge_record_delivery_links_record_idx').on(table.knowledgeRecordId),
  ],
);

/** Kickoff stakeholder snapshot (separate from live project_stakeholders roster). */
export const projectInitialStakeholders = pgTable(
  'project_initial_stakeholders',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    projectRole: text('project_role').notNull().default('stakeholder'),
    sortOrder: integer('sort_order').notNull().default(0),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('project_initial_stakeholders_project_user_uidx').on(
      table.projectId,
      table.userId,
    ),
    index('project_initial_stakeholders_project_id_idx').on(table.projectId),
  ],
);

/** Change management register for baseline / plan / timeline changes. */
export const projectChangeItems = pgTable(
  'project_change_items',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    rationale: text('rationale'),
    status: text('status').notNull().default('proposed'),
    requestedByUserId: uuid('requested_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    approvedByUserId: uuid('approved_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    requestedAt: timestamp('requested_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    decidedAt: timestamp('decided_at', { withTimezone: true, mode: 'date' }),
    effectiveDate: date('effective_date', { mode: 'string' }),
    baselineStartBefore: date('baseline_start_before', { mode: 'string' }),
    baselineStartAfter: date('baseline_start_after', { mode: 'string' }),
    baselineEndBefore: date('baseline_end_before', { mode: 'string' }),
    baselineEndAfter: date('baseline_end_after', { mode: 'string' }),
    knowledgeRecordId: uuid('knowledge_record_id').references(
      () => knowledgeRecords.id,
      { onDelete: 'set null' },
    ),
    sortOrder: integer('sort_order').notNull().default(0),
    issueKeyType: text('issue_key_type'),
    issueNumber: integer('issue_number'),
    archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'date' }),
    ...timestamps,
  },
  (table) => [
    index('project_change_items_project_id_idx').on(table.projectId),
    index('project_change_items_project_status_idx').on(table.projectId, table.status),
    uniqueIndex('project_change_items_project_key_uidx').on(
      table.projectId,
      table.issueKeyType,
      table.issueNumber,
    ),
  ],
);

/** Links a change item to delivery entities (epic / story / milestone / task). */
export const projectChangeDeliveryLinks = pgTable(
  'project_change_delivery_links',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    changeId: uuid('change_id')
      .notNull()
      .references(() => projectChangeItems.id, { onDelete: 'cascade' }),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('project_change_delivery_links_uidx').on(
      table.changeId,
      table.entityType,
      table.entityId,
    ),
    index('project_change_delivery_links_entity_idx').on(
      table.entityType,
      table.entityId,
    ),
  ],
);

/** Daily EVM snapshot for burndown charts (upserted on budget/effort mutations). */
export const projectCostSnapshots = pgTable(
  'project_cost_snapshots',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    capturedOn: date('captured_on', { mode: 'string' }).notNull(),
    bac: numeric('bac', { precision: 14, scale: 2 }).notNull(),
    pv: numeric('pv', { precision: 14, scale: 2 }),
    ev: numeric('ev', { precision: 14, scale: 2 }).notNull(),
    ac: numeric('ac', { precision: 14, scale: 2 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('project_cost_snapshots_project_day_uidx').on(
      table.projectId,
      table.capturedOn,
    ),
    index('project_cost_snapshots_project_id_idx').on(table.projectId),
  ],
);
