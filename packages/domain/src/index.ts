import { z } from 'zod';

export {
  RECORD_TYPES,
  RECORD_TYPE_CATALOG,
  LIFECYCLE_STATUSES,
  SOURCE_OF_TRUTH_MODES,
  KNOWLEDGE_SOURCE_TYPES,
  recordTypeSchema,
  lifecycleStatusSchema,
  sourceOfTruthModeSchema,
  knowledgeSourceTypeSchema,
  getRecordTypeDefinition,
  buildKnowledgeRecordMetadata,
  type RecordType,
  type RecordTypeCategory,
  type RecordTypeDefinition,
  type LifecycleStatus,
  type SourceOfTruthMode,
  type KnowledgeSourceType,
  type FieldRequirement,
  type KnowledgeRecordFieldGuide,
  type KnowledgeRecordMetadata,
} from './record-types.js';

export {
  WORKSPACE_COLORS,
  workspaceColorSchema,
  resolveWorkspaceColor,
  type WorkspaceColor,
} from './workspace-colors.js';

export {
  WORKSPACE_DESCRIPTION_MAX_LENGTH,
  workspaceDescriptionSchema,
} from './workspace.js';

export {
  SYNC_PROVIDERS,
  SYNC_PROVIDER_CATALOG,
  syncProviderSchema,
  getSyncProviderDefinition,
  isSyncProviderSupported,
  providerNeedsBaseUrl,
  providerShowsBaseUrl,
  type SyncProvider,
  type SyncProviderDefinition,
} from './sync-providers.js';

export {
  PASSWORD_MIN_LENGTH,
  PASSWORD_STRONG_LENGTH,
  evaluatePasswordStrength,
  passwordHasNonLetter,
  passwordHasUppercase,
  passwordSchema,
  optionalPasswordSchema,
  type PasswordRequirementKey,
  type PasswordStrength,
  type PasswordStrengthLevel,
} from './password.js';

export const projectStatusSchema = z.enum([
  'idea',
  'planned',
  'active',
  'maintenance',
  'paused',
  'completed',
  'archived',
]);

/** Project Delivery (NF-018): milestone lifecycle. */
export const milestoneStatusSchema = z.enum([
  'planned',
  'active',
  'done',
  'cancelled',
]);

/** Project Delivery (NF-018): task lifecycle. */
export const taskStatusSchema = z.enum([
  'todo',
  'in_progress',
  'blocked',
  'done',
  'cancelled',
]);

/** Project Delivery (NF-018): RACI role codes. */
export const raciRoleSchema = z.enum(['R', 'A', 'C', 'I']);

/** Epic / user-story lifecycle (same set as milestones). */
export const epicStatusSchema = z.enum([
  'planned',
  'active',
  'done',
  'cancelled',
]);

export const userStoryStatusSchema = epicStatusSchema;

/** Task activity timeline event types. */
export const taskActivityTypeSchema = z.enum([
  'created',
  'status_changed',
  'comment',
  'handoff',
  'raci_changed',
  'fields_updated',
  'owner_set',
]);

/** Project stakeholders roster role (hybrid with RACI-derived people). */
export const projectStakeholderRoleSchema = z.enum([
  'sponsor',
  'owner',
  'product_owner',
  'tech_lead',
  'contributor',
  'stakeholder',
  'other',
]);

