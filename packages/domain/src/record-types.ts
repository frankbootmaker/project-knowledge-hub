import { z } from 'zod';

/**
 * Canonical knowledge record types. Stored as validated strings in Postgres;
 * extend here (and in RECORD_TYPE_CATALOG) when adding ledger / ops types.
 */
export const RECORD_TYPES = [
  'overview',
  'architecture',
  'deployment-guide',
  'installation-guide',
  'configuration',
  'configuration-snapshot',
  'runbook',
  'troubleshooting',
  'incident-resolution',
  'migration-guide',
  'decision',
  'project-charter',
  'meeting-minutes',
  'lessons-learned',
  'command-reference',
  'inventory',
  'status',
  'management-summary',
  'progress-summary',
  'roadmap',
  'recovery-guide',
  'backup-guide',
  'security-note',
  'integration-guide',
  'conversation-summary',
  'research-note',
  'proposal',
  'business-idea',
  'vision',
  'plan',
  'initiative',
  'invoice',
  'note',
  'other',
  'sprint_retrospective',
  'sprint_review',
] as const;

export type RecordType = (typeof RECORD_TYPES)[number];

export const recordTypeSchema = z.enum(RECORD_TYPES);

export type RecordTypeCategory =
  'foundation' | 'delivery' | 'operations' | 'planning' | 'reflection' | 'other';

export type RecordTypeDefinition = {
  value: RecordType;
  category: RecordTypeCategory;
  label: string;
  description: string;
  /** 2–4 letter code for project document human keys (ADR-023). */
  docKeyCode: string;
};

