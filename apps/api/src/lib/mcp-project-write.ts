import { and, eq, isNull, ne } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { slugify } from '@project-knowledge-hub/auth';
import {
  memberships,
  projects,
  syncScheduleSlipRisks,
  users,
  workspaces,
} from '@project-knowledge-hub/database';
import {
  AppError,
  assertMcpProjectStageChange,
  normalizeScheduleSlipItemTypes,
  parseProjectMethodology,
  projectCurrencySchema,
  projectNamesAreSimilar,
  scheduleSlipThresholdSchema,
  type ProjectMethodology,
  type ScheduleSlipItemType,
} from '@project-knowledge-hub/domain';
import type { McpClientContext } from '@project-knowledge-hub/mcp';
import { writeAuditEvent } from './identity.js';
import {
  allocateUniqueKeyPrefix,
  assertUniqueKeyPrefix,
} from './project-issue-keys.js';
import {
  assertUniqueProjectSlug,
  retireProjectSlug,
  workspaceProjectSlugStatus,
} from './project-slugs.js';

export type McpCreateProjectInput = {
  workspaceId: string;
  name: string;
  description?: string | null;
  keyPrefix?: string;
  currency?: string;
  methodology?: string | null;
  confirmDuplicateName?: boolean;
  generatedByModel?: string | null;
};

export type McpUpdateProjectInput = {
  projectId: string;
  name?: string;
  description?: string | null;
  methodology?: string | null;
  currency?: string;
  status?: string;
  stage?: string;
  confirmDuplicateName?: boolean;
  scheduleSlipRiskEnabled?: boolean;
  scheduleSlipThresholdDays?: number;
  scheduleSlipItemTypes?: ScheduleSlipItemType[];
  slug?: string;
};

type WorkspaceRow = {
  id: string;
  name: string;
  slug: string;
  organizationId: string;
};

function projectUrl(webUrl: string, workspaceSlug: string, projectSlug: string): string {
  return `${webUrl.replace(/\/$/, '')}/workspaces/${workspaceSlug}/projects/${projectSlug}`;
}

function allowlistDenial(workspace: { id: string; name?: string | null }): string {
  const label = workspace.name
    ? `Workspace "${workspace.name}" (${workspace.id})`
    : `Workspace ${workspace.id}`;
  return (
    `${label} is not on this API client's workspace allow-list, so projects:write cannot change it. ` +
    'Add the workspace to the client allow-list, or pick a workspace where list_workspaces reports writesAllowed true.'
  );
}

async function loadWorkspace(
  app: FastifyInstance,
  workspaceId: string,
): Promise<WorkspaceRow> {
  const [workspace] = await app.database.db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      slug: workspaces.slug,
      organizationId: workspaces.organizationId,
    })
    .from(workspaces)
    .where(and(eq(workspaces.id, workspaceId), isNull(workspaces.archivedAt)))
    .limit(1);
  if (!workspace) {
    throw new AppError({
      code: 'WORKSPACE_NOT_FOUND',
      message: `Workspace ${workspaceId} was not found or is archived.`,
      statusCode: 404,
    });
  }
  return workspace;
}

function assertWritableWorkspace(client: McpClientContext, workspace: WorkspaceRow): void {
  if (client.allowedWorkspaceIds.length === 0) {
    throw new AppError({
      code: 'WORKSPACE_ALLOWLIST_REQUIRED',
      message:
        'This API client has no workspace allow-list, so it cannot create or update projects. ' +
        'Add at least one workspace to the client, then call list_workspaces and use a row with writesAllowed true.',
      statusCode: 403,
    });
  }
  if (!client.allowedWorkspaceIds.includes(workspace.id)) {
    throw new AppError({
      code: 'FORBIDDEN',
      message: allowlistDenial(workspace),
      statusCode: 403,
    });
  }
}

