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

export function createOpenAiCompatibleProvider(
  config: EmbeddingProviderConfig,
): EmbeddingProvider {
  const baseUrl = (config.baseUrl ?? 'https://api.openai.com/v1').replace(
    /\/$/,
    '',
  );

  async function embedBatch(texts: string[]): Promise<number[][]> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (config.apiKey) {
      headers.Authorization = `Bearer ${config.apiKey}`;
    }
    const response = await fetch(`${baseUrl}/embeddings`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: config.model,
        input: texts,
      }),
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `OpenAI-compatible embeddings failed (${response.status}): ${body}`,
      );
    }
    const payload = (await response.json()) as {
      data?: Array<{ embedding: number[]; index: number }>;
    };
    if (!payload.data?.length) {
      throw new Error('OpenAI-compatible embeddings response missing data');
    }
    const sorted = [...payload.data].sort((a, b) => a.index - b.index);
    return sorted.map((row) => {
      assertDimensions(row.embedding, config.dimensions);
      return row.embedding;
    });
  }

  return {
    name: 'openai_compatible',
    model: config.model,
    dimensions: config.dimensions,
    enabled: true,
    async embedDocuments(texts) {
      if (texts.length === 0) return [];
      const batchSize = 32;
      const out: number[][] = [];
      for (let i = 0; i < texts.length; i += batchSize) {
        const batch = texts.slice(i, i + batchSize);
        out.push(...(await embedBatch(batch)));
      }
      return out;
    },
    async embedQuery(text) {
      const [vector] = await embedBatch([text]);
      if (!vector) {
        throw new Error('OpenAI-compatible query embedding missing');
      }
      return vector;
    },
  };
}