export const RECORD_TYPE_CATALOG: RecordTypeDefinition[] = [
  {
    value: 'overview',
    docKeyCode: 'OV',
    category: 'foundation',
    label: 'Overview',
    description: 'High-level description of a workspace, project, or system.',
  },
  {
    value: 'architecture',
    docKeyCode: 'ARCH',
    category: 'foundation',
    label: 'Architecture',
    description: 'Structure, components, boundaries, and design rationale.',
  },
  {
    value: 'deployment-guide',
    docKeyCode: 'DEP',
    category: 'delivery',
    label: 'Deployment guide',
    description: 'How to deploy or release the system or service.',
  },
  {
    value: 'installation-guide',
    docKeyCode: 'INST',
    category: 'delivery',
    label: 'Installation guide',
    description: 'How to install or bootstrap dependencies and runtimes.',
  },
  {
    value: 'configuration',
    docKeyCode: 'CFG',
    category: 'operations',
    label: 'Configuration',
    description: 'Living configuration documentation (hub-managed or mirrored).',
  },
  {
    value: 'configuration-snapshot',
    docKeyCode: 'CFGS',
    category: 'operations',
    label: 'Configuration snapshot',
    description: 'Point-in-time captured configuration for audit or recovery.',
  },
  {
    value: 'runbook',
    docKeyCode: 'RB',
    category: 'operations',
    label: 'Runbook',
    description: 'Operational procedures for routine or emergency tasks.',
  },
  {
    value: 'troubleshooting',
    docKeyCode: 'TS',
    category: 'operations',
    label: 'Troubleshooting',
    description: 'Diagnostic steps and common failure modes.',
  },
  {
    value: 'incident-resolution',
    docKeyCode: 'INC',
    category: 'operations',
    label: 'Incident resolution',
    description: 'Post-incident write-up of cause, impact, and remediation.',
  },
  {
    value: 'migration-guide',
    docKeyCode: 'MIG',
    category: 'delivery',
    label: 'Migration guide',
    description: 'Steps to migrate data, infra, or application versions.',
  },
  {
    value: 'decision',
    docKeyCode: 'DEC',
    category: 'delivery',
    label: 'Decision / decision-making',
    description:
      'Project or architecture decision record (ADR-style), including options considered and outcome.',
  },
  {
    value: 'project-charter',
    docKeyCode: 'CHR',
    category: 'planning',
    label: 'Project charter',
    description:
      'Authorizing project charter: purpose, scope, success criteria, and key stakeholders.',
  },
  {
    value: 'meeting-minutes',
    docKeyCode: 'MM',
    category: 'reflection',
    label: 'Meeting minutes',
    description:
      'Structured minutes from a project meeting: attendees, topics, actions, and decisions.',
  },
  {
    value: 'lessons-learned',
    docKeyCode: 'LL',
    category: 'reflection',
    label: 'Lessons learned',
    description: 'Retrospective insights after delivery or incidents.',
  },
  {
    value: 'command-reference',
    docKeyCode: 'CMD',
    category: 'operations',
    label: 'Command reference',
    description: 'CLI or API command cheat-sheet with examples.',
  },
  {
    value: 'inventory',
    docKeyCode: 'INV',
    category: 'foundation',
    label: 'Inventory',
    description: 'Catalogue of assets, hosts, services, or dependencies.',
  },
  {
    value: 'status',
    docKeyCode: 'STA',
    category: 'operations',
    label: 'Status',
    description: 'Current operational or delivery status snapshot.',
  },
  {
    value: 'management-summary',
    docKeyCode: 'MSUM',
    category: 'planning',
    label: 'Management summary',
    description: 'Executive-oriented summary of situation, outcomes, risks, and decisions needed.',
  },
  {
    value: 'progress-summary',
    docKeyCode: 'PSUM',
    category: 'planning',
    label: 'Progress summary',
    description: 'Period progress report: completed, in progress, blocked, and upcoming work.',
  },
  {
    value: 'roadmap',
    docKeyCode: 'RM',
    category: 'planning',
    label: 'Roadmap',
    description: 'Sequenced near-term delivery roadmap and milestones.',
  },
  {
    value: 'recovery-guide',
    docKeyCode: 'RCV',
    category: 'operations',
    label: 'Recovery guide',
    description: 'Disaster recovery and restore procedures.',
  },
  {
    value: 'backup-guide',
    docKeyCode: 'BAK',
    category: 'operations',
    label: 'Backup guide',
    description: 'Backup schedules, locations, and verification steps.',
  },
  {
    value: 'security-note',
    docKeyCode: 'SEC',
    category: 'operations',
    label: 'Security note',
    description: 'Security considerations, threats, or hardening notes.',
  },
  {
    value: 'integration-guide',
    docKeyCode: 'INTG',
    category: 'delivery',
    label: 'Integration guide',
    description: 'How this system integrates with others.',
  },
  {
    value: 'conversation-summary',
    docKeyCode: 'CONV',
    category: 'reflection',
    label: 'Conversation summary',
    description: 'Summarized chat or meeting outcome captured into the hub.',
  },
  {
    value: 'research-note',
    docKeyCode: 'RES',
    category: 'reflection',
    label: 'Research note',
    description: 'Investigation notes, spikes, or technology evaluation.',
  },
  {
    value: 'proposal',
    docKeyCode: 'PROP',
    category: 'planning',
    label: 'Proposal',
    description: 'Concrete change proposal awaiting decision.',
  },
  {
    value: 'business-idea',
    docKeyCode: 'IDEA',
    category: 'planning',
    label: 'Business idea',
    description: 'Early business or product idea; not yet a committed plan.',
  },
  {
    value: 'vision',
    docKeyCode: 'VIS',
    category: 'planning',
    label: 'Vision',
    description: 'Long-range north-star or future-state vision.',
  },
  {
    value: 'plan',
    docKeyCode: 'PLN',
    category: 'planning',
    label: 'Plan',
    description: 'Actionable plan with scope, approach, and intended outcomes.',
  },
  {
    value: 'initiative',
    docKeyCode: 'INIT',
    category: 'planning',
    label: 'Initiative',
    description: 'Multi-workstream initiative linking plans, delivery, and ops.',
  },
  {
    value: 'invoice',
    docKeyCode: 'INVC',
    category: 'operations',
    label: 'Invoice',
    description: 'Vendor or customer invoice: amounts, dates, parties, and payment references.',
  },
  {
    value: 'note',
    docKeyCode: 'NOTE',
    category: 'reflection',
    label: 'Note',
    description: 'General working note that does not fit a more specific type.',
  },
  {
    value: 'other',
    docKeyCode: 'OTH',
    category: 'other',
    label: 'Other',
    description: 'Fallback when no other type fits; prefer a specific type.',
  },
  {
    value: 'sprint_retrospective',
    docKeyCode: 'RET',
    category: 'reflection',
    label: 'Sprint retrospective',
    description: 'Sprint retrospective notes: what went well, improve, actions.',
  },
  {
    value: 'sprint_review',
    docKeyCode: 'REV',
    category: 'reflection',
    label: 'Sprint review',
    description: 'Sprint review notes: demoed work, feedback, and outcomes.',
  },
];