async function assertCanWriteProject(
  app: FastifyInstance,
  client: McpClientContext,
  workspace: WorkspaceRow,
): Promise<string> {
  if (!client.actingUserId) {
    throw new AppError({
      code: 'ACTING_USER_REQUIRED',
      message:
        'This API client has no acting user. projects:write requires an acting user whose workspace role is maintainer, workspace_admin, or system_admin.',
      statusCode: 403,
    });
  }
  const [user] = await app.database.db
    .select({
      isSystemAdmin: users.isSystemAdmin,
      status: users.status,
      displayName: users.displayName,
    })
    .from(users)
    .where(eq(users.id, client.actingUserId))
    .limit(1);
  if (!user || user.status !== 'active') {
    throw new AppError({
      code: 'FORBIDDEN',
      message: 'The acting user is missing or not active, so they cannot create or update projects.',
      statusCode: 403,
    });
  }
  if (user.isSystemAdmin) return client.actingUserId;

  const [membership] = await app.database.db
    .select({ role: memberships.role })
    .from(memberships)
    .where(
      and(
        eq(memberships.userId, client.actingUserId),
        eq(memberships.workspaceId, workspace.id),
      ),
    )
    .limit(1);
  const role = membership?.role ?? 'none';
  if (role !== 'workspace_admin' && role !== 'maintainer') {
    throw new AppError({
      code: 'FORBIDDEN',
      message:
        `Acting user "${user.displayName}" has role "${role}" in workspace "${workspace.name}" (${workspace.id}). ` +
        'Creating or updating a project requires maintainer or workspace_admin. ' +
        'list_workspaces returns that role and writesAllowed for each workspace.',
      statusCode: 403,
    });
  }
  return client.actingUserId;
}

/**
 * Bearer clients are api_clients rows. OAuth grants are not, so their id must
 * not be stored in created_by_api_client_id.
 */
function projectProvenance(client: McpClientContext): {
  createdByApiClientId: string | null;
  createdByOauthGrantId: string | null;
  actorType: 'api_client' | 'oauth_grant';
  actorId: string;
} {
  if (client.oauthGrantId) {
    return {
      createdByApiClientId: null,
      createdByOauthGrantId: client.oauthGrantId,
      actorType: 'oauth_grant',
      actorId: client.oauthGrantId,
    };
  }
  return {
    createdByApiClientId: client.id,
    createdByOauthGrantId: null,
    actorType: 'api_client',
    actorId: client.id,
  };
}

function assertProjectAllowlistOpen(client: McpClientContext): void {
  if (client.allowedProjectIds.length === 0) return;
  throw new AppError({
    code: 'FORBIDDEN',
    message:
      'This API client is limited to specific projects (allowedProjectIds), so it cannot create a new project. ' +
      'A client with a project allow-list can update those projects, but a new project would be outside the list.',
    statusCode: 403,
  });
}

async function similarProjects(
  app: FastifyInstance,
  workspaceId: string,
  name: string,
  excludeProjectId?: string,
) {
  const conditions = [
    eq(projects.workspaceId, workspaceId),
    isNull(projects.archivedAt),
  ];
  if (excludeProjectId) conditions.push(ne(projects.id, excludeProjectId));
  const rows = await app.database.db
    .select({ id: projects.id, name: projects.name, slug: projects.slug })
    .from(projects)
    .where(and(...conditions));
  return rows.filter((row) => projectNamesAreSimilar(name, row.name));
}

function duplicateNameError(
  matches: Array<{ id: string; name: string; slug: string }>,
): AppError {
  const listed = matches
    .slice(0, 5)
    .map((row) => `"${row.name}" (${row.id})`)
    .join(', ');
  return new AppError({
    code: 'PROJECT_NAME_SIMILAR',
    message:
      `A project with the same or a very similar name already exists in this workspace: ${listed}. ` +
      'Retry with confirmDuplicateName true only if a separate project is intended.',
    statusCode: 409,
    details: {
      matches: matches.slice(0, 5),
      confirmField: 'confirmDuplicateName',
    },
  });
}

