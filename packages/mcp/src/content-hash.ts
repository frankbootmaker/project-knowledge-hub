import { createHash } from 'node:crypto';

/**
 * SHA-256 hex of the full markdown body. Stable across pages of one version.
 * Server-only: the web app imports other MCP modules, and this file must not
 * be part of that graph.
 */
export function contentSha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}