const RESERVED_DELIVERY_KEY_CODES = new Set([
  'E',
  'S',
  'M',
  'T',
  'C',
  'RR',
  'RI',
  'RA',
  'RD',
  'SP',
]);

const DOC_KEY_CODE_BY_TYPE = Object.fromEntries(
  RECORD_TYPE_CATALOG.map((entry) => [entry.value, entry.docKeyCode]),
) as Record<RecordType, string>;

export function getDocKeyCode(recordType: RecordType | string): string | null {
  if (!(recordType in DOC_KEY_CODE_BY_TYPE)) return null;
  return DOC_KEY_CODE_BY_TYPE[recordType as RecordType] ?? null;
}

export function isDocKeyCode(code: string): boolean {
  const upper = code.trim().toUpperCase();
  if (!/^[A-Z]{2,4}$/.test(upper)) return false;
  if (RESERVED_DELIVERY_KEY_CODES.has(upper)) return false;
  return Object.values(DOC_KEY_CODE_BY_TYPE).includes(upper);
}

export function listDocKeyCodes(): string[] {
  return [...new Set(Object.values(DOC_KEY_CODE_BY_TYPE))].sort();
}

export const LIFECYCLE_STATUSES = [
  'draft',
  'review_required',
  'verified',
  'current',
  'superseded',
  'deprecated',
  'archived',
] as const;

export type LifecycleStatus = (typeof LIFECYCLE_STATUSES)[number];
export const lifecycleStatusSchema = z.enum(LIFECYCLE_STATUSES);

export const SOURCE_OF_TRUTH_MODES = [
  'git_managed',
  'hub_managed',
  'imported_snapshot',
  'ai_generated_draft',
  'external_authoritative',
] as const;

export type SourceOfTruthMode = (typeof SOURCE_OF_TRUTH_MODES)[number];
export const sourceOfTruthModeSchema = z.enum(SOURCE_OF_TRUTH_MODES);

export const KNOWLEDGE_SOURCE_TYPES = [
  'manual',
  'git',
  'import',
  'conversation',
  'external',
] as const;

export type KnowledgeSourceType = (typeof KNOWLEDGE_SOURCE_TYPES)[number];
export const knowledgeSourceTypeSchema = z.enum(KNOWLEDGE_SOURCE_TYPES);

/** Explicit record slug on update. Must match auth SLUG_MAX_LENGTH. */
export const KNOWLEDGE_RECORD_SLUG_MAX = 96;

/**
 * Lowercase a-z, digits, and hyphens. No leading, trailing, or doubled hyphen.
 * Update validates this; it does not transliterate. Create still runs slugify.
 */
export const KNOWLEDGE_RECORD_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isKnowledgeRecordSlug(value: string): boolean {
  return (
    value.length >= 1 &&
    value.length <= KNOWLEDGE_RECORD_SLUG_MAX &&
    KNOWLEDGE_RECORD_SLUG_PATTERN.test(value)
  );
}

export type FieldRequirement = 'required' | 'optional' | 'ignored_on_mcp_write';

export type KnowledgeRecordFieldGuide = {
  name: string;
  requirement: FieldRequirement;
  description: string;
  appliesTo: Array<'create' | 'update' | 'human_api'>;
};

const SHARED_OPTIONAL_FIELDS: KnowledgeRecordFieldGuide[] = [
  {
    name: 'summary',
    requirement: 'optional',
    description: 'Short summary (≤1000 chars).',
    appliesTo: ['create', 'update'],
  },
  {
    name: 'projectId',
    requirement: 'optional',
    description: 'Optional project UUID to scope the record.',
    appliesTo: ['create', 'update'],
  },
  {
    name: 'systemId',
    requirement: 'optional',
    description: 'Optional system UUID to scope the record.',
    appliesTo: ['create', 'update'],
  },
  {
    name: 'tags',
    requirement: 'optional',
    description: 'Up to 30 tag strings.',
    appliesTo: ['create', 'update'],
  },
  {
    name: 'language',
    requirement: 'optional',
    description: 'BCP 47 / short language code (e.g. en, de, hu).',
    appliesTo: ['create', 'update'],
  },
  {
    name: 'translationGroupId',
    requirement: 'optional',
    description:
      'Optional UUID shared by translation siblings (same group id). Phase 1: set via API/MCP only.',
    appliesTo: ['create', 'update'],
  },
  {
    name: 'generatedByModel',
    requirement: 'optional',
    description: 'Model identifier for provenance (MCP conversation source).',
    appliesTo: ['create', 'update'],
  },
  {
    name: 'sourceTitle',
    requirement: 'optional',
    description: 'Human label for the originating conversation or document.',
    appliesTo: ['create', 'update'],
  },
];