/** Project-level currency for budget and hourly rates (no FX). */
export const projectCurrencySchema = z.enum([
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

/** Product/LLM brand mark for AI-assistant catalogue systems. */
export const assistantBrandSchema = z.enum([
  'cursor',
  'openai',
  'claude',
  'gemini',
  'ollama',
  'openwebui',
  'generic',
]);

/** Resolve LLM/product brand for AI-assistant systems (metadata, then name/slug). */
export function resolveAssistantBrand(input: {
  name?: string | null;
  slug?: string | null;
  metadata?: Record<string, unknown> | null;
}): z.infer<typeof assistantBrandSchema> {
  const meta = input.metadata?.assistantBrand;
  const parsed = assistantBrandSchema.safeParse(meta);
  if (parsed.success) return parsed.data;

  const hay = `${input.slug ?? ''} ${input.name ?? ''}`.toLowerCase();
  if (hay.includes('cursor')) return 'cursor';
  if (
    hay.includes('chatgpt') ||
    hay.includes('openai') ||
    /\bgpt\b/.test(hay)
  ) {
    return 'openai';
  }
  if (hay.includes('claude') || hay.includes('anthropic')) return 'claude';
  if (hay.includes('gemini') || hay.includes('google')) return 'gemini';
  if (hay.includes('ollama')) return 'ollama';
  if (hay.includes('openwebui') || hay.includes('open-webui')) {
    return 'openwebui';
  }
  return 'generic';
}

/** Project RAID register item kind. */
export const raidKindSchema = z.enum([
  'risk',
  'assumption',
  'issue',
  'dependency',
]);

/** Project RAID register lifecycle. */
export const raidStatusSchema = z.enum([
  'open',
  'mitigating',
  'accepted',
  'closed',
  'cancelled',
]);

/** Project RAID severity (used most for risks/issues). */
export const raidSeveritySchema = z.enum([
  'low',
  'medium',
  'high',
  'critical',
]);

/** Knowledge record → delivery entity link target. */
export const deliveryLinkEntityTypeSchema = z.enum([
  'epic',
  'user_story',
  'task',
]);

/** Change management register kind. */
export const changeKindSchema = z.enum([
  'scope',
  'timeline',
  'stakeholder',
  'budget',
  'other',
]);

/** Change management lifecycle. */
export const changeStatusSchema = z.enum([
  'proposed',
  'approved',
  'rejected',
  'implemented',
  'cancelled',
]);

/** Change → delivery entity link (includes milestones). */
export const changeDeliveryEntityTypeSchema = z.enum([
  'epic',
  'user_story',
  'milestone',
  'task',
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

export const userStatusSchema = z.enum([
  'active',
  'disabled',
  'invited',
  'pending_email',
  'pending_approval',
]);

/** UI / email locale preference (matches web next-intl locales). */
export const APP_LOCALES = ['en', 'de', 'hu'] as const;
export const appLocaleSchema = z.enum(APP_LOCALES);
export type AppLocale = z.infer<typeof appLocaleSchema>;
export const DEFAULT_APP_LOCALE: AppLocale = 'en';

export function normalizeAppLocale(value: string | null | undefined): AppLocale {
  if (value && (APP_LOCALES as readonly string[]).includes(value)) {
    return value as AppLocale;
  }
  return DEFAULT_APP_LOCALE;
}

/** Optional product emails the user can mute (security/lifecycle mails stay always-on). */
export const EMAIL_NOTIFICATION_KEYS = [
  'passwordChanged',
  'aiConnectionPending',
  'aiConnectionApproved',
  'aiConnectionRejected',
  'signupPendingApproval',
] as const;

export type EmailNotificationKey = (typeof EMAIL_NOTIFICATION_KEYS)[number];

export type EmailNotificationPrefs = Record<EmailNotificationKey, boolean>;

export const DEFAULT_EMAIL_NOTIFICATION_PREFS: EmailNotificationPrefs = {
  passwordChanged: true,
  aiConnectionPending: true,
  aiConnectionApproved: true,
  aiConnectionRejected: true,
  /** System admins only; opt-in “on duty” for signup approvals. */
  signupPendingApproval: false,
};

export const emailNotificationPrefsSchema = z.object({
  passwordChanged: z.boolean(),
  aiConnectionPending: z.boolean(),
  aiConnectionApproved: z.boolean(),
  aiConnectionRejected: z.boolean(),
  signupPendingApproval: z.boolean(),
});

export const emailNotificationPrefsPatchSchema = z
  .object({
    passwordChanged: z.boolean().optional(),
    aiConnectionPending: z.boolean().optional(),
    aiConnectionApproved: z.boolean().optional(),
    aiConnectionRejected: z.boolean().optional(),
    signupPendingApproval: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one notification preference is required',
  });

export function mergeEmailNotificationPrefs(
  value: unknown,
): EmailNotificationPrefs {
  const parsed = emailNotificationPrefsSchema.partial().safeParse(value ?? {});
  const partial = parsed.success ? parsed.data : {};
  return {
    ...DEFAULT_EMAIL_NOTIFICATION_PREFS,
    ...partial,
  };
}

export function allowsEmailNotification(
  prefs: unknown,
  key: EmailNotificationKey,
): boolean {
  return mergeEmailNotificationPrefs(prefs)[key];
}

export type ProjectStatus = z.infer<typeof projectStatusSchema>;
export type SystemStatus = z.infer<typeof systemStatusSchema>;
export type MembershipRole = z.infer<typeof membershipRoleSchema>;
export type UserStatus = z.infer<typeof userStatusSchema>;
export type MilestoneStatus = z.infer<typeof milestoneStatusSchema>;
export type TaskStatus = z.infer<typeof taskStatusSchema>;
export type RaciRole = z.infer<typeof raciRoleSchema>;
export type EpicStatus = z.infer<typeof epicStatusSchema>;
export type UserStoryStatus = z.infer<typeof userStoryStatusSchema>;
export type TaskActivityType = z.infer<typeof taskActivityTypeSchema>;
export type ProjectStakeholderRole = z.infer<typeof projectStakeholderRoleSchema>;
export type ProjectCurrency = z.infer<typeof projectCurrencySchema>;
export type AssistantBrand = z.infer<typeof assistantBrandSchema>;
export type RaidKind = z.infer<typeof raidKindSchema>;
export type RaidStatus = z.infer<typeof raidStatusSchema>;
export type RaidSeverity = z.infer<typeof raidSeveritySchema>;
export type DeliveryLinkEntityType = z.infer<typeof deliveryLinkEntityTypeSchema>;
export type ChangeKind = z.infer<typeof changeKindSchema>;
export type ChangeStatus = z.infer<typeof changeStatusSchema>;
export type ChangeDeliveryEntityType = z.infer<typeof changeDeliveryEntityTypeSchema>;

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
