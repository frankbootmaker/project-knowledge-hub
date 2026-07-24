import {
  isStructuredContentFormat,
  parseStructuredConversation,
  type ParsedTurn,
} from './parsers.js';
import type { ConversationContentFormat } from './schemas.js';

export type SuggestedDraftChunk = {
  id: string;
  title: string;
  contentMarkdown: string;
  excerptNote: string;
};

function pairTurns(turns: ParsedTurn[]): ParsedTurn[][] {
  const pairs: ParsedTurn[][] = [];
  let i = 0;
  while (i < turns.length) {
    const current = turns[i]!;
    const next = turns[i + 1];
    if (
      current.role === 'user' &&
      next &&
      (next.role === 'assistant' || next.role === 'model')
    ) {
      pairs.push([current, next]);
      i += 2;
      continue;
    }
    pairs.push([current]);
    i += 1;
  }
  return pairs;
}

function turnsToChunkMarkdown(turns: ParsedTurn[]): string {
  const lines: string[] = [];
  for (const turn of turns) {
    const role = turn.role.trim() || 'unknown';
    const heading = role.charAt(0).toUpperCase() + role.slice(1);
    lines.push(`## ${heading}`, '', turn.content, '');
  }
  return lines.join('\n').replace(/\s+$/u, '').trim();
}

function titleFromContent(content: string, fallback: string): string {
  const firstLine = content
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith('#'));
  if (!firstLine) return fallback;
  const cleaned = firstLine.replace(/^['"`]+|['"`]+$/g, '');
  return cleaned.length > 80 ? `${cleaned.slice(0, 77)}…` : cleaned;
}

function splitMarkdownByRoleHeadings(markdown: string): SuggestedDraftChunk[] {
  const parts = markdown.split(/(?=^##\s+(?:User|Assistant|System|Human|Model)\s*$)/im);
  const sections = parts.map((part) => part.trim()).filter(Boolean);
  if (sections.length <= 1) {
    return [];
  }

  const chunks: SuggestedDraftChunk[] = [];
  for (let i = 0; i < sections.length; i += 2) {
    const group = [sections[i], sections[i + 1]].filter(Boolean) as string[];
    const contentMarkdown = group.join('\n\n').trim();
    if (!contentMarkdown) continue;
    const index = chunks.length + 1;
    chunks.push({
      id: `heading-${index}`,
      title: titleFromContent(contentMarkdown, `Excerpt ${index}`),
      contentMarkdown,
      excerptNote: `Auto-split chunk ${index}`,
    });
  }
  return chunks;
}

function splitByGeneralHeadings(markdown: string): SuggestedDraftChunk[] {
  const parts = markdown.split(/(?=^#{1,3}\s+\S)/m);
  const sections = parts.map((part) => part.trim()).filter(Boolean);
  if (sections.length <= 1) return [];

  return sections.map((contentMarkdown, index) => {
    const heading = contentMarkdown.match(/^#{1,3}\s+(.+)$/m)?.[1]?.trim();
    return {
      id: `section-${index + 1}`,
      title: heading || titleFromContent(contentMarkdown, `Section ${index + 1}`),
      contentMarkdown,
      excerptNote: `Auto-split section ${index + 1}`,
    };
  });
}

/**
 * Suggest draft chunks from an import without LLM.
 * Structured formats prefer user+assistant pairs; markdown uses role/general headings.
 */
export function suggestDraftChunks(input: {
  title: string;
  rawContent: string;
  contentFormat: ConversationContentFormat;
  /** Prefer full-body resolved markdown when already computed. */
  draftMarkdown?: string;
}): SuggestedDraftChunk[] {
  const markdown = (input.draftMarkdown ?? input.rawContent).trim();
  if (!markdown) return [];

  if (isStructuredContentFormat(input.contentFormat)) {
    try {
      const parsed = parseStructuredConversation(input.contentFormat, input.rawContent);
      if (parsed.turns.length >= 2) {
        return pairTurns(parsed.turns).map((turns, index) => {
          const contentMarkdown = turnsToChunkMarkdown(turns);
          const userBit = turns.find((t) => t.role === 'user')?.content ?? contentMarkdown;
          return {
            id: `turn-${index + 1}`,
            title: titleFromContent(userBit, `${input.title} — ${index + 1}`),
            contentMarkdown,
            excerptNote: `Auto-split turn pair ${index + 1}`,
          };
        });
      }
    } catch {
      // Fall through to markdown heuristics.
    }
  }

  const byRole = splitMarkdownByRoleHeadings(markdown);
  if (byRole.length >= 2) return byRole;

  const byHeading = splitByGeneralHeadings(markdown);
  if (byHeading.length >= 2) return byHeading;

  return [];
}
