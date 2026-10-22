import { and, eq, isNull, or } from 'drizzle-orm';
import type { Database } from '@project-knowledge-hub/database';
import {
  aiModelPrices,
  aiUsageEvents,
  projectTasks,
  projects,
} from '@project-knowledge-hub/database';
import {
  AppError,
  DEFAULT_AI_MODEL_PRICES,
  importedCloudAgentIds,
  planModelRateImport,
  presentAiModelPrices,
  priceImportedUsage,
  validateAiModelPriceWrite,
  type AiModelPrice,
  type AiModelPriceScope,
  type AiModelPriceView,
  type AiModelPriceWrite,
  type ModelRateImportPlan,
  type PricedImportedUsage,
  type TheoreticalMonthSplit,
  type UnpricedModel,
} from '@project-knowledge-hub/domain';

export type PublicAiModelPrice = AiModelPriceView & {
  id: string;
  /** @deprecated Use scope. Kept so older clients still see default vs workspace. */
  source: 'default' | 'workspace';
};

export type ImportedAllocationEvent = {
  projectId: string | null;
  aiSystemId: string | null;
  cloudAgentId: string | null;
  occurredAt: Date;
  tokens: number;
};

export type ImportedTheoretical = {
  rows: PricedImportedUsage[];
  agentIds: Set<string>;
  /** Imported events that still carry a cloud agent id, for allocation tokens. */
  allocationEvents: ImportedAllocationEvent[];
  unpricedModels: UnpricedModel[];
  months: TheoreticalMonthSplit[];
  prices: PublicAiModelPrice[];
};

type PriceRow = {
  id: string;
  workspaceId: string | null;
  model: string;
  inputPerMillion: number;
  cacheWritePerMillion: number;
  cacheReadPerMillion: number;
  outputPerMillion: number;
  blendedPerMillion: number;
  currency: string;
  effectiveFrom: string;
  sourceNote: string | null;
  retiredAt: Date | null;
};

function toDomain(row: PriceRow): AiModelPrice & { id: string } {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    model: row.model,
    inputPerMillion: Number(row.inputPerMillion),
    cacheWritePerMillion: Number(row.cacheWritePerMillion),
    cacheReadPerMillion: Number(row.cacheReadPerMillion),
    outputPerMillion: Number(row.outputPerMillion),
    blendedPerMillion: Number(row.blendedPerMillion),
    currency: row.currency,
    effectiveFrom: row.effectiveFrom,
    sourceNote: row.sourceNote,
    retiredAt: row.retiredAt ? row.retiredAt.toISOString() : null,
  };
}

function withSource(row: AiModelPriceView & { id: string }): PublicAiModelPrice {
  return {
    ...row,
    source: row.scope === 'workspace' ? 'workspace' : 'default',
  };
}

function sortPrices(rows: PublicAiModelPrice[]): PublicAiModelPrice[] {
  return [...rows].sort(
    (left, right) =>
      left.model.localeCompare(right.model)
      || left.effectiveFrom.localeCompare(right.effectiveFrom)
      || left.scope.localeCompare(right.scope),
  );
}

export async function listGlobalAiModelPrices(
  database: Database,
): Promise<PublicAiModelPrice[]> {
  const stored = await database.db
    .select()
    .from(aiModelPrices)
    .where(isNull(aiModelPrices.workspaceId));
  const rows = stored.map((row) => toDomain(row));
  const hasDefault = rows.length > 0;
  const domain = hasDefault
    ? rows
    : DEFAULT_AI_MODEL_PRICES.map((row, index) => ({ ...row, id: `default-${index}` }));
  return sortPrices(presentAiModelPrices(domain).map((row) => withSource({ ...row, id: row.id ?? '' })));
}

export async function listAiModelPrices(
  database: Database,
  workspaceId: string,
): Promise<PublicAiModelPrice[]> {
  const stored = await database.db
    .select()
    .from(aiModelPrices)
    .where(or(isNull(aiModelPrices.workspaceId), eq(aiModelPrices.workspaceId, workspaceId)));
  const rows = stored.map((row) => toDomain(row));
  const hasDefault = rows.some((row) => row.workspaceId == null);
  const domain = hasDefault
    ? rows
    : [
        ...DEFAULT_AI_MODEL_PRICES.map((row, index) => ({ ...row, id: `default-${index}` })),
        ...rows,
      ];
  return sortPrices(presentAiModelPrices(domain).map((row) => withSource({ ...row, id: row.id ?? '' })));
}

