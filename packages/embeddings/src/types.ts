export const EMBEDDING_PROVIDERS = [
  'disabled',
  'ollama',
  'openai_compatible',
] as const;

export type EmbeddingProviderName = (typeof EMBEDDING_PROVIDERS)[number];

export type EmbeddingProviderConfig = {
  provider: EmbeddingProviderName;
  model: string;
  baseUrl?: string;
  apiKey?: string;
  dimensions: number;
};

export type EmbeddingProvider = {
  name: EmbeddingProviderName;
  model: string;
  dimensions: number;
  /** True when indexing / hybrid query embedding is available. */
  enabled: boolean;
  embedDocuments(texts: string[]): Promise<number[][]>;
  embedQuery(text: string): Promise<number[]>;
};

export class EmbeddingDisabledError extends Error {
  constructor(message = 'Embedding provider is disabled') {
    super(message);
    this.name = 'EmbeddingDisabledError';
  }
}

export class EmbeddingDimensionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmbeddingDimensionError';
  }
}