const IGNORED_ON_MCP_WRITE_FIELDS: KnowledgeRecordFieldGuide[] = [
  {
    name: 'lifecycleStatus',
    requirement: 'ignored_on_mcp_write',
    description:
      'Human/session API promotes records. MCP create always persists draft. MCP update of a draft forces draft. A content change of a current or verified record does not demote it; MCP creates a new draft revision and leaves the approved record live.',
    appliesTo: ['human_api'],
  },
  {
    name: 'sourceOfTruthMode',
    requirement: 'ignored_on_mcp_write',
    description:
      'Human/session API may set this. MCP create forces ai_generated_draft. A content change of a current or verified record creates a new ai_generated_draft revision and leaves the approved record mode unchanged. In-place draft updates force ai_generated_draft.',
    appliesTo: ['human_api'],
  },
];

const CREATE_FIELDS: KnowledgeRecordFieldGuide[] = [
  {
    name: 'workspaceId',
    requirement: 'required',
    description: 'Target workspace UUID (must be on the API client allowlist for writes).',
    appliesTo: ['create'],
  },
  {
    name: 'title',
    requirement: 'required',
    description: 'Human-readable title (1–300 chars).',
    appliesTo: ['create'],
  },
  {
    name: 'recordType',
    requirement: 'required',
    description: 'One of the catalog recordType values from this metadata payload.',
    appliesTo: ['create'],
  },
  {
    name: 'contentMarkdown',
    requirement: 'required',
    description: 'Markdown body of the record.',
    appliesTo: ['create'],
  },
  {
    name: 'slug',
    requirement: 'optional',
    description: 'URL slug; auto-derived from title when omitted.',
    appliesTo: ['create'],
  },
  ...SHARED_OPTIONAL_FIELDS,
  ...IGNORED_ON_MCP_WRITE_FIELDS,
];

const UPDATE_FIELDS: KnowledgeRecordFieldGuide[] = [
  {
    name: 'recordId',
    requirement: 'required',
    description:
      'UUID (any case, urn:uuid:, or 32 hex) or project document key (e.g. HL1-VIS-2) of the record to update.',
    appliesTo: ['update'],
  },
  {
    name: 'changeMessage',
    requirement: 'required',
    description: 'Required on update: why the change was made.',
    appliesTo: ['update'],
  },
  {
    name: 'expectSha256',
    requirement: 'optional',
    description:
      'SHA-256 hex of the full body. A mismatch returns 409 conflict (errorType conflict) and writes nothing.',
    appliesTo: ['update'],
  },
  {
    name: 'expectedVersion',
    requirement: 'optional',
    description:
      'Expected currentVersionNumber. A mismatch returns 409 conflict (errorType conflict) and writes nothing.',
    appliesTo: ['update'],
  },
  {
    name: 'title',
    requirement: 'optional',
    description: 'Human-readable title (1–300 chars).',
    appliesTo: ['update'],
  },
  {
    name: 'slug',
    requirement: 'optional',
    description: 'URL slug (lowercase a-z, 0-9, hyphens). Title edits do not change it.',
    appliesTo: ['update'],
  },
  {
    name: 'recordType',
    requirement: 'optional',
    description: 'One of the catalog recordType values from this metadata payload.',
    appliesTo: ['update'],
  },
  {
    name: 'contentMarkdown',
    requirement: 'optional',
    description: 'Markdown body of the record.',
    appliesTo: ['update'],
  },
  ...SHARED_OPTIONAL_FIELDS,
  {
    name: 'archived',
    requirement: 'optional',
    description: 'Set true to soft-archive the record, or false to restore it.',
    appliesTo: ['update'],
  },
  ...IGNORED_ON_MCP_WRITE_FIELDS,
];

