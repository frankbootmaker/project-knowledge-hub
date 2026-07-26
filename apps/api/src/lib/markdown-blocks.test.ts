import { describe, expect, it } from 'vitest';
import {
  coerceSpreadsheetValue,
  extractMarkdownTables,
  parseMarkdownBlocks,
  stripInlineMarkdown,
} from './markdown-blocks.js';

const markdown = [
  '# Overview',
  '',
  'Intro with **bold**, `code` and a [link](https://example.com).',
  'Second line of the same paragraph.',
  '',
  '## Dividends',
  '',
  '| Year | Amount | Share |',
  '| --- | ---: | ---: |',
  '| 2024 | 1 250 000 Ft | 12,5% |',
  '| 2025 | 2.500.000 Ft | 25% |',
  '',
  '- First item',
  '  - Nested item',
  '1. Ordered item',
  '',
  '> Quoted note',
  '',
  '```ts',
  'const x = 1;',
  '```',
  '',
  '---',
].join('\n');

describe('parseMarkdownBlocks', () => {
  it('parses headings, paragraphs, tables, lists, quotes and code', () => {
    const blocks = parseMarkdownBlocks(markdown);
    const kinds = blocks.map((block) => block.kind);
    expect(kinds).toEqual([
      'heading',
      'paragraph',
      'heading',
      'table',
      'list',
      'quote',
      'code',
      'rule',
    ]);
  });

  it('joins paragraph lines and strips inline markup', () => {
    const [, paragraph] = parseMarkdownBlocks(markdown);
    expect(paragraph).toEqual({
      kind: 'paragraph',
      text: 'Intro with bold, code and a link. Second line of the same paragraph.',
    });
  });

  it('records list depth and markers', () => {
    const list = parseMarkdownBlocks(markdown).find((block) => block.kind === 'list');
    expect(list).toEqual({
      kind: 'list',
      items: [
        { depth: 0, marker: '•', text: 'First item' },
        { depth: 1, marker: '•', text: 'Nested item' },
        { depth: 0, marker: '1.', text: 'Ordered item' },
      ],
    });
  });

  it('captions tables with the nearest preceding heading', () => {
    const [table] = extractMarkdownTables(markdown);
    expect(table?.caption).toBe('Dividends');
    expect(table?.headers).toEqual(['Year', 'Amount', 'Share']);
    expect(table?.rows).toHaveLength(2);
  });

  it('keeps code block language and lines verbatim', () => {
    const code = parseMarkdownBlocks(markdown).find((block) => block.kind === 'code');
    expect(code).toEqual({ kind: 'code', language: 'ts', lines: ['const x = 1;'] });
  });
});

describe('stripInlineMarkdown', () => {
  it('removes emphasis, links and images', () => {
    expect(stripInlineMarkdown('**a** _b_ ~~c~~ ![alt](x.png) [d](https://e.f)')).toBe(
      'a b c alt d',
    );
  });
});

describe('coerceSpreadsheetValue', () => {
  it('parses plain integers and decimals', () => {
    expect(coerceSpreadsheetValue('1234')).toEqual({ value: 1234, numFmt: '#,##0' });
    expect(coerceSpreadsheetValue('12,5')).toEqual({ value: 12.5, numFmt: '#,##0.##' });
  });

  it('parses grouped numbers in both conventions', () => {
    expect(coerceSpreadsheetValue('1 250 000').value).toBe(1250000);
    expect(coerceSpreadsheetValue('2.500.000').value).toBe(2500000);
    expect(coerceSpreadsheetValue('1,234,567.89').value).toBe(1234567.89);
  });

  it('parses percentages and currency', () => {
    expect(coerceSpreadsheetValue('12,5%')).toEqual({ value: 0.125, numFmt: '0.##%' });
    expect(coerceSpreadsheetValue('1 250 000 Ft')).toEqual({
      value: 1250000,
      numFmt: '#,##0 "Ft"',
    });
    expect(coerceSpreadsheetValue('$1,200.50')).toEqual({
      value: 1200.5,
      numFmt: '"$"#,##0.##',
    });
  });

  it('parses dates', () => {
    expect(coerceSpreadsheetValue('2026-07-27')).toEqual({
      value: new Date(Date.UTC(2026, 6, 27)),
      numFmt: 'yyyy-mm-dd',
    });
    expect(coerceSpreadsheetValue('2026.07.27.').value).toEqual(
      new Date(Date.UTC(2026, 6, 27)),
    );
  });

  it('keeps text and treats dashes as empty', () => {
    expect(coerceSpreadsheetValue('Tagi hitel')).toEqual({ value: 'Tagi hitel' });
    expect(coerceSpreadsheetValue('—')).toEqual({ value: null });
  });
});
