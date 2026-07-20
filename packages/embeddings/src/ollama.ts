import {
  EmbeddingDimensionError,
  type EmbeddingProvider,
  type EmbeddingProviderConfig,
} from './types.js';

function assertDimensions(vector: number[], expected: number): void {
  if (vector.length !== expected) {
    throw new EmbeddingDimensionError(
      `Embedding length ${vector.length} does not match EMBEDDING_DIMENSIONS=${expected}`,
    );
  }
}

export function createOllamaProvider(
  config: EmbeddingProviderConfig,
): EmbeddingProvider {
  const baseUrl = (config.baseUrl ?? 'http://127.0.0.1:11434').replace(/\/$/, '');

  async function embedOne(text: string): Promise<number[]> {
    const response = await fetch(`${baseUrl}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: config.model, prompt: text }),
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Ollama embeddings failed (${response.status}): ${body}`);
    }
    const payload = (await response.json()) as { embedding?: number[] };
    if (!payload.embedding?.length) {
      throw new Error('Ollama embeddings response missing embedding');
    }
    assertDimensions(payload.embedding, config.dimensions);
    return payload.embedding;
  }

  return {
    name: 'ollama',
    model: config.model,
    dimensions: config.dimensions,
    enabled: true,
    async embedDocuments(texts) {
      const vectors: number[][] = [];
      for (const text of texts) {
        vectors.push(await embedOne(text));
      }
      return vectors;
    },
    async embedQuery(text) {
      return embedOne(text);
    },
  };
}
