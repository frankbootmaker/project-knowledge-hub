import { and, asc, eq } from 'drizzle-orm';
import type { AppEnv } from '@project-knowledge-hub/config';
import {
  llmProviders,
  llmServiceBindings,
  type Database,
} from '@project-knowledge-hub/database';
import { AppError } from '@project-knowledge-hub/domain';
import { z } from 'zod';
import { chatCompletions } from './vision-llm.js';

export const LLM_SERVICES = [
  'translation',
  'vision_ocr',
  'doc_forge',
  'embeddings',
] as const;

export type LlmService = (typeof LLM_SERVICES)[number];

/** Services wired in v1 (others reserved for later). */
export const LLM_SERVICES_ACTIVE = ['translation', 'vision_ocr'] as const;
export type LlmServiceActive = (typeof LLM_SERVICES_ACTIVE)[number];

export const llmServiceSchema = z.enum(LLM_SERVICES);
export const llmServiceActiveSchema = z.enum(LLM_SERVICES_ACTIVE);

export type ResolvedLlmConfig = {
  baseUrl: string;
  apiKey: string | undefined;
  model: string;
  timeoutMs: number;
  source: 'binding' | 'env';
  providerId: string | null;
  providerName: string | null;
};

export type PublicLlmProvider = {
  id: string;
  name: string;
  kind: string;
  baseUrl: string;
  defaultModel: string;
  timeoutMs: number | null;
  status: string;
  hasApiKey: boolean;
  createdAt: string;
  updatedAt: string;
};

export type PublicLlmBinding = {
  service: LlmService;
  providerId: string | null;
  providerName: string | null;
  modelOverride: string | null;
  active: boolean;
  available: boolean;
  source: 'binding' | 'env' | 'none';
  effectiveModel: string | null;
};

function toPublicProvider(row: typeof llmProviders.$inferSelect): PublicLlmProvider {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    baseUrl: row.baseUrl,
    defaultModel: row.defaultModel,
    timeoutMs: row.timeoutMs,
    status: row.status,
    hasApiKey: Boolean(row.apiKey?.trim()),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function envFallback(
  env: AppEnv,
  service: LlmService,
): ResolvedLlmConfig | null {
  if (service !== 'translation' && service !== 'vision_ocr') {
    return null;
  }
  const baseUrl = env.VISION_LLM_BASE_URL?.trim();
  if (!baseUrl) {
    return null;
  }
  return {
    baseUrl,
    apiKey: env.VISION_LLM_API_KEY,
    model: env.VISION_LLM_MODEL,
    timeoutMs: env.MARKITDOWN_TIMEOUT_MS,
    source: 'env',
    providerId: null,
    providerName: null,
  };
}

export async function resolveLlmForService(
  database: Database,
  env: AppEnv,
  service: LlmService,
): Promise<ResolvedLlmConfig | null> {
  const [binding] = await database.db
    .select()
    .from(llmServiceBindings)
    .where(eq(llmServiceBindings.service, service))
    .limit(1);

  if (binding) {
    const [provider] = await database.db
      .select()
      .from(llmProviders)
      .where(
        and(
          eq(llmProviders.id, binding.providerId),
          eq(llmProviders.status, 'active'),
        ),
      )
      .limit(1);

    if (provider?.baseUrl?.trim()) {
      const model =
        binding.modelOverride?.trim() ||
        provider.defaultModel.trim() ||
        env.VISION_LLM_MODEL;
      return {
        baseUrl: provider.baseUrl.trim(),
        apiKey: provider.apiKey?.trim() || undefined,
        model,
        timeoutMs: provider.timeoutMs ?? env.MARKITDOWN_TIMEOUT_MS,
        source: 'binding',
        providerId: provider.id,
        providerName: provider.name,
      };
    }
  }

  return envFallback(env, service);
}

export async function listPublicLlmProviders(
  database: Database,
): Promise<PublicLlmProvider[]> {
  const rows = await database.db
    .select()
    .from(llmProviders)
    .orderBy(asc(llmProviders.name));
  return rows.map(toPublicProvider);
}

export async function getPublicLlmProvider(
  database: Database,
  providerId: string,
): Promise<PublicLlmProvider | null> {
  const [row] = await database.db
    .select()
    .from(llmProviders)
    .where(eq(llmProviders.id, providerId))
    .limit(1);
  return row ? toPublicProvider(row) : null;
}

export const createLlmProviderSchema = z.object({
  name: z.string().min(1).max(120),
  kind: z.enum(['openai_compatible']).default('openai_compatible'),
  baseUrl: z.string().url().max(500),
  apiKey: z.string().max(500).nullable().optional(),
  defaultModel: z.string().min(1).max(160),
  timeoutMs: z.number().int().positive().max(600_000).nullable().optional(),
  status: z.enum(['active', 'disabled']).optional(),
});

export const updateLlmProviderSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  kind: z.literal('openai_compatible').optional(),
  baseUrl: z.string().url().max(500).optional(),
  /** Omit to keep; null clears; non-empty replaces. */
  apiKey: z.string().max(500).nullable().optional(),
  defaultModel: z.string().min(1).max(160).optional(),
  timeoutMs: z.number().int().positive().max(600_000).nullable().optional(),
  status: z.enum(['active', 'disabled']).optional(),
});

