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
  'lessons-learned',
  'command-reference',
  'inventory',
  'status',
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
  'note',
  'other',
] as const;

export type RecordType = (typeof RECORD_TYPES)[number];

export const recordTypeSchema = z.enum(RECORD_TYPES);

export type RecordTypeCategory =
  | 'foundation'
  | 'delivery'
  | 'operations'
  | 'planning'
  | 'reflection'
  | 'other';

export type RecordTypeDefinition = {
  value: RecordType;
  category: RecordTypeCategory;
  label: string;
  description: string;
};

export const RECORD_TYPE_CATALOG: RecordTypeDefinition[] = [
  {
    value: 'overview',
    category: 'foundation',
    label: 'Overview',
    description: 'High-level description of a workspace, project, or system.',
  },
  {
    value: 'architecture',
    category: 'foundation',
    label: 'Architecture',
    description: 'Structure, components, boundaries, and design rationale.',
  },
  {
    value: 'deployment-guide',
    category: 'delivery',
    label: 'Deployment guide',
    description: 'How to deploy or release the system or service.',
  },
  {
    value: 'installation-guide',
    category: 'delivery',
    label: 'Installation guide',
    description: 'How to install or bootstrap dependencies and runtimes.',
  },
  {
    value: 'configuration',
    category: 'operations',
    label: 'Configuration',
    description: 'Living configuration documentation (hub-managed or mirrored).',
  },
  {
    value: 'configuration-snapshot',
    category: 'operations',
    label: 'Configuration snapshot',
    description: 'Point-in-time captured configuration for audit or recovery.',
  },
  {
    value: 'runbook',
    category: 'operations',
    label: 'Runbook',
    description: 'Operational procedures for routine or emergency tasks.',
  },
  {
    value: 'troubleshooting',
    category: 'operations',
    label: 'Troubleshooting',
    description: 'Diagnostic steps and common failure modes.',
  },
  {
    value: 'incident-resolution',
    category: 'operations',
    label: 'Incident resolution',
    description: 'Post-incident write-up of cause, impact, and remediation.',
  },
  {
    value: 'migration-guide',
    category: 'delivery',
    label: 'Migration guide',
    description: 'Steps to migrate data, infra, or application versions.',
  },
  {
    value: 'decision',
    category: 'delivery',
    label: 'Decision',
    description: 'Architecture or product decision record (ADR-style).',
  },
  {
    value: 'lessons-learned',
    category: 'reflection',
    label: 'Lessons learned',
    description: 'Retrospective insights after delivery or incidents.',
  },
  {
    value: 'command-reference',
    category: 'operations',
    label: 'Command reference',
    description: 'CLI or API command cheat-sheet with examples.',
  },
  {
    value: 'inventory',
    category: 'foundation',
    label: 'Inventory',
    description: 'Catalogue of assets, hosts, services, or dependencies.',
  },
  {
    value: 'status',
    category: 'operations',
    label: 'Status',
    description: 'Current operational or delivery status snapshot.',
  },
  {
    value: 'roadmap',
    category: 'planning',
    label: 'Roadmap',
    description: 'Sequenced near-term delivery roadmap and milestones.',
  },
  {
    value: 'recovery-guide',
    category: 'operations',
    label: 'Recovery guide',
    description: 'Disaster recovery and restore procedures.',
  },
  {
    value: 'backup-guide',
    category: 'operations',
    label: 'Backup guide',
    description: 'Backup schedules, locations, and verification steps.',
  },
  {
    value: 'security-note',
    category: 'operations',
    label: 'Security note',
    description: 'Security considerations, threats, or hardening notes.',
  },
  {
    value: 'integration-guide',
    category: 'delivery',
    label: 'Integration guide',
    description: 'How this system integrates with others.',
  },
  {
    value: 'conversation-summary',
    category: 'reflection',
    label: 'Conversation summary',
    description: 'Summarized chat or meeting outcome captured into the hub.',
  },
  {
    value: 'research-note',
    category: 'reflection',
    label: 'Research note',
    description: 'Investigation notes, spikes, or technology evaluation.',
  },
  {
    value: 'proposal',
    category: 'planning',
    label: 'Proposal',
    description: 'Concrete change proposal awaiting decision.',
  },
  {
    value: 'business-idea',
    category: 'planning',
    label: 'Business idea',
    description: 'Early business or product idea; not yet a committed plan.',
  },
  {
    value: 'vision',
    category: 'planning',
    label: 'Vision',
    description: 'Long-range north-star or future-state vision.',
  },
  {
    value: 'plan',
    category: 'planning',
    label: 'Plan',
    description: 'Actionable plan with scope, approach, and intended outcomes.',
  },
  {
    value: 'initiative',
    category: 'planning',
    label: 'Initiative',
    description: 'Multi-workstream initiative linking plans, delivery, and ops.',
  },
  {
    value: 'note',
    category: 'reflection',
    label: 'Note',
    description: 'General working note that does not fit a more specific type.',
  },
  {
    value: 'other',
    category: 'other',
    label: 'Other',
    description: 'Fallback when no other type fits; prefer a specific type.',
  },
];

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

