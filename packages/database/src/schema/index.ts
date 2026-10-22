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
    /** Currency used for AI cost charts and cross-currency totals. */
    reportingCurrency: text('reporting_currency').notNull().default('EUR'),
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
    /** User category: 'human' (default) or 'system' (service accounts). */
    userType: text('user_type').notNull().default('human'),
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
    status: text('status').notNull().default('active'),
    ownerUserId: uuid('owner_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    businessDomain: text('business_domain'),
    criticality: text('criticality'),
    startDate: date('start_date', { mode: 'string' }),
    endDate: date('end_date', { mode: 'string' }),
    /** Effort hours in one working day. Scheduling and Gantt share this calendar. */
    hoursPerWorkday: numeric('hours_per_workday', {
      precision: 4,
      scale: 2,
      mode: 'number',
    })
      .notNull()
      .default(8),
    /** Monday-first working days: 5 is Monday–Friday, 7 is every day. */
    workdaysPerWeek: integer('workdays_per_week').notNull().default(5),
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
    /** Scrum Definition of Done checklist / notes (NF-020). */
    definitionOfDone: text('definition_of_done'),
    /** Project currency for budget and stakeholder rates (no FX). */
    currency: text('currency').notNull().default('EUR'),
    /** Kickoff baseline budget amount in project currency. */
    initialBudget: numeric('initial_budget', { precision: 14, scale: 2, mode: 'number' }),
    /** Working BAC; falls back to initialBudget when null. */
    approvedBudget: numeric('approved_budget', { precision: 14, scale: 2, mode: 'number' }),
    /** Workspace-unique 3-char prefix for human issue keys (AAA or AA0). */
    keyPrefix: text('key_prefix'),
    /** scrum | kanban | waterfall | hybrid. Null when unset. */
    methodology: text('methodology'),
    /** mcp when an agent created the project. Null for human creates. */
    createdVia: text('created_via'),
    createdByApiClientId: uuid('created_by_api_client_id').references(
      (): AnyPgColumn => apiClients.id,
      { onDelete: 'set null' },
    ),
    /** Set when ChatGPT (or another OAuth grant) created the project. Not an api_clients id. */
    createdByOauthGrantId: uuid('created_by_oauth_grant_id').references(
      (): AnyPgColumn => oauthGrants.id,
      { onDelete: 'set null' },
    ),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    generatedByModel: text('generated_by_model'),
    /** When true, a slipping delivery item raises one open RAID risk. */
    scheduleSlipRiskEnabled: boolean('schedule_slip_risk_enabled')
      .notNull()
      .default(false),
    /** Minimum working days of slip before a risk is raised. */
    scheduleSlipThresholdDays: integer('schedule_slip_threshold_days')
      .notNull()
      .default(2),
    /** task, user_story, epic, milestone. */
    scheduleSlipItemTypes: jsonb('schedule_slip_item_types')
      .$type<string[]>()
      .notNull()
      .default(['task', 'user_story', 'epic', 'milestone']),
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

/** Dates the project calendar never treats as working days. */
export const projectNonWorkingDays = pgTable(
  'project_non_working_days',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    day: date('day', { mode: 'string' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('project_non_working_days_project_day_uidx').on(
      table.projectId,
      table.day,
    ),
    index('project_non_working_days_project_id_idx').on(table.projectId),
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
    /** Structured IT inventory (hostname, URLs, IPs, deployment, etc.). */
    itDetails: jsonb('it_details')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    /** Non-AI catalogue OpEx: flat | one_time | note_only. */
    itCostMode: text('it_cost_mode'),
    itFlatMonthlyFee: numeric('it_flat_monthly_fee', { precision: 14, scale: 2, mode: 'number' }),
    itOneTimeCost: numeric('it_one_time_cost', { precision: 14, scale: 2, mode: 'number' }),
    itBudgetAllocation: numeric('it_budget_allocation', { precision: 14, scale: 2, mode: 'number' }),
    /** AI assistant cost mode: flat | api | mixed | note_only. */
    aiCostMode: text('ai_cost_mode'),
    aiFlatMonthlyFee: numeric('ai_flat_monthly_fee', { precision: 14, scale: 2, mode: 'number' }),
    /**
     * Retired per-1k rates. Migration 0080 copied filled values into
     * ai_model_prices. Pricing uses the catalog. Writes are rejected.
     */
    aiTokenRatePer1k: numeric('ai_token_rate_per_1k', { precision: 14, scale: 4, mode: 'number' }),
    aiTokenRateInputPer1k: numeric('ai_token_rate_input_per_1k', {
      precision: 14,
      scale: 4,
      mode: 'number',
    }),
    aiTokenRateOutputPer1k: numeric('ai_token_rate_output_per_1k', {
      precision: 14,
      scale: 4,
      mode: 'number',
    }),
    aiTokenRateCachePer1k: numeric('ai_token_rate_cache_per_1k', {
      precision: 14,
      scale: 4,
      mode: 'number',
    }),
    /** Cache-write price per 1k. Null falls back to the blended rate. Distinct from cache read. */
    aiTokenRateCacheWritePer1k: numeric('ai_token_rate_cache_write_per_1k', {
      precision: 14,
      scale: 4,
      mode: 'number',
    }),
    /** Currency of the token list prices. Null means the linked project's currency. */
    aiTokenRateCurrency: text('ai_token_rate_currency'),
    /** Short note, e.g. Cursor Pro+ flat plus on-demand. */
    aiCostNotes: text('ai_cost_notes'),
    aiBudgetAllocation: numeric('ai_budget_allocation', { precision: 14, scale: 2, mode: 'number' }),
    metadataJson: jsonb('metadata_json').$type<Record<string, unknown>>(),
    lastValidatedAt: timestamp('last_validated_at', {
      withTimezone: true,
      mode: 'date',
    }),
    archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'date' }),
    createdBy: uuid('created_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('systems_workspace_slug_uidx').on(table.workspaceId, table.slug),
    index('systems_workspace_id_idx').on(table.workspaceId),
    index('systems_project_id_idx').on(table.projectId),
    index('systems_created_by_idx').on(table.createdBy),
  ],
);

/**
 * Daily foreign-exchange quotes. `rate` is quote units per 1 base unit.
 * ECB rows use base EUR. A manual row for the same pair and day wins.
 */
export const exchangeRates = pgTable(
  'exchange_rates',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    rateDate: date('rate_date', { mode: 'string' }).notNull(),
    base: text('base').notNull(),
    quote: text('quote').notNull(),
    rate: numeric('rate', { precision: 18, scale: 8, mode: 'number' }).notNull(),
    /** ecb | mnb | manual */
    source: text('source').notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('exchange_rates_pair_uidx').on(
      table.rateDate,
      table.base,
      table.quote,
      table.source,
    ),
    index('exchange_rates_pair_date_idx').on(table.base, table.quote, table.rateDate),
  ],
);

