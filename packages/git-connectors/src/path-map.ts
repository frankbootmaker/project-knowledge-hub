import { recordTypeSchema, type RecordType } from '@project-knowledge-hub/domain';
import type { GitPathMapping } from '@project-knowledge-hub/database';
import { pathMatches } from './path-match.js';

export const DEFAULT_INCLUDE_PATHS = ['docs/**/*.md', 'README.md', '**/ADR-*.md'];
export const DEFAULT_EXCLUDE_PATHS = ['**/node_modules/**', '**/.git/**'];

export const DEFAULT_PATH_MAPPINGS: GitPathMapping[] = [
  { pattern: 'docs/adr/**', recordType: 'decision', tags: ['adr', 'git'] },
  { pattern: '**/ADR-*.md', recordType: 'decision', tags: ['adr', 'git'] },
  {
    pattern: 'docs/architecture/**',
    recordType: 'architecture',
    tags: ['architecture', 'git'],
  },
  {
    pattern: 'docs/deployment/**',
    recordType: 'deployment-guide',
    tags: ['ops', 'deploy', 'git'],
  },
  {
    pattern: 'docs/security/**',
    recordType: 'security-note',
    tags: ['security', 'git'],
  },
  {
    pattern: 'docs/development/**',
    recordType: 'runbook',
    tags: ['dev', 'git'],
  },
  {
    pattern: 'docs/product/ROADMAP.md',
    recordType: 'roadmap',
    tags: ['product', 'git'],
  },
  {
    pattern: 'docs/product/**',
    recordType: 'overview',
    tags: ['product', 'git'],
  },
  {
    pattern: 'docs/design/**',
    recordType: 'note',
    tags: ['design', 'git'],
  },
  {
    pattern: 'docs/MILESTONE_*.md',
    recordType: 'plan',
    tags: ['milestone', 'git'],
  },
  { pattern: 'docs/**', recordType: 'note', tags: ['docs', 'git'] },
  { pattern: 'README.md', recordType: 'overview', tags: ['readme', 'git'] },
];

export type MappedPath = {
  recordType: RecordType;
  tags: string[];
};

export function mapPathToRecord(
  path: string,
  mappings: GitPathMapping[] = DEFAULT_PATH_MAPPINGS,
): MappedPath {
  for (const mapping of mappings) {
    if (!pathMatches(path, [mapping.pattern])) continue;
    const parsed = recordTypeSchema.safeParse(mapping.recordType);
    return {
      recordType: parsed.success ? parsed.data : 'note',
      tags: [...new Set([...(mapping.tags ?? []), 'git'])],
    };
  }
  return { recordType: 'note', tags: ['git', 'docs'] };
}

export function titleFromMarkdown(content: string, fallbackPath: string): string {
  const heading = content.match(/^#\s+(.+)$/m);
  if (heading?.[1]?.trim()) {
    return heading[1].trim().slice(0, 300);
  }
  const base = fallbackPath.split('/').pop() ?? fallbackPath;
  return base.replace(/\.(md|mdx|markdown)$/i, '').replace(/[-_]+/g, ' ').slice(0, 300);
}
