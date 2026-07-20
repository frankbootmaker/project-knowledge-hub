import { createHash } from 'node:crypto';

const DEFAULT_CHUNK_CHARS = 1200;
const DEFAULT_OVERLAP_CHARS = 200;

export type TextChunk = {
  index: number;
  content: string;
  tokenEstimate: number;
};

/** Rough token estimate (~4 chars/token). */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function contentHash(parts: string[]): string {
  return createHash('sha256').update(parts.join('\n\0\n'), 'utf8').digest('hex');
}

/**
 * Split title + summary + markdown into overlapping character windows.
 */
export function chunkKnowledgeText(input: {
  title: string;
  summary?: string | null;
  contentMarkdown: string;
  chunkChars?: number;
  overlapChars?: number;
}): TextChunk[] {
  const chunkChars = input.chunkChars ?? DEFAULT_CHUNK_CHARS;
  const overlapChars = input.overlapChars ?? DEFAULT_OVERLAP_CHARS;
  const header = [
    `# ${input.title.trim()}`,
    input.summary?.trim() ? input.summary.trim() : '',
  ]
    .filter(Boolean)
    .join('\n\n');
  const body = input.contentMarkdown?.trim() ?? '';
  const full = [header, body].filter(Boolean).join('\n\n').trim();
  if (!full) {
    return [];
  }

  if (full.length <= chunkChars) {
    return [
      {
        index: 0,
        content: full,
        tokenEstimate: estimateTokens(full),
      },
    ];
  }

  const chunks: TextChunk[] = [];
  let start = 0;
  let index = 0;
  while (start < full.length) {
    const end = Math.min(full.length, start + chunkChars);
    const content = full.slice(start, end).trim();
    if (content) {
      chunks.push({
        index,
        content,
        tokenEstimate: estimateTokens(content),
      });
      index += 1;
    }
    if (end >= full.length) break;
    start = Math.max(0, end - overlapChars);
  }
  return chunks;
}
