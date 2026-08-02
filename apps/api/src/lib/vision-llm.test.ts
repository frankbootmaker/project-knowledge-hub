import { describe, expect, it } from 'vitest';
import {
  consumeChatCompletionsSse,
  deltaTextFromChatChunk,
  extractChatMessageContent,
  normalizeTranslatedMarkdown,
  parseTranslationJson,
  restoreStrippedMarkdownHeading,
  stripModelReasoning,
  unescapeLiteralNewlines,
} from './vision-llm.js';
import { formatSseEvent } from './sse.js';

describe('extractChatMessageContent', () => {
  it('returns content after a closing think tag', () => {
    expect(
      extractChatMessageContent({
        content: 'plan…</think>\n\n{"title":"T"}',
      }),
    ).toBe('{"title":"T"}');
  });

  it('falls back to reasoning when content is empty', () => {
    expect(
      extractChatMessageContent({
        content: '',
        reasoning: 'scratch</think>\nfinal',
      }),
    ).toBe('final');
  });
});

describe('stripModelReasoning', () => {
  it('removes think blocks before JSON', () => {
    const raw = '<think>plan…</think>\n{"title":"T","summary":null,"contentMarkdown":"# A\\n"}';
    expect(stripModelReasoning(raw)).toBe(
      '{"title":"T","summary":null,"contentMarkdown":"# A\\n"}',
    );
  });
});

describe('unescapeLiteralNewlines', () => {
  it('converts literal backslash-n sequences when real newlines are absent', () => {
    expect(unescapeLiteralNewlines('Híd\\n\\nBeállítások.\\n')).toBe(
      'Híd\n\nBeállítások.\n',
    );
  });

  it('leaves normal markdown alone', () => {
    const md = '# Híd\n\nBeállítások.\n';
    expect(unescapeLiteralNewlines(md)).toBe(md);
  });
});

describe('restoreStrippedMarkdownHeading', () => {
  it('restores a dropped ATX heading marker', () => {
    expect(
      restoreStrippedMarkdownHeading(
        '# Bridge\n\nCurrent settings.\n',
        'Híd\n\nJelenlegi beállítások.\n',
      ),
    ).toBe('# Híd\n\nJelenlegi beállítások.\n');
  });

  it('does not double-prefix existing headings', () => {
    const translated = '# Híd\n\nJelenlegi beállítások.\n';
    expect(
      restoreStrippedMarkdownHeading('# Bridge\n\nCurrent settings.\n', translated),
    ).toBe(translated);
  });
});

describe('normalizeTranslatedMarkdown', () => {
  it('fixes literal newlines and stripped headings together', () => {
    expect(
      normalizeTranslatedMarkdown(
        '# Bridge\n\nCurrent Tailscale Headscale bridge settings.\n',
        'Híd\\n\\nJelenlegi Tailscale Headscale híd beállítások.\\n',
      ),
    ).toBe('# Híd\n\nJelenlegi Tailscale Headscale híd beállítások.\n');
  });
});

describe('parseTranslationJson', () => {
  it('parses whole-response fenced JSON and unescapes contentMarkdown', () => {
    const content = [
      '<think>ok</think>',
      '```json',
      '{"title":"MCP Híd","summary":null,"contentMarkdown":"Híd\\\\n\\\\nBeállítások.\\\\n"}',
      '```',
    ].join('\n');

    const parsed = parseTranslationJson(content);
    expect(parsed.title).toBe('MCP Híd');
    expect(parsed.contentMarkdown).toBe('Híd\n\nBeállítások.\n');
  });

  it('does not treat code fences inside contentMarkdown as a JSON wrapper', () => {
    const content = JSON.stringify({
      title: 'Example',
      summary: null,
      contentMarkdown: '# Run\n\n```bash\necho hi\n```\n',
    });

    const parsed = parseTranslationJson(content);
    expect(parsed.title).toBe('Example');
    expect(parsed.contentMarkdown).toContain('```bash');
    expect(parsed.contentMarkdown).toContain('echo hi');
  });
});

describe('deltaTextFromChatChunk', () => {
  it('joins content and reasoning delta fragments', () => {
    expect(
      deltaTextFromChatChunk({
        choices: [{ delta: { content: '{"a"', reasoning: 'think' } }],
      }),
    ).toBe('{"a"think');
  });
});

describe('consumeChatCompletionsSse', () => {
  it('accumulates streamed deltas for the Details log', async () => {
    const sse = [
      'data: {"model":"qwen3:4b","choices":[{"delta":{"content":"{\\"title\\""}}]}\n\n',
      'data: {"choices":[{"delta":{"content":":\\"T\\"}"}}]}\n\n',
      'data: [DONE]\n\n',
    ].join('');
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(sse));
        controller.close();
      },
    });
    const deltas: string[] = [];
    const result = await consumeChatCompletionsSse(stream, (text) => {
      deltas.push(text);
    });
    expect(deltas.join('')).toBe('{"title":"T"}');
    expect(result.content).toBe('{"title":"T"}');
    expect(result.model).toBe('qwen3:4b');
  });
});

describe('formatSseEvent', () => {
  it('formats event frames', () => {
    expect(formatSseEvent('stage', { stage: 'preparing' })).toBe(
      'event: stage\ndata: {"stage":"preparing"}\n\n',
    );
  });
});