export type KnowledgeRecordMetadata = {
  version: number;
  recordTypes: RecordTypeDefinition[];
  lifecycleStatuses: Array<{ value: LifecycleStatus; description: string }>;
  sourceOfTruthModes: Array<{ value: SourceOfTruthMode; description: string }>;
  knowledgeSourceTypes: Array<{ value: KnowledgeSourceType; description: string }>;
  createKnowledgeRecord: {
    requiredFields: string[];
    optionalFields: string[];
    fields: KnowledgeRecordFieldGuide[];
    mcpWriteConstraints: {
      lifecycleStatus: 'draft';
      sourceOfTruthMode: 'ai_generated_draft';
      sourceType: 'conversation';
      sourceProvider: 'mcp';
      notes: string[];
    };
  };
  updateKnowledgeRecord: {
    requiredFields: string[];
    optionalFields: string[];
    fields: KnowledgeRecordFieldGuide[];
  };
  workspaceMedia: {
    tools: string[];
    contentTypes: string[];
    markdownPattern: string;
    /** begin → append → finalize; LLM clients must follow this, not upload_workspace_media. */
    preferredPath: string;
    workflow: string[];
  };
  guidance: string[];
};

/**
 * MCP tool input schemas for knowledge records.
 * Single source of truth - used by packages/mcp/src/server.ts.
 * These are intentionally more restrictive than the API schemas
 * (no lifecycleStatus, sourceOfTruthMode, metadata, source fields).
 */
export const createKnowledgeRecordInputSchema = z.object({
  workspaceId: z
    .string()
    .uuid()
    .describe('Target workspace UUID (must be on the API client allowlist for writes).'),
  title: z.string().min(1).max(300).describe('Human-readable title (1–300 chars).'),
  recordType: z
    .string()
    .min(1)
    .max(64)
    .describe('One of the catalog recordType values from list_record_metadata.'),
  contentMarkdown: z.string().max(500_000).describe('Markdown body of the record.'),
  summary: z.string().max(1000).optional().describe('Short summary (≤1000 chars).'),
  slug: z
    .string()
    .min(1)
    .max(96)
    .optional()
    .describe('URL slug; auto-derived from title when omitted.'),
  projectId: z.string().uuid().optional().describe('Optional project UUID to scope the record.'),
  systemId: z.string().uuid().optional().describe('Optional system UUID to scope the record.'),
  tags: z.array(z.string().min(1).max(64)).max(30).optional().describe('Up to 30 tag strings.'),
  language: z
    .string()
    .min(2)
    .max(16)
    .optional()
    .describe('BCP 47 / short language code (e.g. en, de, hu).'),
  translationGroupId: z
    .string()
    .uuid()
    .nullable()
    .optional()
    .describe('Optional UUID shared by translation siblings (same group id).'),
  generatedByModel: z
    .string()
    .max(160)
    .optional()
    .describe('Model identifier for provenance (MCP conversation source).'),
  sourceTitle: z
    .string()
    .max(300)
    .optional()
    .describe('Human label for the originating conversation or document.'),
});

const sha256Schema = z
  .string()
  .regex(/^[a-fA-F0-9]{64}$/)
  .describe(
    'Optional SHA-256 hex of the full body. A mismatch returns 409 conflict (errorType conflict) and writes nothing.',
  );

const expectedVersionSchema = z
  .number()
  .int()
  .min(1)
  .describe(
    'Optional current version number. A mismatch returns 409 conflict (errorType conflict) and writes nothing.',
  );

export const UPDATE_KNOWLEDGE_RECORD_TOOL_DESCRIPTION =
  'Update a knowledge record (requires knowledge:write and changeMessage). recordId is a UUID (any case, urn:uuid:, or 32 hex) or a project document key (e.g. HL1-VIS-2). Send the full markdown body; a value ending in the get_knowledge_record truncation marker is rejected. Page that read until nextOffset is null before rewriting. Optional slug renames the URL (lowercase a-z, 0-9, hyphens). Optional expectSha256 and expectedVersion are optimistic concurrency checks: a mismatch returns 409 conflict (errorType conflict) and writes nothing. A content change (title, summary, recordType, language, or contentMarkdown) of a current or verified record leaves that approved record live and creates a new draft revision (lifecycleStatus draft, sourceOfTruthMode ai_generated_draft) linked by supersedesRecordId. The response includes preservedLiveRecord and a warning. Drafts and other non-approved statuses update in place and stay draft. Metadata-only edits of an approved record stay on the live row and do not change lifecycleStatus. archived=true sets archivedAt and does not change lifecycleStatus. Git-managed records stay read-only except archival. For images: begin → append → finalize_workspace_media_upload.';

