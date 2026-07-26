/**
 * Lightweight block parser used by spreadsheet/PDF exports. It turns canonical
 * Markdown into ordered structural blocks so exporters can lay out real
 * headings, lists and tables instead of raw Markdown text.
 */

export type MarkdownListItem = {
  depth: number;
  marker: string;
  text: string;
};

export type MarkdownTable = {
  headers: string[];
  rows: string[][];
  /** Nearest preceding heading, used to name spreadsheet sheets. */
  caption: string | null;
};

export type MarkdownBlock =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; items: MarkdownListItem[] }
  | { kind: 'quote'; text: string }
  | { kind: 'code'; language: string | null; lines: string[] }
  | { kind: 'table'; table: MarkdownTable }
  | { kind: 'rule' };

const HEADING_PATTERN = /^(#{1,6})\s+(.*)$/;
const FENCE_PATTERN = /^(```|~~~)\s*([\w-]*)\s*$/;
const RULE_PATTERN = /^(-{3,}|\*{3,}|_{3,})$/;
const LIST_PATTERN = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const TABLE_ROW_PATTERN = /^\|.*\|$/;
const TABLE_SEPARATOR_PATTERN = /^\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)+\|?$/;

export function stripInlineMarkdown(value: string): string {
  return value
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(?=\S)([\s\S]*?)(?<=\S)\1/g, '$2')
    .replace(/~~(.*?)~~/g, '$1')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => stripInlineMarkdown(cell));
}

export function parseMarkdownBlocks(markdown: string): MarkdownBlock[] {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const blocks: MarkdownBlock[] = [];
  let lastHeading: string | null = null;
  let index = 0;

  while (index < lines.length) {
    const raw = lines[index] ?? '';
    const line = raw.trim();

    if (!line) {
      index += 1;
      continue;
    }

    const fence = FENCE_PATTERN.exec(line);
    if (fence) {
      const marker = fence[1];
      const language = fence[2] ? fence[2].toLowerCase() : null;
      const code: string[] = [];
      index += 1;
      while (index < lines.length && (lines[index] ?? '').trim() !== marker) {
        code.push(lines[index] ?? '');
        index += 1;
      }
      index += 1;
      blocks.push({ kind: 'code', language, lines: code });
      continue;
    }

    const heading = HEADING_PATTERN.exec(line);
    if (heading) {
      const text = stripInlineMarkdown(heading[2] ?? '');
      lastHeading = text || lastHeading;
      blocks.push({ kind: 'heading', level: heading[1]?.length ?? 1, text });
      index += 1;
      continue;
    }

    if (
      TABLE_ROW_PATTERN.test(line) &&
      TABLE_SEPARATOR_PATTERN.test((lines[index + 1] ?? '').trim())
    ) {
      const headers = splitTableRow(line);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && TABLE_ROW_PATTERN.test((lines[index] ?? '').trim())) {
        rows.push(splitTableRow(lines[index] ?? ''));
        index += 1;
      }
      blocks.push({ kind: 'table', table: { headers, rows, caption: lastHeading } });
      continue;
    }

    if (RULE_PATTERN.test(line)) {
      blocks.push({ kind: 'rule' });
      index += 1;
      continue;
    }

    if (line.startsWith('>')) {
      const quoted: string[] = [];
      while (index < lines.length && (lines[index] ?? '').trim().startsWith('>')) {
        quoted.push((lines[index] ?? '').trim().replace(/^>\s?/, ''));
        index += 1;
      }
      blocks.push({ kind: 'quote', text: stripInlineMarkdown(quoted.join(' ')) });
      continue;
    }

    if (LIST_PATTERN.test(raw)) {
      const items: MarkdownListItem[] = [];
      while (index < lines.length) {
        const match = LIST_PATTERN.exec(lines[index] ?? '');
        if (!match) break;
        const indent = (match[1] ?? '').replace(/\t/g, '  ').length;
        const bullet = match[2] ?? '-';
        items.push({
          depth: Math.floor(indent / 2),
          marker: /^\d/.test(bullet) ? bullet.replace(/[.)]$/, '.') : '•',
          text: stripInlineMarkdown(match[3] ?? ''),
        });
        index += 1;
      }
      blocks.push({ kind: 'list', items });
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length) {
      const current = lines[index] ?? '';
      const trimmed = current.trim();
      if (
        !trimmed ||
        HEADING_PATTERN.test(trimmed) ||
        FENCE_PATTERN.test(trimmed) ||
        RULE_PATTERN.test(trimmed) ||
        LIST_PATTERN.test(current) ||
        trimmed.startsWith('>') ||
        TABLE_ROW_PATTERN.test(trimmed)
      ) {
        break;
      }
      paragraph.push(trimmed);
      index += 1;
    }
    if (paragraph.length > 0) {
      blocks.push({ kind: 'paragraph', text: stripInlineMarkdown(paragraph.join(' ')) });
      continue;
    }

    index += 1;
  }

  return blocks;
}

export function extractMarkdownTables(markdown: string): MarkdownTable[] {
  return parseMarkdownBlocks(markdown)
    .filter((block): block is Extract<MarkdownBlock, { kind: 'table' }> => block.kind === 'table')
    .map((block) => block.table);
}

export type SpreadsheetValue = {
  value: string | number | Date | null;
  numFmt?: string;
};

const CURRENCY_SUFFIX_PATTERN = /^(-?[\d\s.,]+)\s*(Ft|HUF|EUR|USD|GBP|€|\$|£)$/i;
const CURRENCY_PREFIX_PATTERN = /^(€|\$|£)\s*(-?[\d\s.,]+)$/;
const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DOTTED_DATE_PATTERN = /^(\d{4})\.\s?(\d{1,2})\.\s?(\d{1,2})\.?$/;

function parseNumberLike(text: string): number | null {
  const compact = text.replace(/\s/g, '');
  if (!/^-?[\d.,]+$/.test(compact) || !/\d/.test(compact)) {
    return null;
  }

  const lastComma = compact.lastIndexOf(',');
  const lastDot = compact.lastIndexOf('.');
  let normalized = compact;

  if (lastComma >= 0 && lastDot >= 0) {
    normalized =
      lastComma > lastDot
        ? compact.replace(/\./g, '').replace(',', '.')
        : compact.replace(/,/g, '');
  } else if (lastComma >= 0) {
    const groups = compact.split(',');
    const looksGrouped =
      groups.length > 1 && groups.slice(1).every((group) => group.length === 3);
    normalized = looksGrouped ? compact.replace(/,/g, '') : compact.replace(',', '.');
  } else if (lastDot >= 0) {
    const groups = compact.split('.');
    const looksGrouped =
      groups.length > 2 && groups.slice(1).every((group) => group.length === 3);
    normalized = looksGrouped ? compact.replace(/\./g, '') : compact;
  }

  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

function numberFormatFor(value: number): string {
  return Number.isInteger(value) ? '#,##0' : '#,##0.##';
}

/** Convert a Markdown table cell into a typed spreadsheet value. */
export function coerceSpreadsheetValue(raw: string): SpreadsheetValue {
  const text = stripInlineMarkdown(raw).replace(/[\u00a0\u202f\u2009]/g, ' ').trim();
  if (!text || text === '-' || text === '—') {
    return { value: null };
  }

  if (text.endsWith('%')) {
    const percent = parseNumberLike(text.slice(0, -1));
    if (percent !== null) {
      return { value: percent / 100, numFmt: '0.##%' };
    }
  }

  const suffixCurrency = CURRENCY_SUFFIX_PATTERN.exec(text);
  if (suffixCurrency) {
    const amount = parseNumberLike(suffixCurrency[1] ?? '');
    if (amount !== null) {
      const symbol = suffixCurrency[2] ?? '';
      return { value: amount, numFmt: `${numberFormatFor(amount)} "${symbol}"` };
    }
  }

  const prefixCurrency = CURRENCY_PREFIX_PATTERN.exec(text);
  if (prefixCurrency) {
    const amount = parseNumberLike(prefixCurrency[2] ?? '');
    if (amount !== null) {
      const symbol = prefixCurrency[1] ?? '';
      return { value: amount, numFmt: `"${symbol}"${numberFormatFor(amount)}` };
    }
  }

  const isoDate = ISO_DATE_PATTERN.exec(text) ?? DOTTED_DATE_PATTERN.exec(text);
  if (isoDate) {
    const year = Number(isoDate[1]);
    const month = Number(isoDate[2]);
    const day = Number(isoDate[3]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return {
        value: new Date(Date.UTC(year, month - 1, day)),
        numFmt: 'yyyy-mm-dd',
      };
    }
  }

  const numeric = parseNumberLike(text);
  if (numeric !== null) {
    return { value: numeric, numFmt: numberFormatFor(numeric) };
  }

  return { value: text };
}