function asRates(prices: readonly PublicAiModelPrice[]): AiModelPrice[] {
  return prices.map((row) => ({
    id: row.id,
    workspaceId: row.workspaceId,
    model: row.model,
    inputPerMillion: row.inputPerMillion,
    cacheWritePerMillion: row.cacheWritePerMillion,
    cacheReadPerMillion: row.cacheReadPerMillion,
    outputPerMillion: row.outputPerMillion,
    blendedPerMillion: row.blendedPerMillion,
    currency: row.currency,
    effectiveFrom: row.effectiveFrom,
    sourceNote: row.sourceNote,
    retiredAt: row.retiredAt,
  }));
}

/**
 * Price every imported usage row from the current table.
 * Calling it again after a price edit recomputes the same way.
 */
export async function loadImportedTheoretical(
  database: Database,
  workspaceId: string,
): Promise<ImportedTheoretical> {
  const prices = await listAiModelPrices(database, workspaceId);
  const events = await database.db
    .select({
      occurredAt: aiUsageEvents.occurredAt,
      model: aiUsageEvents.model,
      tokensInput: aiUsageEvents.tokensInput,
      tokensCacheWrite: aiUsageEvents.tokensCacheWrite,
      tokensCache: aiUsageEvents.tokensCache,
      tokensOutput: aiUsageEvents.tokensOutput,
      cost: aiUsageEvents.cost,
      projectTaskId: aiUsageEvents.projectTaskId,
      cloudAgentId: aiUsageEvents.cloudAgentId,
      tokensTotal: aiUsageEvents.tokensTotal,
      projectId: projectTasks.projectId,
      aiSystemId: projectTasks.aiSystemId,
      projectName: projects.name,
    })
    .from(aiUsageEvents)
    .leftJoin(projectTasks, eq(aiUsageEvents.projectTaskId, projectTasks.id))
    .leftJoin(projects, eq(projectTasks.projectId, projects.id))
    .where(eq(aiUsageEvents.workspaceId, workspaceId));
  const priced = priceImportedUsage(
    events.map((row) => ({
      occurredOn: row.occurredAt.toISOString().slice(0, 10),
      model: row.model,
      tokensInput: row.tokensInput,
      tokensCacheWrite: row.tokensCacheWrite,
      tokensCache: row.tokensCache,
      tokensOutput: row.tokensOutput,
      cost: row.cost,
      linked: row.projectTaskId != null,
      projectId: row.projectId,
      projectName: row.projectName,
      cloudAgentId: row.cloudAgentId,
    })),
    asRates(prices),
  );
  return {
    rows: priced.rows,
    agentIds: importedCloudAgentIds(priced.rows),
    allocationEvents: events.map((row) => {
      const parts =
        Number(row.tokensInput) +
        Number(row.tokensCacheWrite) +
        Number(row.tokensCache) +
        Number(row.tokensOutput);
      const total = Number(row.tokensTotal);
      return {
        projectId: row.projectId,
        aiSystemId: row.aiSystemId,
        cloudAgentId: row.cloudAgentId,
        occurredAt: row.occurredAt,
        tokens: total > 0 ? total : parts,
      };
    }),
    unpricedModels: priced.unpricedModels,
    months: priced.months,
    prices,
  };
}

export type { AiModelPriceWrite, AiModelPriceScope, ModelRateImportPlan };

function assertPrice(
  input: Partial<AiModelPriceWrite>,
  requireSourceNote: boolean,
): AiModelPriceWrite {
  const validated = validateAiModelPriceWrite(input, { requireSourceNote });
  if (!validated.ok) {
    throw new AppError({
      code: 'MODEL_PRICE_INVALID',
      message: validated.errors.map((error) => error.message).join('; '),
      statusCode: 400,
      details: { errors: validated.errors },
    });
  }
  return validated.price;
}

function scopeWhere(workspaceId: string | null, model: string, effectiveFrom: string) {
  const scope = workspaceId
    ? eq(aiModelPrices.workspaceId, workspaceId)
    : isNull(aiModelPrices.workspaceId);
  return and(
    scope,
    eq(aiModelPrices.model, model),
    eq(aiModelPrices.effectiveFrom, effectiveFrom),
  );
}

async function presentOne(
  database: Database,
  workspaceId: string | null,
  id: string,
): Promise<PublicAiModelPrice> {
  const prices = workspaceId
    ? await listAiModelPrices(database, workspaceId)
    : await listGlobalAiModelPrices(database);
  const price = prices.find((row) => row.id === id);
  if (!price) {
    throw new AppError({
      code: 'MODEL_PRICE_INVALID',
      message: 'Could not save the model price',
      statusCode: 500,
    });
  }
  return price;
}