/**
 * Workspace-level AI invoices. Not per project: a period's paid total is
 * allocated across projects (see docs/product/PROJECT_BUDGET.md).
 */
export const aiBillingEntries = pgTable(
  'ai_billing_entries',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    /** Null: workspace-wide pool (for example one Cursor subscription). */
    aiSystemId: uuid('ai_system_id').references(() => systems.id, {
      onDelete: 'set null',
    }),
    /** YYYY-MM. The start month when the service window is set. */
    period: text('period').notNull(),
    /** Inclusive first day. Null keeps the whole amount in period. */
    servicePeriodStart: date('service_period_start', { mode: 'string' }),
    /** Exclusive renewal date (not included). Null together with the start. */
    servicePeriodEnd: date('service_period_end', { mode: 'string' }),
    provider: text('provider').notNull(),
    plan: text('plan'),
    /** subscription | plan_change | on_demand. */
    type: text('type').notNull(),
    /** plan_change may be negative (downgrade credit). */
    amount: numeric('amount', { precision: 14, scale: 2, mode: 'number' }).notNull(),
    currency: text('currency').notNull(),
    paidAt: timestamp('paid_at', { withTimezone: true, mode: 'date' }),
    note: text('note'),
    externalRef: text('external_ref'),
    createdBy: uuid('created_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    ...timestamps,
  },
  (table) => [
    index('ai_billing_entries_workspace_period_idx').on(
      table.workspaceId,
      table.period,
    ),
    index('ai_billing_entries_system_idx').on(table.aiSystemId),
    index('ai_billing_entries_created_by_idx').on(table.createdBy),
  ],
);

/**
 * Optional percent of one billing pool assigned to a project.
 * Null ai_system_id is the workspace-wide pool. Percents in a pool must
 * sum to at most 100; the remainder follows the default allocation rule.
 */
