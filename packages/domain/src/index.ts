import { z } from 'zod';

export {
  RECORD_TYPES,
  RECORD_TYPE_CATALOG,
  getDocKeyCode,
  isDocKeyCode,
  listDocKeyCodes,
  LIFECYCLE_STATUSES,
  SOURCE_OF_TRUTH_MODES,
  KNOWLEDGE_SOURCE_TYPES,
  recordTypeSchema,
  lifecycleStatusSchema,
  sourceOfTruthModeSchema,
  knowledgeSourceTypeSchema,
  getRecordTypeDefinition,
  buildKnowledgeRecordMetadata,
  KNOWLEDGE_RECORD_SLUG_MAX,
  KNOWLEDGE_RECORD_SLUG_PATTERN,
  isKnowledgeRecordSlug,
  createKnowledgeRecordInputSchema,
  updateKnowledgeRecordInputSchema,
  type RecordType,
  type RecordTypeCategory,
  type RecordTypeDefinition,
  type LifecycleStatus,
  type SourceOfTruthMode,
  type KnowledgeSourceType,
  type FieldRequirement,
  type KnowledgeRecordFieldGuide,
  type KnowledgeRecordMetadata,
  type CreateKnowledgeRecordInput,
  type UpdateKnowledgeRecordInput,
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

export {
  ALLOWED_MEDIA_TYPES,
  isAllowedMediaType,
  sniffMediaContentType,
  assertMediaBytesMatchContentType,
  type AllowedMediaType,
} from './media-validation.js';

export const projectStatusSchema = z.enum([
  'idea',
  'planned',
  'active',
  'maintenance',
  'paused',
  'completed',
  'archived',
]);

/**
 * Milestone, epic, and user-story lifecycle.
 * `active` remains a manual status. Derived status uses `in_progress` and `blocked`.
 */
export const milestoneStatusSchema = z.enum([
  'planned',
  'active',
  'in_progress',
  'blocked',
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

/** Steps a task can report while it is still open. */
export const TASK_COMPLETION_PERCENTS = [0, 25, 50, 75, 100] as const;

export const taskCompletionPercentSchema = z.union([
  z.literal(0),
  z.literal(25),
  z.literal(50),
  z.literal(75),
  z.literal(100),
]);

const TASK_COMPLETION_PERCENT_SET = new Set<number>(TASK_COMPLETION_PERCENTS);

export function isTaskCompletionPercent(value: number): boolean {
  return TASK_COMPLETION_PERCENT_SET.has(value);
}

/**
 * Done is always 100. Cancelled stores nothing.
 * An open task keeps a menu value, or 0 when none is stored yet.
 *
 * Reopening a done task (status back to todo, in_progress, or blocked)
 * resets the stored step to 0 unless this call sends `requested`.
 * The step from before done is not stored: marking done overwrites it with 100.
 *
 * This is the value written to `project_tasks.completion_percent`.
 * Reads use `displayedTaskCompletionPercent`, which shows 0 for cancelled.
 */
export function resolveTaskCompletionPercent(input: {
  status: z.infer<typeof taskStatusSchema>;
  requested?: number | null;
  existing?: number | null;
  /** Status before this write. Used to detect a reopen from done. */
  previousStatus?: z.infer<typeof taskStatusSchema> | null;
}): number | null {
  if (input.status === 'cancelled') return null;
  if (input.status === 'done') return 100;
  if (input.requested != null && isTaskCompletionPercent(input.requested)) {
    return input.requested;
  }
  const reopening =
    input.previousStatus === 'done' && input.requested === undefined;
  if (reopening) return 0;
  if (
    input.requested === undefined &&
    input.existing != null &&
    isTaskCompletionPercent(input.existing)
  ) {
    return input.existing;
  }
  return 0;
}

/**
 * Latest transition to done, and only while the item is still done.
 * Reopening clears it even when an older status_changed→done activity remains.
 */
export function taskCompletedAt(
  status: string,
  latestDoneTransitionAt: string | null | undefined,
): string | null {
  if (status !== 'done') return null;
  return latestDoneTransitionAt || null;
}

export type DeliveryCompletionRollup = {
  percent: number;
  /**
   * Finished share for a story or epic, including partial steps such as 0.5.
   * For a milestone, the count of included items that are done or 100 percent.
   */
  done: number;
  total: number;
};

export type DeliveryCompletionChild = {
  status: string;
  completionPercent?: number | null;
  userStoryId?: string | null;
  epicId?: string | null;
};

/**
 * Points a child adds to a parent's average.
 * Cancelled children are excluded. Done is 100.
 * An open child uses its stored step, or 0 when none is stored.
 */
export function childCompletionPoints(
  status: string,
  completionPercent?: number | null,
): number | null {
  if (status === 'cancelled') return null;
  if (status === 'done') return 100;
  if (typeof completionPercent === 'number' && Number.isFinite(completionPercent)) {
    return completionPercent;
  }
  return 0;
}

/**
 * Percent shown for a task or bug.
 * Done is 100. Cancelled is 0. Otherwise the stored step, or 0.
 */
export function displayedTaskCompletionPercent(
  status: string,
  completionPercent?: number | null,
): number {
  if (status === 'done') return 100;
  if (status === 'cancelled') return 0;
  if (typeof completionPercent === 'number' && Number.isFinite(completionPercent)) {
    return completionPercent;
  }
  return 0;
}

export type MilestoneLinkKind = 'task' | 'parent';

export type MilestoneLinkCompletion = {
  /** Tasks and bugs use `task`. Epics and stories use `parent`. */
  kind: MilestoneLinkKind;
  status: string;
  /**
   * Computed percent for an open item.
   * Tasks pass the stored step. Parents pass the child average.
   * Null means nothing was computed.
   */
  completionPercent?: number | null;
};

/**
 * Points one linked item adds to a milestone average.
 * Done is 100. Cancelled is excluded.
 * A task with no stored step counts as 0.
 * A parent with no computed children is excluded.
 */
export function milestoneLinkPoints(
  link: MilestoneLinkCompletion,
): number | null {
  if (link.kind === 'task') {
    return childCompletionPoints(link.status, link.completionPercent);
  }
  if (link.status === 'cancelled') return null;
  if (link.status === 'done') return 100;
  if (
    typeof link.completionPercent === 'number' &&
    Number.isFinite(link.completionPercent)
  ) {
    return link.completionPercent;
  }
  return null;
}

/**
 * Derived milestone completion from linked items and dependencies.
 * percent is 100 only when every included item is complete, otherwise 0.
 * done counts included items that are done or 100 percent.
 * total is that included set. Cancelled items are left out.
 * An empty set has no rollup.
 * The milestone's own status does not override the links.
 * Predecessor dependencies use the same points, so they count in done and total together.
 */
export function milestoneCompletion(
  links: readonly MilestoneLinkCompletion[],
): DeliveryCompletionRollup | null {
  const points: number[] = [];
  for (const link of links) {
    const value = milestoneLinkPoints(link);
    if (value == null) continue;
    points.push(value);
  }
  if (points.length === 0) return null;
  const done = points.filter((value) => value === 100).length;
  return {
    percent: done === points.length ? 100 : 0,
    done,
    total: points.length,
  };
}

/** Average of the points that were not excluded. Empty input has no rollup. */
export function averageCompletion(
  points: readonly number[],
): DeliveryCompletionRollup | null {
  if (points.length === 0) return null;
  const earned = points.reduce((sum, value) => sum + value, 0);
  return {
    percent: Math.round(earned / points.length),
    done: earned / 100,
    total: points.length,
  };
}

/**
 * Percent shown for a story or epic.
 * Done is 100 even when children are behind. Cancelled is 0.
 * Any other status keeps the child rollup, or null when nothing remains to average.
 */
export function displayedParentCompletion(
  status: string,
  rollup: DeliveryCompletionRollup | null,
): DeliveryCompletionRollup | null {
  if (status === 'done') {
    const total = rollup?.total ?? 1;
    return { percent: 100, done: total, total };
  }
  if (status === 'cancelled') {
    return { percent: 0, done: 0, total: rollup?.total ?? 0 };
  }
  return rollup;
}

export type ParentStatusSource = {
  status: string;
  /** Null excludes the child. Cancelled, or a parent with nothing to average. */
  points: number | null;
};

/** Status stored on a story, epic, or milestone when children imply one. */
export type DerivedDeliveryStatus = 'planned' | 'todo' | 'in_progress' | 'blocked' | 'done';

const IDLE_CHILD_STATUSES = new Set(['todo', 'planned']);

/**
 * Status implied by included children.
 * Null means nothing is included, so the parent keeps its manual status.
 *
 * All included children done -> done.
 * Any included child that is not done and is blocked -> blocked.
 * Computed completion above 0, or any child that has started -> in_progress.
 * Otherwise planned, or todo when idleStatus is todo.
 */
export function derivedParentStatus(
  children: readonly ParentStatusSource[],
  idleStatus: 'planned' | 'todo' = 'planned',
): DerivedDeliveryStatus | null {
  const included = children.filter(
    (child): child is ParentStatusSource & { points: number } => child.points != null,
  );
  if (included.length === 0) return null;
  const allDone = included.every(
    (child) => child.status === 'done' || child.points === 100,
  );
  if (allDone) return 'done';
  if (included.some((child) => child.status === 'blocked' && child.points < 100)) {
    return 'blocked';
  }
  const rollup = averageCompletion(included.map((child) => child.points));
  const started = included.some(
    (child) => child.points > 0 || !IDLE_CHILD_STATUSES.has(child.status),
  );
  if ((rollup?.percent ?? 0) > 0 || started) return 'in_progress';
  return idleStatus;
}

export const ARCHIVED_LINK_KIND_LABEL = {
  milestone: 'Milestone',
  epic: 'Epic',
  user_story: 'User story',
  sprint: 'Sprint',
} as const;

export type ArchivedLinkKind = keyof typeof ARCHIVED_LINK_KIND_LABEL;

/** Clear error when an active item is linked to an archived parent. */
export function archivedItemLinkMessage(kind: ArchivedLinkKind, label: string): string {
  return `${ARCHIVED_LINK_KIND_LABEL[kind]} ${label} is archived; unarchive it first`;
}

/**
 * Story or epic status from child tasks and bugs. No included children keeps manualStatus.
 * Cancelled is a manual terminal status and is never replaced.
 */
export function parentStatusFromChildren(
  manualStatus: string,
  children: readonly { status: string; completionPercent?: number | null }[],
  idleStatus: 'planned' | 'todo' = 'planned',
): string {
  if (manualStatus === 'cancelled') return 'cancelled';
  const derived = derivedParentStatus(
    children.map((child) => ({
      status: child.status,
      points: childCompletionPoints(child.status, child.completionPercent),
    })),
    idleStatus,
  );
  return derived ?? manualStatus;
}

/** Milestone status from the same links that feed milestone completion. Cancelled stays cancelled. */
export function milestoneStatusFromLinks(
  manualStatus: string,
  links: readonly MilestoneLinkCompletion[],
): string {
  if (manualStatus === 'cancelled') return 'cancelled';
  const derived = derivedParentStatus(
    links.map((link) => ({
      status: link.status,
      points: milestoneLinkPoints(link),
    })),
  );
  return derived ?? manualStatus;
}

export type ParentDateSource = {
  status: string;
  start?: string | null;
  end?: string | null;
};

export type ParentDateSpan = {
  start: string | null;
  end: string | null;
};

/** A side is derived when an included child supplies that date. */
export type ParentDateDetail = ParentDateSpan & {
  startDerived: boolean;
  endDerived: boolean;
};

/** Planned target percent shown beside completion. Integer 0–100, or null. */
export const targetPercentSchema = z.number().int().min(0).max(100);

/** Dependency lag in working days. Negative is a lead. */
export const dependencyLagDaysSchema = z.number().int().min(-3650).max(3650);

function earliestDate(values: readonly string[]): string | null {
  if (values.length === 0) return null;
  return values.reduce((min, value) => (value < min ? value : min));
}

function latestDate(values: readonly string[]): string | null {
  if (values.length === 0) return null;
  return values.reduce((max, value) => (value > max ? value : max));
}

/**
 * Start is the earliest included child start. End is the latest included end.
 * Cancelled children are excluded. A side with no child date keeps the manual
 * value and stays writable. A side taken from children is read-only.
 */
export function parentDateDetail(
  manual: ParentDateSpan,
  children: readonly ParentDateSource[],
): ParentDateDetail {
  const included = children.filter((child) => child.status !== 'cancelled');
  const starts = included
    .map((child) => child.start)
    .filter((value): value is string => Boolean(value));
  const ends = included
    .map((child) => child.end)
    .filter((value): value is string => Boolean(value));
  const start = earliestDate(starts);
  const end = latestDate(ends);
  return {
    start: start ?? manual.start ?? null,
    end: end ?? manual.end ?? null,
    startDerived: start != null,
    endDerived: end != null,
  };
}

/**
 * Start is the earliest included child start. End is the latest included end.
 * Cancelled children are excluded. A side with no child date keeps the manual value.
 */
export function derivedParentDates(
  manual: ParentDateSpan,
  children: readonly ParentDateSource[],
): ParentDateSpan {
  const detail = parentDateDetail(manual, children);
  return { start: detail.start, end: detail.end };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function utcDay(isoDate: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return Number.NaN;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

/**
 * Share of a start–end window that should be finished on `today`.
 * The start day is 0. The end day, and every day after it, is 100.
 * A missing or reversed window has no target. The result is an integer 0–100.
 */
export function plannedTargetPercent(
  start: string | null | undefined,
  end: string | null | undefined,
  today: string,
): number | null {
  if (!start || !end || !ISO_DATE.test(start) || !ISO_DATE.test(end) || !ISO_DATE.test(today)) {
    return null;
  }
  if (end < start) return null;
  if (today <= start) return 0;
  if (today >= end) return 100;
  const span = utcDay(end) - utcDay(start);
  if (span <= 0) return 100;
  return Math.round(((utcDay(today) - utcDay(start)) / span) * 100);
}

/**
 * Names a date the caller tried to write after children already own that side.
 * Undefined patch fields are omitted, so a read that does not send the date is fine.
 */
export function derivedDateWriteField(input: {
  detail: ParentDateDetail;
  startDate?: string | null;
  endDate?: string | null;
}): 'startDate' | 'endDate' | null {
  if (input.detail.startDerived && input.startDate !== undefined) return 'startDate';
  if (input.detail.endDerived && input.endDate !== undefined) return 'endDate';
  return null;
}

/**
 * Story and epic rollups from child tasks and bugs.
 * Cancelled children are left out of the average. A parent whose children
 * are all cancelled is omitted here; `displayedParentCompletion` still
 * forces 0 or 100 from that parent's own status.
 */
export function deliveryCompletionIndex(
  tasks: readonly DeliveryCompletionChild[],
): {
  byStoryId: Map<string, DeliveryCompletionRollup>;
  byEpicId: Map<string, DeliveryCompletionRollup>;
} {
  const stories = new Map<string, number[]>();
  const epics = new Map<string, number[]>();
  for (const task of tasks) {
    const points = childCompletionPoints(task.status, task.completionPercent);
    if (points == null) continue;
    if (task.userStoryId) {
      const list = stories.get(task.userStoryId) ?? [];
      list.push(points);
      stories.set(task.userStoryId, list);
    }
    if (task.epicId) {
      const list = epics.get(task.epicId) ?? [];
      list.push(points);
      epics.set(task.epicId, list);
    }
  }
  const byStoryId = new Map<string, DeliveryCompletionRollup>();
  const byEpicId = new Map<string, DeliveryCompletionRollup>();
  for (const [id, list] of stories) {
    const rollup = averageCompletion(list);
    if (rollup) byStoryId.set(id, rollup);
  }
  for (const [id, list] of epics) {
    const rollup = averageCompletion(list);
    if (rollup) byEpicId.set(id, rollup);
  }
  return { byStoryId, byEpicId };
}

/**
 * Choosing a percent moves the status: 100 is done, any other step above 0
 * is in progress. 0 leaves the status, except a done task becomes to do so
 * the 0 can be stored. An unchanged percent does not move the status.
 */
export function statusForTaskCompletionChange(input: {
  status: z.infer<typeof taskStatusSchema>;
  requested?: number | null;
  existing?: number | null;
}): z.infer<typeof taskStatusSchema> {
  if (input.requested === undefined || input.requested === input.existing) {
    return input.status;
  }
  if (input.requested === 100) return 'done';
  if (input.requested != null && input.requested > 0) return 'in_progress';
  if (input.requested === 0 && input.status === 'done') return 'todo';
  return input.status;
}

/** Project Scrum (NF-020): sprint lifecycle. */
export const sprintStatusSchema = z.enum([
  'planned',
  'active',
  'completed',
  'cancelled',
]);

/** Project Delivery (NF-018): RACI role codes. */
export const raciRoleSchema = z.enum(['R', 'A', 'C', 'I']);

/** Epic / user-story lifecycle (same set as milestones). */
export const epicStatusSchema = z.enum([
  'planned',
  'active',
  'in_progress',
  'blocked',
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
  'project_manager',
  'scrum_master',
  'product_owner',
  'tech_lead',
  'contributor',
  'stakeholder',
  'other',
]);

/** Roster engagement classification for capacity / contracts. */
export const stakeholderEngagementTypeSchema = z.enum([
  'employee',
  'contractor',
]);

/**
 * Competency tag on a stakeholder / open role.
 * `skillId` is reserved for a future shared skill catalog (null today).
 */
export const stakeholderCompetencySchema = z.object({
  name: z.string().trim().min(1).max(80),
  skillId: z.string().uuid().nullable().optional(),
});

/** Deduped competency list (case-insensitive by name). */
export const stakeholderCompetenciesSchema = z
  .array(stakeholderCompetencySchema)
  .max(40)
  .transform((items) => {
    const seen = new Set<string>();
    const out: Array<{ name: string; skillId: string | null }> = [];
    for (const item of items) {
      const key = item.name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        name: item.name,
        skillId: item.skillId ?? null,
      });
    }
    return out;
  });

export const stakeholderStaffingStatusSchema = z.enum(['open', 'assigned']);

/** AI assistant billing mode against the project budget. */
export const aiCostModeSchema = z.enum([
  'flat',
  'api',
  'mixed',
  'note_only',
]);

/** OpEx billing for non-AI catalogue systems linked to a project. */
export const systemItCostModeSchema = z.enum([
  'flat',
  'one_time',
  'note_only',
]);

/** Resource utilization status for capacity planning. */
export const resourceUtilizationStatusSchema = z.enum([
  'under',
  'on_track',
  'over',
  'unknown',
]);

/** Utilization dashboard view mode. */
export const resourceUtilizationViewSchema = z.enum([
  'planned',
  'burn',
  'combined',
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

/** Knowledge record → delivery entity link target. Bugs stay entity type task. */
export const deliveryLinkEntityTypeSchema = z.enum([
  'epic',
  'user_story',
  'milestone',
  'task',
  'sprint',
]);

/** Item → workspace media or external URL. Includes RAID and change; bugs stay task. */
export const itemMediaEntityTypeSchema = z.enum([
  'epic',
  'user_story',
  'milestone',
  'task',
  'sprint',
  'raid',
  'change',
]);

export const itemMediaKindSchema = z.enum(['media', 'url']);

/** Accept only http(s) URLs and return a canonical href. */
export function assertPublicHttpUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new AppError({
      code: 'INVALID_URL',
      message: 'URL must be http or https',
      statusCode: 400,
    });
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new AppError({
      code: 'INVALID_URL',
      message: 'URL must be http or https',
      statusCode: 400,
    });
  }
  if (parsed.username || parsed.password) {
    throw new AppError({
      code: 'INVALID_URL',
      message: 'URL must not include credentials',
      statusCode: 400,
    });
  }
  const href = parsed.toString();
  if (href.length > 2000) {
    throw new AppError({
      code: 'INVALID_URL',
      message: 'URL is too long',
      statusCode: 400,
    });
  }
  return href;
}

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

/** Business impact / criticality for catalogue systems. */
export const systemCriticalitySchema = z.enum([
  'low',
  'medium',
  'high',
  'critical',
]);

export const systemDeploymentModelSchema = z.enum([
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
]);

export const systemDataClassificationSchema = z.enum([
  'public',
  'internal',
  'confidential',
  'restricted',
]);

const systemItPortSchema = z.object({
  port: z.number().int().min(1).max(65535),
  protocol: z.string().trim().min(1).max(40).optional(),
  service: z.string().trim().min(1).max(80).optional(),
});

const systemItEndpointSchema = z.object({
  name: z.string().trim().min(1).max(120),
  url: z.string().trim().min(1).max(2000),
});

/**
 * Structured IT inventory on a catalogue system (`systems.it_details`).
 * All keys optional; unknown keys stripped.
 */
export const systemItDetailsSchema = z
  .object({
    hostname: z.string().trim().min(1).max(253).optional(),
    primaryUrl: z.string().trim().min(1).max(2000).optional(),
    ipAddresses: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
    ports: z.array(systemItPortSchema).max(40).optional(),
    endpoints: z.array(systemItEndpointSchema).max(20).optional(),
    networkZone: z.string().trim().min(1).max(80).optional(),
    location: z.string().trim().min(1).max(200).optional(),
    deploymentModel: systemDeploymentModelSchema.optional(),
    vendor: z.string().trim().min(1).max(120).optional(),
    product: z.string().trim().min(1).max(120).optional(),
    platform: z.string().trim().min(1).max(120).optional(),
    dataClassification: systemDataClassificationSchema.optional(),
    backupPolicy: z.string().trim().min(1).max(500).optional(),
    supportContact: z.string().trim().min(1).max(200).optional(),
    documentationUrl: z.string().trim().min(1).max(2000).optional(),
    assetTag: z.string().trim().min(1).max(80).optional(),
    externalId: z.string().trim().min(1).max(120).optional(),
    dependencies: z.array(z.string().trim().min(1).max(200)).max(50).optional(),
    notes: z.string().trim().min(1).max(5000).optional(),
  })
  .strip();

/**
 * Partial update schema for itDetails (PATCH/MCP update).
 * Each field is nullable (to remove) and optional (to preserve).
 * Unknown keys stripped.
 */
export const systemItDetailsPatchSchema = z
  .object({
    hostname: z.string().trim().min(1).max(253).nullable().optional(),
    primaryUrl: z.string().trim().min(1).max(2000).nullable().optional(),
    ipAddresses: z.array(z.string().trim().min(1).max(80)).max(20).nullable().optional(),
    ports: z.array(systemItPortSchema).max(40).nullable().optional(),
    endpoints: z.array(systemItEndpointSchema).max(20).nullable().optional(),
    networkZone: z.string().trim().min(1).max(80).nullable().optional(),
    location: z.string().trim().min(1).max(200).nullable().optional(),
    deploymentModel: systemDeploymentModelSchema.nullable().optional(),
    vendor: z.string().trim().min(1).max(120).nullable().optional(),
    product: z.string().trim().min(1).max(120).nullable().optional(),
    platform: z.string().trim().min(1).max(120).nullable().optional(),
    dataClassification: systemDataClassificationSchema.nullable().optional(),
    backupPolicy: z.string().trim().min(1).max(500).nullable().optional(),
    supportContact: z.string().trim().min(1).max(200).nullable().optional(),
    documentationUrl: z.string().trim().min(1).max(2000).nullable().optional(),
    assetTag: z.string().trim().min(1).max(80).nullable().optional(),
    externalId: z.string().trim().min(1).max(120).nullable().optional(),
    dependencies: z.array(z.string().trim().min(1).max(200)).max(50).nullable().optional(),
    notes: z.string().trim().min(1).max(5000).nullable().optional(),
  })
  .strip();

/** Normalize free-text criticality to the enum when possible. */
export function normalizeSystemCriticality(
  value: string | null | undefined,
): z.infer<typeof systemCriticalitySchema> | null {
  if (value == null || value.trim() === '') return null;
  const key = value.trim().toLowerCase().replace(/\s+/g, '_');
  const aliases: Record<string, z.infer<typeof systemCriticalitySchema>> = {
    low: 'low',
    medium: 'medium',
    med: 'medium',
    high: 'high',
    critical: 'critical',
    crit: 'critical',
  };
  return aliases[key] ?? null;
}

/**
 * Build an itDetails patch from form fields.
 * Empty strings become `null` (to remove the key), trimmed non-empty strings are kept.
 * Use this to build the payload for update operations where clearing a field should remove it.
 */
export function buildItDetailsPatch(form: {
  primaryUrl?: string;
  hostname?: string;
  vendor?: string;
  deploymentModel?: string;
  supportContact?: string;
  documentationUrl?: string;
  dataClassification?: string;
}): SystemItDetailsPatch {
  const patch: SystemItDetailsPatch = {};
  
  if (form.primaryUrl !== undefined) {
    patch.primaryUrl = form.primaryUrl.trim() || null;
  }
  if (form.hostname !== undefined) {
    patch.hostname = form.hostname.trim() || null;
  }
  if (form.vendor !== undefined) {
    patch.vendor = form.vendor.trim() || null;
  }
  if (form.deploymentModel !== undefined) {
    const value = form.deploymentModel || null;
    patch.deploymentModel = value as SystemItDetailsPatch['deploymentModel'];
  }
  if (form.supportContact !== undefined) {
    patch.supportContact = form.supportContact.trim() || null;
  }
  if (form.documentationUrl !== undefined) {
    patch.documentationUrl = form.documentationUrl.trim() || null;
  }
  if (form.dataClassification !== undefined) {
    const value = form.dataClassification || null;
    patch.dataClassification = value as SystemItDetailsPatch['dataClassification'];
  }
  
  return patch;
}

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

export const userTypeSchema = z.enum(['human', 'system']);

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

/** Report Mermaid diagrams and dashboard summary widgets the user can toggle. */
export const REPORT_DIAGRAM_KEYS = [
  'orgHierarchy',
  'raidBreakdown',
  'deliveryTimeline',
  'budgetBurndown',
] as const;

export const DASHBOARD_WIDGET_KEYS = [
  'tasksByDue',
  'projectHealthRag',
  'openRaidCounts',
  'budgetAttention',
] as const;

export type ReportDiagramKey = (typeof REPORT_DIAGRAM_KEYS)[number];
export type DashboardWidgetKey = (typeof DASHBOARD_WIDGET_KEYS)[number];

export type ReportDiagramPrefs = Record<ReportDiagramKey, boolean>;
export type DashboardWidgetPrefs = Record<DashboardWidgetKey, boolean>;

export type DisplayPrefs = {
  reportDiagrams: ReportDiagramPrefs;
  dashboardWidgets: DashboardWidgetPrefs;
};

export const DEFAULT_REPORT_DIAGRAM_PREFS: ReportDiagramPrefs = {
  orgHierarchy: true,
  raidBreakdown: true,
  deliveryTimeline: true,
  budgetBurndown: true,
};

export const DEFAULT_DASHBOARD_WIDGET_PREFS: DashboardWidgetPrefs = {
  tasksByDue: true,
  projectHealthRag: true,
  openRaidCounts: true,
  budgetAttention: true,
};

export const DEFAULT_DISPLAY_PREFS: DisplayPrefs = {
  reportDiagrams: DEFAULT_REPORT_DIAGRAM_PREFS,
  dashboardWidgets: DEFAULT_DASHBOARD_WIDGET_PREFS,
};

export const reportDiagramPrefsSchema = z.object({
  orgHierarchy: z.boolean(),
  raidBreakdown: z.boolean(),
  deliveryTimeline: z.boolean(),
  budgetBurndown: z.boolean(),
});

export const dashboardWidgetPrefsSchema = z.object({
  tasksByDue: z.boolean(),
  projectHealthRag: z.boolean(),
  openRaidCounts: z.boolean(),
  budgetAttention: z.boolean(),
});

export const displayPrefsSchema = z.object({
  reportDiagrams: reportDiagramPrefsSchema,
  dashboardWidgets: dashboardWidgetPrefsSchema,
});

export const displayPrefsPatchSchema = z
  .object({
    reportDiagrams: reportDiagramPrefsSchema.partial().optional(),
    dashboardWidgets: dashboardWidgetPrefsSchema.partial().optional(),
  })
  .refine(
    (value) =>
      (value.reportDiagrams != null &&
        Object.keys(value.reportDiagrams).length > 0) ||
      (value.dashboardWidgets != null &&
        Object.keys(value.dashboardWidgets).length > 0),
    { message: 'At least one display preference is required' },
  );

export function mergeDisplayPrefs(value: unknown): DisplayPrefs {
  const parsed = displayPrefsSchema.partial().safeParse(value ?? {});
  const partial = parsed.success ? parsed.data : {};
  return {
    reportDiagrams: {
      ...DEFAULT_REPORT_DIAGRAM_PREFS,
      ...(partial.reportDiagrams ?? {}),
    },
    dashboardWidgets: {
      ...DEFAULT_DASHBOARD_WIDGET_PREFS,
      ...(partial.dashboardWidgets ?? {}),
    },
  };
}

export type ProjectStatus = z.infer<typeof projectStatusSchema>;
export type SystemStatus = z.infer<typeof systemStatusSchema>;
export type SystemCriticality = z.infer<typeof systemCriticalitySchema>;
export type SystemDeploymentModel = z.infer<typeof systemDeploymentModelSchema>;
export type SystemDataClassification = z.infer<
  typeof systemDataClassificationSchema
>;
export type SystemItDetails = z.infer<typeof systemItDetailsSchema>;
export type SystemItDetailsPatch = z.infer<typeof systemItDetailsPatchSchema>;
export type MembershipRole = z.infer<typeof membershipRoleSchema>;
export type UserStatus = z.infer<typeof userStatusSchema>;
export type UserType = z.infer<typeof userTypeSchema>;
export type MilestoneStatus = z.infer<typeof milestoneStatusSchema>;
export type TaskStatus = z.infer<typeof taskStatusSchema>;

export {
  taskItemTypeSchema,
  bugFoundInSchema,
  bugResolutionSchema,
  emptyBugFields,
  bugPatchTouches,
  resolveBugCreate,
  resolveBugUpdate,
  type TaskItemType,
  type BugFoundIn,
  type BugResolution,
  type StoredBugFields,
  type BugFieldPatch,
  type BugWriteErrorCode,
  type BugWriteResult,
} from './delivery-bug.js';
export type SprintStatus = z.infer<typeof sprintStatusSchema>;
export type RaciRole = z.infer<typeof raciRoleSchema>;
export type EpicStatus = z.infer<typeof epicStatusSchema>;
export type UserStoryStatus = z.infer<typeof userStoryStatusSchema>;
export type TaskActivityType = z.infer<typeof taskActivityTypeSchema>;
export type ProjectStakeholderRole = z.infer<typeof projectStakeholderRoleSchema>;
export type StakeholderEngagementType = z.infer<
  typeof stakeholderEngagementTypeSchema
>;
export type StakeholderCompetency = z.infer<typeof stakeholderCompetencySchema>;
export type StakeholderCompetencies = z.infer<
  typeof stakeholderCompetenciesSchema
>;
export type StakeholderStaffingStatus = z.infer<
  typeof stakeholderStaffingStatusSchema
>;
export type AiCostMode = z.infer<typeof aiCostModeSchema>;
export type SystemItCostMode = z.infer<typeof systemItCostModeSchema>;
export type ResourceUtilizationStatus = z.infer<
  typeof resourceUtilizationStatusSchema
>;
export type ResourceUtilizationView = z.infer<
  typeof resourceUtilizationViewSchema
>;
export type ProjectCurrency = z.infer<typeof projectCurrencySchema>;
export type AssistantBrand = z.infer<typeof assistantBrandSchema>;
export type RaidKind = z.infer<typeof raidKindSchema>;
export type RaidStatus = z.infer<typeof raidStatusSchema>;
export type RaidSeverity = z.infer<typeof raidSeveritySchema>;
export type DeliveryLinkEntityType = z.infer<typeof deliveryLinkEntityTypeSchema>;
export type ItemMediaEntityType = z.infer<typeof itemMediaEntityTypeSchema>;
export type ItemMediaKind = z.infer<typeof itemMediaKindSchema>;
export type ChangeKind = z.infer<typeof changeKindSchema>;
export type ChangeStatus = z.infer<typeof changeStatusSchema>;
export type ChangeDeliveryEntityType = z.infer<typeof changeDeliveryEntityTypeSchema>;

export {
  ISSUE_KEY_TYPES,
  issueKeyTypeSchema,
  KEY_PREFIX_PATTERN,
  HUMAN_KEY_PATTERN,
  HUMAN_KEY_TYPE_PATTERN,
  keyPrefixSchema,
  isUuid,
  normalizeKeyPrefix,
  isValidKeyPrefix,
  isValidHumanKeyType,
  isDeliveryIssueKeyType,
  suggestKeyPrefix,
  parseHumanKey,
  formatHumanKey,
  raidKindToIssueKeyType,
  issueKeyTypeToRaidKind,
  readIssueCounter,
  type IssueKeyType,
  type ParsedHumanKey,
  type IssueCounters,
} from './issue-keys.js';

export { sanitizeError, type SanitizedError } from './error-sanitizer.js';

/**
 * Validate that a YYYY-MM-DD string is a real calendar date.
 * Rejects impossible dates such as 2026-02-30, 2026-13-01, and non-leap 2027-02-29.
 */
export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
  .refine(
    (value) => {
      const parts = value.split('-').map(Number);
      const [year, month, day] = parts;
      if (year === undefined || month === undefined || day === undefined) {
        return false;
      }
      const date = new Date(Date.UTC(year, month - 1, day));
      return (
        date.getUTCFullYear() === year &&
        date.getUTCMonth() === month - 1 &&
        date.getUTCDate() === day
      );
    },
    { message: 'Invalid calendar date' },
  );

/**
 * Nullable version of isoDateSchema for optional date fields.
 */
export const isoDateNullableSchema = isoDateSchema.nullable();

export {
  assertDateRange,
  effectiveDateRange,
} from './date-validation.js';

export {
  DELIVERY_DEPENDENCY_ENTITY_TYPES,
  DELIVERY_DEPENDENCY_LAG_MAX,
  DELIVERY_DEPENDENCY_LAG_MIN,
  DELIVERY_DEPENDENCY_LINK_LABELS,
  DELIVERY_DEPENDENCY_LINK_TYPES,
  DELIVERY_DURATION_MAX_DAYS,
  addCalendarDays,
  applyPredecessorSchedule,
  dependencyCycleKeys,
  dependencyEntityTypeFromIssueKey,
  deliveryItemKey,
  diffCalendarDays,
  earliestSuccessorStart,
  predecessorConstraintApplies,
  resolveTaskScheduleDates,
  scheduleDeliveryGraph,
  successorDurationDays,
  type DeliveryDependencyEntityType,
  type DeliveryDependencyLinkType,
  type ScheduleLink,
  type ScheduleNode,
  type TaskDateFields,
} from './delivery-dependencies.js';

export {
  CYCLE_CHECKED_KNOWLEDGE_RECORD_RELATION_TYPES,
  KNOWLEDGE_RECORD_RELATION_INVERSE,
  KNOWLEDGE_RECORD_RELATION_TYPES,
  MAX_KNOWLEDGE_RECORD_RELATIONS,
  RECORD_RELATIONS_COMPACT_CAP,
  SYMMETRIC_KNOWLEDGE_RECORD_RELATION_TYPES,
  anchorOwnsStoredRelation,
  canonicalRecordPair,
  graphAfterRelationReplace,
  inverseKnowledgeRecordRelation,
  isCycleCheckedKnowledgeRecordRelation,
  isSymmetricKnowledgeRecordRelation,
  knowledgeRecordRelationTypeSchema,
  normalizeStoredRelation,
  relationCyclePath,
  relationEdgeKey,
  relationListDirection,
  relationReplacePlan,
  type KnowledgeRecordRelationInverse,
  type KnowledgeRecordRelationType,
  type StoredRelationEdge,
} from './knowledge-record-relations.js';

export {
  DEFAULT_PROJECT_CALENDAR,
  EVERY_DAY_CALENDAR,
  HOURS_PER_WORKDAY_MAX,
  HOURS_PER_WORKDAY_MIN,
  NON_WORKING_DAY_LIMIT,
  WORKDAYS_PER_WEEK_MAX,
  WORKDAYS_PER_WEEK_MIN,
  addWorkingDays,
  assertUsableCalendar,
  coerceProjectCalendar,
  diffWorkingDays,
  hoursPerWorkdaySchema,
  isWorkingDay,
  isoWeekday,
  nonWorkingDaySchema,
  nonWorkingDaysSchema,
  normalizeNonWorkingDays,
  planDurationWorkingDays,
  planWindowFromDatedItems,
  scheduledEffortHours,
  workdaysPerWeekSchema,
  type PlanDateSpan,
  type ProjectWorkingCalendar,
} from './working-calendar.js';

export {
  DEFAULT_SCHEDULE_SLIP_ITEM_TYPES,
  DEFAULT_SCHEDULE_SLIP_THRESHOLD_DAYS,
  SCHEDULE_SLIP_CLOSURE_NOTE,
  SCHEDULE_SLIP_ITEM_TYPES,
  SCHEDULE_SLIP_SOURCE,
  decideScheduleSlipRisk,
  evaluateDeliveryScheduleSlips,
  evaluateScheduleSlip,
  initialBaselineFinish,
  normalizeScheduleSlipItemTypes,
  scheduleSlipDescription,
  scheduleSlipItemTypeSchema,
  scheduleSlipRating,
  scheduleSlipSettingsFromRow,
  scheduleSlipThresholdSchema,
  scheduleSlipTitle,
  scheduleSlipWindow,
  stripScheduleSlipClosureNote,
  withScheduleSlipClosureNote,
  type OpenAutoSlipRisk,
  type ScheduleSlipDecision,
  type ScheduleSlipEpicInput,
  type ScheduleSlipEvaluation,
  type ScheduleSlipHit,
  type ScheduleSlipItemType,
  type ScheduleSlipMilestoneInput,
  type ScheduleSlipRating,
  type ScheduleSlipSettings,
  type ScheduleSlipStoryInput,
  type ScheduleSlipTaskInput,
} from './schedule-slip.js';

export {
  AI_BILLING_ACTIVE_STATUSES,
  AI_BILLING_AVG_DAYS_PER_MONTH,
  AI_BILLING_ENTRY_TYPES,
  aiBillingCostComparison,
  aiBillingPaidCost,
  aiBillingPeriodInWindow,
  allocateAiBillingPool,
  assertAiBillingPeriod,
  assertAllocationPercent,
  assertServiceDate,
  buildPlatformAiCost,
  currentAiBillingPeriod,
  defaultAiBillingWindow,
  flatFeeMonthShares,
  isAiBillingActiveProject,
  listAiBillingPeriods,
  resolveAiBillingWindow,
  resolveBillingServiceWindow,
  roundAiMoney,
  scaleAiBillingTypes,
  settleProjectAiCost,
  shiftAiBillingPeriod,
  splitAiMoney,
  splitBillingEntryByMonth,
  summarizeAiBillingMonth,
  type AiBillingAllocationMethod,
  type AiBillingAllocationProject,
  type AiBillingAllocationShare,
  type AiBillingEntryType,
  type AiBillingMonthParts,
  type AiBillingMonthSummary,
  type AiBillingProjectShare,
  type BillingEntryMonthInput,
  type BillingMonthSlice,
  type BillingServiceWindow,
  type AiBillingTypeAmounts,
  type PlatformAiCostEntry,
  type PlatformAiCostEntryFilter,
  type PlatformAiCostEntryInput,
  type PlatformAiWorkspaceMonth,
  type AiCostUsageSlice,
  type AiFallbackSystem,
  type AiPaidPeriod,
  type AiPaidPeriodSource,
  type SettledProjectAiCost,
  type SettleProjectAiCostInput,
} from './ai-billing.js';

export {
  convertMoney,
  convertMoneyParts,
  isoDateOnly,
  lookupFxRate,
  paidConversionDate,
  splitSignedMoney,
  theoreticalUsageDate,
  usageConversionDate,
  type FxConversion,
  type FxRate,
} from './fx.js';

export {
  ECB_EUROFX_90_URL,
  ECB_EUROFX_FULL_URL,
  MNB_EXCHANGE_RATE_URL,
  loadReferenceRates,
  mnbExchangeRatesRequest,
  parseEcbEuroFx,
  parseMnbRates,
  type FxFetcher,
} from './fx-feed.js';

export {
  AI_COST_RANGES,
  fillAiCostChart,
  fillPlatformAiCostMonths,
  formatAiBillingMonthLabel,
  periodsCoveredByEntry,
  assertAiCostViewBound,
  assertAiCostViewBounds,
  resolveAiCostViewWindow,
  type AiCostChartMonth,
  type AiCostChartSourcePoint,
  type AiCostCoverageEntry,
  type AiCostRange,
  type AiCostResolvedWindow,
  type AiCostViewRange,
  type PlatformAiCostMonthRow,
} from './ai-billing-chart.js';

export {
  AI_COST_DAY_LIMIT,
  AI_COST_GRAINS,
  aggregateAiCostBuckets,
  calendarMonthWindow,
  calendarQuarterWindow,
  firstDayOfMonth,
  formatAiCostDayLabel,
  isAiCostGrain,
  isIsoDay,
  isIsoMonth,
  lastDayOfMonth,
  listCalendarDays,
  paidDaysFromBillingEntries,
  resolveAiCostGrain,
  splitBillingEntryByDay,
  weekStartMonday,
  zonedCalendarParts,
  type AiCostBucket,
  type AiCostDayAmount,
  type AiCostGrain,
  type BillingDaySlice,
} from './ai-cost-granularity.js';

export {
  DEFAULT_AI_MODEL_PRICES,
  importedCloudAgentIds,
  matchAiModelPrice,
  modelPatternMatches,
  parseUsagePaidAmount,
  priceImportedUsage,
  taskSupersededByImport,
  theoreticalMonths,
  theoreticalTokenCost,
  type AiModelPrice,
  type ImportedUsageForPrice,
  type PricedImportedUsage,
  type TheoreticalMonthSplit,
  type UnpricedModel,
  type UsageTokenCounts,
} from './ai-model-price.js';

export {
  AI_COST_NOTES_MAX,
  AI_MODEL_ID_MAX,
  AI_PRICING_TIER_MAX,
  MAX_TOKEN_COUNT,
  aiBillingPeriodSchema,
  assertReportedAiUsage,
  mergeAiUsage,
  parseAiCostNotes,
  parseAiModelId,
  parseAiPricingTier,
  parseBillingPeriod,
  parseUsageOccurredAt,
  tokenBreakdownSum,
  tokenCountSchema,
  usageHasTokenBreakdown,
  type AiUsageCounts,
  type AiUsagePatch,
} from './ai-cost.js';

export {
  AI_USAGE_IMPORT_SOURCES,
  CLOUD_AGENT_ID_MAX,
  CURSOR_USAGE_CSV_HEADERS,
  USAGE_CSV_MAX_CHARS,
  USAGE_CSV_MAX_ROWS,
  USAGE_IMPORT_ERROR_LIMIT,
  aggregateLinkedUsage,
  dedupeUsageRows,
  linkUsageRows,
  mapCursorUsageTokens,
  parseCloudAgentId,
  parseCursorUsageCsv,
  parseUsageSource,
  previewUsageImport,
  summarizeUsageRows,
  usageRowHash,
  type AiUsageImportSource,
  type AiUsageImportSummary,
  type AiUsageRowError,
  type NormalizedAiUsageRow,
  type TaskUsageAggregate,
  type UsageImportStats,
  type UsageModelTotal,
  type UsageTokenTotals,
} from './ai-usage-import.js';

/**
 * ISO 4217 code stored uppercase. Lowercase input is normalised.
 * Unknown codes throw a validation error that lists the supported set.
 */
export function parseProjectCurrency(value: string): ProjectCurrency {
  const normalized = value.trim().toUpperCase();
  const parsed = projectCurrencySchema.safeParse(normalized);
  if (!parsed.success) {
    throw new AppError({
      code: 'VALIDATION_ERROR',
      message:
        `Invalid currency "${value}". Allowed values: ` +
        `${projectCurrencySchema.options.join(', ')}.`,
      statusCode: 400,
    });
  }
  return parsed.data;
}

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

export {
  PROJECT_METHODOLOGIES,
  assertMcpProjectStageChange,
  buildProjectMetadata,
  normalizeProjectName,
  parseProjectMethodology,
  projectNamesAreSimilar,
  type ProjectAgentMetadata,
  type ProjectFieldGuide,
  type ProjectMethodology,
} from './project-agent.js';

export {
  TIMELINE_AT_RISK_DAYS,
  addDaysYmd,
  assessRiskRag,
  computeFinancialRag,
  computeRiskRag,
  emptyProjectHealth,
  projectHealthFromBudget,
  raidDueDateTone,
  timelineRag,
  todayYmd,
  worstProjectRag,
  type ProjectHealth,
  type ProjectRagStatus,
  type RiskRagAssessment,
  type RiskRagCause,
  type RiskRagItem,
  type RiskRagReason,
} from './project-health.js';
