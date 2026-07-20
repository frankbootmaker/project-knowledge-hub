import { and, eq } from 'drizzle-orm';
import {
  embeddingModels,
  knowledgeRecordChunks,
  knowledgeRecords,
  type Database,
} from '@project-knowledge-hub/database';
import { chunkKnowledgeText, contentHash } from './chunk.js';
import { EmbeddingDisabledError, type EmbeddingProvider } from './types.js';

export type ReindexResult = {
  knowledgeRecordId: string;
  skipped: boolean;
  reason?: string;
  chunkCount: number;
};

async function ensureEmbeddingModel(
  database: Database,
  provider: EmbeddingProvider,
): Promise<string> {
  const [existing] = await database.db
    .select()
    .from(embeddingModels)
    .where(
      and(
        eq(embeddingModels.provider, provider.name),
        eq(embeddingModels.modelName, provider.model),
      ),
    )
    .limit(1);

  if (existing) {
    if (existing.dimensions !== provider.dimensions) {
      throw new Error(
        `Stored model dimensions ${existing.dimensions} != provider ${provider.dimensions}`,
      );
    }
    return existing.id;
  }

  const [created] = await database.db
    .insert(embeddingModels)
    .values({
      provider: provider.name,
      modelName: provider.model,
      dimensions: provider.dimensions,
    })
    .returning();

  if (!created) {
    throw new Error('Failed to register embedding model');
  }
  return created.id;
}

/**
 * Chunk + embed a knowledge record. No-op when provider is disabled.
 * Replaces all chunks for the record when content hash changes (or force).
 */
export async function reindexKnowledgeRecord(options: {
  database: Database;
  provider: EmbeddingProvider;
  knowledgeRecordId: string;
  force?: boolean;
}): Promise<ReindexResult> {
  const { database, provider, knowledgeRecordId } = options;

  if (!provider.enabled) {
    return {
      knowledgeRecordId,
      skipped: true,
      reason: 'provider_disabled',
      chunkCount: 0,
    };
  }

  const [record] = await database.db
    .select()
    .from(knowledgeRecords)
    .where(eq(knowledgeRecords.id, knowledgeRecordId))
    .limit(1);

  if (!record || record.archivedAt) {
    return {
      knowledgeRecordId,
      skipped: true,
      reason: 'record_missing_or_archived',
      chunkCount: 0,
    };
  }

  const hash = contentHash([
    record.title,
    record.summary ?? '',
    record.contentMarkdown,
    provider.name,
    provider.model,
    String(provider.dimensions),
  ]);

  const [existingChunk] = await database.db
    .select({ contentHash: knowledgeRecordChunks.contentHash })
    .from(knowledgeRecordChunks)
    .where(eq(knowledgeRecordChunks.knowledgeRecordId, knowledgeRecordId))
    .limit(1);

  if (
    !options.force &&
    existingChunk &&
    existingChunk.contentHash === hash
  ) {
    return {
      knowledgeRecordId,
      skipped: true,
      reason: 'unchanged',
      chunkCount: 0,
    };
  }

  const chunks = chunkKnowledgeText({
    title: record.title,
    summary: record.summary,
    contentMarkdown: record.contentMarkdown,
  });

  if (chunks.length === 0) {
    await database.db
      .delete(knowledgeRecordChunks)
      .where(eq(knowledgeRecordChunks.knowledgeRecordId, knowledgeRecordId));
    return {
      knowledgeRecordId,
      skipped: false,
      chunkCount: 0,
    };
  }

  let vectors: number[][];
  try {
    vectors = await provider.embedDocuments(chunks.map((chunk) => chunk.content));
  } catch (error) {
    if (error instanceof EmbeddingDisabledError) {
      return {
        knowledgeRecordId,
        skipped: true,
        reason: 'provider_disabled',
        chunkCount: 0,
      };
    }
    throw error;
  }

  if (vectors.length !== chunks.length) {
    throw new Error('Embedding provider returned unexpected vector count');
  }

  const modelId = await ensureEmbeddingModel(database, provider);
  const now = new Date();

  await database.db
    .delete(knowledgeRecordChunks)
    .where(eq(knowledgeRecordChunks.knowledgeRecordId, knowledgeRecordId));

  await database.db.insert(knowledgeRecordChunks).values(
    chunks.map((chunk, index) => ({
      knowledgeRecordId: record.id,
      workspaceId: record.workspaceId,
      chunkIndex: chunk.index,
      content: chunk.content,
      tokenEstimate: chunk.tokenEstimate,
      embeddingModelId: modelId,
      embedding: vectors[index]!,
      contentHash: hash,
      updatedAt: now,
    })),
  );

  return {
    knowledgeRecordId,
    skipped: false,
    chunkCount: chunks.length,
  };
}

export function vectorLiteral(vector: number[]): string {
  return `[${vector.join(',')}]`;
}