export const aiBillingAllocationOverrides = pgTable(
  'ai_billing_allocation_overrides',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    period: text('period').notNull(),
    aiSystemId: uuid('ai_system_id').references(() => systems.id, {
      onDelete: 'cascade',
    }),
    percent: numeric('percent', { precision: 6, scale: 3, mode: 'number' }).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('ai_billing_allocation_overrides_uidx').on(
      table.workspaceId,
      table.projectId,
      table.period,
      sql`coalesce(${table.aiSystemId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
    ),
    index('ai_billing_allocation_overrides_project_idx').on(table.projectId),
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

/** One-time OAuth authorization codes for the /mcp/oauth resource. */
export const oauthAuthorizationCodes = pgTable(
  'oauth_authorization_codes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    codeHash: text('code_hash').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    clientId: text('client_id').notNull(),
    redirectUri: text('redirect_uri').notNull(),
    resource: text('resource').notNull(),
    scopes: jsonb('scopes').$type<string[]>().notNull(),
    allowedWorkspaceIds: jsonb('allowed_workspace_ids').$type<string[]>().notNull(),
    allowedProjectIds: jsonb('allowed_project_ids').$type<string[]>().notNull(),
    codeChallenge: text('code_challenge').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('oauth_authorization_codes_code_hash_uidx').on(table.codeHash),
    index('oauth_authorization_codes_user_id_idx').on(table.userId),
  ],
);

/** Per-user consent for ChatGPT/Codex. Not an api_clients bearer token. */
export const oauthGrants = pgTable(
  'oauth_grants',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    clientId: text('client_id').notNull(),
    resource: text('resource').notNull(),
    scopes: jsonb('scopes').$type<string[]>().notNull(),
    allowedWorkspaceIds: jsonb('allowed_workspace_ids').$type<string[]>().notNull(),
    allowedProjectIds: jsonb('allowed_project_ids').$type<string[]>().notNull(),
    status: text('status').notNull().default('active'),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true, mode: 'date' }),
    refreshExpiresAt: timestamp('refresh_expires_at', { withTimezone: true, mode: 'date' }),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('oauth_grants_user_id_idx').on(table.userId),
    index('oauth_grants_organization_id_idx').on(table.organizationId),
    index('oauth_grants_status_idx').on(table.status),
  ],
);

export const oauthRefreshTokens = pgTable(
  'oauth_refresh_tokens',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    grantId: uuid('grant_id')
      .notNull()
      .references(() => oauthGrants.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    tokenPrefix: text('token_prefix').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    rotatedFromId: uuid('rotated_from_id'),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('oauth_refresh_tokens_token_hash_uidx').on(table.tokenHash),
    index('oauth_refresh_tokens_grant_id_idx').on(table.grantId),
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
    createdBy: uuid('created_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('tags_organization_slug_uidx').on(table.organizationId, table.slug),
    index('tags_organization_id_idx').on(table.organizationId),
    index('tags_created_by_idx').on(table.createdBy),
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
    /** Document human-key type code (ADR-023); set when project-scoped. */
    documentKeyType: text('document_key_type'),
    documentNumber: integer('document_number'),
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
    uniqueIndex('knowledge_records_project_doc_key_uidx')
      .on(table.projectId, table.documentKeyType, table.documentNumber)
      .where(
        sql`${table.projectId} IS NOT NULL AND ${table.documentKeyType} IS NOT NULL AND ${table.documentNumber} IS NOT NULL`,
      ),
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
    /**
     * Transitional byte folder. Set when a row moved workspace before its object
     * was copied. Null means the bytes are at workspace_id/id. The relocator
     * clears this after a verified copy. No foreign key: the original workspace
     * may be purged while a failed relocate still needs the old path.
     */
    storageWorkspaceId: uuid('storage_workspace_id'),
    /** Byte file id. Null means this row's id. Paired with storage_workspace_id. */
    storageMediaId: uuid('storage_media_id'),
  },
  (table) => [
    index('workspace_media_workspace_id_idx').on(table.workspaceId),
    index('workspace_media_record_id_idx').on(table.knowledgeRecordId),
    index('workspace_media_created_at_idx').on(table.createdAt),
    index('workspace_media_storage_idx').on(
      table.storageWorkspaceId,
      table.storageMediaId,
    ),
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
    /** First saved finish. Later target moves are measured against this. */
    baselineFinishDate: date('baseline_finish_date', { mode: 'string' }),
    sortOrder: integer('sort_order').notNull().default(0),
    issueKeyType: text('issue_key_type'),
    issueNumber: integer('issue_number'),
    createdBy: uuid('created_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'date' }),
    ...timestamps,
  },
  (table) => [
    index('project_milestones_project_id_idx').on(table.projectId),
    index('project_milestones_created_by_idx').on(table.createdBy),
    index('project_milestones_project_status_idx').on(table.projectId, table.status),
    uniqueIndex('project_milestones_project_key_uidx').on(
      table.projectId,
      table.issueKeyType,
      table.issueNumber,
    ),
  ],
);

/**
 * Items whose completion rolls up to a milestone.
 * Epics, stories, tasks, and bugs (tasks with item_type bug).
 * entity_id is polymorphic; the app checks project ownership.
 */
export const projectMilestoneItemLinks = pgTable(
  'project_milestone_item_links',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    milestoneId: uuid('milestone_id')
      .notNull()
      .references(() => projectMilestones.id, { onDelete: 'cascade' }),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    createdBy: uuid('created_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('project_milestone_item_links_uidx').on(
      table.milestoneId,
      table.entityType,
      table.entityId,
    ),
    index('project_milestone_item_links_entity_idx').on(
      table.entityType,
      table.entityId,
    ),
    index('project_milestone_item_links_created_by_idx').on(table.createdBy),
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
    /** First saved finish. Later end moves are measured against this. */
    baselineFinishDate: date('baseline_finish_date', { mode: 'string' }),
    sortOrder: integer('sort_order').notNull().default(0),
    issueKeyType: text('issue_key_type'),
    issueNumber: integer('issue_number'),
    createdBy: uuid('created_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'date' }),
    ...timestamps,
  },
  (table) => [
    index('project_epics_project_id_idx').on(table.projectId),
    index('project_epics_created_by_idx').on(table.createdBy),
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
    /** First saved finish. Later end moves are measured against this. */
    baselineFinishDate: date('baseline_finish_date', { mode: 'string' }),
    sortOrder: integer('sort_order').notNull().default(0),
    issueKeyType: text('issue_key_type'),
    issueNumber: integer('issue_number'),
    createdBy: uuid('created_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'date' }),
    ...timestamps,
  },
  (table) => [
    index('project_user_stories_project_id_idx').on(table.projectId),
    index('project_user_stories_created_by_idx').on(table.createdBy),
    index('project_user_stories_epic_id_idx').on(table.epicId),
    index('project_user_stories_project_status_idx').on(table.projectId, table.status),
    uniqueIndex('project_user_stories_project_key_uidx').on(
      table.projectId,
      table.issueKeyType,
      table.issueNumber,
    ),
  ],
);

/** Scrum sprints (NF-020 / ADR-022) — orthogonal to milestones. */
export const projectSprints = pgTable(
  'project_sprints',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    goal: text('goal'),
    status: text('status').notNull().default('planned'),
    startDate: date('start_date', { mode: 'string' }),
    endDate: date('end_date', { mode: 'string' }),
    capacityPoints: integer('capacity_points'),
    /**
     * Points and burndown frozen when the sprint is completed or cancelled.
     * Moving unfinished tasks off the sprint must not rewrite this history.
     */
    closureSnapshot: jsonb('closure_snapshot').$type<{
      committedPoints: number;
      donePoints: number;
      startDate: string | null;
      endDate: string | null;
      points: Array<{
        date: string;
        idealRemaining: number;
        remaining: number;
      }>;
    } | null>(),
    sortOrder: integer('sort_order').notNull().default(0),
    issueKeyType: text('issue_key_type'),
    issueNumber: integer('issue_number'),
    createdBy: uuid('created_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'date' }),
    ...timestamps,
  },
  (table) => [
    index('project_sprints_project_id_idx').on(table.projectId),
    index('project_sprints_created_by_idx').on(table.createdBy),
    index('project_sprints_project_status_idx').on(table.projectId, table.status),
    uniqueIndex('project_sprints_project_key_uidx').on(
      table.projectId,
      table.issueKeyType,
      table.issueNumber,
    ),
    uniqueIndex('project_sprints_one_active_uidx')
      .on(table.projectId)
      .where(sql`${table.status} = 'active' AND ${table.archivedAt} IS NULL`),
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
    sprintId: uuid('sprint_id').references(() => projectSprints.id, {
      onDelete: 'set null',
    }),
    title: text('title').notNull(),
    description: text('description'),
    /** task (default) or bug. Set at create; human key letter follows it (T or B). */
    itemType: text('item_type').notNull().default('task'),
    /** Bug impact. Null on tasks. Defaults to medium when a bug is created. */
    severity: text('severity'),
    foundIn: text('found_in'),
    foundInNote: text('found_in_note'),
    stepsToReproduce: text('steps_to_reproduce'),
    expectedBehavior: text('expected_behavior'),
    actualBehavior: text('actual_behavior'),
    resolution: text('resolution'),
    regression: boolean('regression').notNull().default(false),
    affectedSystemId: uuid('affected_system_id').references(() => systems.id, {
      onDelete: 'set null',
    }),
    duplicateOfTaskId: uuid('duplicate_of_task_id').references(
      (): AnyPgColumn => projectTasks.id,
      { onDelete: 'set null' },
    ),
    status: text('status').notNull().default('todo'),
    startDate: date('start_date', { mode: 'string' }),
    dueDate: date('due_date', { mode: 'string' }),
    /** First saved finish. Later due-date moves are measured against this. */
    baselineFinishDate: date('baseline_finish_date', { mode: 'string' }),
    /** Calendar days. Due date is start date plus this many days when set. */
    durationDays: integer('duration_days'),
    forecastHours: numeric('forecast_hours', { precision: 10, scale: 2, mode: 'number' }),
    actualHours: numeric('actual_hours', { precision: 10, scale: 2, mode: 'number' }),
    storyPoints: integer('story_points'),
    /** 0, 25, 50, 75, or 100 while open. 100 when done. Null when cancelled. */
    completionPercent: integer('completion_percent'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdBy: uuid('created_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    /** Ball-in-court owner; distinct from standing RACI. */
    currentOwnerUserId: uuid('current_owner_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    /** Tokens consumed by an AI assistant on this task (actuals). Sum of the breakdown when set. */
    tokensUsed: integer('tokens_used'),
    tokensInput: integer('tokens_input'),
    tokensOutput: integer('tokens_output'),
    tokensCache: integer('tokens_cache'),
    /** Input tokens that wrote the cache. Null when the export has no cache-write column. */
    tokensCacheWrite: integer('tokens_cache_write'),
    /** Model label for the latest usage report, e.g. grok-4.7. */
    aiModelId: text('ai_model_id'),
    /** Pricing tier label, e.g. standard or fast. */
    aiPricingTier: text('ai_pricing_tier'),
    /** When the usage occurred. Audit only; does not move the flat-fee window. */
    usageOccurredAt: timestamp('usage_occurred_at', {
      withTimezone: true,
      mode: 'date',
    }),
    /** YYYY-MM audit tag. Does not change flat-fee accrual. */
    billingPeriod: text('billing_period'),
    aiSystemId: uuid('ai_system_id').references(() => systems.id, {
      onDelete: 'set null',
    }),
    /**
     * Mirror of the first sorted cloud-agent link. Not unique.
     * `projectTaskCloudAgentLinks` is the source of truth.
     */
    cloudAgentId: text('cloud_agent_id'),
    issueKeyType: text('issue_key_type'),
    issueNumber: integer('issue_number'),
    archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'date' }),
    ...timestamps,
  },
  (table) => [
    index('project_tasks_project_id_idx').on(table.projectId),
    index('project_tasks_milestone_id_idx').on(table.milestoneId),
    index('project_tasks_user_story_id_idx').on(table.userStoryId),
    index('project_tasks_sprint_id_idx').on(table.sprintId),
    index('project_tasks_project_user_story_idx').on(table.projectId, table.userStoryId),
    index('project_tasks_current_owner_user_id_idx').on(table.currentOwnerUserId),
    index('project_tasks_ai_system_id_idx').on(table.aiSystemId),
    index('project_tasks_project_status_idx').on(table.projectId, table.status),
    index('project_tasks_project_item_type_idx').on(table.projectId, table.itemType),
    index('project_tasks_affected_system_id_idx').on(table.affectedSystemId),
    index('project_tasks_duplicate_of_task_id_idx').on(table.duplicateOfTaskId),
    uniqueIndex('project_tasks_project_key_uidx').on(
      table.projectId,
      table.issueKeyType,
      table.issueNumber,
    ),
    index('project_tasks_cloud_agent_id_idx').on(table.cloudAgentId),
  ],
);

/**
 * Many tasks may share one Cursor cloud agent. A task may also link several.
 * Unique on the pair, not on the agent id.
 */
export const projectTaskCloudAgentLinks = pgTable(
  'project_task_cloud_agent_links',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => projectTasks.id, { onDelete: 'cascade' }),
    cloudAgentId: text('cloud_agent_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('project_task_cloud_agent_links_pair_uidx').on(
      table.taskId,
      table.cloudAgentId,
    ),
    index('project_task_cloud_agent_links_agent_idx').on(table.cloudAgentId),
  ],
);

export type AiUsageImportErrorJson = {
  rowNumber: number;
  message: string;
};

export type AiUsageImportSummaryJson = {
  dateFrom: string | null;
  dateTo: string | null;
  totals: {
    tokensInput: number;
    tokensCacheWrite: number;
    tokensCache: number;
    tokensOutput: number;
    tokensTotal: number;
  };
  models: Array<{ model: string; rowCount: number; tokensTotal: number }>;
  linkedCount: number;
  unassignedCount: number;
};

/**
 * One usage import. `source` is `csv` today. `cursor_admin_api` is reserved
 * so a later source can share the event table.
 */
export const aiUsageImports = pgTable(
  'ai_usage_imports',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    source: text('source').notNull(),
    fileName: text('file_name'),
    createdBy: uuid('created_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    rowCountTotal: integer('row_count_total').notNull().default(0),
    rowCountInserted: integer('row_count_inserted').notNull().default(0),
    rowCountDuplicate: integer('row_count_duplicate').notNull().default(0),
    rowCountLinked: integer('row_count_linked').notNull().default(0),
    rowCountErrors: integer('row_count_errors').notNull().default(0),
    /** Rows with every token column empty. Skipped, not stored, not an error. */
    rowCountNoTokens: integer('row_count_no_tokens').notNull().default(0),
    errorsJson: jsonb('errors_json')
      .$type<AiUsageImportErrorJson[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** Preview snapshot: dates, token totals, models, linked vs unassigned. */
    summaryJson: jsonb('summary_json').$type<AiUsageImportSummaryJson | null>(),
    ...timestamps,
  },
  (table) => [
    index('ai_usage_imports_workspace_created_idx').on(
      table.workspaceId,
      table.createdAt,
    ),
  ],
);

/**
 * Normalized usage from any source. The unique hash stops a re-import of
 * the same or an overlapping file from inserting the row twice.
 */
export const aiUsageEvents = pgTable(
  'ai_usage_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    importId: uuid('import_id').references(() => aiUsageImports.id, {
      onDelete: 'set null',
    }),
    source: text('source').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'date' })
      .notNull(),
    occurredAtKey: text('occurred_at_key').notNull(),
    cloudAgentId: text('cloud_agent_id'),
    automationId: text('automation_id'),
    kind: text('kind'),
    model: text('model').notNull(),
    maxMode: boolean('max_mode'),
    tokensInput: integer('tokens_input').notNull(),
    tokensCacheWrite: integer('tokens_cache_write').notNull(),
    tokensCache: integer('tokens_cache').notNull(),
    tokensOutput: integer('tokens_output').notNull(),
    tokensTotal: integer('tokens_total').notNull(),
    cost: text('cost'),
    rowHash: text('row_hash').notNull(),
    projectTaskId: uuid('project_task_id').references(() => projectTasks.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('ai_usage_events_workspace_hash_uidx').on(
      table.workspaceId,
      table.rowHash,
    ),
    index('ai_usage_events_cloud_agent_idx').on(
      table.workspaceId,
      table.cloudAgentId,
    ),
    index('ai_usage_events_task_idx').on(table.projectTaskId),
    index('ai_usage_events_import_idx').on(table.importId),
  ],
);

/**
 * Per-model theoretical API prices. workspace_id null is the platform list.
 * Amounts are an ISO currency per 1,000,000 tokens.
 * model may be an exact id or a glob (`*claude*sonnet*`).
 * A workspace row with the same pattern overrides the global row.
 */
export const aiModelPrices = pgTable(
  'ai_model_prices',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').references(() => workspaces.id, {
      onDelete: 'cascade',
    }),
    model: text('model').notNull(),
    inputPerMillion: numeric('input_per_million', {
      precision: 14,
      scale: 6,
      mode: 'number',
    }).notNull(),
    cacheWritePerMillion: numeric('cache_write_per_million', {
      precision: 14,
      scale: 6,
      mode: 'number',
    }).notNull(),
    cacheReadPerMillion: numeric('cache_read_per_million', {
      precision: 14,
      scale: 6,
      mode: 'number',
    }).notNull(),
    outputPerMillion: numeric('output_per_million', {
      precision: 14,
      scale: 6,
      mode: 'number',
    }).notNull(),
    blendedPerMillion: numeric('blended_per_million', {
      precision: 14,
      scale: 6,
      mode: 'number',
    }).notNull(),
    currency: text('currency').notNull(),
    effectiveFrom: date('effective_from', { mode: 'string' }).notNull(),
    sourceNote: text('source_note'),
    retiredAt: timestamp('retired_at', { withTimezone: true, mode: 'date' }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('ai_model_prices_scope_uidx').on(
      sql`coalesce(${table.workspaceId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      table.model,
      table.effectiveFrom,
    ),
    index('ai_model_prices_workspace_idx').on(table.workspaceId),
  ],
);

/**
 * Directed predecessor link between two delivery items in one project.
 * Successors are the inverse of these rows; they are not stored separately.
 */
export const projectDeliveryDependencies = pgTable(
  'project_delivery_dependencies',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    predecessorType: text('predecessor_type').notNull(),
    predecessorId: uuid('predecessor_id').notNull(),
    successorType: text('successor_type').notNull(),
    successorId: uuid('successor_id').notNull(),
    /** FS, SS, FF, or SF. */
    linkType: text('link_type').notNull(),
    /** Calendar days added to the relationship. Negative is a lead. */
    lagDays: integer('lag_days').notNull().default(0),
    createdBy: uuid('created_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('project_delivery_dependencies_pair_uidx').on(
      table.predecessorType,
      table.predecessorId,
      table.successorType,
      table.successorId,
    ),
    index('project_delivery_dependencies_project_idx').on(table.projectId),
    index('project_delivery_dependencies_successor_idx').on(
      table.successorType,
      table.successorId,
    ),
    index('project_delivery_dependencies_predecessor_idx').on(
      table.predecessorType,
      table.predecessorId,
    ),
    index('project_delivery_dependencies_created_by_idx').on(table.createdBy),
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
    createdBy: uuid('created_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('project_task_raci_task_user_uidx').on(table.taskId, table.userId),
    index('project_task_raci_created_by_idx').on(table.createdBy),
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
export type StakeholderCompetencyRow = {
  name: string;
  skillId: string | null;
};

export const projectStakeholders = pgTable(
  'project_stakeholders',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    /** Null = open job role (not yet filled by a workspace member). */
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    projectRole: text('project_role').notNull().default('stakeholder'),
    jobTitle: text('job_title'),
    /** Role / vacancy description (advertised staffing needs). */
    roleDescription: text('role_description'),
    /**
     * Competency tags. `skillId` reserved for a future shared skill catalog.
     */
    competencies: jsonb('competencies')
      .$type<StakeholderCompetencyRow[]>()
      .notNull()
      .default([]),
    notes: text('notes'),
    reportsToUserId: uuid('reports_to_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    /** Hourly rate in the project's currency. */
    hourlyRate: numeric('hourly_rate', { precision: 12, scale: 2, mode: 'number' }),
    /** employee | contractor */
    engagementType: text('engagement_type'),
    assignmentStart: date('assignment_start', { mode: 'string' }),
    assignmentEnd: date('assignment_end', { mode: 'string' }),
    allocatedDailyHours: numeric('allocated_daily_hours', {
      precision: 6,
      scale: 2,
      mode: 'number',
    }),
    contractRef: text('contract_ref'),
    contractedBudget: numeric('contracted_budget', { precision: 14, scale: 2, mode: 'number' }),
    contractStart: date('contract_start', { mode: 'string' }),
    contractEnd: date('contract_end', { mode: 'string' }),
    sortOrder: integer('sort_order').notNull().default(0),
    createdBy: uuid('created_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('project_stakeholders_project_user_uidx')
      .on(table.projectId, table.userId)
      .where(sql`${table.userId} IS NOT NULL`),
    index('project_stakeholders_project_id_idx').on(table.projectId),
    index('project_stakeholders_reports_to_idx').on(table.reportsToUserId),
    index('project_stakeholders_created_by_idx').on(table.createdBy),
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
    /** Optional likelihood. Independent of severity. Null on existing rows. */
    probability: text('probability'),
    /** Optional consequence. Independent of severity. Null on existing rows. */
    impact: text('impact'),
    ownerUserId: uuid('owner_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    dueDate: date('due_date', { mode: 'string' }),
    /** auto_schedule_slip when the hub raised this risk. Null for manual rows. */
    source: text('source'),
    sourceEntityType: text('source_entity_type'),
    sourceEntityId: uuid('source_entity_id'),
    /** True when an auto slip has cleared and a person should close the risk. */
    closureSuggested: boolean('closure_suggested').notNull().default(false),
    slipWorkingDays: integer('slip_working_days'),
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
    createdBy: uuid('created_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'date' }),
    ...timestamps,
  },
  (table) => [
    index('project_raid_items_project_id_idx').on(table.projectId),
    index('project_raid_items_created_by_idx').on(table.createdBy),
    index('project_raid_items_project_kind_idx').on(table.projectId, table.kind),
    index('project_raid_items_project_status_idx').on(table.projectId, table.status),
    uniqueIndex('project_raid_items_project_key_uidx').on(
      table.projectId,
      table.issueKeyType,
      table.issueNumber,
    ),
    uniqueIndex('project_raid_items_one_open_auto_slip_uidx')
      .on(table.projectId, table.sourceEntityType, table.sourceEntityId)
      .where(sql`${table.source} = 'auto_schedule_slip'
        AND ${table.archivedAt} IS NULL
        AND ${table.status} IN ('open', 'mitigating', 'accepted')`),
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
    createdBy: uuid('created_by').references(() => users.id, {
      onDelete: 'set null',
    }),
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
    index('project_raid_task_links_created_by_idx').on(table.createdBy),
  ],
);

/** Links a RAID item to an epic, user story, or milestone in the same project. Tasks stay on project_raid_task_links. */
export const projectRaidDeliveryLinks = pgTable(
  'project_raid_delivery_links',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    raidItemId: uuid('raid_item_id')
      .notNull()
      .references(() => projectRaidItems.id, { onDelete: 'cascade' }),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    createdBy: uuid('created_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('project_raid_delivery_links_uidx').on(
      table.raidItemId,
      table.entityType,
      table.entityId,
    ),
    index('project_raid_delivery_links_entity_idx').on(
      table.entityType,
      table.entityId,
    ),
    index('project_raid_delivery_links_created_by_idx').on(table.createdBy),
  ],
);

/** Links a RAID item to knowledge records in the same project. */
export const projectRaidRecordLinks = pgTable(
  'project_raid_record_links',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    raidItemId: uuid('raid_item_id')
      .notNull()
      .references(() => projectRaidItems.id, { onDelete: 'cascade' }),
    knowledgeRecordId: uuid('knowledge_record_id')
      .notNull()
      .references(() => knowledgeRecords.id, { onDelete: 'cascade' }),
    createdBy: uuid('created_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('project_raid_record_links_raid_record_uidx').on(
      table.raidItemId,
      table.knowledgeRecordId,
    ),
    index('project_raid_record_links_record_id_idx').on(table.knowledgeRecordId),
    index('project_raid_record_links_created_by_idx').on(table.createdBy),
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
    createdBy: uuid('created_by').references(() => users.id, {
      onDelete: 'set null',
    }),
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
    index('knowledge_record_delivery_links_created_by_idx').on(table.createdBy),
  ],
);

/**
 * Typed record↔record edges (ADR-025). Symmetric types are stored once
 * with from_knowledge_record_id < to_knowledge_record_id.
 */
export const knowledgeRecordRelations = pgTable(
  'knowledge_record_relations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    fromKnowledgeRecordId: uuid('from_knowledge_record_id')
      .notNull()
      .references(() => knowledgeRecords.id, { onDelete: 'cascade' }),
    toKnowledgeRecordId: uuid('to_knowledge_record_id')
      .notNull()
      .references(() => knowledgeRecords.id, { onDelete: 'cascade' }),
    relationType: text('relation_type').notNull(),
    createdBy: uuid('created_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('knowledge_record_relations_uidx').on(
      table.fromKnowledgeRecordId,
      table.toKnowledgeRecordId,
      table.relationType,
    ),
    index('knowledge_record_relations_from_idx').on(table.fromKnowledgeRecordId),
    index('knowledge_record_relations_to_idx').on(table.toKnowledgeRecordId),
    index('knowledge_record_relations_workspace_idx').on(table.workspaceId),
    index('knowledge_record_relations_created_by_idx').on(table.createdBy),
  ],
);

/**
 * Links a delivery, RAID, or change item to workspace media or an external URL.
 * Media rows are soft-archived, so the FK does not cascade and a deleted file
 * can still render as a placeholder.
 */
export const projectItemMediaLinks = pgTable(
  'project_item_media_links',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    kind: text('kind').notNull(),
    workspaceMediaId: uuid('workspace_media_id').references(() => workspaceMedia.id, {
      onDelete: 'restrict',
    }),
    url: text('url'),
    title: text('title'),
    description: text('description'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdBy: uuid('created_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('project_item_media_links_media_uidx')
      .on(table.entityType, table.entityId, table.workspaceMediaId)
      .where(sql`${table.workspaceMediaId} IS NOT NULL`),
    uniqueIndex('project_item_media_links_url_uidx')
      .on(table.entityType, table.entityId, table.url)
      .where(sql`${table.url} IS NOT NULL`),
    index('project_item_media_links_entity_idx').on(table.entityType, table.entityId),
    index('project_item_media_links_media_idx').on(table.workspaceMediaId),
    index('project_item_media_links_project_idx').on(table.projectId),
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
    createdBy: uuid('created_by').references(() => users.id, {
      onDelete: 'set null',
    }),
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
    index('project_initial_stakeholders_created_by_idx').on(table.createdBy),
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
    /** Set when an approved schedule change was written onto the project baseline. */
    baselineAppliedAt: timestamp('baseline_applied_at', {
      withTimezone: true,
      mode: 'date',
    }),
    knowledgeRecordId: uuid('knowledge_record_id').references(
      () => knowledgeRecords.id,
      { onDelete: 'set null' },
    ),
    sortOrder: integer('sort_order').notNull().default(0),
    issueKeyType: text('issue_key_type'),
    issueNumber: integer('issue_number'),
    createdBy: uuid('created_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'date' }),
    ...timestamps,
  },
  (table) => [
    index('project_change_items_project_id_idx').on(table.projectId),
    index('project_change_items_created_by_idx').on(table.createdBy),
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
    createdBy: uuid('created_by').references(() => users.id, {
      onDelete: 'set null',
    }),
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
    index('project_change_delivery_links_created_by_idx').on(table.createdBy),
  ],
);

/** Many documents linked to one change item. The legacy knowledge_record_id column stays the first link. */
export const projectChangeRecordLinks = pgTable(
  'project_change_record_links',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    changeId: uuid('change_id')
      .notNull()
      .references(() => projectChangeItems.id, { onDelete: 'cascade' }),
    knowledgeRecordId: uuid('knowledge_record_id')
      .notNull()
      .references(() => knowledgeRecords.id, { onDelete: 'cascade' }),
    createdBy: uuid('created_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('project_change_record_links_uidx').on(
      table.changeId,
      table.knowledgeRecordId,
    ),
    index('project_change_record_links_record_id_idx').on(table.knowledgeRecordId),
    index('project_change_record_links_created_by_idx').on(table.createdBy),
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
    bac: numeric('bac', { precision: 14, scale: 2, mode: 'number' }).notNull(),
    pv: numeric('pv', { precision: 14, scale: 2, mode: 'number' }),
    ev: numeric('ev', { precision: 14, scale: 2, mode: 'number' }).notNull(),
    ac: numeric('ac', { precision: 14, scale: 2, mode: 'number' }).notNull(),
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

/**
 * Singleton row written by the worker after each audit retention purge.
 * Admin → Monitoring reads it. Settings live in platform_settings.
 */
export const auditRetentionState = pgTable('audit_retention_state', {
  id: text('id').primaryKey().default('default'),
  lastPurgedAt: timestamp('last_purged_at', { withTimezone: true, mode: 'date' }),
  rowsPurged: integer('rows_purged').notNull().default(0),
  retentionDays: integer('retention_days'),
  cutoff: timestamp('cutoff', { withTimezone: true, mode: 'date' }),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
});