export async function createLlmProvider(
  database: Database,
  input: z.infer<typeof createLlmProviderSchema>,
  updatedBy: string,
): Promise<PublicLlmProvider> {
  const body = createLlmProviderSchema.parse(input);
  try {
    const [row] = await database.db
      .insert(llmProviders)
      .values({
        name: body.name.trim(),
        kind: body.kind,
        baseUrl: body.baseUrl.replace(/\/$/, ''),
        apiKey: body.apiKey?.trim() || null,
        defaultModel: body.defaultModel.trim(),
        timeoutMs: body.timeoutMs ?? null,
        status: body.status ?? 'active',
        updatedBy,
      })
      .returning();
    if (!row) {
      throw new AppError({
        code: 'LLM_PROVIDER_CREATE_FAILED',
        message: 'Could not create LLM provider',
        statusCode: 500,
      });
    }
    return toPublicProvider(row);
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: string }).code === '23505'
    ) {
      throw new AppError({
        code: 'LLM_PROVIDER_NAME_CONFLICT',
        message: 'An AI provider with this name already exists',
        statusCode: 409,
      });
    }
    throw error;
  }
}

export async function updateLlmProvider(
  database: Database,
  providerId: string,
  input: z.infer<typeof updateLlmProviderSchema>,
  updatedBy: string,
): Promise<PublicLlmProvider> {
  const body = updateLlmProviderSchema.parse(input);
  const [existing] = await database.db
    .select()
    .from(llmProviders)
    .where(eq(llmProviders.id, providerId))
    .limit(1);
  if (!existing) {
    throw new AppError({
      code: 'LLM_PROVIDER_NOT_FOUND',
      message: 'AI provider not found',
      statusCode: 404,
    });
  }

  let nextApiKey = existing.apiKey;
  if (body.apiKey === null) {
    nextApiKey = null;
  } else if (typeof body.apiKey === 'string' && body.apiKey.trim()) {
    nextApiKey = body.apiKey.trim();
  }

  try {
    const [row] = await database.db
      .update(llmProviders)
      .set({
        name: body.name?.trim() ?? existing.name,
        kind: body.kind ?? existing.kind,
        baseUrl: body.baseUrl
          ? body.baseUrl.replace(/\/$/, '')
          : existing.baseUrl,
        apiKey: nextApiKey,
        defaultModel: body.defaultModel?.trim() ?? existing.defaultModel,
        timeoutMs:
          body.timeoutMs !== undefined ? body.timeoutMs : existing.timeoutMs,
        status: body.status ?? existing.status,
        updatedAt: new Date(),
        updatedBy,
      })
      .where(eq(llmProviders.id, providerId))
      .returning();
    if (!row) {
      throw new AppError({
        code: 'LLM_PROVIDER_NOT_FOUND',
        message: 'AI provider not found',
        statusCode: 404,
      });
    }
    return toPublicProvider(row);
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: string }).code === '23505'
    ) {
      throw new AppError({
        code: 'LLM_PROVIDER_NAME_CONFLICT',
        message: 'An AI provider with this name already exists',
        statusCode: 409,
      });
    }
    throw error;
  }
}

export async function deleteLlmProvider(
  database: Database,
  providerId: string,
): Promise<void> {
  const [bound] = await database.db
    .select()
    .from(llmServiceBindings)
    .where(eq(llmServiceBindings.providerId, providerId))
    .limit(1);
  if (bound) {
    throw new AppError({
      code: 'LLM_PROVIDER_IN_USE',
      message: `Cannot delete provider bound to service "${bound.service}". Clear the binding first.`,
      statusCode: 409,
    });
  }

  const deleted = await database.db
    .delete(llmProviders)
    .where(eq(llmProviders.id, providerId))
    .returning({ id: llmProviders.id });
  if (deleted.length === 0) {
    throw new AppError({
      code: 'LLM_PROVIDER_NOT_FOUND',
      message: 'AI provider not found',
      statusCode: 404,
    });
  }
}