async function uniqueSlug(
  app: FastifyInstance,
  workspaceId: string,
  name: string,
): Promise<string> {
  const base = slugify(name);
  if (!base) {
    throw new AppError({
      code: 'VALIDATION_ERROR',
      message: 'Project name does not produce a valid slug. Use letters or digits.',
      statusCode: 400,
    });
  }
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const slug = attempt === 0 ? base : `${base}-${attempt + 1}`.slice(0, 64);
    const status = await workspaceProjectSlugStatus(app.database.db, {
      workspaceId,
      slug,
    });
    if (status === 'free') return slug;
  }
  throw new AppError({
    code: 'PROJECT_SLUG_CONFLICT',
    message: `Could not allocate a unique slug from "${base}" in this workspace.`,
    statusCode: 409,
  });
}

async function resolveKeyPrefix(
  app: FastifyInstance,
  input: { workspaceId: string; name: string; keyPrefix?: string },
): Promise<{ keyPrefix: string; warning: string | null }> {
  if (!input.keyPrefix) {
    const keyPrefix = await allocateUniqueKeyPrefix(app.database, {
      workspaceId: input.workspaceId,
      nameOrSlug: input.name,
    });
    return { keyPrefix, warning: null };
  }
  try {
    const result = await assertUniqueKeyPrefix(app.database, {
      workspaceId: input.workspaceId,
      keyPrefix: input.keyPrefix,
      checkCrossWorkspace: true,
    });
    return { keyPrefix: result.keyPrefix, warning: result.warning ?? null };
  } catch (error) {
    if (!(error instanceof AppError) || error.code !== 'KEY_PREFIX_TAKEN') throw error;
    const suggested = await allocateUniqueKeyPrefix(app.database, {
      workspaceId: input.workspaceId,
      nameOrSlug: input.name,
    });
    throw new AppError({
      code: 'KEY_PREFIX_TAKEN',
      message:
        `${error.message}. Suggested available prefix: ${suggested}. ` +
        `Retry create_project with keyPrefix "${suggested}", or omit keyPrefix to auto-assign.`,
      statusCode: 409,
      details: { suggestedKeyPrefix: suggested },
    });
  }
}

function parseCurrency(value: string | undefined, fallback: string): string {
  if (value === undefined) return projectCurrencySchema.parse(fallback);
  const parsed = projectCurrencySchema.safeParse(value);
  if (!parsed.success) {
    throw new AppError({
      code: 'VALIDATION_ERROR',
      message: `Invalid currency "${value}". Allowed values: ${projectCurrencySchema.options.join(', ')}.`,
      statusCode: 400,
    });
  }
  return parsed.data;
}

function requestedStage(input: { status?: string; stage?: string }): string | undefined {
  if (input.status !== undefined && input.stage !== undefined && input.status !== input.stage) {
    throw new AppError({
      code: 'VALIDATION_ERROR',
      message: 'status and stage must be the same value when both are sent.',
      statusCode: 400,
    });
  }
  return input.status ?? input.stage;
}

