import { describe, expect, it } from 'vitest';
import { chunkKnowledgeText, contentHash } from './chunk.js';
import { createEmbeddingProvider } from './factory.js';
import { EmbeddingDisabledError } from './types.js';

describe('chunkKnowledgeText', () => {
  it('returns a single chunk for short content', () => {
    const chunks = chunkKnowledgeText({
      title: 'Overview',
      summary: 'Short',
      contentMarkdown: 'Hello world',
    });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.content).toContain('Overview');
    expect(chunks[0]?.content).toContain('Hello world');
  });

  it('splits long content with overlap', () => {
    const body = 'a'.repeat(3000);
    const chunks = chunkKnowledgeText({
      title: 'Long',
      contentMarkdown: body,
      chunkChars: 1000,
      overlapChars: 100,
    });
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks[0]?.index).toBe(0);
    expect(chunks[1]?.index).toBe(1);
  });

  it('hashes content stably', () => {
    expect(contentHash(['a', 'b'])).toBe(contentHash(['a', 'b']));
    expect(contentHash(['a', 'b'])).not.toBe(contentHash(['a', 'c']));
  });
});

describe('createEmbeddingProvider', () => {
  it('disabled provider throws on embed', async () => {
    const provider = createEmbeddingProvider({
      provider: 'disabled',
      model: 'nomic-embed-text',
      dimensions: 768,
    });
    expect(provider.enabled).toBe(false);
    await expect(provider.embedQuery('hi')).rejects.toBeInstanceOf(
      EmbeddingDisabledError,
    );
  });
});
