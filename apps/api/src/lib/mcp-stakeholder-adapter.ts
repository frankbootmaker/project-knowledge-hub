import type { PublicStakeholder } from './project-stakeholders.js';

/**
 * MCP adapter for stakeholder responses.
 * Transforms REST/service stakeholder entries for MCP clients.
 * 
 * For roster-backed entries (rosterId != null):
 * - Sets id = rosterId (agents need the roster ID for mutations)
 * - Keeps rosterId field
 * - Sets userId (null for open seats, UUID for filled)
 * 
 * Non-roster entries (RACI-only people, AI assistants) are unchanged.
 */
export function toMcpStakeholder(entry: PublicStakeholder): PublicStakeholder {
  if (entry.rosterId) {
    return {
      ...entry,
      id: entry.rosterId,
    };
  }
  return entry;
}
