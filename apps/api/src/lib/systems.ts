import { and, eq, isNull } from 'drizzle-orm';
import { slugify } from '@project-knowledge-hub/auth';
import {
  projects,
  systems,
  workspaces,
  type Database,
} from '@project-knowledge-hub/database';
import {
  AppError,
  aiCostModeSchema,
  normalizeSystemCriticality,
  systemCriticalitySchema,
  systemItCostModeSchema,
  systemItDetailsSchema,
  systemStatusSchema,
  type AiCostMode,
  type SystemCriticality,
  type SystemItCostMode,
  type SystemItDetails,
  type SystemStatus,
} from '@project-knowledge-hub/domain';
import { getSystemTags, setSystemTags } from './tags.js';
import {
  parseBudgetAmount,
  parseTokenRate,
  upsertProjectCostSnapshot,
} from './project-budget.js';

export type PublicSystemTag = { id: string; name: string; slug: string };

export type PublicSystem = {
  id: string;
  workspaceId: string;
  projectId: string | null;
  name: string;
  slug: string;
  summary: string | null;
  description: string | null;
  systemType: string | null;
  status: string;
  ownerUserId: string | null;
  environment: string | null;
  version: string | null;
  criticality: string | null;
  itDetails: SystemItDetails;
  itCostMode: string | null;
  itFlatMonthlyFee: string | null;
  itOneTimeCost: string | null;
  itBudgetAllocation: string | null;
  aiCostMode: string | null;
  aiFlatMonthlyFee: string | null;
  aiTokenRatePer1k: string | null;
  aiBudgetAllocation: string | null;
  metadata: Record<string, unknown> | null;
  tags: PublicSystemTag[];
  lastValidatedAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export function parseItDetails(value: unknown): SystemItDetails {
  const parsed = systemItDetailsSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : {};
}

export function normalizeCriticalityInput(
  value: string | null | undefined,
): SystemCriticality | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value.trim() === '') return null;
  const normalized = normalizeSystemCriticality(value);
  if (normalized) return normalized;
  return systemCriticalitySchema.parse(value.trim().toLowerCase());
}

export function toPublicSystem(
  system: typeof systems.$inferSelect,
  tagList: PublicSystemTag[],
): PublicSystem {
  return {
    id: system.id,
    workspaceId: system.workspaceId,
    projectId: system.projectId,
    name: system.name,
    slug: system.slug,
    summary: system.summary,
    description: system.description,
    systemType: system.systemType,
    status: system.status,
    ownerUserId: system.ownerUserId,
    environment: system.environment,
    version: system.version,
    criticality: system.criticality,
    itDetails: parseItDetails(system.itDetails),
    itCostMode: system.itCostMode,
    itFlatMonthlyFee: system.itFlatMonthlyFee,
    itOneTimeCost: system.itOneTimeCost,
    itBudgetAllocation: system.itBudgetAllocation,
    aiCostMode: system.aiCostMode,
    aiFlatMonthlyFee: system.aiFlatMonthlyFee,
    aiTokenRatePer1k: system.aiTokenRatePer1k,
    aiBudgetAllocation: system.aiBudgetAllocation,
    metadata: system.metadataJson,
    tags: tagList,
    lastValidatedAt: system.lastValidatedAt?.toISOString() ?? null,
    archivedAt: system.archivedAt?.toISOString() ?? null,
    createdAt: system.createdAt.toISOString(),
    updatedAt: system.updatedAt.toISOString(),
  };
}

export async function assertProjectInWorkspace(
  database: Database,
  workspaceId: string,
  projectId: string | null | undefined,
): Promise<void> {
  if (!projectId) return;
  const [project] = await database.db
    .select({ id: projects.id })
    .from(projects)
    .where(
      and(
        eq(projects.id, projectId),
        eq(projects.workspaceId, workspaceId),
        isNull(projects.archivedAt),
      ),
    )
    .limit(1);
  if (!project) {
    throw new AppError({
      code: 'PROJECT_NOT_FOUND',
      message: 'Associated project was not found in this workspace',
      statusCode: 400,
    });
  }
}

export async function getSystemRow(
  database: Database,
  systemId: string,
  opts?: { includeArchived?: boolean },
) {
  const [system] = await database.db
    .select()
    .from(systems)
    .where(eq(systems.id, systemId))
    .limit(1);
  if (!system) {
    throw new AppError({
      code: 'SYSTEM_NOT_FOUND',
      message: 'System not found',
      statusCode: 404,
    });
  }
  if (!opts?.includeArchived && system.archivedAt) {
    throw new AppError({
      code: 'SYSTEM_NOT_FOUND',
      message: 'System not found',
      statusCode: 404,
    });
  }
  return system;
}

export async function getPublicSystem(
  database: Database,
  systemId: string,
  opts?: { includeArchived?: boolean },
): Promise<PublicSystem> {
  const system = await getSystemRow(database, systemId, opts);
  const tagMap = await getSystemTags(database, [system.id]);
  return toPublicSystem(system, tagMap.get(system.id) ?? []);
}

