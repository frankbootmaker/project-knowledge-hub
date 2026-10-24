/**
 * List page sizes with no Node builtins.
 * The web app imports the LLM catalog, so these constants must not live in
 * limits.ts (that module imports node:crypto).
 */

/** Max items returned by list/search tools. */
export const MCP_MAX_LIST_LIMIT = 25;

/**
 * Page size for list_knowledge_records on Bearer /mcp and call_hub_tool.
 * Other lists stay at MCP_MAX_LIST_LIMIT.
 */
export const MCP_KNOWLEDGE_LIST_LIMIT = 50;
