import { and, desc, eq, isNull, ne, sql } from 'drizzle-orm';
import type { Database } from '@project-knowledge-hub/database';
import {
  knowledgeRecords,
  projectKeyPrefixHistory,
  projects,
} from '@project-knowledge-hub/database';
import { AppError, normalizeKeyPrefix } from '@project-knowledge-hub/domain';

type PrefixDb = Pick<Database['db'], 'select' | 'insert' | 'update'>;

export type WorkspacePrefixStatus = 'free' | 'current' | 'retired';

/**
 * A project owns a prefix when it is the current key_prefix or an unreleased
 * historical prefix. Callers that do not scope workspaceIds still follow
 * PRO-T-3: the same prefix in another workspace is a second candidate.
 */
export function sqlProjectOwnsKeyPrefix(prefix: string) {
  const normalized = normalizeKeyPrefix(prefix);
  return sql`(
    upper(${projects.keyPrefix}) = ${normalized}
    or exists (
      select 1
      from project_key_prefix_history as prefix_history
      where prefix_history.project_id = ${projects.id}
        and prefix_history.released_at is null
        and upper(prefix_history.key_prefix) = ${normalized}
    )
  )`;
}

export async function workspaceKeyPrefixStatus(
  db: PrefixDb,
  input: {
    workspaceId: string;
    keyPrefix: string;
    excludeProjectId?: string;
  },
): Promise<WorkspacePrefixStatus> {
  const keyPrefix = normalizeKeyPrefix(input.keyPrefix);
  const currentConditions = [
    eq(projects.workspaceId, input.workspaceId),
    sql`upper(${projects.keyPrefix}) = ${keyPrefix}`,
  ];
  if (input.excludeProjectId) {
    currentConditions.push(ne(projects.id, input.excludeProjectId));
  }
  const [current] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(...currentConditions))
    .limit(1);
  if (current) return 'current';

  const historyConditions = [
    eq(projectKeyPrefixHistory.workspaceId, input.workspaceId),
    sql`upper(${projectKeyPrefixHistory.keyPrefix}) = ${keyPrefix}`,
    isNull(projectKeyPrefixHistory.releasedAt),
  ];
  if (input.excludeProjectId) {
    historyConditions.push(ne(projectKeyPrefixHistory.projectId, input.excludeProjectId));
  }
  const [retired] = await db
    .select({ id: projectKeyPrefixHistory.id })
    .from(projectKeyPrefixHistory)
    .where(and(...historyConditions))
    .limit(1);
  return retired ? 'retired' : 'free';
}

export async function listCrossWorkspacePrefixUses(
  database: Database,
  input: {
    workspaceId: string;
    keyPrefix: string;
    excludeProjectId?: string;
  },
): Promise<Array<{ name: string; retired: boolean }>> {
  const keyPrefix = normalizeKeyPrefix(input.keyPrefix);
  const currentConditions = [
    ne(projects.workspaceId, input.workspaceId),
    sql`upper(${projects.keyPrefix}) = ${keyPrefix}`,
  ];
  if (input.excludeProjectId) {
    currentConditions.push(ne(projects.id, input.excludeProjectId));
  }
  const current = await database.db
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .where(and(...currentConditions))
    .limit(3);

  const historyConditions = [
    ne(projectKeyPrefixHistory.workspaceId, input.workspaceId),
    sql`upper(${projectKeyPrefixHistory.keyPrefix}) = ${keyPrefix}`,
    isNull(projectKeyPrefixHistory.releasedAt),
  ];
  if (input.excludeProjectId) {
    historyConditions.push(ne(projectKeyPrefixHistory.projectId, input.excludeProjectId));
  }
  const retired = await database.db
    .select({
      id: projects.id,
      name: projects.name,
    })
    .from(projectKeyPrefixHistory)
    .innerJoin(projects, eq(projects.id, projectKeyPrefixHistory.projectId))
    .where(and(...historyConditions))
    .limit(3);

  const seen = new Set(current.map((row) => row.id));
  return [
    ...current.map((row) => ({ name: row.name, retired: false })),
    ...retired
      .filter((row) => !seen.has(row.id))
      .map((row) => ({ name: row.name, retired: true })),
  ];
}

/**
 * Record the previous prefix when it actually changes. Reclaiming a prefix
 * this project already retired releases that history row so the current
 * value and the reservation are not stored twice.
 */
