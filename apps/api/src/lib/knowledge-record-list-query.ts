import { z } from 'zod';
import { recordTypeSchema } from '@project-knowledge-hub/domain';

const MAX_EXCLUDE_IDS = 200;
const MAX_PAGE_SIZE = 50;
const MAX_OFFSET = 10_000;

function queryInt(min: number, max: number) {
  return z
    .string()
    .optional()
    .transform((value, ctx) => {
      if (value === undefined || value === '') {
        return undefined;
      }
      if (!/^\d+$/.test(value)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Expected an integer',
        });
        return z.NEVER;
      }
      const parsed = Number(value);
      if (parsed < min || parsed > max) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Expected an integer from ${min} to ${max}`,
        });
        return z.NEVER;
      }
      return parsed;
    });
}

const excludeIdsSchema = z
  .string()
  .optional()
  .transform((value, ctx) => {
    if (!value?.trim()) {
      return [] as string[];
    }
    const ids = value
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
    if (ids.length > MAX_EXCLUDE_IDS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `excludeIds accepts at most ${MAX_EXCLUDE_IDS} ids`,
      });
      return z.NEVER;
    }
    for (const id of ids) {
      if (!z.string().uuid().safeParse(id).success) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'excludeIds must be comma-separated uuids',
        });
        return z.NEVER;
      }
    }
    return ids;
  });

/**
 * Catalogue list. `limit` turns on paging and a `total`. Without it the
 * route still returns the full filtered list so existing callers stay put.
 * `workspaceLevel` keeps workspace-scoped records (no project) when the
 * caller has no projectId.
 */
export const knowledgeRecordListQuerySchema = z.object({
  workspaceId: z.string().uuid(),
  projectId: z.string().uuid().optional(),
  systemId: z.string().uuid().optional(),
  language: z.string().min(2).max(16).optional(),
  slug: z.string().min(1).max(200).optional(),
  includeArchived: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
  includeRecordRelations: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
  q: z
    .string()
    .max(200)
    .optional()
    .transform((value) => {
      const trimmed = value?.trim() ?? '';
      return trimmed.length > 0 ? trimmed : undefined;
    }),
  recordType: recordTypeSchema.optional(),
  limit: queryInt(1, MAX_PAGE_SIZE),
  offset: queryInt(0, MAX_OFFSET),
  excludeIds: excludeIdsSchema,
  workspaceLevel: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
});

export type KnowledgeRecordListQuery = z.infer<typeof knowledgeRecordListQuerySchema>;

/** Escape `%`, `_`, and `\` so a picker query cannot widen an ILIKE pattern. */
export function escapeIlike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

export function knowledgeRecordSearchPattern(query: string): string {
  return `%${escapeIlike(query)}%`;
}
