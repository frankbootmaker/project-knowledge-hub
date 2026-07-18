import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  boolean,
  integer,
  uniqueIndex,
  index,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

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
    passwordHash: text('password_hash'),
    status: text('status').notNull().default('active'),
    isSystemAdmin: boolean('is_system_admin').notNull().default(false),
    ...timestamps,
  },
  (table) => [uniqueIndex('users_email_uidx').on(table.email)],
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
    metadataJson: jsonb('metadata_json').$type<Record<string, unknown>>(),
    archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'date' }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('projects_workspace_slug_uidx').on(table.workspaceId, table.slug),
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

export const apiClients = pgTable(
  'api_clients',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    tokenHash: text('token_hash').notNull(),
    tokenPrefix: text('token_prefix').notNull(),
    scopes: jsonb('scopes').$type<string[]>().notNull(),
    allowedWorkspaceIds: jsonb('allowed_workspace_ids').$type<string[]>().notNull(),
    allowedProjectIds: jsonb('allowed_project_ids').$type<string[]>().notNull(),
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