export async function retireProjectKeyPrefix(
  db: PrefixDb,
  input: {
    projectId: string;
    workspaceId: string;
    previousPrefix: string | null;
    nextPrefix: string | null;
    actorUserId: string | null;
  },
): Promise<boolean> {
  const previous = input.previousPrefix
    ? normalizeKeyPrefix(input.previousPrefix)
    : null;
  const next = input.nextPrefix ? normalizeKeyPrefix(input.nextPrefix) : null;
  if (!previous || previous === next) return false;

  if (next) {
    await db
      .update(projectKeyPrefixHistory)
      .set({
        releasedAt: new Date(),
        releasedBy: input.actorUserId,
      })
      .where(
        and(
          eq(projectKeyPrefixHistory.projectId, input.projectId),
          sql`upper(${projectKeyPrefixHistory.keyPrefix}) = ${next}`,
          isNull(projectKeyPrefixHistory.releasedAt),
        ),
      );
  }

  const [existing] = await db
    .select({ id: projectKeyPrefixHistory.id })
    .from(projectKeyPrefixHistory)
    .where(
      and(
        eq(projectKeyPrefixHistory.projectId, input.projectId),
        sql`upper(${projectKeyPrefixHistory.keyPrefix}) = ${previous}`,
        isNull(projectKeyPrefixHistory.releasedAt),
      ),
    )
    .limit(1);
  if (!existing) {
    await db.insert(projectKeyPrefixHistory).values({
      projectId: input.projectId,
      workspaceId: input.workspaceId,
      keyPrefix: previous,
      retiredBy: input.actorUserId,
    });
  }
  return true;
}

export async function listProjectKeyPrefixHistory(
  database: Database,
  projectId: string,
) {
  return database.db
    .select({
      keyPrefix: projectKeyPrefixHistory.keyPrefix,
      retiredAt: projectKeyPrefixHistory.retiredAt,
      releasedAt: projectKeyPrefixHistory.releasedAt,
    })
    .from(projectKeyPrefixHistory)
    .where(eq(projectKeyPrefixHistory.projectId, projectId))
    .orderBy(desc(projectKeyPrefixHistory.retiredAt));
}

export async function releaseProjectKeyPrefix(
  database: Database,
  input: {
    projectId: string;
    keyPrefix: string;
    actorUserId: string;
  },
): Promise<{ keyPrefix: string }> {
  const keyPrefix = normalizeKeyPrefix(input.keyPrefix);
  const [row] = await database.db
    .update(projectKeyPrefixHistory)
    .set({
      releasedAt: new Date(),
      releasedBy: input.actorUserId,
    })
    .where(
      and(
        eq(projectKeyPrefixHistory.projectId, input.projectId),
        sql`upper(${projectKeyPrefixHistory.keyPrefix}) = ${keyPrefix}`,
        isNull(projectKeyPrefixHistory.releasedAt),
      ),
    )
    .returning({ keyPrefix: projectKeyPrefixHistory.keyPrefix });
  if (!row) {
    throw new AppError({
      code: 'KEY_PREFIX_NOT_RESERVED',
      message: `Prefix ${keyPrefix} is not a retired prefix of this project`,
      statusCode: 404,
    });
  }
  return { keyPrefix: row.keyPrefix };
}

export type KeyPrefixMention = {
  id: string;
  title: string;
  slug: string;
  projectId: string | null;
  projectSlug: string | null;
  excerpt: string;
};

const MENTION_LIMIT = 25;

/** Best-effort scan of knowledge-record text for keys that use this prefix. */
export async function listKeyPrefixMentions(
  database: Database,
  input: { workspaceId: string; keyPrefix: string },
): Promise<KeyPrefixMention[]> {
  const prefix = normalizeKeyPrefix(input.keyPrefix);
  const pattern = `(^|[^A-Za-z0-9])${prefix}-[A-Za-z]{1,4}-[0-9]+`;
  const mentioned = sql`(
    ${knowledgeRecords.title} ~* ${pattern}
    or coalesce(${knowledgeRecords.summary}, '') ~* ${pattern}
    or coalesce(${knowledgeRecords.contentMarkdown}, '') ~* ${pattern}
  )`;
  const rows = await database.db
    .select({
      id: knowledgeRecords.id,
      title: knowledgeRecords.title,
      slug: knowledgeRecords.slug,
      projectId: knowledgeRecords.projectId,
      projectSlug: projects.slug,
      summary: knowledgeRecords.summary,
      contentMarkdown: knowledgeRecords.contentMarkdown,
    })
    .from(knowledgeRecords)
    .leftJoin(projects, eq(projects.id, knowledgeRecords.projectId))
    .where(and(eq(knowledgeRecords.workspaceId, input.workspaceId), mentioned))
    .orderBy(desc(knowledgeRecords.updatedAt))
    .limit(MENTION_LIMIT);

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    slug: row.slug,
    projectId: row.projectId,
    projectSlug: row.projectSlug,
    excerpt: mentionExcerpt(prefix, row.title, row.summary, row.contentMarkdown),
  }));
}

function mentionExcerpt(
  prefix: string,
  title: string,
  summary: string | null,
  content: string | null,
): string {
  const matcher = new RegExp(
    `(^|[^A-Za-z0-9])(${prefix}-[A-Za-z]{1,4}-[0-9]+)`,
    'i',
  );
  for (const source of [title, summary ?? '', content ?? '']) {
    const match = matcher.exec(source);
    if (!match || match.index == null) continue;
    const at = match.index + match[1]!.length;
    const start = Math.max(0, at - 40);
    const slice = source.slice(start, at + 80).replace(/\s+/g, ' ').trim();
    return start > 0 ? `…${slice}` : slice;
  }
  return title;
}
