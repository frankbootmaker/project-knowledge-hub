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
] as const;

export type EmailNotificationKey = (typeof EMAIL_NOTIFICATION_KEYS)[number];

export type EmailNotificationPrefs = Record<EmailNotificationKey, boolean>;

export const DEFAULT_EMAIL_NOTIFICATION_PREFS: EmailNotificationPrefs = {
  passwordChanged: true,
  aiConnectionPending: true,
  aiConnectionApproved: true,
  aiConnectionRejected: true,
};

export const emailNotificationPrefsSchema = z.object({
  passwordChanged: z.boolean(),
  aiConnectionPending: z.boolean(),
  aiConnectionApproved: z.boolean(),
  aiConnectionRejected: z.boolean(),
});

export const emailNotificationPrefsPatchSchema = z
  .object({
    passwordChanged: z.boolean().optional(),
    aiConnectionPending: z.boolean().optional(),
    aiConnectionApproved: z.boolean().optional(),
    aiConnectionRejected: z.boolean().optional(),
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
