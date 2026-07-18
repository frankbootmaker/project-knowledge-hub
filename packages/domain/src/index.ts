import { z } from 'zod';

export const projectStatusSchema = z.enum([
  'idea',
  'planned',
  'active',
  'maintenance',
  'paused',
  'completed',
  'archived',
]);

export const systemStatusSchema = z.enum([
  'proposed',
  'experimental',
  'active',
  'degraded',
  'maintenance',
  'deprecated',
  'retired',
  'archived',
]);

export const membershipRoleSchema = z.enum([
  'system_admin',
  'workspace_admin',
  'maintainer',
  'reader',
  'mcp_client',
]);

export const userStatusSchema = z.enum(['active', 'disabled', 'invited']);

export const recordTypeSchema = z.enum([
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
  'other',
]);

export const lifecycleStatusSchema = z.enum([
  'draft',
  'review_required',
  'verified',
  'current',
  'superseded',
  'deprecated',
  'archived',
]);

export const sourceOfTruthModeSchema = z.enum([
  'git_managed',
  'hub_managed',
  'imported_snapshot',
  'ai_generated_draft',
  'external_authoritative',
]);

export const knowledgeSourceTypeSchema = z.enum([
  'manual',
  'git',
  'import',
  'conversation',
  'external',
]);

export type ProjectStatus = z.infer<typeof projectStatusSchema>;
export type SystemStatus = z.infer<typeof systemStatusSchema>;
export type MembershipRole = z.infer<typeof membershipRoleSchema>;
export type UserStatus = z.infer<typeof userStatusSchema>;
export type RecordType = z.infer<typeof recordTypeSchema>;
export type LifecycleStatus = z.infer<typeof lifecycleStatusSchema>;
export type SourceOfTruthMode = z.infer<typeof sourceOfTruthModeSchema>;
export type KnowledgeSourceType = z.infer<typeof knowledgeSourceTypeSchema>;

export class AppError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly details?: unknown;

  constructor(options: {
    code: string;
    message: string;
    statusCode?: number;
    details?: unknown;
    cause?: unknown;
  }) {
    super(options.message, { cause: options.cause });
    this.name = 'AppError';
    this.code = options.code;
    this.statusCode = options.statusCode ?? 500;
    this.details = options.details;
  }
}
