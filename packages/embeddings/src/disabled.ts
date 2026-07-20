import {
  EmbeddingDisabledError,
  type EmbeddingProvider,
  type EmbeddingProviderConfig,
} from './types.js';

export function createDisabledProvider(
  config: EmbeddingProviderConfig,
): EmbeddingProvider {
  return {
    name: 'disabled',
    model: config.model,
    dimensions: config.dimensions,
    enabled: false,
    async embedDocuments() {
      throw new EmbeddingDisabledError();
    },
    async embedQuery() {
      throw new EmbeddingDisabledError();
    },
  };
}