export async function testLlmProvider(
  database: Database,
  env: AppEnv,
  providerId: string,
): Promise<{ ok: true; model: string }> {
  const [row] = await database.db
    .select()
    .from(llmProviders)
    .where(eq(llmProviders.id, providerId))
    .limit(1);
  if (!row) {
    throw new AppError({
      code: 'LLM_PROVIDER_NOT_FOUND',
      message: 'AI provider not found',
      statusCode: 404,
    });
  }

  try {
    const result = await chatCompletions(
      {
        baseUrl: row.baseUrl,
        apiKey: row.apiKey ?? undefined,
        model: row.defaultModel,
        timeoutMs: row.timeoutMs ?? Math.min(env.MARKITDOWN_TIMEOUT_MS, 30_000),
      },
      [
        {
          role: 'user',
          content: 'Reply with exactly: ok',
        },
      ],
    );
    return { ok: true, model: result.model };
  } catch (error) {
    throw new AppError({
      code: 'LLM_PROVIDER_TEST_FAILED',
      message:
        error instanceof Error ? error.message : 'AI provider connection test failed',
      statusCode: 502,
    });
  }
}

export const putLlmBindingsSchema = z.object({
  bindings: z.array(
    z.object({
      service: llmServiceActiveSchema,
      providerId: z.string().uuid().nullable(),
      modelOverride: z.string().max(160).nullable().optional(),
    }),
  ),
});

export async function listPublicLlmBindings(
  database: Database,
  env: AppEnv,
): Promise<PublicLlmBinding[]> {
  const providers = await database.db.select().from(llmProviders);
  const byId = new Map(providers.map((row) => [row.id, row]));
  const bindings = await database.db.select().from(llmServiceBindings);
  const byService = new Map(bindings.map((row) => [row.service, row]));

  const out: PublicLlmBinding[] = [];
  for (const service of LLM_SERVICES) {
    const active = (LLM_SERVICES_ACTIVE as readonly string[]).includes(service);
    const binding = byService.get(service);
    const provider = binding ? byId.get(binding.providerId) : undefined;
    const resolved = active
      ? await resolveLlmForService(database, env, service)
      : null;

    out.push({
      service,
      providerId: binding?.providerId ?? null,
      providerName: provider?.name ?? null,
      modelOverride: binding?.modelOverride ?? null,
      active,
      available: Boolean(resolved),
      source: resolved?.source ?? 'none',
      effectiveModel: resolved?.model ?? null,
    });
  }
  return out;
}

export async function putLlmServiceBindings(
  database: Database,
  env: AppEnv,
  input: z.infer<typeof putLlmBindingsSchema>,
  updatedBy: string,
): Promise<PublicLlmBinding[]> {
  const body = putLlmBindingsSchema.parse(input);

  for (const item of body.bindings) {
    if (item.providerId === null) {
      await database.db
        .delete(llmServiceBindings)
        .where(eq(llmServiceBindings.service, item.service));
      continue;
    }

    const [provider] = await database.db
      .select()
      .from(llmProviders)
      .where(eq(llmProviders.id, item.providerId))
      .limit(1);
    if (!provider) {
      throw new AppError({
        code: 'LLM_PROVIDER_NOT_FOUND',
        message: `AI provider not found for service "${item.service}"`,
        statusCode: 404,
      });
    }

    await database.db
      .insert(llmServiceBindings)
      .values({
        service: item.service,
        providerId: item.providerId,
        modelOverride: item.modelOverride?.trim() || null,
        updatedBy,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: llmServiceBindings.service,
        set: {
          providerId: item.providerId,
          modelOverride: item.modelOverride?.trim() || null,
          updatedBy,
          updatedAt: new Date(),
        },
      });
  }

  return listPublicLlmBindings(database, env);
}

export async function getLlmCapabilities(
  database: Database,
  env: AppEnv,
): Promise<{
  translationConfigured: boolean;
  visionOcrConfigured: boolean;
  translationSource: 'binding' | 'env' | 'none';
  visionOcrSource: 'binding' | 'env' | 'none';
}> {
  const translation = await resolveLlmForService(database, env, 'translation');
  const visionOcr = await resolveLlmForService(database, env, 'vision_ocr');
  return {
    translationConfigured: Boolean(translation),
    visionOcrConfigured: Boolean(visionOcr),
    translationSource: translation?.source ?? 'none',
    visionOcrSource: visionOcr?.source ?? 'none',
  };
}