export type CreateSystemInput = {
  workspaceId: string;
  projectId?: string | null;
  name: string;
  slug?: string;
  summary?: string | null;
  description?: string | null;
  systemType?: string | null;
  status?: SystemStatus;
  ownerUserId?: string | null;
  environment?: string | null;
  version?: string | null;
  criticality?: string | null;
  itDetails?: SystemItDetails;
  itCostMode?: SystemItCostMode | null;
  itFlatMonthlyFee?: number | string | null;
  itOneTimeCost?: number | string | null;
  itBudgetAllocation?: number | string | null;
  tags?: string[];
  metadata?: Record<string, unknown> | null;
};

export async function createSystem(
  database: Database,
  input: CreateSystemInput,
  opts: { defaultOwnerUserId: string },
): Promise<PublicSystem> {
  const [workspace] = await database.db
    .select()
    .from(workspaces)
    .where(
      and(eq(workspaces.id, input.workspaceId), isNull(workspaces.archivedAt)),
    )
    .limit(1);
  if (!workspace) {
    throw new AppError({
      code: 'WORKSPACE_NOT_FOUND',
      message: 'Workspace not found',
      statusCode: 404,
    });
  }

  await assertProjectInWorkspace(
    database,
    input.workspaceId,
    input.projectId,
  );

  const slug = input.slug ? slugify(input.slug) : slugify(input.name);
  if (!slug) {
    throw new AppError({
      code: 'VALIDATION_ERROR',
      message: 'System slug is invalid',
      statusCode: 400,
    });
  }

  const [existing] = await database.db
    .select({ id: systems.id })
    .from(systems)
    .where(
      and(eq(systems.workspaceId, input.workspaceId), eq(systems.slug, slug)),
    )
    .limit(1);
  if (existing) {
    throw new AppError({
      code: 'SYSTEM_SLUG_CONFLICT',
      message: 'A system with this slug already exists in the workspace',
      statusCode: 409,
    });
  }

  const criticality =
    input.criticality === undefined
      ? null
      : normalizeCriticalityInput(input.criticality) ?? null;
  const itDetails = parseItDetails(input.itDetails ?? {});
  const status = input.status
    ? systemStatusSchema.parse(input.status)
    : 'proposed';
  const itCostMode =
    input.itCostMode === undefined || input.itCostMode == null
      ? null
      : systemItCostModeSchema.parse(input.itCostMode);

  const [created] = await database.db
    .insert(systems)
    .values({
      workspaceId: input.workspaceId,
      projectId: input.projectId ?? null,
      name: input.name,
      slug,
      summary: input.summary ?? null,
      description: input.description ?? null,
      systemType: input.systemType ?? null,
      status,
      ownerUserId:
        input.ownerUserId === undefined
          ? opts.defaultOwnerUserId
          : input.ownerUserId,
      environment: input.environment ?? null,
      version: input.version ?? null,
      criticality,
      itDetails,
      itCostMode,
      itFlatMonthlyFee:
        input.itFlatMonthlyFee === undefined
          ? null
          : parseBudgetAmount(input.itFlatMonthlyFee) ?? null,
      itOneTimeCost:
        input.itOneTimeCost === undefined
          ? null
          : parseBudgetAmount(input.itOneTimeCost) ?? null,
      itBudgetAllocation:
        input.itBudgetAllocation === undefined
          ? null
          : parseBudgetAmount(input.itBudgetAllocation) ?? null,
      metadataJson: input.metadata ?? null,
      updatedAt: new Date(),
    })
    .returning();

  if (!created) {
    throw new AppError({
      code: 'SYSTEM_CREATE_FAILED',
      message: 'Failed to create system',
      statusCode: 500,
    });
  }

  const tagList = await setSystemTags(
    database,
    created.id,
    workspace.organizationId,
    input.tags ?? [],
  );
  if (created.projectId && itCostMode) {
    await upsertProjectCostSnapshot(database, created.projectId);
  }
  return toPublicSystem(created, tagList);
}

export type UpdateSystemInput = {
  projectId?: string | null;
  name?: string;
  summary?: string | null;
  description?: string | null;
  systemType?: string | null;
  status?: SystemStatus;
  ownerUserId?: string | null;
  environment?: string | null;
  version?: string | null;
  criticality?: string | null;
  itDetails?: SystemItDetails | null;
  itCostMode?: SystemItCostMode | null;
  itFlatMonthlyFee?: number | string | null;
  itOneTimeCost?: number | string | null;
  itBudgetAllocation?: number | string | null;
  tags?: string[];
  metadata?: Record<string, unknown> | null;
  archived?: boolean;
  aiCostMode?: AiCostMode | null;
  aiFlatMonthlyFee?: number | string | null;
  aiTokenRatePer1k?: number | string | null;
  aiBudgetAllocation?: number | string | null;
};