export const BEGIN_RECORD_CONTENT_UPLOAD_TOOL_DESCRIPTION =
  'Start a chunked markdown update (knowledge:write). Required field: recordId (UUID or document key). Optional changeMessage is stored on the session and used by finalize_record_content_upload when finalize omits it. Optional expectSha256 and expectedVersion fail fast with 409 conflict (errorType conflict) before a session is created. Then append_record_content with uploadId, chunk, and optional index — contentMarkdown is not valid on append. Finalize with uploadId. One version per session. Approved (current or verified) records stay live; finalize creates a new draft revision instead of demoting them. The session expires in 15 minutes. Returns uploadId, maxChunkChars (40000), contentSha256, contentLength, and currentVersionNumber.';

export const APPEND_RECORD_CONTENT_TOOL_DESCRIPTION =
  'Append one markdown chunk to a begin_record_content_upload session. Required fields: uploadId and chunk (1–40000 characters). Optional field: index (the next chunk index). contentMarkdown is not a valid field. The joined body cannot exceed 500000 characters. Requires knowledge:write.';

export const FINALIZE_RECORD_CONTENT_UPLOAD_TOOL_DESCRIPTION =
  'Join appended chunks and save them (knowledge:write). Required field: uploadId. changeMessage is required unless begin_record_content_upload stored one. Optional expectedLength must match the joined body. Optional expectSha256 and expectedVersion return 409 conflict (errorType conflict) and write nothing when the live record does not match. Also returns 409 when the body changed after begin. A content save of a current or verified record leaves that record live and creates a new draft revision. The session is deleted on success.';

export const LIST_KNOWLEDGE_RECORDS_TOOL_DESCRIPTION =
  'List knowledge records in a workspace (excludes archived). limit is 1–50 and defaults to 50. Pass cursor from nextCursor to read the next page; nextCursor is null and hasMore is false on the last page. total is the count after project allow-list filtering. Each record includes tags as a string array of tag names, the same shape as search_knowledge. Prefer language: "en" unless the user asks for another locale.';

export const updateKnowledgeRecordInputSchema = z.object({
  recordId: z
    .string()
    .min(1)
    .max(80)
    .describe(
      'UUID (any case, urn:uuid:, or 32 hex) or project document key (e.g. HL1-VIS-2) of the record to update.',
    ),
  changeMessage: z.string().min(1).max(500).describe('Required: why the change was made.'),
  expectSha256: sha256Schema.optional(),
  expectedVersion: expectedVersionSchema.optional(),
  title: z.string().min(1).max(300).optional().describe('Human-readable title (1–300 chars).'),
  slug: z
    .string()
    .min(1)
    .max(KNOWLEDGE_RECORD_SLUG_MAX)
    .optional()
    .describe('URL slug (lowercase a-z, 0-9, hyphens)'),
  summary: z.string().max(1000).nullable().optional().describe('Short summary (≤1000 chars).'),
  recordType: z
    .string()
    .min(1)
    .max(64)
    .optional()
    .describe('One of the catalog recordType values from list_record_metadata.'),
  contentMarkdown: z.string().max(500_000).optional().describe('Markdown body of the record.'),
  projectId: z
    .string()
    .uuid()
    .nullable()
    .optional()
    .describe('Optional project UUID to scope the record.'),
  systemId: z
    .string()
    .uuid()
    .nullable()
    .optional()
    .describe('Optional system UUID to scope the record.'),
  tags: z.array(z.string().min(1).max(64)).max(30).optional().describe('Up to 30 tag strings.'),
  language: z
    .string()
    .min(2)
    .max(16)
    .nullable()
    .optional()
    .describe('BCP 47 / short language code (e.g. en, de, hu).'),
  translationGroupId: z
    .string()
    .uuid()
    .nullable()
    .optional()
    .describe('Optional UUID shared by translation siblings (same group id).'),
  generatedByModel: z
    .string()
    .max(160)
    .optional()
    .describe('Model identifier for provenance (MCP conversation source).'),
  sourceTitle: z
    .string()
    .max(300)
    .optional()
    .describe('Human label for the originating conversation or document.'),
  archived: z
    .boolean()
    .optional()
    .describe('Set true to soft-archive the record, or false to restore it.'),
});

export const beginRecordContentUploadInputSchema = z.object({
  recordId: z
    .string()
    .min(1)
    .max(80)
    .describe(
      'Required knowledge record id: UUID (any case, urn:uuid:, or 32 hex) or document key.',
    ),
  changeMessage: z
    .string()
    .min(1)
    .max(500)
    .optional()
    .describe(
      'Optional reason stored on the upload session. finalize_record_content_upload uses it when changeMessage is omitted there.',
    ),
  expectSha256: sha256Schema.optional(),
  expectedVersion: expectedVersionSchema.optional(),
});