export async function createProjectViaMcp(
  app: FastifyInstance,
  client: McpClientContext,
  input: McpCreateProjectInput,
  ipAddress?: string | null,
) {
  const workspace = await loadWorkspace(app, input.workspaceId);
  assertWritableWorkspace(client, workspace);
  assertProjectAllowlistOpen(client);
  const actingUserId = await assertCanWriteProject(app, client, workspace);
  const name = input.name.trim();
  if (!name) {
    throw new AppError({
      code: 'VALIDATION_ERROR',
      message: 'Project name is required.',
      statusCode: 400,
    });
  }
  const methodology = parseProjectMethodology(input.methodology);
  const currency = parseCurrency(input.currency, 'EUR');
  const matches = await similarProjects(app, workspace.id, name);
  if (matches.length > 0 && !input.confirmDuplicateName) {
    throw duplicateNameError(matches);
  }
  const slug = await uniqueSlug(app, workspace.id, name);
  const key = await resolveKeyPrefix(app, {
    workspaceId: workspace.id,
    name,
    ...(input.keyPrefix ? { keyPrefix: input.keyPrefix } : {}),
  });
  const generatedByModel = input.generatedByModel?.trim() || null;
  const provenance = projectProvenance(client);
  const [created] = await app.database.db
    .insert(projects)
    .values({
      workspaceId: workspace.id,
      name,
      slug,
      description: input.description ?? null,
      status: 'idea',
      ownerUserId: actingUserId,
      currency,
      methodology,
      keyPrefix: key.keyPrefix,
      issueCounters: {},
      createdVia: 'mcp',
      createdByApiClientId: provenance.createdByApiClientId,
      createdByOauthGrantId: provenance.createdByOauthGrantId,
      createdByUserId: actingUserId,
      generatedByModel,
      updatedAt: new Date(),
    })
    .returning();
  if (!created) {
    throw new AppError({
      code: 'PROJECT_CREATE_FAILED',
      message: 'Failed to create project',
      statusCode: 500,
    });
  }
  await writeAuditEvent(app.database, {
    organizationId: workspace.organizationId,
    actorType: provenance.actorType,
    actorId: provenance.actorId,
    action: 'project.create',
    entityType: 'project',
    entityId: created.id,
    metadata: {
      via: 'mcp',
      actingUserId,
      ...(provenance.createdByOauthGrantId
        ? { oauthGrantId: provenance.createdByOauthGrantId }
        : { apiClientId: provenance.createdByApiClientId }),
      generatedByModel,
      status: 'idea',
      name: created.name,
      keyPrefix: created.keyPrefix,
    },
    ipAddress: ipAddress ?? null,
  });
  const warnings = [
    matches.length > 0
      ? `Created despite a similar name: ${matches.map((row) => row.name).join(', ')}.`
      : null,
    key.warning,
  ].filter((item): item is string => Boolean(item));
  return {
    project: {
      id: created.id,
      name: created.name,
      slug: created.slug,
      workspaceId: created.workspaceId,
      status: 'idea' as const,
      keyPrefix: created.keyPrefix ?? key.keyPrefix,
      url: projectUrl(app.env.WEB_URL, workspace.slug, created.slug),
      methodology: (created.methodology as ProjectMethodology | null) ?? null,
      currency: projectCurrencySchema.parse(created.currency),
      description: created.description,
      createdVia: 'mcp' as const,
      createdByApiClientId: provenance.createdByApiClientId,
      createdByOauthGrantId: provenance.createdByOauthGrantId,
      createdByUserId: actingUserId,
      generatedByModel,
      warning: warnings.length > 0 ? warnings.join(' ') : null,
    },
  };
}

