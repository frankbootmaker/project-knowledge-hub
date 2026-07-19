import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  lifecycleStatusSchema,
  recordTypeSchema,
} from '@project-knowledge-hub/domain';
import {
  buildSnippet,
  combineSearchScore,
  DEFAULT_EXCLUDED_LIFECYCLE_STATUSES,
} from '@project-knowledge-hub/search';

export const searchBodySchema = z.object({
  workspaceId: z.string().uuid(),
  query: z.string().min(1).max(300),
  projectId: z.string().uuid().optional(),
  systemId: z.string().uuid().optional(),
  recordTypes: z.array(recordTypeSchema).max(40).optional(),
  lifecycleStatuses: z.array(lifecycleStatusSchema).max(20).optional(),
  verifiedOnly: z.boolean().optional(),
  currentOnly: z.boolean().optional(),
  includeHistorical: z.boolean().optional(),
  sourceType: z.string().max(80).optional(),
  limit: z.number().int().min(1).max(50).optional(),
});

export type SearchInput = z.infer<typeof searchBodySchema>;

type SearchRow = {
  id: string;
  workspace_id: string;
  project_id: string | null;
  system_id: string | null;
  title: string;
  slug: string;
  summary: string | null;
  record_type: string;
  lifecycle_status: string;
  content_markdown: string;
  verified_at: Date | null;
  updated_at: Date;
  project_name: string | null;
  project_slug: string | null;
  system_name: string | null;
  system_slug: string | null;
  source_type: string | null;
  source_provider: string | null;
  tag_names: string | null;
  ts_rank: number;
};

export function parseSearchInput(raw: unknown) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const input = raw as Record<string, unknown>;
    return searchBodySchema.parse({
      ...input,
      verifiedOnly:
        typeof input.verifiedOnly === 'string'
          ? input.verifiedOnly === 'true'
          : input.verifiedOnly,
      currentOnly:
        typeof input.currentOnly === 'string'
          ? input.currentOnly === 'true'
          : input.currentOnly,
      includeHistorical:
        typeof input.includeHistorical === 'string'
          ? input.includeHistorical === 'true'
          : input.includeHistorical,
      limit: typeof input.limit === 'string' ? Number(input.limit) : input.limit,
      recordTypes:
        typeof input.recordTypes === 'string'
          ? input.recordTypes.split(',').filter(Boolean)
          : input.recordTypes,
      lifecycleStatuses:
        typeof input.lifecycleStatuses === 'string'
          ? input.lifecycleStatuses.split(',').filter(Boolean)
          : input.lifecycleStatuses,
    });
  }
  return searchBodySchema.parse(raw);
}

