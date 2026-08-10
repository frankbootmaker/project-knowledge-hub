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
  projectStakeholderRoleSchema,
  raciRoleSchema,
  resolveAssistantBrand,
  type AssistantBrand,
  type ProjectStakeholderRole,
  type RaciRole,
} from '@project-knowledge-hub/domain';
import {
  assertProjectNotArchived,
  requireProjectContext,
} from './project-delivery.js';
import { avatarUrlForUser } from './public-user.js';

export type StakeholderKind = 'person' | 'ai_assistant';
export type StakeholderSource = 'roster' | 'owner' | 'raci' | 'ai_assistant';

/** Catalogue systems with this type appear as AI-assistant stakeholders (not general Systems). */
export const AI_ASSISTANT_SYSTEM_TYPE = 'ai_assistant';

export type PublicStakeholder = {
  kind: StakeholderKind;
  /** Stable id: userId for people, `ai:<systemUuid>` for AI assistants. */
  id: string;
  userId: string | null;
  systemId: string | null;
  displayName: string;
  fullName: string | null;
  email: string | null;
  projectRole: ProjectStakeholderRole | null;
  jobTitle: string | null;
  notes: string | null;
  reportsToUserId: string | null;
  hourlyRate: string | null;
  /** Profile photo URL for people; null when unset (UI uses monogram). */
  avatarUrl: string | null;
  /** LLM/product brand for AI assistants; null for people. */
  assistantBrand: AssistantBrand | null;
  raciRoles: RaciRole[];
  taskCount: number;
  sources: StakeholderSource[];
  rosterId: string | null;
  sortOrder: number;
  systemSlug: string | null;
  systemStatus: string | null;
};

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
  for (const row of roster) ids.add(row.userId);

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
    edges.set(row.userId, row.reportsToUserId);
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
  for (const row of rosterRows) userIds.add(row.userId);
  for (const userId of raciByUser.keys()) userIds.add(userId);
  if (project.ownerUserId) userIds.add(project.ownerUserId);
  for (const assistant of aiAssistants) {
    if (assistant.ownerUserId) userIds.add(assistant.ownerUserId);
  }

  const userMap = await loadUserMap(database, [...userIds]);
  const byPerson = new Map<string, PublicStakeholder>();

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
      notes: null,
      reportsToUserId: null,
      hourlyRate: null,
      avatarUrl: profile.avatarUrl,
      assistantBrand: null,
      raciRoles: [],
      taskCount: 0,
      sources: [],
      rosterId: null,
      sortOrder: 1000,
      systemSlug: null,
      systemStatus: null,
    };
    byPerson.set(userId, entry);
    return entry;
  };

  for (const row of rosterRows) {
    const entry = ensurePerson(row.userId);
    if (!entry) continue;
    entry.rosterId = row.id;
    entry.projectRole = projectStakeholderRoleSchema.parse(row.projectRole);
    entry.jobTitle = row.jobTitle;
    entry.notes = row.notes;
    entry.reportsToUserId = row.reportsToUserId;
    entry.hourlyRate = row.hourlyRate;
    entry.sortOrder = row.sortOrder;
    if (!entry.sources.includes('roster')) entry.sources.push('roster');
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
      notes: assistant.summary,
      reportsToUserId: ownerInSet,
      hourlyRate: null,
      avatarUrl: null,
      assistantBrand: resolveAssistantBrand({
        name: assistant.name,
        slug: assistant.slug,
        metadata: assistant.metadataJson,
      }),
      raciRoles: [],
      taskCount: 0,
      sources: ['ai_assistant'] as StakeholderSource[],
      rosterId: null,
      sortOrder: 500 + index,
      systemSlug: assistant.slug,
      systemStatus: assistant.status,
    };
  });

  const RACI_ORDER: RaciRole[] = ['A', 'R', 'C', 'I'];
  return [...byPerson.values(), ...aiEntries].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'person' ? -1 : 1;
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