export async function updateSystem(
  database: Database,
  systemId: string,
  input: UpdateSystemInput,
): Promise<PublicSystem> {
  const system = await getSystemRow(database, systemId, {
    includeArchived: true,
  });

  await assertProjectInWorkspace(
    database,
    system.workspaceId,
    input.projectId === undefined ? system.projectId : input.projectId,
  );

  const [workspace] = await database.db
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, system.workspaceId))
    .limit(1);

  const nextFlat =
    input.aiFlatMonthlyFee === undefined
      ? undefined
      : parseBudgetAmount(input.aiFlatMonthlyFee) ?? null;
  const nextTokenRate =
    input.aiTokenRatePer1k === undefined
      ? undefined
      : parseTokenRate(input.aiTokenRatePer1k) ?? null;
  const nextAllocation =
    input.aiBudgetAllocation === undefined
      ? undefined
      : parseBudgetAmount(input.aiBudgetAllocation) ?? null;
  const nextItFlat =
    input.itFlatMonthlyFee === undefined
      ? undefined
      : parseBudgetAmount(input.itFlatMonthlyFee) ?? null;
  const nextItOneTime =
    input.itOneTimeCost === undefined
      ? undefined
      : parseBudgetAmount(input.itOneTimeCost) ?? null;
  const nextItAllocation =
    input.itBudgetAllocation === undefined
      ? undefined
      : parseBudgetAmount(input.itBudgetAllocation) ?? null;

  let nextCriticality = system.criticality;
  if (input.criticality !== undefined) {
    nextCriticality = normalizeCriticalityInput(input.criticality) ?? null;
  }

  let nextItDetails = system.itDetails;
  if (input.itDetails !== undefined) {
    nextItDetails =
      input.itDetails == null ? {} : parseItDetails(input.itDetails);
  }

  const [updated] = await database.db
    .update(systems)
    .set({
      projectId:
        input.projectId === undefined ? system.projectId : input.projectId,
      name: input.name ?? system.name,
      summary: input.summary === undefined ? system.summary : input.summary,
      description:
        input.description === undefined
          ? system.description
          : input.description,
      systemType:
        input.systemType === undefined ? system.systemType : input.systemType,
      status: input.status
        ? systemStatusSchema.parse(input.status)
        : system.status,
      ownerUserId:
        input.ownerUserId === undefined
          ? system.ownerUserId
          : input.ownerUserId,
      environment:
        input.environment === undefined
          ? system.environment
          : input.environment,
      version: input.version === undefined ? system.version : input.version,
      criticality: nextCriticality,
      itDetails: nextItDetails,
      itCostMode:
        input.itCostMode === undefined
          ? system.itCostMode
          : input.itCostMode == null
            ? null
            : systemItCostModeSchema.parse(input.itCostMode),
      itFlatMonthlyFee:
        nextItFlat === undefined ? system.itFlatMonthlyFee : nextItFlat,
      itOneTimeCost:
        nextItOneTime === undefined ? system.itOneTimeCost : nextItOneTime,
      itBudgetAllocation:
        nextItAllocation === undefined
          ? system.itBudgetAllocation
          : nextItAllocation,
      aiCostMode:
        input.aiCostMode === undefined
          ? system.aiCostMode
          : input.aiCostMode == null
            ? null
            : aiCostModeSchema.parse(input.aiCostMode),
      aiFlatMonthlyFee:
        nextFlat === undefined ? system.aiFlatMonthlyFee : nextFlat,
      aiTokenRatePer1k:
        nextTokenRate === undefined ? system.aiTokenRatePer1k : nextTokenRate,
      aiBudgetAllocation:
        nextAllocation === undefined
          ? system.aiBudgetAllocation
          : nextAllocation,
      metadataJson:
        input.metadata === undefined ? system.metadataJson : input.metadata,
      archivedAt:
        input.archived === undefined
          ? system.archivedAt
          : input.archived
            ? new Date()
            : null,
      updatedAt: new Date(),
    })
    .where(eq(systems.id, systemId))
    .returning();

  if (!updated) {
    throw new AppError({
      code: 'SYSTEM_UPDATE_FAILED',
      message: 'Failed to update system',
      statusCode: 500,
    });
  }

  let tagList =
    (await getSystemTags(database, [updated.id])).get(updated.id) ?? [];
  if (input.tags && workspace) {
    tagList = await setSystemTags(
      database,
      updated.id,
      workspace.organizationId,
      input.tags,
    );
  }

  const costTouched =
    input.aiCostMode !== undefined ||
    input.aiFlatMonthlyFee !== undefined ||
    input.aiTokenRatePer1k !== undefined ||
    input.aiBudgetAllocation !== undefined ||
    input.itCostMode !== undefined ||
    input.itFlatMonthlyFee !== undefined ||
    input.itOneTimeCost !== undefined ||
    input.itBudgetAllocation !== undefined ||
    input.projectId !== undefined;
  if (costTouched && updated.projectId) {
    await upsertProjectCostSnapshot(database, updated.projectId);
  }
  if (
    costTouched &&
    input.projectId !== undefined &&
    system.projectId &&
    system.projectId !== updated.projectId
  ) {
    await upsertProjectCostSnapshot(database, system.projectId);
  }

  return toPublicSystem(updated, tagList);
}
