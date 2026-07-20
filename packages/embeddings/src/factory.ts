import { createDisabledProvider } from './disabled.js';
import { createOllamaProvider } from './ollama.js';
import { createOpenAiCompatibleProvider } from './openai-compatible.js';
import {
  EMBEDDING_PROVIDERS,
  type EmbeddingProvider,
  type EmbeddingProviderConfig,
  type EmbeddingProviderName,
} from './types.js';

export function createEmbeddingProvider(
  config: EmbeddingProviderConfig,
): EmbeddingProvider {
  switch (config.provider) {
    case 'disabled':
      return createDisabledProvider(config);
    case 'ollama':
      return createOllamaProvider(config);
    case 'openai_compatible':
      return createOpenAiCompatibleProvider(config);
    default: {
      const neverProvider: never = config.provider;
      throw new Error(`Unknown embedding provider: ${String(neverProvider)}`);
    }
  }
}

export function parseEmbeddingProviderName(
  value: string | undefined,
): EmbeddingProviderName {
  if (
    value &&
    (EMBEDDING_PROVIDERS as readonly string[]).includes(value)
  ) {
    return value as EmbeddingProviderName;
  }
  return 'disabled';
}