export async function upsertProjectStakeholder(
  database: Database,
  input: {
    projectId: string;
    workspaceId: string;
    userId: string;
    projectRole: ProjectStakeholderRole;
    jobTitle?: string | null;
    notes?: string | null;
    reportsToUserId?: string | null;
    hourlyRate?: string | null;
    sortOrder?: number;
  },
): Promise<PublicStakeholder> {
  const { project } = await requireProjectContext(database, input.projectId);
  assertProjectNotArchived(project);
  await assertWorkspaceMembers(database, input.workspaceId, [input.userId]);

  if (input.reportsToUserId) {
    await assertWorkspaceMembers(database, input.workspaceId, [
      input.reportsToUserId,
    ]);
    const allowed = await collectStakeholderUserIds(
      database,
      input.projectId,
      project.ownerUserId,
    );
    // Allow reporting to the user being added, or anyone already in the set.
    allowed.add(input.userId);
    if (!allowed.has(input.reportsToUserId)) {
      throw new AppError({
        code: 'STAKEHOLDER_REPORTS_TO_UNKNOWN',
        message:
          'reportsToUserId must be a project stakeholder (roster, owner, or RACI)',
        statusCode: 400,
      });
    }
    await assertNoReportsToCycle(
      database,
      input.projectId,
      input.userId,
      input.reportsToUserId,
    );
  }

  const [existing] = await database.db
    .select()
    .from(projectStakeholders)
    .where(
      and(
        eq(projectStakeholders.projectId, input.projectId),
        eq(projectStakeholders.userId, input.userId),
      ),
    )
    .limit(1);

  if (existing) {
    await database.db
      .update(projectStakeholders)
      .set({
        projectRole: input.projectRole,
        jobTitle: input.jobTitle === undefined ? existing.jobTitle : input.jobTitle,
        notes: input.notes === undefined ? existing.notes : input.notes,
        reportsToUserId:
          input.reportsToUserId === undefined
            ? existing.reportsToUserId
            : input.reportsToUserId,
        hourlyRate:
          input.hourlyRate === undefined ? existing.hourlyRate : input.hourlyRate,
        sortOrder: input.sortOrder ?? existing.sortOrder,
        updatedAt: new Date(),
      })
      .where(eq(projectStakeholders.id, existing.id));
  } else {
    await database.db.insert(projectStakeholders).values({
      projectId: input.projectId,
      userId: input.userId,
      projectRole: input.projectRole,
      jobTitle: input.jobTitle ?? null,
      notes: input.notes ?? null,
      reportsToUserId: input.reportsToUserId ?? null,
      hourlyRate: input.hourlyRate ?? null,
      sortOrder: input.sortOrder ?? 0,
    });
  }

  const list = await listProjectStakeholders(database, input.projectId);
  const found = list.find(
    (row) => row.kind === 'person' && row.userId === input.userId,
  );
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
    notes?: string | null;
    reportsToUserId?: string | null;
    hourlyRate?: string | null;
    sortOrder?: number;
  },
): Promise<PublicStakeholder> {
  const existing = await getRosterStakeholder(database, rosterId);
  const { project } = await requireProjectContext(database, existing.projectId);
  assertProjectNotArchived(project);

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
    if (!allowed.has(nextReportsTo)) {
      throw new AppError({
        code: 'STAKEHOLDER_REPORTS_TO_UNKNOWN',
        message:
          'reportsToUserId must be a project stakeholder (roster, owner, or RACI)',
        statusCode: 400,
      });
    }
    await assertNoReportsToCycle(
      database,
      existing.projectId,
      existing.userId,
      nextReportsTo,
    );
  }

  await database.db
    .update(projectStakeholders)
    .set({
      projectRole: input.projectRole ?? existing.projectRole,
      jobTitle: input.jobTitle === undefined ? existing.jobTitle : input.jobTitle,
      notes: input.notes === undefined ? existing.notes : input.notes,
      reportsToUserId: nextReportsTo,
      hourlyRate:
        input.hourlyRate === undefined ? existing.hourlyRate : input.hourlyRate,
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

export async function deleteProjectStakeholder(
  database: Database,
  rosterId: string,
): Promise<{ projectId: string; userId: string }> {
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
