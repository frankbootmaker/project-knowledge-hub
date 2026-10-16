import { createHash } from 'node:crypto';

/** Max tool calls per API client per minute. */
export const MCP_RATE_LIMIT_PER_MINUTE = 60;

/** Max characters of markdown returned by get_knowledge_record. */
export const MCP_MAX_CONTENT_CHARS = 50_000;

/**
 * Smallest page the server will shrink to when the serialized response would
 * still exceed MCP_MAX_RESPONSE_BYTES.
 */
export const MCP_MIN_CONTENT_CHARS = 1_000;

/**
 * Max UTF-8 bytes of markdown in one page, leaving room for the rest of the
 * tool JSON under MCP_MAX_RESPONSE_BYTES.
 */
export const MCP_MAX_CONTENT_BYTES = 100_000;

/** Max items returned by list/search tools. */
export const MCP_MAX_LIST_LIMIT = 25;

/** Soft cap on serialized JSON tool result size (bytes). */
export const MCP_MAX_RESPONSE_BYTES = 200_000;

/** Appended to the default unpaged first page when more markdown remains. Omitted when paging. */
export const MCP_CONTENT_TRUNCATION_SUFFIX = '\n\n…[truncated]';

export class ContentOffsetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContentOffsetError';
  }
}

export type ContentBoundary = 'none' | 'paragraph' | 'line';

export type ContentPage = {
  content: string;
  contentLength: number;
  contentOffset: number;
  contentTruncated: boolean;
  nextOffset: number | null;
  /** Source characters in this page, excluding the first-page truncation marker. */
  returnedChars: number;
  /** 0-based page index for this read (`ceil(offset/limit)` when offset > 0). */
  chunkIndex: number;
  /** Approximate page count (`ceil(contentLength / limit)`). */
  totalChunks: number;
  /** True when this page ends inside a code fence that could not be moved back. */
  inCodeFence: boolean;
};

export function isTruncatedReadback(content: string): boolean {
  return content.endsWith(MCP_CONTENT_TRUNCATION_SUFFIX);
}

/** SHA-256 hex of the full markdown body. Stable across pages of one version. */
export function contentSha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
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

function chunkMeta(offset: number, limit: number, contentLength: number): {
  chunkIndex: number;
  totalChunks: number;
} {
  return {
    chunkIndex: offset === 0 ? 0 : Math.ceil(offset / limit),
    totalChunks: contentLength === 0 ? 1 : Math.ceil(contentLength / limit),
  };
}

/** Include the break when it starts in the second half of the window. */
function snapToBoundary(slice: string, boundary: ContentBoundary): string {
  if (boundary === 'none' || slice.length === 0) return slice;
  const needle = boundary === 'paragraph' ? '\n\n' : '\n';
  const idx = slice.lastIndexOf(needle);
  if (idx < 0 || idx < slice.length / 2) return slice;
  const cut = idx + needle.length;
  if (cut <= 0 || cut >= slice.length) return slice;
  return slice.slice(0, cut);
}

/**
 * Index of the opener for a fence that is still open at `end`.
 * Fences are lines whose trimmed text starts with ```.
 */
function openFenceAt(content: string, end: number): number | null {
  let openAt: number | null = null;
  let i = 0;
  while (i < end) {
    const lineEnd = content.indexOf('\n', i);
    const lineStop = lineEnd === -1 || lineEnd >= end ? end : lineEnd;
    const line = content.slice(i, lineStop);
    if (line.trimStart().startsWith('```')) {
      openAt = openAt === null ? i : null;
    }
    if (lineEnd === -1 || lineEnd >= end) break;
    i = lineEnd + 1;
  }
  return openAt;
}

