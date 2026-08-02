import { describe, expect, it } from 'vitest';
import {
  normalizeTranslatedMarkdown,
  parseTranslationJson,
  restoreStrippedMarkdownHeading,
  stripModelReasoning,
  unescapeLiteralNewlines,
} from './vision-llm.js';

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
  it('parses fenced JSON and unescapes contentMarkdown', () => {
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
});