export async function updateProjectViaMcp(
  app: FastifyInstance,
  client: McpClientContext,
  input: McpUpdateProjectInput,
  ipAddress?: string | null,
) {
  const [project] = await app.database.db
    .select()
    .from(projects)
    .where(and(eq(projects.id, input.projectId), isNull(projects.archivedAt)))
    .limit(1);
  if (!project) {
    throw new AppError({
      code: 'PROJECT_NOT_FOUND',
      message: 'Project not found',
      statusCode: 404,
    });
  }
  const workspace = await loadWorkspace(app, project.workspaceId);
  assertWritableWorkspace(client, workspace);
  if (
    client.allowedProjectIds.length > 0 &&
    !client.allowedProjectIds.includes(project.id)
  ) {
    throw new AppError({
      code: 'FORBIDDEN',
      message:
        `Project "${project.name}" (${project.id}) is not on this API client's project allow-list. ` +
        'This token cannot update that project.',
      statusCode: 403,
    });
  }
  const actingUserId = await assertCanWriteProject(app, client, workspace);
  const provenance = projectProvenance(client);
  const nextName = input.name === undefined ? project.name : input.name.trim();
  if (!nextName) {
    throw new AppError({
      code: 'VALIDATION_ERROR',
      message: 'Project name cannot be empty.',
      statusCode: 400,
    });
  }
  let duplicateWarning: string | null = null;
  if (nextName !== project.name) {
    const matches = await similarProjects(app, workspace.id, nextName, project.id);
    if (matches.length > 0 && !input.confirmDuplicateName) {
      throw duplicateNameError(matches);
    }
    if (matches.length > 0) {
      duplicateWarning = `Renamed despite a similar name: ${matches.map((row) => row.name).join(', ')}.`;
    }
  }
  const stage = requestedStage(input);
  const nextStatus = stage === undefined
    ? project.status
    : assertMcpProjectStageChange(project.status, stage);
  const methodology = input.methodology === undefined
    ? project.methodology
    : parseProjectMethodology(input.methodology);
  const currency = parseCurrency(input.currency, project.currency);
  const description = input.description === undefined ? project.description : input.description;
  const slipEnabled = input.scheduleSlipRiskEnabled === undefined
    ? project.scheduleSlipRiskEnabled
    : input.scheduleSlipRiskEnabled;
  const slipThreshold = input.scheduleSlipThresholdDays === undefined
    ? project.scheduleSlipThresholdDays
    : scheduleSlipThresholdSchema.parse(input.scheduleSlipThresholdDays);
  const slipTypes = input.scheduleSlipItemTypes === undefined
    ? project.scheduleSlipItemTypes
    : normalizeScheduleSlipItemTypes(input.scheduleSlipItemTypes);
  const nextSlug = input.slug === undefined
    ? project.slug
    : await assertUniqueProjectSlug(app.database, {
        workspaceId: workspace.id,
        slug: input.slug,
        excludeProjectId: project.id,
      });
  const [updated] = await app.database.db.transaction(async (tx) => {
    await retireProjectSlug(tx, {
      projectId: project.id,
      workspaceId: project.workspaceId,
      previousSlug: project.slug,
      nextSlug,
      actorUserId: actingUserId,
    });
    return tx
      .update(projects)
      .set({
        name: nextName,
        slug: nextSlug,
        description,
        methodology,
        currency,
        status: nextStatus,
        scheduleSlipRiskEnabled: slipEnabled,
        scheduleSlipThresholdDays: slipThreshold,
        scheduleSlipItemTypes: slipTypes,
        updatedAt: new Date(),
      })
      .where(eq(projects.id, project.id))
      .returning();
  });
  if (!updated) {
    throw new AppError({
      code: 'PROJECT_NOT_FOUND',
      message: 'Project not found',
      statusCode: 404,
    });
  }
  await writeAuditEvent(app.database, {
    organizationId: workspace.organizationId,
    actorType: provenance.actorType,
    actorId: provenance.actorId,
    action: 'project.update',
    entityType: 'project',
    entityId: project.id,
    metadata: {
      via: 'mcp',
      actingUserId,
      ...(provenance.createdByOauthGrantId
        ? { oauthGrantId: provenance.createdByOauthGrantId }
        : { apiClientId: provenance.createdByApiClientId }),
      name: nextName,
      slug: nextSlug,
      status: nextStatus,
      methodology,
      currency,
      scheduleSlipRiskEnabled: slipEnabled,
    },
    ipAddress: ipAddress ?? null,
  });
  if (project.slug !== nextSlug) {
    await writeAuditEvent(app.database, {
      organizationId: workspace.organizationId,
      actorType: provenance.actorType,
      actorId: provenance.actorId,
      action: 'project.slug_changed',
      entityType: 'project',
      entityId: project.id,
      metadata: {
        via: 'mcp',
        actingUserId,
        previousSlug: project.slug,
        slug: nextSlug,
      },
      ipAddress: ipAddress ?? null,
    });
  }
  if (
    input.scheduleSlipRiskEnabled !== undefined
    || input.scheduleSlipThresholdDays !== undefined
    || input.scheduleSlipItemTypes !== undefined
  ) {
    await syncScheduleSlipRisks(app.database, project.id);
  }
  return { project: updated, workspace, duplicateWarning };
}
