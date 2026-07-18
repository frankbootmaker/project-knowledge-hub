import { and, desc, eq, isNull, ne, sql } from 'drizzle-orm';
import {
  knowledgeRecords,
  knowledgeRecordVersions,
  type Database,
} from '@project-knowledge-hub/database';

type RecordRow = typeof knowledgeRecords.$inferSelect;
type VersionRow = typeof knowledgeRecordVersions.$inferSelect;

export function toPublicVersion(version: VersionRow) {
  return {
    id: version.id,
    knowledgeRecordId: version.knowledgeRecordId,
    versionNumber: version.versionNumber,
    title: version.title,
    summary: version.summary,
    recordType: version.recordType,
    lifecycleStatus: version.lifecycleStatus,
    contentMarkdown: version.contentMarkdown,
    metadata: version.metadataJson,
    changeMessage: version.changeMessage,
    createdBy: version.createdBy,
    createdAt: version.createdAt.toISOString(),
  };
}

export async function insertVersionSnapshot(
  database: Database,
  input: {
    knowledgeRecordId: string;
    versionNumber: number;
    title: string;
    summary: string | null;
    recordType: string;
    lifecycleStatus: string;
    contentMarkdown: string;
    metadataJson: Record<string, unknown> | null;
    changeMessage: string | null;
    createdBy: string;
  },
): Promise<VersionRow> {
  const [created] = await database.db
    .insert(knowledgeRecordVersions)
    .values({
      knowledgeRecordId: input.knowledgeRecordId,
      versionNumber: input.versionNumber,
      title: input.title,
      summary: input.summary,
      recordType: input.recordType,
      lifecycleStatus: input.lifecycleStatus,
      contentMarkdown: input.contentMarkdown,
      metadataJson: input.metadataJson,
      changeMessage: input.changeMessage,
      createdBy: input.createdBy,
    })
    .returning();

  if (!created) {
    throw new Error('Failed to insert knowledge record version');
  }
  return created;
}

/** For pre-M4 records: persist the current row as a baseline version if none exist. */
export async function ensureBaselineVersion(
  database: Database,
  record: RecordRow,
): Promise<void> {
  const [countRow] = await database.db
    .select({ count: sql<number>`count(*)::int` })
    .from(knowledgeRecordVersions)
    .where(eq(knowledgeRecordVersions.knowledgeRecordId, record.id));

  if ((countRow?.count ?? 0) > 0) {
    return;
  }

  await insertVersionSnapshot(database, {
    knowledgeRecordId: record.id,
    versionNumber: record.currentVersionNumber,
    title: record.title,
    summary: record.summary,
    recordType: record.recordType,
    lifecycleStatus: record.lifecycleStatus,
    contentMarkdown: record.contentMarkdown,
    metadataJson: record.metadataJson,
    changeMessage: 'Baseline snapshot',
    createdBy: record.createdBy,
  });
}

export async function listVersions(
  database: Database,
  knowledgeRecordId: string,
): Promise<VersionRow[]> {
  return database.db
    .select()
    .from(knowledgeRecordVersions)
    .where(eq(knowledgeRecordVersions.knowledgeRecordId, knowledgeRecordId))
    .orderBy(desc(knowledgeRecordVersions.versionNumber));
}

export async function getVersion(
  database: Database,
  knowledgeRecordId: string,
  versionNumber: number,
): Promise<VersionRow | null> {
  const [version] = await database.db
    .select()
    .from(knowledgeRecordVersions)
    .where(
      and(
        eq(knowledgeRecordVersions.knowledgeRecordId, knowledgeRecordId),
        eq(knowledgeRecordVersions.versionNumber, versionNumber),
      ),
    )
    .limit(1);
  return version ?? null;
}

/**
 * Mark other current records in the same configuration series as superseded.
 * Series: same workspace + recordType + (systemId if set, else projectId if set).
 */
export async function supersedeOtherCurrentInSeries(
  database: Database,
  record: RecordRow,
): Promise<Array<{ id: string; slug: string }>> {
  if (!record.systemId && !record.projectId) {
    // Without system/project association there is no configuration series.
    return [];
  }

  const conditions = [
    eq(knowledgeRecords.workspaceId, record.workspaceId),
    eq(knowledgeRecords.recordType, record.recordType),
    eq(knowledgeRecords.lifecycleStatus, 'current'),
    ne(knowledgeRecords.id, record.id),
    isNull(knowledgeRecords.archivedAt),
  ];

  if (record.systemId) {
    conditions.push(eq(knowledgeRecords.systemId, record.systemId));
  } else if (record.projectId) {
    conditions.push(eq(knowledgeRecords.projectId, record.projectId));
  }

  const others = await database.db
    .select()
    .from(knowledgeRecords)
    .where(and(...conditions));

  const superseded: Array<{ id: string; slug: string }> = [];
  for (const other of others) {
    await database.db
      .update(knowledgeRecords)
      .set({
        lifecycleStatus: 'superseded',
        updatedAt: new Date(),
      })
      .where(eq(knowledgeRecords.id, other.id));
    superseded.push({ id: other.id, slug: other.slug });
  }

  return superseded;
}

export function contentFieldsChanged(
  previous: RecordRow,
  next: {
    title: string;
    summary: string | null;
    recordType: string;
    contentMarkdown: string;
    metadataJson: Record<string, unknown> | null;
  },
): boolean {
  return (
    previous.title !== next.title ||
    previous.summary !== next.summary ||
    previous.recordType !== next.recordType ||
    previous.contentMarkdown !== next.contentMarkdown ||
    JSON.stringify(previous.metadataJson ?? null) !== JSON.stringify(next.metadataJson ?? null)
  );
}