export type FieldRequirement = 'required' | 'optional' | 'ignored_on_mcp_write';

export type KnowledgeRecordFieldGuide = {
  name: string;
  requirement: FieldRequirement;
  description: string;
  appliesTo: Array<'create' | 'update' | 'human_api'>;
};

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
    appliesTo: ['create', 'update'],
  },
  {
    name: 'recordType',
    requirement: 'required',
    description: 'One of the catalog recordType values from this metadata payload.',
    appliesTo: ['create', 'update'],
  },
  {
    name: 'contentMarkdown',
    requirement: 'required',
    description: 'Markdown body of the record.',
    appliesTo: ['create', 'update'],
  },
  {
    name: 'summary',
    requirement: 'optional',
    description: 'Short summary (≤1000 chars).',
    appliesTo: ['create', 'update'],
  },
  {
    name: 'slug',
    requirement: 'optional',
    description: 'URL slug; auto-derived from title when omitted.',
    appliesTo: ['create'],
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
  {
    name: 'changeMessage',
    requirement: 'required',
    description: 'Required on update: why the change was made.',
    appliesTo: ['update'],
  },
  {
    name: 'lifecycleStatus',
    requirement: 'ignored_on_mcp_write',
    description:
      'Human/session API only for promotion. MCP create/update always persist draft.',
    appliesTo: ['human_api'],
  },
  {
    name: 'sourceOfTruthMode',
    requirement: 'ignored_on_mcp_write',
    description:
      'Human/session API may set this. MCP writes always force ai_generated_draft.',
    appliesTo: ['human_api'],
  },
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
  guidance: string[];
};

export function getRecordTypeDefinition(value: string): RecordTypeDefinition | undefined {
  return RECORD_TYPE_CATALOG.find((entry) => entry.value === value);
}

/** Discovery payload for MCP / OpenAPI clients before creating a record. */
export function buildKnowledgeRecordMetadata(): KnowledgeRecordMetadata {
  return {
    version: 1,
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
          'MCP cannot set lifecycleStatus or sourceOfTruthMode; humans verify/mark-current.',
          'Prefer specific planning types (business-idea, vision, plan, initiative) over other.',
        ],
      },
    },
    updateKnowledgeRecord: {
      requiredFields: ['recordId', 'changeMessage'],
      optionalFields: [
        'title',
        'summary',
        'recordType',
        'contentMarkdown',
        'projectId',
        'systemId',
        'tags',
        'language',
        'generatedByModel',
        'sourceTitle',
      ],
      fields: CREATE_FIELDS.filter((field) => field.appliesTo.includes('update')),
    },
    guidance: [
      'Use this hub as a ledger across planning, delivery, operations, and vision.',
      'Pick the most specific recordType; use note for unstructured working notes.',
      'Attach projectId/systemId when the record is scoped to catalogue entities.',
    ],
  };
}