export async function runSearch(app: FastifyInstance, input: SearchInput) {
  const limit = input.limit ?? 20;
  const includeHistorical = input.includeHistorical ?? false;

  const conditions: string[] = [
    'kr.workspace_id = $1',
    'kr.archived_at IS NULL',
    `kr.search_vector @@ plainto_tsquery('english', $2)`,
  ];
  const params: unknown[] = [input.workspaceId, input.query];
  let paramIndex = 3;

  if (!includeHistorical && !input.lifecycleStatuses?.length) {
    conditions.push(
      `kr.lifecycle_status NOT IN (${DEFAULT_EXCLUDED_LIFECYCLE_STATUSES.map((status) => `'${status}'`).join(', ')})`,
    );
  }

  if (input.projectId) {
    conditions.push(`kr.project_id = $${paramIndex}`);
    params.push(input.projectId);
    paramIndex += 1;
  }
  if (input.systemId) {
    conditions.push(`kr.system_id = $${paramIndex}`);
    params.push(input.systemId);
    paramIndex += 1;
  }
  if (input.recordTypes && input.recordTypes.length > 0) {
    conditions.push(`kr.record_type = ANY($${paramIndex}::text[])`);
    params.push(input.recordTypes);
    paramIndex += 1;
  }
  if (input.lifecycleStatuses && input.lifecycleStatuses.length > 0) {
    conditions.push(`kr.lifecycle_status = ANY($${paramIndex}::text[])`);
    params.push(input.lifecycleStatuses);
    paramIndex += 1;
  }
  if (input.verifiedOnly) {
    conditions.push(`kr.verified_at IS NOT NULL`);
    conditions.push(`kr.lifecycle_status IN ('verified', 'current')`);
  }
  if (input.currentOnly) {
    conditions.push(`kr.lifecycle_status = 'current'`);
  }
  if (input.sourceType) {
    conditions.push(`ks.source_type = $${paramIndex}`);
    params.push(input.sourceType);
    paramIndex += 1;
  }

  // Also match project/system/tag names that may not be in the record vector
  conditions[2] = `(
    kr.search_vector @@ plainto_tsquery('english', $2)
    OR p.name ILIKE '%' || $2 || '%'
    OR s.name ILIKE '%' || $2 || '%'
    OR EXISTS (
      SELECT 1
      FROM knowledge_record_tags krt
      INNER JOIN tags t ON t.id = krt.tag_id
      WHERE krt.knowledge_record_id = kr.id
        AND t.name ILIKE '%' || $2 || '%'
    )
  )`;

  params.push(limit);
  const limitParam = paramIndex;

  const sql = `
    SELECT
      kr.id,
      kr.workspace_id,
      kr.project_id,
      kr.system_id,
      kr.title,
      kr.slug,
      kr.summary,
      kr.record_type,
      kr.lifecycle_status,
      kr.content_markdown,
      kr.verified_at,
      kr.updated_at,
      p.name AS project_name,
      p.slug AS project_slug,
      s.name AS system_name,
      s.slug AS system_slug,
      ks.source_type,
      ks.source_provider,
      (
        SELECT string_agg(t.name, ', ' ORDER BY t.name)
        FROM knowledge_record_tags krt
        INNER JOIN tags t ON t.id = krt.tag_id
        WHERE krt.knowledge_record_id = kr.id
      ) AS tag_names,
      COALESCE(ts_rank_cd(kr.search_vector, plainto_tsquery('english', $2)), 0)::float8 AS ts_rank
    FROM knowledge_records kr
    LEFT JOIN projects p ON p.id = kr.project_id
    LEFT JOIN systems s ON s.id = kr.system_id
    LEFT JOIN LATERAL (
      SELECT source_type, source_provider
      FROM knowledge_sources
      WHERE knowledge_record_id = kr.id
      ORDER BY created_at ASC
      LIMIT 1
    ) ks ON true
    WHERE ${conditions.join(' AND ')}
    LIMIT $${limitParam}
  `;

  const rows = (await app.database.client.unsafe(sql, params as never[])) as SearchRow[];

  const results = rows
    .map((row) => {
      const score = combineSearchScore({
        tsRank: Number(row.ts_rank) || 0,
        title: row.title,
        query: input.query,
        lifecycleStatus: row.lifecycle_status,
      });
      const excerptSource = row.summary?.trim()
        ? `${row.summary}\n\n${row.content_markdown}`
        : row.content_markdown;
      return {
        id: row.id,
        workspaceId: row.workspace_id,
        projectId: row.project_id,
        systemId: row.system_id,
        title: row.title,
        slug: row.slug,
        summary: row.summary,
        recordType: row.record_type,
        lifecycleStatus: row.lifecycle_status,
        verified: Boolean(row.verified_at) ||
          row.lifecycle_status === 'verified' ||
          row.lifecycle_status === 'current',
        project: row.project_id
          ? { id: row.project_id, name: row.project_name, slug: row.project_slug }
          : null,
        system: row.system_id
          ? { id: row.system_id, name: row.system_name, slug: row.system_slug }
          : null,
        tags: row.tag_names
          ? row.tag_names.split(', ').filter(Boolean)
          : [],
        sourceType: row.source_type,
        sourceProvider: row.source_provider,
        excerpt: buildSnippet(excerptSource, input.query),
        updatedAt: row.updated_at instanceof Date
          ? row.updated_at.toISOString()
          : String(row.updated_at),
        score,
      };
    })
    .sort((a, b) => b.score - a.score);

  return {
    query: input.query,
    workspaceId: input.workspaceId,
    total: results.length,
    results,
  };
}