export const appendRecordContentInputSchema = z.object({
  uploadId: z
    .string()
    .uuid()
    .describe('Required upload session id from begin_record_content_upload.'),
  chunk: z
    .string()
    .min(1)
    .max(40_000)
    .describe('Required markdown chunk (1–40000 characters). Not contentMarkdown.'),
  index: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('Optional next chunk index. Omit to append in order.'),
});

export const finalizeRecordContentUploadInputSchema = z.object({
  uploadId: z
    .string()
    .uuid()
    .describe('Required upload session id from begin_record_content_upload.'),
  changeMessage: z
    .string()
    .min(1)
    .max(500)
    .optional()
    .describe(
      'Why this change was made. Required here unless begin_record_content_upload stored changeMessage.',
    ),
  expectedLength: z
    .number()
    .int()
    .min(0)
    .max(500_000)
    .optional()
    .describe('Optional joined character count. Rejected when it does not match.'),
  expectSha256: sha256Schema.optional(),
  expectedVersion: expectedVersionSchema.optional(),
});

export type CreateKnowledgeRecordInput = z.infer<typeof createKnowledgeRecordInputSchema>;
export type UpdateKnowledgeRecordInput = z.infer<typeof updateKnowledgeRecordInputSchema>;
export type BeginRecordContentUploadInput = z.infer<typeof beginRecordContentUploadInputSchema>;
export type AppendRecordContentInput = z.infer<typeof appendRecordContentInputSchema>;
export type FinalizeRecordContentUploadInput = z.infer<
  typeof finalizeRecordContentUploadInputSchema
>;

export function getRecordTypeDefinition(value: string): RecordTypeDefinition | undefined {
  return RECORD_TYPE_CATALOG.find((entry) => entry.value === value);
}