export async function upsertScopedAiModelPrice(
  database: Database,
  workspaceId: string | null,
  input: Partial<AiModelPriceWrite>,
  options?: { requireSourceNote?: boolean },
): Promise<PublicAiModelPrice> {
  const price = assertPrice(input, options?.requireSourceNote === true);
  const [existing] = await database.db
    .select()
    .from(aiModelPrices)
    .where(scopeWhere(workspaceId, price.model, price.effectiveFrom))
    .limit(1);
  const values = {
    inputPerMillion: price.inputPerMillion,
    cacheWritePerMillion: price.cacheWritePerMillion,
    cacheReadPerMillion: price.cacheReadPerMillion,
    outputPerMillion: price.outputPerMillion,
    blendedPerMillion: price.blendedPerMillion,
    currency: price.currency,
    sourceNote: price.sourceNote,
    retiredAt: null,
    updatedAt: new Date(),
  };
  if (existing) {
    const [updated] = await database.db
      .update(aiModelPrices)
      .set(values)
      .where(eq(aiModelPrices.id, existing.id))
      .returning({ id: aiModelPrices.id });
    if (!updated) {
      throw new AppError({
        code: 'MODEL_PRICE_INVALID',
        message: 'Could not update the model price',
        statusCode: 500,
      });
    }
    return presentOne(database, workspaceId, updated.id);
  }
  const [created] = await database.db
    .insert(aiModelPrices)
    .values({ workspaceId, model: price.model, effectiveFrom: price.effectiveFrom, ...values })
    .returning({ id: aiModelPrices.id });
  if (!created) {
    throw new AppError({
      code: 'MODEL_PRICE_INVALID',
      message: 'Could not save the model price',
      statusCode: 500,
    });
  }
  return presentOne(database, workspaceId, created.id);
}

export async function upsertAiModelPrice(
  database: Database,
  workspaceId: string,
  input: Partial<AiModelPriceWrite>,
): Promise<PublicAiModelPrice> {
  return upsertScopedAiModelPrice(database, workspaceId, input);
}

export async function retireScopedAiModelPrice(
  database: Database,
  workspaceId: string | null,
  target: { priceId?: string; model?: string; effectiveFrom?: string },
): Promise<PublicAiModelPrice> {
  const scope = workspaceId
    ? eq(aiModelPrices.workspaceId, workspaceId)
    : isNull(aiModelPrices.workspaceId);
  const identity = target.priceId
    ? eq(aiModelPrices.id, target.priceId)
    : target.model && target.effectiveFrom
      ? and(
          eq(aiModelPrices.model, target.model.trim()),
          eq(aiModelPrices.effectiveFrom, target.effectiveFrom),
        )
      : null;
  if (!identity) {
    throw new AppError({
      code: 'MODEL_PRICE_INVALID',
      message: 'priceId or model and effectiveFrom is required',
      statusCode: 400,
    });
  }
  const [existing] = await database.db
    .select({ id: aiModelPrices.id })
    .from(aiModelPrices)
    .where(and(scope, identity))
    .limit(1);
  if (!existing) {
    throw new AppError({
      code: 'MODEL_PRICE_NOT_FOUND',
      message: 'Model price not found',
      statusCode: 404,
    });
  }
  await database.db
    .update(aiModelPrices)
    .set({ retiredAt: new Date(), updatedAt: new Date() })
    .where(eq(aiModelPrices.id, existing.id));
  return presentOne(database, workspaceId, existing.id);
}

export async function deleteAiModelPrice(
  database: Database,
  workspaceId: string,
  priceId: string,
): Promise<PublicAiModelPrice> {
  return retireScopedAiModelPrice(database, workspaceId, { priceId });
}

export async function previewScopedModelRateImport(
  database: Database,
  workspaceId: string | null,
  text: string,
  format: 'csv' | 'json',
): Promise<ModelRateImportPlan> {
  const prices = workspaceId
    ? await listAiModelPrices(database, workspaceId)
    : await listGlobalAiModelPrices(database);
  const owned = prices.filter((row) =>
    workspaceId ? row.workspaceId === workspaceId : row.workspaceId == null,
  );
  return planModelRateImport(owned, text, format);
}

export async function applyScopedModelRateImport(
  database: Database,
  workspaceId: string | null,
  text: string,
  format: 'csv' | 'json',
): Promise<ModelRateImportPlan> {
  const plan = await previewScopedModelRateImport(database, workspaceId, text, format);
  if (plan.errors.length > 0) {
    throw new AppError({
      code: 'MODEL_PRICE_INVALID',
      message: 'Fix the import errors before applying',
      statusCode: 400,
      details: { errors: plan.errors },
    });
  }
  for (const row of plan.writable) {
    await upsertScopedAiModelPrice(database, workspaceId, row, { requireSourceNote: true });
  }
  return plan;
}
