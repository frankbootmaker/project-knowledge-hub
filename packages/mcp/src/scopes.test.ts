import { describe, expect, it } from 'vitest';
import { DEFAULT_MCP_SCOPES, hasMcpScope } from './scopes.js';
import {
  ContentOffsetError,
  isTruncatedReadback,
  MCP_CONTENT_TRUNCATION_SUFFIX,
  MCP_MAX_CONTENT_BYTES,
  sliceContent,
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
});