/** Discovery payload for MCP / OpenAPI clients before creating a record. */
export function buildKnowledgeRecordMetadata(): KnowledgeRecordMetadata {
  return {
    version: 2,
    recordTypes: RECORD_TYPE_CATALOG,
    lifecycleStatuses: [
      { value: 'draft', description: 'Editable working copy; default for MCP writes.' },
      {
        value: 'review_required',
        description: 'Awaiting human review before verification.',
      },
      { value: 'verified', description: 'Reviewed and accepted; not necessarily current.' },
      {
        value: 'current',
        description: 'Authoritative current record in its series (human mark-current).',
      },
      { value: 'superseded', description: 'Replaced by a newer current record.' },
      { value: 'deprecated', description: 'Still readable but should not be followed.' },
      { value: 'archived', description: 'Soft-archived; hidden from default lists.' },
    ],
    sourceOfTruthModes: [
      {
        value: 'git_managed',
        description: 'Canonical content lives in git; hub may mirror.',
      },
      {
        value: 'hub_managed',
        description: 'Hub is the primary editable source of truth.',
      },
      {
        value: 'imported_snapshot',
        description: 'Imported snapshot; may be stale relative to origin.',
      },
      {
        value: 'ai_generated_draft',
        description: 'AI/MCP draft; not authoritative until a human promotes it.',
      },
      {
        value: 'external_authoritative',
        description: 'External system remains authoritative.',
      },
    ],
    knowledgeSourceTypes: [
      { value: 'manual', description: 'Entered by a human in the hub UI/API.' },
      { value: 'git', description: 'Synced or imported from a git repository.' },
      { value: 'import', description: 'Bulk or file import.' },
      { value: 'conversation', description: 'Captured from an LLM/MCP conversation.' },
      { value: 'external', description: 'Pulled from an external system.' },
    ],
    createKnowledgeRecord: {
      requiredFields: ['workspaceId', 'title', 'recordType', 'contentMarkdown'],
      optionalFields: [
        'summary',
        'slug',
        'projectId',
        'systemId',
        'tags',
        'language',
        'translationGroupId',
        'generatedByModel',
        'sourceTitle',
      ],
      fields: CREATE_FIELDS.filter((field) => field.appliesTo.includes('create')),
      mcpWriteConstraints: {
        lifecycleStatus: 'draft',
        sourceOfTruthMode: 'ai_generated_draft',
        sourceType: 'conversation',
        sourceProvider: 'mcp',
        notes: [
          'Call list_record_metadata before create_knowledge_record to pick recordType.',
          'MCP cannot set lifecycleStatus or sourceOfTruthMode; humans approve/mark-current.',
          'Prefer specific planning types (business-idea, vision, plan, initiative) over other.',
          'Do not embed data:image/...;base64 URIs in Markdown — use begin → append → finalize_workspace_media_upload (never upload_workspace_media from LLM clients).',
          'Prefer language: "en" on search_knowledge / list_knowledge_records unless the user asks for another locale.',
          'REQUIRED for locales: call create_record_translation — NEVER create_knowledge_record for hu/de of an existing topic (that creates unlinked duplicates).',
          'If translateWithAi fails or AI is unconfigured, call create_record_translation again without translateWithAi and pass title/summary/contentMarkdown.',
          'Use list_record_translations to discover siblings. Update the sibling only — never overwrite the EN source with a translation.',
          'PDF/DOCX: import_document_knowledge_record (contentBase64 + filename + contentType, or mediaId). Returns draft id, humanKey, and contentMarkdown. Requires a workspace maintainer.',
        ],
      },
    },
    updateKnowledgeRecord: {
      requiredFields: ['recordId', 'changeMessage'],
      optionalFields: [
        'title',
        'slug',
        'summary',
        'recordType',
        'contentMarkdown',
        'projectId',
        'systemId',
        'tags',
        'language',
        'translationGroupId',
        'generatedByModel',
        'sourceTitle',
        'archived',
        'expectSha256',
        'expectedVersion',
      ],
      fields: UPDATE_FIELDS,
    },
    workspaceMedia: {
      tools: [
        'begin_workspace_media_upload',
        'append_workspace_media_upload',
        'finalize_workspace_media_upload',
        'upload_workspace_media',
        'list_workspace_media',
        'get_workspace_media',
        'delete_workspace_media',
      ],
      contentTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
      markdownPattern: '![alt text](/api/v1/media/{mediaId})',
      preferredPath:
        'begin_workspace_media_upload → append_workspace_media_upload → finalize_workspace_media_upload',
      workflow: [
        'DEFAULT for ChatGPT/OpenAPI and preferred for MCP: begin_workspace_media_upload → append_workspace_media_upload (~8000-char raw base64 chunks, max 12000) → finalize_workspace_media_upload.',
        'ChatGPT Actions OpenAPI omits upload_workspace_media (single-shot fails on large base64). Native MCP may still offer it for tiny files.',
        'finalize returns media.markdownSnippet — paste into contentMarkdown, or set knowledgeRecordId + insertIntoRecord=true on begin to append automatically into the .md body.',
        'Optional knowledgeRecordId links the asset to a record; get_knowledge_record returns linked media[].',
        'Optional targetEntityType + targetEntityId (UUID or human key) links the image to a delivery, RAID, or change item. That link requires pm:write. PDF and Office files are documents, not media.',
        'Read pixels with get_workspace_media (knowledge:read). It returns MCP image content, downscaled to at most 1568 px and about 1 MB, plus a short-lived signedUrl. SVG and non-images return metadata only.',
        'Requires knowledge:write, actingUserId, and a non-empty workspace allowlist.',
        'ChatGPT Custom GPT Actions: after hub upgrades, re-import GET /api/v1/llm/openapi.json so begin/append/finalize appear (and upload_workspace_media disappears if it was listed before).',
      ],
    },
    guidance: [
      'Use this hub as a ledger across planning, delivery, operations, and vision.',
      'Pick the most specific recordType; use note for unstructured working notes.',
      'Attach projectId/systemId when the record is scoped to catalogue entities.',
      'For charts/screenshots: begin_workspace_media_upload → append_workspace_media_upload → finalize_workspace_media_upload, then embed media.markdownSnippet — never upload_workspace_media or data: URIs.',
      'Locale siblings (hu/de/…): always create_record_translation; never a second create_knowledge_record.',
      'To import a PDF or DOCX, call import_document_knowledge_record. Do not paste the file into create_knowledge_record.',
      'update_knowledge_record and finalize_record_content_upload accept optional expectSha256 and expectedVersion. A mismatch is a 409 conflict (errorType conflict) and writes nothing.',
      'A content change of a current or verified record keeps that version live and creates a new draft revision linked by supersedesRecordId.',
      'list_knowledge_records pages with limit (max 50, default 50), cursor, nextCursor, and hasMore.',
    ],
  };
}
