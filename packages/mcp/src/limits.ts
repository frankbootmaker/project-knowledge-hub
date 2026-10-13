/** Max tool calls per API client per minute. */
export const MCP_RATE_LIMIT_PER_MINUTE = 60;

/** Max characters of markdown returned by get_knowledge_record. */
export const MCP_MAX_CONTENT_CHARS = 50_000;

/**
 * Max UTF-8 bytes of markdown in one page, leaving room for the rest of the
 * tool JSON under MCP_MAX_RESPONSE_BYTES.
 */
export const MCP_MAX_CONTENT_BYTES = 100_000;

/** Max items returned by list/search tools. */
export const MCP_MAX_LIST_LIMIT = 25;

/** Soft cap on serialized JSON tool result size (bytes). */
export const MCP_MAX_RESPONSE_BYTES = 200_000;

/** Appended to the first page when more markdown remains. Later pages omit it. */
export const MCP_CONTENT_TRUNCATION_SUFFIX = '\n\n…[truncated]';

export class ContentOffsetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContentOffsetError';
  }
}

export type ContentPage = {
  content: string;
  contentLength: number;
  contentOffset: number;
  contentTruncated: boolean;
  nextOffset: number | null;
};

export function isTruncatedReadback(content: string): boolean {
  return content.endsWith(MCP_CONTENT_TRUNCATION_SUFFIX);
}

function fitUtf8(text: string, maxBytes: number): string {
  if (maxBytes <= 0 || text.length === 0) return '';
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text;
  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (Buffer.byteLength(text.slice(0, mid), 'utf8') <= maxBytes) low = mid;
    else high = mid - 1;
  }
  if (low > 0) {
    const last = text.charCodeAt(low - 1);
    if (last >= 0xd800 && last <= 0xdbff) low -= 1;
  }
  return text.slice(0, low);
}

export function sliceContent(
  content: string,
  options?: { offset?: number; limit?: number },
): ContentPage {
  const contentLength = content.length;
  const offset = options?.offset ?? 0;
  if (!Number.isInteger(offset) || offset < 0) {
    throw new ContentOffsetError('contentOffset must be a non-negative integer');
  }
  if (offset > contentLength) {
    throw new ContentOffsetError('contentOffset is past the end of the record');
  }
  const requestedLimit = options?.limit ?? MCP_MAX_CONTENT_CHARS;
  if (!Number.isInteger(requestedLimit) || requestedLimit < 1) {
    throw new ContentOffsetError('contentLimit must be a positive integer');
  }
  const limit = Math.min(requestedLimit, MCP_MAX_CONTENT_CHARS);
  if (offset === contentLength) {
    return {
      content: '',
      contentLength,
      contentOffset: offset,
      contentTruncated: false,
      nextOffset: null,
    };
  }

  let slice = fitUtf8(content.slice(offset, offset + limit), MCP_MAX_CONTENT_BYTES);
  if (offset === 0 && offset + slice.length < contentLength) {
    const suffixBytes = Buffer.byteLength(MCP_CONTENT_TRUNCATION_SUFFIX, 'utf8');
    slice = fitUtf8(
      content.slice(offset, offset + limit),
      MCP_MAX_CONTENT_BYTES - suffixBytes,
    );
  }
  const end = offset + slice.length;
  const truncated = end < contentLength;
  const marker = offset === 0 && truncated ? MCP_CONTENT_TRUNCATION_SUFFIX : '';
  return {
    content: `${slice}${marker}`,
    contentLength,
    contentOffset: offset,
    contentTruncated: truncated,
    nextOffset: truncated ? end : null,
  };
}

export function truncateContent(content: string, max = MCP_MAX_CONTENT_CHARS): {
  content: string;
  truncated: boolean;
} {
  const page = sliceContent(content, { offset: 0, limit: max });
  return { content: page.content, truncated: page.contentTruncated };
}

export function enforceResponseSize<T>(payload: T): T {
  const serialized = JSON.stringify(payload);
  if (Buffer.byteLength(serialized, 'utf8') <= MCP_MAX_RESPONSE_BYTES) {
    return payload;
  }
  return {
    error: 'Response exceeds size limit',
    hint: 'Narrow filters or request a specific record id',
  } as T;
}
