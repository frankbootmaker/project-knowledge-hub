/** Max tool calls per API client per minute. */
export const MCP_RATE_LIMIT_PER_MINUTE = 60;

/** Max characters of markdown returned by get_knowledge_record. */
export const MCP_MAX_CONTENT_CHARS = 50_000;

/** Max items returned by list/search tools. */
export const MCP_MAX_LIST_LIMIT = 25;

/** Soft cap on serialized JSON tool result size (bytes). */
export const MCP_MAX_RESPONSE_BYTES = 200_000;

export function truncateContent(content: string, max = MCP_MAX_CONTENT_CHARS): {
  content: string;
  truncated: boolean;
} {
  if (content.length <= max) {
    return { content, truncated: false };
  }
  return {
    content: `${content.slice(0, max)}\n\n…[truncated]`,
    truncated: true,
  };
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
