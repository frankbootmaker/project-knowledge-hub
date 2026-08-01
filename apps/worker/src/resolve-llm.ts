import { and, eq } from 'drizzle-orm';
import type { AppEnv } from '@project-knowledge-hub/config';
import {
  llmProviders,
  llmServiceBindings,
  type Database,
} from '@project-knowledge-hub/database';

export type WorkerResolvedLlm = {
  baseUrl: string;
  apiKey: string | undefined;
  model: string;
  timeoutMs: number;
  source: 'binding' | 'env';
};

/**
 * Resolve vision OCR LLM for the worker (mirrors API resolveLlmForService).
 * Binding wins; otherwise VISION_LLM_* env.
 */
export async function resolveWorkerVisionLlm(
  database: Database,
  env: AppEnv,
): Promise<WorkerResolvedLlm | null> {
  const [binding] = await database.db
    .select()
    .from(llmServiceBindings)
    .where(eq(llmServiceBindings.service, 'vision_ocr'))
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
      return {
        baseUrl: provider.baseUrl.trim(),
        apiKey: provider.apiKey?.trim() || undefined,
        model:
          binding.modelOverride?.trim() ||
          provider.defaultModel.trim() ||
          env.VISION_LLM_MODEL,
        timeoutMs: provider.timeoutMs ?? env.MARKITDOWN_TIMEOUT_MS,
        source: 'binding',
      };
    }
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
  };
}
