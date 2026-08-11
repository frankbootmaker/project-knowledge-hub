import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type { Database } from '@project-knowledge-hub/database';
import {
  memberships,
  projectStakeholders,
  projectTaskRaci,
  projectTasks,
  systems,
  users,
} from '@project-knowledge-hub/database';
import {
  AppError,
  aiCostModeSchema,
  projectStakeholderRoleSchema,
  raciRoleSchema,
  resolveAssistantBrand,
  stakeholderCompetenciesSchema,
  stakeholderEngagementTypeSchema,
  type AiCostMode,
  type AssistantBrand,
  type ProjectStakeholderRole,
  type RaciRole,
  type StakeholderCompetencies,
  type StakeholderEngagementType,
  type StakeholderStaffingStatus,
} from '@project-knowledge-hub/domain';
import {
  assertProjectNotArchived,
  requireProjectContext,
} from './project-delivery.js';
import { avatarUrlForUser } from './public-user.js';

export type StakeholderKind = 'person' | 'ai_assistant' | 'open_role';
export type StakeholderSource = 'roster' | 'owner' | 'raci' | 'ai_assistant';

/** Catalogue systems with this type appear as AI-assistant stakeholders (not general Systems). */
export const AI_ASSISTANT_SYSTEM_TYPE = 'ai_assistant';

export type PublicStakeholder = {
  kind: StakeholderKind;
  /**
   * Stable id: userId for people, roster uuid for open roles,
   * `ai:<systemUuid>` for AI assistants.
   */
  id: string;
  userId: string | null;
  systemId: string | null;
  displayName: string;
  fullName: string | null;
  email: string | null;
  projectRole: ProjectStakeholderRole | null;
  jobTitle: string | null;
  roleDescription: string | null;
  competencies: StakeholderCompetencies;
  staffingStatus: StakeholderStaffingStatus | null;
  notes: string | null;
  reportsToUserId: string | null;
  hourlyRate: string | null;
  engagementType: StakeholderEngagementType | null;
  assignmentStart: string | null;
  assignmentEnd: string | null;
  allocatedDailyHours: string | null;
  contractRef: string | null;
  contractedBudget: string | null;
  contractStart: string | null;
  contractEnd: string | null;
  /** Profile photo URL for people; null when unset (UI uses monogram). */
  avatarUrl: string | null;
  /** LLM/product brand for AI assistants; null for people. */
  assistantBrand: AssistantBrand | null;
  /** AI cost mode when kind is ai_assistant. */
  aiCostMode: AiCostMode | null;
  aiFlatMonthlyFee: string | null;
  aiTokenRatePer1k: string | null;
  aiBudgetAllocation: string | null;
  raciRoles: RaciRole[];
  taskCount: number;
  sources: StakeholderSource[];
  rosterId: string | null;
  sortOrder: number;
  systemSlug: string | null;
  systemStatus: string | null;
};

function parseCompetencies(value: unknown): StakeholderCompetencies {
  const parsed = stakeholderCompetenciesSchema.safeParse(value ?? []);
  return parsed.success ? parsed.data : [];
}

function emptyPersonFields(): Pick<
  PublicStakeholder,
  | 'roleDescription'
  | 'competencies'
  | 'staffingStatus'
  | 'notes'
  | 'reportsToUserId'
  | 'hourlyRate'
  | 'engagementType'
  | 'assignmentStart'
  | 'assignmentEnd'
  | 'allocatedDailyHours'
  | 'contractRef'
  | 'contractedBudget'
  | 'contractStart'
  | 'contractEnd'
  | 'avatarUrl'
  | 'assistantBrand'
  | 'aiCostMode'
  | 'aiFlatMonthlyFee'
  | 'aiTokenRatePer1k'
  | 'aiBudgetAllocation'
  | 'raciRoles'
  | 'taskCount'
  | 'rosterId'
  | 'systemSlug'
  | 'systemStatus'
> {
  return {
    roleDescription: null,
    competencies: [],
    staffingStatus: null,
    notes: null,
    reportsToUserId: null,
    hourlyRate: null,
    engagementType: null,
    assignmentStart: null,
    assignmentEnd: null,
    allocatedDailyHours: null,
    contractRef: null,
    contractedBudget: null,
    contractStart: null,
    contractEnd: null,
    avatarUrl: null,
    assistantBrand: null,
    aiCostMode: null,
    aiFlatMonthlyFee: null,
    aiTokenRatePer1k: null,
    aiBudgetAllocation: null,
    raciRoles: [],
    taskCount: 0,
    rosterId: null,
    systemSlug: null,
    systemStatus: null,
  };
}