export function sliceContent(
  content: string,
  options?: {
    offset?: number;
    limit?: number;
    boundary?: ContentBoundary;
    /** Default unpaged read only; ignored when contentOffset/contentLimit are used. */
    legacyFirstPageTruncation?: boolean;
  },
): ContentPage {
  const contentLength = content.length;
  const offset = options?.offset ?? 0;
  const explicitPaging =
    options?.offset !== undefined || options?.limit !== undefined;
  const legacyFirstPageTruncation =
    options?.legacyFirstPageTruncation ?? !explicitPaging;
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
  const boundary = options?.boundary ?? 'none';
  let start = offset;
  if (start > 0 && start < contentLength) {
    const code = content.charCodeAt(start);
    const prev = content.charCodeAt(start - 1);
    if (code >= 0xdc00 && code <= 0xdfff && prev >= 0xd800 && prev <= 0xdbff) {
      start -= 1;
    }
  }
  const meta = chunkMeta(start, limit, contentLength);
  if (start === contentLength) {
    return {
      content: '',
      contentLength,
      contentOffset: start,
      contentTruncated: false,
      nextOffset: null,
      returnedChars: 0,
      inCodeFence: false,
      ...meta,
    };
  }

  let slice = fitUtf8(content.slice(start, start + limit), MCP_MAX_CONTENT_BYTES);
  if (
    legacyFirstPageTruncation &&
    start === 0 &&
    start + slice.length < contentLength
  ) {
    const suffixBytes = Buffer.byteLength(MCP_CONTENT_TRUNCATION_SUFFIX, 'utf8');
    slice = fitUtf8(
      content.slice(start, start + limit),
      MCP_MAX_CONTENT_BYTES - suffixBytes,
    );
  }
  slice = snapToBoundary(slice, boundary);

  let end = start + slice.length;
  let inCodeFence = false;
  const opener = openFenceAt(content, end);
  if (opener !== null && opener < end) {
    if (opener > start) {
      end = opener;
      slice = content.slice(start, end);
    } else {
      inCodeFence = true;
    }
  }

  const truncated = end < contentLength;
  const marker =
    legacyFirstPageTruncation && start === 0 && truncated
      ? MCP_CONTENT_TRUNCATION_SUFFIX
      : '';
  return {
    content: `${slice}${marker}`,
    contentLength,
    contentOffset: start,
    contentTruncated: truncated,
    nextOffset: truncated ? end : null,
    returnedChars: slice.length,
    inCodeFence,
    ...meta,
  };
}

/** Pretty-printed tool JSON size, matching the MCP text result. */
export function serializedResponseBytes(payload: unknown): number {
  return Buffer.byteLength(JSON.stringify(payload, null, 2), 'utf8');
}

/**
 * Re-slice with a smaller limit until `measure` fits under the response cap.
 * Stops at MCP_MIN_CONTENT_CHARS so a page always makes progress.
 */
export function sliceContentToFit(
  content: string,
  options: { offset?: number; limit?: number; boundary?: ContentBoundary } | undefined,
  measure: (page: ContentPage) => number,
): ContentPage {
  let limit = Math.min(options?.limit ?? MCP_MAX_CONTENT_CHARS, MCP_MAX_CONTENT_CHARS);
  let page = sliceContent(content, { ...options, limit });
  while (measure(page) > MCP_MAX_RESPONSE_BYTES && limit > MCP_MIN_CONTENT_CHARS) {
    const halved = Math.max(MCP_MIN_CONTENT_CHARS, Math.floor(limit / 2));
    if (halved >= limit) break;
    limit = halved;
    page = sliceContent(content, { ...options, limit });
  }
  return page;
}

export function truncateContent(content: string, max = MCP_MAX_CONTENT_CHARS): {
  content: string;
  truncated: boolean;
} {
  const page = sliceContent(content, {
    offset: 0,
    limit: max,
    legacyFirstPageTruncation: true,
  });
  return { content: page.content, truncated: page.contentTruncated };
}

export function enforceResponseSize<T>(payload: T): T {
  const serialized = JSON.stringify(payload);
  if (Buffer.byteLength(serialized, 'utf8') <= MCP_MAX_RESPONSE_BYTES) {
    return payload;
  }
  let suggestedLimit = 10;
  if (payload && typeof payload === 'object' && 'limit' in payload) {
    const limit = (payload as { limit?: unknown }).limit;
    if (typeof limit === 'number' && Number.isInteger(limit) && limit > 0) {
      suggestedLimit = Math.max(1, Math.floor(limit / 2));
    }
  }
  return {
    error: 'Response exceeds size limit',
    hint:
      'Pass a smaller limit, follow nextCursor, or page get_knowledge_record with contentOffset. suggestedLimit is a smaller list page size.',
    suggestedLimit,
  } as T;
}
