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
  priceImportedUsage,
  type AiModelPrice,
  type PricedImportedUsage,
  type TheoreticalMonthSplit,
  type UnpricedModel,
} from '@project-knowledge-hub/domain';

export type PublicAiModelPrice = {
  id: string;
  workspaceId: string | null;
  model: string;
  inputPerMillion: number;
  cacheWritePerMillion: number;
  cacheReadPerMillion: number;
  outputPerMillion: number;
  currency: string;
  effectiveFrom: string;
  source: 'default' | 'workspace';
};

export type ImportedTheoretical = {
  rows: PricedImportedUsage[];
  agentIds: Set<string>;
  unpricedModels: UnpricedModel[];
  months: TheoreticalMonthSplit[];
  prices: PublicAiModelPrice[];
};

function toPrice(row: {
  id: string;
  workspaceId: string | null;
  model: string;
  inputPerMillion: number;
  cacheWritePerMillion: number;
  cacheReadPerMillion: number;
  outputPerMillion: number;
  currency: string;
  effectiveFrom: string;
}): PublicAiModelPrice {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    model: row.model,
    inputPerMillion: Number(row.inputPerMillion),
    cacheWritePerMillion: Number(row.cacheWritePerMillion),
    cacheReadPerMillion: Number(row.cacheReadPerMillion),
    outputPerMillion: Number(row.outputPerMillion),
    currency: row.currency,
    effectiveFrom: row.effectiveFrom,
    source: row.workspaceId ? 'workspace' : 'default',
  };
}

export async function listAiModelPrices(
  database: Database,
  workspaceId: string,
): Promise<PublicAiModelPrice[]> {
  const stored = await database.db
    .select()
    .from(aiModelPrices)
    .where(or(isNull(aiModelPrices.workspaceId), eq(aiModelPrices.workspaceId, workspaceId)));
  const rows = stored.map(toPrice);
  const hasDefault = rows.some((row) => row.workspaceId == null);
  if (!hasDefault) {
    return [
      ...DEFAULT_AI_MODEL_PRICES.map((row, index) => ({
        id: `default-${index}`,
        workspaceId: null,
        model: row.model,
        inputPerMillion: row.inputPerMillion,
        cacheWritePerMillion: row.cacheWritePerMillion,
        cacheReadPerMillion: row.cacheReadPerMillion,
        outputPerMillion: row.outputPerMillion,
        currency: row.currency,
        effectiveFrom: row.effectiveFrom,
        source: 'default' as const,
      })),
      ...rows,
    ];
  }
  return rows.sort(
    (a, b) =>
      a.model.localeCompare(b.model) || a.effectiveFrom.localeCompare(b.effectiveFrom),
  );
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
    currency: row.currency,
    effectiveFrom: row.effectiveFrom,
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
      projectId: projectTasks.projectId,
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
    unpricedModels: priced.unpricedModels,
    months: priced.months,
    prices,
  };
}

export type AiModelPriceWrite = {
  model: string;
  inputPerMillion: number;
  cacheWritePerMillion: number;
  cacheReadPerMillion: number;
  outputPerMillion: number;
  currency: string;
  effectiveFrom: string;
};

function assertPrice(input: AiModelPriceWrite): AiModelPriceWrite {
  const model = input.model.trim();
  if (model.length < 1 || model.length > 80) {
    throw new AppError({
      code: 'MODEL_PRICE_INVALID',
      message: 'model must be 1–80 characters',
      statusCode: 400,
    });
  }
  const currency = input.currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new AppError({
      code: 'MODEL_PRICE_INVALID',
      message: 'currency must be a 3-letter ISO code',
      statusCode: 400,
    });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveFrom)) {
    throw new AppError({
      code: 'MODEL_PRICE_INVALID',
      message: 'effectiveFrom must be YYYY-MM-DD',
      statusCode: 400,
    });
  }
  const rates = [
    input.inputPerMillion,
    input.cacheWritePerMillion,
    input.cacheReadPerMillion,
    input.outputPerMillion,
  ];
  if (rates.some((rate) => !Number.isFinite(rate) || rate < 0 || rate > 1_000_000)) {
    throw new AppError({
      code: 'MODEL_PRICE_INVALID',
      message: 'Prices must be zero or a positive amount per 1M tokens',
      statusCode: 400,
    });
  }
  const rate = (value: number) => Math.round(value * 1_000_000) / 1_000_000;
  return {
    model,
    currency,
    effectiveFrom: input.effectiveFrom,
    inputPerMillion: rate(input.inputPerMillion),
    cacheWritePerMillion: rate(input.cacheWritePerMillion),
    cacheReadPerMillion: rate(input.cacheReadPerMillion),
    outputPerMillion: rate(input.outputPerMillion),
  };
}

export async function upsertAiModelPrice(
  database: Database,
  workspaceId: string,
  input: AiModelPriceWrite,
): Promise<PublicAiModelPrice> {
  const price = assertPrice(input);
  const [existing] = await database.db
    .select()
    .from(aiModelPrices)
    .where(
      and(
        eq(aiModelPrices.workspaceId, workspaceId),
        eq(aiModelPrices.model, price.model),
        eq(aiModelPrices.effectiveFrom, price.effectiveFrom),
      ),
    )
    .limit(1);
  if (existing) {
    const [updated] = await database.db
      .update(aiModelPrices)
      .set({
        inputPerMillion: price.inputPerMillion,
        cacheWritePerMillion: price.cacheWritePerMillion,
        cacheReadPerMillion: price.cacheReadPerMillion,
        outputPerMillion: price.outputPerMillion,
        currency: price.currency,
        updatedAt: new Date(),
      })
      .where(eq(aiModelPrices.id, existing.id))
      .returning();
    if (!updated) {
      throw new AppError({
        code: 'MODEL_PRICE_INVALID',
        message: 'Could not update the model price',
        statusCode: 500,
      });
    }
    return toPrice(updated);
  }
  const [created] = await database.db
    .insert(aiModelPrices)
    .values({ workspaceId, ...price })
    .returning();
  if (!created) {
    throw new AppError({
      code: 'MODEL_PRICE_INVALID',
      message: 'Could not save the model price',
      statusCode: 500,
    });
  }
  return toPrice(created);
}

export async function deleteAiModelPrice(
  database: Database,
  workspaceId: string,
  priceId: string,
): Promise<void> {
  const [existing] = await database.db
    .select({ id: aiModelPrices.id })
    .from(aiModelPrices)
    .where(and(eq(aiModelPrices.id, priceId), eq(aiModelPrices.workspaceId, workspaceId)))
    .limit(1);
  if (!existing) {
    throw new AppError({
      code: 'MODEL_PRICE_NOT_FOUND',
      message: 'Model price not found',
      statusCode: 404,
    });
  }
  await database.db.delete(aiModelPrices).where(eq(aiModelPrices.id, priceId));
}
