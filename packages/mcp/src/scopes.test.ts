import { describe, expect, it } from 'vitest';
import { DEFAULT_MCP_SCOPES, hasMcpScope } from './scopes.js';
import {
  ContentOffsetError,
  enforceResponseSize,
  isTruncatedReadback,
  MCP_CONTENT_TRUNCATION_SUFFIX,
  MCP_MAX_CONTENT_BYTES,
  MCP_MAX_RESPONSE_BYTES,
  serializedResponseBytes,
  sliceContent,
  sliceContentToFit,
  truncateContent,
} from './limits.js';

describe('mcp scopes and limits', () => {
  it('includes default read scopes without write', () => {
    expect(DEFAULT_MCP_SCOPES).toContain('knowledge:search');
    expect(DEFAULT_MCP_SCOPES).not.toContain('knowledge:write');
    expect(DEFAULT_MCP_SCOPES).not.toContain('pm:read');
    expect(DEFAULT_MCP_SCOPES).not.toContain('pm:write');
    expect(DEFAULT_MCP_SCOPES).not.toContain('catalogue:write');
    expect(DEFAULT_MCP_SCOPES).not.toContain('monitoring:read');
    expect(hasMcpScope(DEFAULT_MCP_SCOPES, 'projects:read')).toBe(true);
    expect(hasMcpScope(['projects:read'], 'knowledge:read')).toBe(false);
    expect(hasMcpScope(['monitoring:read'], 'monitoring:read')).toBe(true);
    expect(hasMcpScope(['knowledge:write'], 'knowledge:write')).toBe(true);
    expect(hasMcpScope(['catalogue:write'], 'catalogue:write')).toBe(true);
    expect(hasMcpScope(['pm:write'], 'pm:write')).toBe(true);
  });

  it('truncates oversized content', () => {
    const result = truncateContent('x'.repeat(10), 5);
    expect(result.truncated).toBe(true);
    expect(result.content.startsWith('xxxxx')).toBe(true);
    expect(result.content.endsWith(MCP_CONTENT_TRUNCATION_SUFFIX)).toBe(true);
  });

  it('pages a record so later slices join back to the source', () => {
    const source = 'abcdefghij';
    const first = sliceContent(source, { offset: 0, limit: 4 });
    expect(first.contentLength).toBe(source.length);
    expect(first.contentOffset).toBe(0);
    expect(first.contentTruncated).toBe(true);
    expect(first.content.endsWith(MCP_CONTENT_TRUNCATION_SUFFIX)).toBe(true);
    expect(first.nextOffset).toBe(4);

    const second = sliceContent(source, { offset: first.nextOffset ?? 0, limit: 4 });
    expect(second.content).toBe('efgh');
    expect(second.content.endsWith(MCP_CONTENT_TRUNCATION_SUFFIX)).toBe(false);
    expect(second.nextOffset).toBe(8);

    const third = sliceContent(source, { offset: second.nextOffset ?? 0, limit: 4 });
    expect(third.content).toBe('ij');
    expect(third.contentTruncated).toBe(false);
    expect(third.nextOffset).toBeNull();

    const joined = [
      first.content.slice(0, first.nextOffset ?? first.content.length),
      second.content,
      third.content,
    ].join('');
    expect(joined).toBe(source);
  });

  it('stops a page at the UTF-8 byte cap and continues from the characters returned', () => {
    const source = '😀'.repeat(40_000);
    const page = sliceContent(source, { offset: 0, limit: 50_000 });
    const body = page.content.slice(0, page.content.length - MCP_CONTENT_TRUNCATION_SUFFIX.length);
    expect(Buffer.byteLength(page.content, 'utf8')).toBeLessThanOrEqual(MCP_MAX_CONTENT_BYTES);
    expect(page.nextOffset).toBe(body.length);
    expect(page.contentTruncated).toBe(true);
    expect(page.contentLength).toBe(source.length);

    const rest = sliceContent(source, { offset: page.nextOffset ?? 0, limit: 50_000 });
    expect(rest.contentOffset).toBe(page.nextOffset);
    expect(rest.content.endsWith(MCP_CONTENT_TRUNCATION_SUFFIX)).toBe(false);
  });

  it('returns an empty slice at the end and rejects an offset past it', () => {
    const source = 'abc';
    const end = sliceContent(source, { offset: source.length });
    expect(end.content).toBe('');
    expect(end.contentTruncated).toBe(false);
    expect(end.nextOffset).toBeNull();
    expect(() => sliceContent(source, { offset: source.length + 1 })).toThrow(ContentOffsetError);
  });

  it('treats a body that ends with the truncation marker as a truncated readback', () => {
    const page = sliceContent('abcdefghij', { offset: 0, limit: 4 });
    expect(isTruncatedReadback(page.content)).toBe(true);
    expect(isTruncatedReadback('abcdefghij')).toBe(false);
    expect(isTruncatedReadback(`notes ${MCP_CONTENT_TRUNCATION_SUFFIX} and more`)).toBe(false);
  });

  it('covers short, exact, and over-limit lengths', () => {
    const empty = sliceContent('');
    expect(empty.returnedChars).toBe(0);
    expect(empty.contentTruncated).toBe(false);
    expect(empty.totalChunks).toBe(1);
    expect(empty.nextOffset).toBeNull();

    const one = sliceContent('a', { limit: 1 });
    expect(one.content).toBe('a');
    expect(one.returnedChars).toBe(1);
    expect(one.contentTruncated).toBe(false);
    expect(one.chunkIndex).toBe(0);
    expect(one.totalChunks).toBe(1);

    const exact = sliceContent('x'.repeat(50_000));
    expect(exact.contentTruncated).toBe(false);
    expect(exact.returnedChars).toBe(50_000);
    expect(exact.nextOffset).toBeNull();

    const over = sliceContent('x'.repeat(50_001));
    expect(over.contentTruncated).toBe(true);
    expect(over.returnedChars).toBe(50_000);
    expect(over.nextOffset).toBe(50_000);
    expect(over.totalChunks).toBe(2);
    expect(over.content.endsWith(MCP_CONTENT_TRUNCATION_SUFFIX)).toBe(true);
  });

  it('joins a long body, including a 500k record, back to the source', () => {
    for (const length of [120_000, 500_000]) {
      const source = 'z'.repeat(length);
      let offset = 0;
      let joined = '';
      let guard = 0;
      while (guard < 20) {
        const page = sliceContent(source, { offset, limit: 50_000 });
        joined += source.slice(page.contentOffset, page.contentOffset + page.returnedChars);
        expect(page.returnedChars).toBeGreaterThan(0);
        if (page.nextOffset === null) break;
        expect(page.nextOffset).toBeGreaterThan(offset);
        offset = page.nextOffset;
        guard += 1;
      }
      expect(joined).toBe(source);
    }
  });

  it('snaps to a paragraph or line in the second half and hard-cuts otherwise', () => {
    const paragraph = sliceContent('aaaa\n\nbbMORE', {
      offset: 0,
      limit: 8,
      boundary: 'paragraph',
    });
    expect(paragraph.returnedChars).toBe(6);
    expect(paragraph.nextOffset).toBe(6);
    expect(paragraph.content.startsWith('aaaa\n\n')).toBe(true);

    const line = sliceContent('abcd\nEFGHMORE', { offset: 0, limit: 6, boundary: 'line' });
    expect(line.returnedChars).toBe(5);
    expect(line.nextOffset).toBe(5);

    const hard = sliceContent('abcdefghij', { offset: 0, limit: 4, boundary: 'paragraph' });
    expect(hard.nextOffset).toBe(4);
    expect(hard.returnedChars).toBe(4);
  });

  it('moves a cut back before an open fence, or flags the page when it cannot', () => {
    const source = `intro\n\`\`\`js\n${'x'.repeat(20)}`;
    const opener = source.indexOf('```');
    const page = sliceContent(source, { offset: 0, limit: opener + 8, boundary: 'none' });
    expect(page.inCodeFence).toBe(false);
    expect(page.nextOffset).toBe(opener);
    expect(page.content.startsWith('intro\n')).toBe(true);
    expect(page.content.includes('```')).toBe(false);

    const inside = sliceContent(`\`\`\`\n${'x'.repeat(30)}`, { offset: 4, limit: 5 });
    expect(inside.inCodeFence).toBe(true);
    expect(inside.content).toBe('xxxxx');
    expect(inside.returnedChars).toBe(5);
  });

  it('adds suggestedLimit when a response exceeds the byte cap', () => {
    const text = 'x'.repeat(MCP_MAX_RESPONSE_BYTES);
    const halved = enforceResponseSize({ limit: 25, text }) as { suggestedLimit?: number };
    expect(halved.suggestedLimit).toBe(12);
    const fallback = enforceResponseSize({ text }) as { suggestedLimit?: number };
    expect(fallback.suggestedLimit).toBe(10);
    const floor = enforceResponseSize({ limit: 1, text }) as { suggestedLimit?: number };
    expect(floor.suggestedLimit).toBe(1);
    expect(enforceResponseSize({ ok: true })).toEqual({ ok: true });
  });

  it('keeps the unpaged read body and only adds paging fields', () => {
    const source = `${'a'.repeat(50_000)}TAIL`;
    const page = sliceContent(source);
    expect(page.contentTruncated).toBe(true);
    expect(page.content.endsWith(MCP_CONTENT_TRUNCATION_SUFFIX)).toBe(true);
    expect(page.content.startsWith('a'.repeat(50_000))).toBe(true);
    expect(page.returnedChars).toBe(50_000);
    expect({
      contentLength: page.contentLength,
      contentOffset: page.contentOffset,
      nextOffset: page.nextOffset,
      chunkIndex: page.chunkIndex,
      totalChunks: page.totalChunks,
      inCodeFence: page.inCodeFence,
    }).toEqual({
      contentLength: 50_004,
      contentOffset: 0,
      nextOffset: 50_000,
      chunkIndex: 0,
      totalChunks: 2,
      inCodeFence: false,
    });
  });

  it('moves a contentOffset off the low half of a surrogate pair', () => {
    const source = 'a😀b';
    const emojiAt = source.indexOf('😀');
    const page = sliceContent(source, { offset: emojiAt + 1, limit: 10 });
    expect(page.contentOffset).toBe(emojiAt);
    expect(page.content.codePointAt(0)).toBe('😀'.codePointAt(0));
    expect(page.content.startsWith('😀')).toBe(true);
  });

  it('shrinks heavily escaped pages so each one stays under the response cap', () => {
    const source = `${'\u0001'.repeat(40_000)}${'😀"\\\n'.repeat(2_000)}`;
    const measure = (page: ReturnType<typeof sliceContent>) =>
      serializedResponseBytes({
        knowledgeRecord: {
          contentMarkdown: page.content,
          contentTruncated: page.contentTruncated,
          contentLength: page.contentLength,
          contentOffset: page.contentOffset,
          nextOffset: page.nextOffset,
          returnedChars: page.returnedChars,
        },
      });

    let offset = 0;
    let joined = '';
    for (let guard = 0; guard < 80; guard += 1) {
      const page = sliceContentToFit(source, { offset }, measure);
      expect(measure(page)).toBeLessThanOrEqual(MCP_MAX_RESPONSE_BYTES);
      expect(page.returnedChars).toBeGreaterThan(0);
      joined += source.slice(page.contentOffset, page.contentOffset + page.returnedChars);
      if (page.nextOffset === null) {
        expect(joined).toBe(source);
        return;
      }
      expect(page.nextOffset).toBeGreaterThan(offset);
      offset = page.nextOffset;
    }
    throw new Error('paging did not finish');
  });
});
