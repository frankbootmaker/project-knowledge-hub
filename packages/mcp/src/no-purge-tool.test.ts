import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LLM_TOOL_CATALOG } from './llm-tool-catalog.js';

describe('MCP tool surface', () => {
  it('does not register a purge tool', () => {
    const catalogNames = LLM_TOOL_CATALOG.map((tool) => tool.name);
    expect(
      catalogNames.some((name) => name.toLowerCase().includes('purge')),
    ).toBe(false);

    const source = readFileSync(new URL('./server.ts', import.meta.url), 'utf8');
    const registered = [
      ...source.matchAll(/server\.tool\(\s*'([^']+)'/g),
    ].map((match) => match[1] ?? '');
    expect(registered.length).toBeGreaterThan(10);
    expect(
      registered.some((name) => name.toLowerCase().includes('purge')),
    ).toBe(false);
  });
});