function parseEngagementType(
  value: string | null | undefined,
): StakeholderEngagementType | null {
  if (!value) return null;
  const parsed = stakeholderEngagementTypeSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function parseAiCostMode(value: string | null | undefined): AiCostMode | null {
  if (!value) return null;
  const parsed = aiCostModeSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

async function assertWorkspaceMembers(
  database: Database,
  workspaceId: string,
  userIds: string[],
): Promise<void> {
  if (userIds.length === 0) return;
  const unique = [...new Set(userIds)];
  const rows = await database.db
    .select({ userId: memberships.userId })
    .from(memberships)
    .innerJoin(users, eq(memberships.userId, users.id))
    .where(
      and(
        eq(memberships.workspaceId, workspaceId),
        inArray(memberships.userId, unique),
        eq(users.status, 'active'),
      ),
    );
  if (rows.length !== unique.length) {
    throw new AppError({
      code: 'STAKEHOLDER_USER_NOT_MEMBER',
      message: 'Stakeholder users must be active members of the project workspace',
      statusCode: 400,
    });
  }
}

async function loadUserMap(
  database: Database,
  userIds: string[],
): Promise<
  Map<
    string,
    {
      displayName: string;
      fullName: string | null;
      email: string;
      avatarUrl: string | null;
    }
  >
> {
  const map = new Map<
    string,
    {
      displayName: string;
      fullName: string | null;
      email: string;
      avatarUrl: string | null;
    }
  >();
  if (userIds.length === 0) return map;
  const rows = await database.db
    .select({
      id: users.id,
      displayName: users.displayName,
      fullName: users.fullName,
      email: users.email,
      avatarContentType: users.avatarContentType,
      updatedAt: users.updatedAt,
    })
    .from(users)
    .where(inArray(users.id, [...new Set(userIds)]));
  for (const row of rows) {
    map.set(row.id, {
      displayName: row.displayName,
      fullName: row.fullName,
      email: row.email,
      avatarUrl: avatarUrlForUser(
        row.id,
        row.avatarContentType ?? null,
        row.updatedAt,
      ),
    });
  }
  return map;
}

/** Collect user ids that count as stakeholders for reports-to validation. */
async function collectStakeholderUserIds(
  database: Database,
  projectId: string,
  ownerUserId: string | null,
): Promise<Set<string>> {
  const ids = new Set<string>();
  if (ownerUserId) ids.add(ownerUserId);

  const roster = await database.db
    .select({ userId: projectStakeholders.userId })
    .from(projectStakeholders)
    .where(eq(projectStakeholders.projectId, projectId));
  for (const row of roster) {
    if (row.userId) ids.add(row.userId);
  }

  const raciRows = await database.db
    .select({ userId: projectTaskRaci.userId })
    .from(projectTaskRaci)
    .innerJoin(projectTasks, eq(projectTaskRaci.taskId, projectTasks.id))
    .where(
      and(eq(projectTasks.projectId, projectId), isNull(projectTasks.archivedAt)),
    );
  for (const row of raciRows) ids.add(row.userId);

  return ids;
}

async function assertNoReportsToCycle(
  database: Database,
  projectId: string,
  userId: string,
  reportsToUserId: string | null,
): Promise<void> {
  if (!reportsToUserId) return;
  if (reportsToUserId === userId) {
    throw new AppError({
      code: 'STAKEHOLDER_REPORTS_TO_SELF',
      message: 'A stakeholder cannot report to themselves',
      statusCode: 400,
    });
  }

  const edges = new Map<string, string | null>();
  const roster = await database.db
    .select({
      userId: projectStakeholders.userId,
      reportsToUserId: projectStakeholders.reportsToUserId,
    })
    .from(projectStakeholders)
    .where(eq(projectStakeholders.projectId, projectId));
  for (const row of roster) {
    if (row.userId) edges.set(row.userId, row.reportsToUserId);
  }
  edges.set(userId, reportsToUserId);

  let cursor: string | null = reportsToUserId;
  const seen = new Set<string>([userId]);
  while (cursor) {
    if (seen.has(cursor)) {
      throw new AppError({
        code: 'STAKEHOLDER_REPORTS_TO_CYCLE',
        message: 'Reporting line would create a cycle',
        statusCode: 400,
      });
    }
    seen.add(cursor);
    cursor = edges.get(cursor) ?? null;
  }
}

export async function listProjectStakeholders(
  database: Database,
  projectId: string,
): Promise<PublicStakeholder[]> {
  const { project } = await requireProjectContext(database, projectId);

  const rosterRows = await database.db
    .select()
    .from(projectStakeholders)
    .where(eq(projectStakeholders.projectId, projectId))
    .orderBy(asc(projectStakeholders.sortOrder), asc(projectStakeholders.createdAt));

  const raciAgg = await database.db
    .select({
      userId: projectTaskRaci.userId,
      role: projectTaskRaci.role,
      taskId: projectTaskRaci.taskId,
    })
    .from(projectTaskRaci)
    .innerJoin(projectTasks, eq(projectTaskRaci.taskId, projectTasks.id))
    .where(
      and(eq(projectTasks.projectId, projectId), isNull(projectTasks.archivedAt)),
    );

  type Acc = {
    raciRoles: Set<RaciRole>;
    taskIds: Set<string>;
  };
  const raciByUser = new Map<string, Acc>();
  for (const row of raciAgg) {
    const role = raciRoleSchema.safeParse(row.role);
    if (!role.success) continue;
    let acc = raciByUser.get(row.userId);
    if (!acc) {
      acc = { raciRoles: new Set(), taskIds: new Set() };
      raciByUser.set(row.userId, acc);
    }
    acc.raciRoles.add(role.data);
    acc.taskIds.add(row.taskId);
  }

  // Only AI assistants (not general catalogue Systems like Proxmox / KnowHub).
  const aiAssistants = await database.db
    .select({
      id: systems.id,
      name: systems.name,
      slug: systems.slug,
      summary: systems.summary,
      systemType: systems.systemType,
      status: systems.status,
      ownerUserId: systems.ownerUserId,
      metadataJson: systems.metadataJson,
      aiCostMode: systems.aiCostMode,
      aiFlatMonthlyFee: systems.aiFlatMonthlyFee,
      aiTokenRatePer1k: systems.aiTokenRatePer1k,
      aiBudgetAllocation: systems.aiBudgetAllocation,
    })
    .from(systems)
    .where(
      and(
        eq(systems.projectId, projectId),
        eq(systems.systemType, AI_ASSISTANT_SYSTEM_TYPE),
        isNull(systems.archivedAt),
      ),
    )
    .orderBy(asc(systems.name));

  const userIds = new Set<string>();
  for (const row of rosterRows) {
    if (row.userId) userIds.add(row.userId);
  }
  for (const userId of raciByUser.keys()) userIds.add(userId);
  if (project.ownerUserId) userIds.add(project.ownerUserId);
  for (const assistant of aiAssistants) {
    if (assistant.ownerUserId) userIds.add(assistant.ownerUserId);
  }

  const userMap = await loadUserMap(database, [...userIds]);
  const byPerson = new Map<string, PublicStakeholder>();
  const openRoles: PublicStakeholder[] = [];

  const ensurePerson = (userId: string): PublicStakeholder | null => {
    const existing = byPerson.get(userId);
    if (existing) return existing;
    const profile = userMap.get(userId);
    if (!profile) return null;
    const entry: PublicStakeholder = {
      kind: 'person',
      id: userId,
      userId,
      systemId: null,
      displayName: profile.displayName,
      fullName: profile.fullName,
      email: profile.email,
      projectRole: null,
      jobTitle: null,
      ...emptyPersonFields(),
      avatarUrl: profile.avatarUrl,
      sources: [],
      sortOrder: 1000,
    };
    byPerson.set(userId, entry);
    return entry;
  };

  const applyRosterFields = (
    entry: PublicStakeholder,
    row: typeof projectStakeholders.$inferSelect,
  ) => {
    entry.rosterId = row.id;
    entry.projectRole = projectStakeholderRoleSchema.parse(row.projectRole);
    entry.jobTitle = row.jobTitle;
    entry.roleDescription = row.roleDescription;
    entry.competencies = parseCompetencies(row.competencies);
    entry.notes = row.notes;
    entry.reportsToUserId = row.reportsToUserId;
    entry.hourlyRate = row.hourlyRate;
    entry.engagementType = parseEngagementType(row.engagementType);
    entry.assignmentStart = row.assignmentStart;
    entry.assignmentEnd = row.assignmentEnd;
    entry.allocatedDailyHours = row.allocatedDailyHours;
    entry.contractRef = row.contractRef;
    entry.contractedBudget = row.contractedBudget;
    entry.contractStart = row.contractStart;
    entry.contractEnd = row.contractEnd;
    entry.sortOrder = row.sortOrder;
    if (!entry.sources.includes('roster')) entry.sources.push('roster');
  };

  for (const row of rosterRows) {
    if (!row.userId) {
      const roleLabel =
        row.jobTitle?.trim() ||
        projectStakeholderRoleSchema.safeParse(row.projectRole).data ||
        'Open role';
      openRoles.push({
        kind: 'open_role',
        id: row.id,
        userId: null,
        systemId: null,
        displayName: roleLabel,
        fullName: null,
        email: null,
        projectRole: projectStakeholderRoleSchema.parse(row.projectRole),
        jobTitle: row.jobTitle,
        roleDescription: row.roleDescription,
        competencies: parseCompetencies(row.competencies),
        staffingStatus: 'open',
        notes: row.notes,
        reportsToUserId: row.reportsToUserId,
        hourlyRate: row.hourlyRate,
        engagementType: parseEngagementType(row.engagementType),
        assignmentStart: row.assignmentStart,
        assignmentEnd: row.assignmentEnd,
        allocatedDailyHours: row.allocatedDailyHours,
        contractRef: row.contractRef,
        contractedBudget: row.contractedBudget,
        contractStart: row.contractStart,
        contractEnd: row.contractEnd,
        avatarUrl: null,
        assistantBrand: null,
        aiCostMode: null,
        aiFlatMonthlyFee: null,
        aiTokenRatePer1k: null,
        aiBudgetAllocation: null,
        raciRoles: [],
        taskCount: 0,
        sources: ['roster'],
        rosterId: row.id,
        sortOrder: row.sortOrder,
        systemSlug: null,
        systemStatus: null,
      });
      continue;
    }
    const entry = ensurePerson(row.userId);
    if (!entry) continue;
    applyRosterFields(entry, row);
    entry.staffingStatus = 'assigned';
  }

  if (project.ownerUserId) {
    const entry = ensurePerson(project.ownerUserId);
    if (entry) {
      if (!entry.sources.includes('owner')) entry.sources.push('owner');
      if (!entry.projectRole) {
        entry.projectRole = 'owner';
      }
      entry.sortOrder = Math.min(entry.sortOrder, 0);
    }
  }

  for (const [userId, agg] of raciByUser) {
    const entry = ensurePerson(userId);
    if (!entry) continue;
    entry.raciRoles = [...agg.raciRoles].sort();
    entry.taskCount = agg.taskIds.size;
    if (!entry.sources.includes('raci')) entry.sources.push('raci');
  }

  // Ensure AI-assistant owners appear so org-chart edges can resolve.
  for (const assistant of aiAssistants) {
    if (assistant.ownerUserId) {
      ensurePerson(assistant.ownerUserId);
    }
  }

  const aiEntries: PublicStakeholder[] = aiAssistants.map((assistant, index) => {
    const ownerInSet =
      assistant.ownerUserId && byPerson.has(assistant.ownerUserId)
        ? assistant.ownerUserId
        : null;
    return {
      kind: 'ai_assistant' as const,
      id: `ai:${assistant.id}`,
      userId: null,
      systemId: assistant.id,
      displayName: assistant.name,
      fullName: null,
      email: null,
      projectRole: null,
      jobTitle: 'AI assistant',
      roleDescription: null,
      competencies: [],
      staffingStatus: null,
      notes: assistant.summary,
      reportsToUserId: ownerInSet,
      hourlyRate: null,
      engagementType: null,
      assignmentStart: null,
      assignmentEnd: null,
      allocatedDailyHours: null,
      contractRef: null,
      contractedBudget: null,
      contractStart: null,
      contractEnd: null,
      avatarUrl: null,
      assistantBrand: resolveAssistantBrand({
        name: assistant.name,
        slug: assistant.slug,
        metadata: assistant.metadataJson,
      }),
      aiCostMode: parseAiCostMode(assistant.aiCostMode),
      aiFlatMonthlyFee: assistant.aiFlatMonthlyFee,
      aiTokenRatePer1k: assistant.aiTokenRatePer1k,
      aiBudgetAllocation: assistant.aiBudgetAllocation,
      raciRoles: [],
      taskCount: 0,
      sources: ['ai_assistant'] as StakeholderSource[],
      rosterId: null,
      sortOrder: 500 + index,
      systemSlug: assistant.slug,
      systemStatus: assistant.status,
    };
  });

  const KIND_ORDER: Record<StakeholderKind, number> = {
    person: 0,
    open_role: 1,
    ai_assistant: 2,
  };
  const RACI_ORDER: RaciRole[] = ['A', 'R', 'C', 'I'];
  return [...byPerson.values(), ...openRoles, ...aiEntries].sort((a, b) => {
    if (a.kind !== b.kind) return KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    const aRole = a.raciRoles[0] ? RACI_ORDER.indexOf(a.raciRoles[0]) : 99;
    const bRole = b.raciRoles[0] ? RACI_ORDER.indexOf(b.raciRoles[0]) : 99;
    if (aRole !== bRole) return aRole - bRole;
    return a.displayName.localeCompare(b.displayName);
  });
}

export async function getRosterStakeholder(
  database: Database,
  rosterId: string,
): Promise<typeof projectStakeholders.$inferSelect> {
  const [row] = await database.db
    .select()
    .from(projectStakeholders)
    .where(eq(projectStakeholders.id, rosterId))
    .limit(1);
  if (!row) {
    throw new AppError({
      code: 'STAKEHOLDER_NOT_FOUND',
      message: 'Stakeholder roster entry not found',
      statusCode: 404,
    });
  }
  return row;
}

export type StakeholderCapacityInput = {
  engagementType?: StakeholderEngagementType | null;
  assignmentStart?: string | null;
  assignmentEnd?: string | null;
  allocatedDailyHours?: string | null;
  contractRef?: string | null;
  contractedBudget?: string | null;
  contractStart?: string | null;
  contractEnd?: string | null;
};

function normalizeCompetenciesInput(
  value: unknown | undefined,
): StakeholderCompetencies | undefined {
  if (value === undefined) return undefined;
  return stakeholderCompetenciesSchema.parse(value ?? []);
}

export async function upsertProjectStakeholder(
  database: Database,
  input: {
    projectId: string;
    workspaceId: string;
    /** Omit or null to create an open job role (requires jobTitle). */
    userId?: string | null;
    projectRole: ProjectStakeholderRole;
    jobTitle?: string | null;
    roleDescription?: string | null;
    competencies?: StakeholderCompetencies;
    notes?: string | null;
    reportsToUserId?: string | null;
    hourlyRate?: string | null;
    sortOrder?: number;
  } & StakeholderCapacityInput,
): Promise<PublicStakeholder> {
  const { project } = await requireProjectContext(database, input.projectId);
  assertProjectNotArchived(project);

  const userId = input.userId ?? null;
  const jobTitle = input.jobTitle?.trim() || null;
  if (!userId && !jobTitle) {
    throw new AppError({
      code: 'STAKEHOLDER_OPEN_ROLE_TITLE_REQUIRED',
      message: 'Open job roles require a job title',
      statusCode: 400,
    });
  }

  if (userId) {
    await assertWorkspaceMembers(database, input.workspaceId, [userId]);
  }

  if (input.reportsToUserId) {
    await assertWorkspaceMembers(database, input.workspaceId, [
      input.reportsToUserId,
    ]);
    const allowed = await collectStakeholderUserIds(
      database,
      input.projectId,
      project.ownerUserId,
    );
    if (userId) allowed.add(userId);
    if (!allowed.has(input.reportsToUserId)) {
      throw new AppError({
        code: 'STAKEHOLDER_REPORTS_TO_UNKNOWN',
        message:
          'reportsToUserId must be a project stakeholder (roster, owner, or RACI)',
        statusCode: 400,
      });
    }
    if (userId) {
      await assertNoReportsToCycle(
        database,
        input.projectId,
        userId,
        input.reportsToUserId,
      );
    }
  }

  const competencies =
    input.competencies === undefined
      ? undefined
      : normalizeCompetenciesInput(input.competencies) ?? [];

  let rosterId: string | null = null;

  if (userId) {
    const [existing] = await database.db
      .select()
      .from(projectStakeholders)
      .where(
        and(
          eq(projectStakeholders.projectId, input.projectId),
          eq(projectStakeholders.userId, userId),
        ),
      )
      .limit(1);

    if (existing) {
      rosterId = existing.id;
      await database.db
        .update(projectStakeholders)
        .set({
          projectRole: input.projectRole,
          jobTitle: input.jobTitle === undefined ? existing.jobTitle : jobTitle,
          roleDescription:
            input.roleDescription === undefined
              ? existing.roleDescription
              : input.roleDescription,
          competencies:
            competencies === undefined ? existing.competencies : competencies,
          notes: input.notes === undefined ? existing.notes : input.notes,
          reportsToUserId:
            input.reportsToUserId === undefined
              ? existing.reportsToUserId
              : input.reportsToUserId,
          hourlyRate:
            input.hourlyRate === undefined
              ? existing.hourlyRate
              : input.hourlyRate,
          engagementType:
            input.engagementType === undefined
              ? existing.engagementType
              : input.engagementType,
          assignmentStart:
            input.assignmentStart === undefined
              ? existing.assignmentStart
              : input.assignmentStart,
          assignmentEnd:
            input.assignmentEnd === undefined
              ? existing.assignmentEnd
              : input.assignmentEnd,
          allocatedDailyHours:
            input.allocatedDailyHours === undefined
              ? existing.allocatedDailyHours
              : input.allocatedDailyHours,
          contractRef:
            input.contractRef === undefined
              ? existing.contractRef
              : input.contractRef,
          contractedBudget:
            input.contractedBudget === undefined
              ? existing.contractedBudget
              : input.contractedBudget,
          contractStart:
            input.contractStart === undefined
              ? existing.contractStart
              : input.contractStart,
          contractEnd:
            input.contractEnd === undefined
              ? existing.contractEnd
              : input.contractEnd,
          sortOrder: input.sortOrder ?? existing.sortOrder,
          updatedAt: new Date(),
        })
        .where(eq(projectStakeholders.id, existing.id));
    } else {
      const [inserted] = await database.db
        .insert(projectStakeholders)
        .values({
          projectId: input.projectId,
          userId,
          projectRole: input.projectRole,
          jobTitle,
          roleDescription: input.roleDescription ?? null,
          competencies: competencies ?? [],
          notes: input.notes ?? null,
          reportsToUserId: input.reportsToUserId ?? null,
          hourlyRate: input.hourlyRate ?? null,
          engagementType: input.engagementType ?? null,
          assignmentStart: input.assignmentStart ?? null,
          assignmentEnd: input.assignmentEnd ?? null,
          allocatedDailyHours: input.allocatedDailyHours ?? null,
          contractRef: input.contractRef ?? null,
          contractedBudget: input.contractedBudget ?? null,
          contractStart: input.contractStart ?? null,
          contractEnd: input.contractEnd ?? null,
          sortOrder: input.sortOrder ?? 0,
        })
        .returning({ id: projectStakeholders.id });
      rosterId = inserted?.id ?? null;
    }
  } else {
    const [inserted] = await database.db
      .insert(projectStakeholders)
      .values({
        projectId: input.projectId,
        userId: null,
        projectRole: input.projectRole,
        jobTitle,
        roleDescription: input.roleDescription ?? null,
        competencies: competencies ?? [],
        notes: input.notes ?? null,
        reportsToUserId: input.reportsToUserId ?? null,
        hourlyRate: input.hourlyRate ?? null,
        engagementType: input.engagementType ?? null,
        assignmentStart: input.assignmentStart ?? null,
        assignmentEnd: input.assignmentEnd ?? null,
        allocatedDailyHours: input.allocatedDailyHours ?? null,
        contractRef: input.contractRef ?? null,
        contractedBudget: input.contractedBudget ?? null,
        contractStart: input.contractStart ?? null,
        contractEnd: input.contractEnd ?? null,
        sortOrder: input.sortOrder ?? 0,
      })
      .returning({ id: projectStakeholders.id });
    rosterId = inserted?.id ?? null;
  }

  const list = await listProjectStakeholders(database, input.projectId);
  const found = userId
    ? list.find((row) => row.kind === 'person' && row.userId === userId)
    : list.find((row) => row.kind === 'open_role' && row.rosterId === rosterId);
  if (!found) {
    throw new AppError({
      code: 'STAKEHOLDER_NOT_FOUND',
      message: 'Stakeholder was not found after upsert',
      statusCode: 500,
    });
  }
  return found;
}

export async function updateProjectStakeholder(
  database: Database,
  rosterId: string,
  input: {
    projectRole?: ProjectStakeholderRole;
    jobTitle?: string | null;
    roleDescription?: string | null;
    competencies?: StakeholderCompetencies;
    notes?: string | null;
    reportsToUserId?: string | null;
    hourlyRate?: string | null;
    sortOrder?: number;
  } & StakeholderCapacityInput,
): Promise<PublicStakeholder> {
  const existing = await getRosterStakeholder(database, rosterId);
  const { project } = await requireProjectContext(database, existing.projectId);
  assertProjectNotArchived(project);

  const nextJobTitle =
    input.jobTitle === undefined
      ? existing.jobTitle
      : input.jobTitle?.trim() || null;
  if (!existing.userId && !nextJobTitle) {
    throw new AppError({
      code: 'STAKEHOLDER_OPEN_ROLE_TITLE_REQUIRED',
      message: 'Open job roles require a job title',
      statusCode: 400,
    });
  }

  const nextReportsTo =
    input.reportsToUserId === undefined
      ? existing.reportsToUserId
      : input.reportsToUserId;

  if (nextReportsTo) {
    await assertWorkspaceMembers(database, project.workspaceId, [nextReportsTo]);
    const allowed = await collectStakeholderUserIds(
      database,
      existing.projectId,
      project.ownerUserId,
    );
    if (existing.userId) allowed.add(existing.userId);
    if (!allowed.has(nextReportsTo)) {
      throw new AppError({
        code: 'STAKEHOLDER_REPORTS_TO_UNKNOWN',
        message:
          'reportsToUserId must be a project stakeholder (roster, owner, or RACI)',
        statusCode: 400,
      });
    }
    if (existing.userId) {
      await assertNoReportsToCycle(
        database,
        existing.projectId,
        existing.userId,
        nextReportsTo,
      );
    }
  }

  const competencies =
    input.competencies === undefined
      ? undefined
      : normalizeCompetenciesInput(input.competencies) ?? [];

  await database.db
    .update(projectStakeholders)
    .set({
      projectRole: input.projectRole ?? existing.projectRole,
      jobTitle: nextJobTitle,
      roleDescription:
        input.roleDescription === undefined
          ? existing.roleDescription
          : input.roleDescription,
      competencies:
        competencies === undefined ? existing.competencies : competencies,
      notes: input.notes === undefined ? existing.notes : input.notes,
      reportsToUserId: nextReportsTo,
      hourlyRate:
        input.hourlyRate === undefined ? existing.hourlyRate : input.hourlyRate,
      engagementType:
        input.engagementType === undefined
          ? existing.engagementType
          : input.engagementType,
      assignmentStart:
        input.assignmentStart === undefined
          ? existing.assignmentStart
          : input.assignmentStart,
      assignmentEnd:
        input.assignmentEnd === undefined
          ? existing.assignmentEnd
          : input.assignmentEnd,
      allocatedDailyHours:
        input.allocatedDailyHours === undefined
          ? existing.allocatedDailyHours
          : input.allocatedDailyHours,
      contractRef:
        input.contractRef === undefined
          ? existing.contractRef
          : input.contractRef,
      contractedBudget:
        input.contractedBudget === undefined
          ? existing.contractedBudget
          : input.contractedBudget,
      contractStart:
        input.contractStart === undefined
          ? existing.contractStart
          : input.contractStart,
      contractEnd:
        input.contractEnd === undefined ? existing.contractEnd : input.contractEnd,
      sortOrder: input.sortOrder ?? existing.sortOrder,
      updatedAt: new Date(),
    })
    .where(eq(projectStakeholders.id, rosterId));

  const list = await listProjectStakeholders(database, existing.projectId);
  const found = list.find((row) => row.rosterId === rosterId);
  if (!found) {
    throw new AppError({
      code: 'STAKEHOLDER_NOT_FOUND',
      message: 'Stakeholder was not found after update',
      statusCode: 500,
    });
  }
  return found;
}

export async function assignProjectStakeholder(
  database: Database,
  rosterId: string,
  userId: string,
): Promise<PublicStakeholder> {
  const existing = await getRosterStakeholder(database, rosterId);
  const { project } = await requireProjectContext(database, existing.projectId);
  assertProjectNotArchived(project);

  if (existing.userId) {
    throw new AppError({
      code: 'STAKEHOLDER_ALREADY_ASSIGNED',
      message: 'This roster seat is already filled; unassign first',
      statusCode: 400,
    });
  }

  await assertWorkspaceMembers(database, project.workspaceId, [userId]);

  const [conflict] = await database.db
    .select({ id: projectStakeholders.id })
    .from(projectStakeholders)
    .where(
      and(
        eq(projectStakeholders.projectId, existing.projectId),
        eq(projectStakeholders.userId, userId),
      ),
    )
    .limit(1);
  if (conflict) {
    throw new AppError({
      code: 'STAKEHOLDER_USER_ALREADY_ON_ROSTER',
      message: 'That workspace member is already on this project roster',
      statusCode: 409,
    });
  }

  if (existing.reportsToUserId) {
    await assertNoReportsToCycle(
      database,
      existing.projectId,
      userId,
      existing.reportsToUserId,
    );
  }

  await database.db
    .update(projectStakeholders)
    .set({ userId, updatedAt: new Date() })
    .where(eq(projectStakeholders.id, rosterId));

  const list = await listProjectStakeholders(database, existing.projectId);
  const found = list.find((row) => row.rosterId === rosterId);
  if (!found) {
    throw new AppError({
      code: 'STAKEHOLDER_NOT_FOUND',
      message: 'Stakeholder was not found after assign',
      statusCode: 500,
    });
  }
  return found;
}

export async function unassignProjectStakeholder(
  database: Database,
  rosterId: string,
): Promise<PublicStakeholder> {
  const existing = await getRosterStakeholder(database, rosterId);
  const { project } = await requireProjectContext(database, existing.projectId);
  assertProjectNotArchived(project);

  if (!existing.userId) {
    throw new AppError({
      code: 'STAKEHOLDER_ALREADY_OPEN',
      message: 'This roster seat is already an open role',
      statusCode: 400,
    });
  }

  const jobTitle = existing.jobTitle?.trim();
  if (!jobTitle) {
    throw new AppError({
      code: 'STAKEHOLDER_OPEN_ROLE_TITLE_REQUIRED',
      message:
        'Set a job title before unassigning so the open role can be advertised',
      statusCode: 400,
    });
  }

  await database.db
    .update(projectStakeholders)
    .set({ userId: null, updatedAt: new Date() })
    .where(eq(projectStakeholders.id, rosterId));

  const list = await listProjectStakeholders(database, existing.projectId);
  const found = list.find((row) => row.rosterId === rosterId);
  if (!found) {
    throw new AppError({
      code: 'STAKEHOLDER_NOT_FOUND',
      message: 'Stakeholder was not found after unassign',
      statusCode: 500,
    });
  }
  return found;
}

export async function updateAiAssistantCost(
  database: Database,
  systemId: string,
  input: {
    aiCostMode?: AiCostMode | null;
    aiFlatMonthlyFee?: string | null;
    aiTokenRatePer1k?: string | null;
    aiBudgetAllocation?: string | null;
  },
): Promise<PublicStakeholder> {
  const [system] = await database.db
    .select()
    .from(systems)
    .where(eq(systems.id, systemId))
    .limit(1);
  if (!system || system.archivedAt) {
    throw new AppError({
      code: 'SYSTEM_NOT_FOUND',
      message: 'AI assistant system not found',
      statusCode: 404,
    });
  }
  if (system.systemType !== AI_ASSISTANT_SYSTEM_TYPE) {
    throw new AppError({
      code: 'SYSTEM_NOT_AI_ASSISTANT',
      message: 'System is not an AI assistant',
      statusCode: 400,
    });
  }
  if (!system.projectId) {
    throw new AppError({
      code: 'SYSTEM_NOT_PROJECT_SCOPED',
      message: 'AI assistant must be linked to a project',
      statusCode: 400,
    });
  }

  const { project } = await requireProjectContext(database, system.projectId);
  assertProjectNotArchived(project);

  await database.db
    .update(systems)
    .set({
      aiCostMode:
        input.aiCostMode === undefined ? system.aiCostMode : input.aiCostMode,
      aiFlatMonthlyFee:
        input.aiFlatMonthlyFee === undefined
          ? system.aiFlatMonthlyFee
          : input.aiFlatMonthlyFee,
      aiTokenRatePer1k:
        input.aiTokenRatePer1k === undefined
          ? system.aiTokenRatePer1k
          : input.aiTokenRatePer1k,
      aiBudgetAllocation:
        input.aiBudgetAllocation === undefined
          ? system.aiBudgetAllocation
          : input.aiBudgetAllocation,
      updatedAt: new Date(),
    })
    .where(eq(systems.id, systemId));

  const list = await listProjectStakeholders(database, system.projectId);
  const found = list.find((row) => row.systemId === systemId);
  if (!found) {
    throw new AppError({
      code: 'STAKEHOLDER_NOT_FOUND',
      message: 'AI assistant was not found after cost update',
      statusCode: 500,
    });
  }
  return found;
}

export async function deleteProjectStakeholder(
  database: Database,
  rosterId: string,
): Promise<{ projectId: string; userId: string | null }> {
  const existing = await getRosterStakeholder(database, rosterId);
  const { project } = await requireProjectContext(database, existing.projectId);
  assertProjectNotArchived(project);

  await database.db
    .delete(projectStakeholders)
    .where(eq(projectStakeholders.id, rosterId));

  return { projectId: existing.projectId, userId: existing.userId };
}

export async function listWorkspaceMembers(
  database: Database,
  workspaceId: string,
): Promise<
  Array<{
    userId: string;
    displayName: string;
    fullName: string | null;
    email: string;
    role: string;
  }>
> {
  const rows = await database.db
    .select({
      userId: memberships.userId,
      displayName: users.displayName,
      fullName: users.fullName,
      email: users.email,
      role: memberships.role,
    })
    .from(memberships)
    .innerJoin(users, eq(memberships.userId, users.id))
    .where(
      and(
        eq(memberships.workspaceId, workspaceId),
        eq(users.status, 'active'),
      ),
    )
    .orderBy(asc(users.displayName));

  return rows.map((row) => ({
    userId: row.userId,
    displayName: row.displayName,
    fullName: row.fullName,
    email: row.email,
    role: row.role,
  }));
}
