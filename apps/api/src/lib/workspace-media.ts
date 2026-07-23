import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { and, desc, eq, isNull } from 'drizzle-orm';
import {
  blobObjectKey,
  type BlobStore,
} from '@project-knowledge-hub/blob-store';
import {
  knowledgeRecords,
  workspaceMedia,
  type Database,
} from '@project-knowledge-hub/database';
import { AppError } from '@project-knowledge-hub/domain';

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export function isAllowedMediaContentType(value: string): boolean {
  return ALLOWED_TYPES.has(value);
}

export function mediaPublicUrl(mediaId: string): string {
  return `/api/v1/media/${mediaId}`;
}

export function mediaMarkdownSnippet(mediaId: string, alt?: string | null): string {
  const safeAlt = (alt ?? 'image').replace(/[[\]]/g, '');
  return `![${safeAlt}](${mediaPublicUrl(mediaId)})`;
}

export type WorkspaceMediaRow = typeof workspaceMedia.$inferSelect;

export type PublicWorkspaceMedia = {
  id: string;
  workspaceId: string;
  knowledgeRecordId: string | null;
  contentType: string;
  byteSize: number;
  originalFilename: string | null;
  altText: string | null;
  createdBy: string | null;
  createdAt: string;
  url: string;
  markdownSnippet: string;
};

export function toPublicMedia(row: WorkspaceMediaRow): PublicWorkspaceMedia {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    knowledgeRecordId: row.knowledgeRecordId,
    contentType: row.contentType,
    byteSize: row.byteSize,
    originalFilename: row.originalFilename,
    altText: row.altText,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    url: mediaPublicUrl(row.id),
    markdownSnippet: mediaMarkdownSnippet(row.id, row.altText),
  };
}

function mediaBlobKey(workspaceId: string, mediaId: string): string {
  return blobObjectKey('media', `${workspaceId}/${mediaId}`);
}

function mediaFilePath(uploadDir: string, workspaceId: string, mediaId: string): string {
  return path.join(path.resolve(uploadDir), workspaceId, mediaId);
}

async function ensureMediaParentDir(
  uploadDir: string,
  workspaceId: string,
): Promise<void> {
  await mkdir(path.join(path.resolve(uploadDir), workspaceId), { recursive: true });
}

export async function writeMediaBytes(
  uploadDir: string,
  workspaceId: string,
  mediaId: string,
  buffer: Buffer,
  options?: { blobStore?: BlobStore; contentType?: string },
): Promise<void> {
  const store = options?.blobStore;
  if (store && store.provider !== 'disabled') {
    await store.put({
      key: mediaBlobKey(workspaceId, mediaId),
      body: buffer,
      contentType: options?.contentType,
    });
    await ensureMediaParentDir(uploadDir, workspaceId);
    await writeFile(mediaFilePath(uploadDir, workspaceId, mediaId), buffer).catch(
      () => undefined,
    );
    return;
  }

  await ensureMediaParentDir(uploadDir, workspaceId);
  await writeFile(mediaFilePath(uploadDir, workspaceId, mediaId), buffer);
}

export async function readMediaBytes(
  uploadDir: string,
  workspaceId: string,
  mediaId: string,
  options?: { blobStore?: BlobStore },
): Promise<Buffer | null> {
  const store = options?.blobStore;
  if (store && store.provider !== 'disabled') {
    const fromBlob = await store.get(mediaBlobKey(workspaceId, mediaId));
    if (fromBlob) return fromBlob;
    const local = await readLocalMedia(uploadDir, workspaceId, mediaId);
    if (local) {
      await store
        .put({ key: mediaBlobKey(workspaceId, mediaId), body: local })
        .catch(() => undefined);
      return local;
    }
    return null;
  }
  return readLocalMedia(uploadDir, workspaceId, mediaId);
}

async function readLocalMedia(
  uploadDir: string,
  workspaceId: string,
  mediaId: string,
): Promise<Buffer | null> {
  try {
    return await readFile(mediaFilePath(uploadDir, workspaceId, mediaId));
  } catch {
    return null;
  }
}

export async function deleteMediaBytes(
  uploadDir: string,
  workspaceId: string,
  mediaId: string,
  options?: { blobStore?: BlobStore },
): Promise<void> {
  const store = options?.blobStore;
  if (store && store.provider !== 'disabled') {
    await store.delete(mediaBlobKey(workspaceId, mediaId)).catch(() => undefined);
  }
  try {
    await unlink(mediaFilePath(uploadDir, workspaceId, mediaId));
  } catch {
    // missing is fine
  }
}

export async function assertRecordInWorkspace(
  database: Database,
  workspaceId: string,
  knowledgeRecordId: string,
): Promise<void> {
  const [row] = await database.db
    .select({ id: knowledgeRecords.id })
    .from(knowledgeRecords)
    .where(
      and(
        eq(knowledgeRecords.id, knowledgeRecordId),
        eq(knowledgeRecords.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  if (!row) {
    throw new AppError({
      code: 'KNOWLEDGE_RECORD_NOT_FOUND',
      message: 'Knowledge record not found in this workspace',
      statusCode: 404,
    });
  }
}

export async function createWorkspaceMedia(
  database: Database,
  input: {
    workspaceId: string;
    knowledgeRecordId?: string | null;
    contentType: string;
    buffer: Buffer;
    originalFilename?: string | null;
    altText?: string | null;
    createdBy?: string | null;
    uploadDir: string;
    maxBytes: number;
    blobStore?: BlobStore;
  },
): Promise<WorkspaceMediaRow> {
  if (!isAllowedMediaContentType(input.contentType)) {
    throw new AppError({
      code: 'MEDIA_TYPE_UNSUPPORTED',
      message: 'Media must be JPEG, PNG, or WebP',
      statusCode: 400,
    });
  }
  if (input.buffer.byteLength === 0 || input.buffer.byteLength > input.maxBytes) {
    throw new AppError({
      code: 'MEDIA_TOO_LARGE',
      message: `Media must be between 1 byte and ${input.maxBytes} bytes`,
      statusCode: 400,
    });
  }
  if (input.knowledgeRecordId) {
    await assertRecordInWorkspace(
      database,
      input.workspaceId,
      input.knowledgeRecordId,
    );
  }

  const mediaId = randomUUID();
  await writeMediaBytes(input.uploadDir, input.workspaceId, mediaId, input.buffer, {
    blobStore: input.blobStore,
    contentType: input.contentType,
  });

  const [row] = await database.db
    .insert(workspaceMedia)
    .values({
      id: mediaId,
      workspaceId: input.workspaceId,
      knowledgeRecordId: input.knowledgeRecordId ?? null,
      contentType: input.contentType,
      byteSize: input.buffer.byteLength,
      originalFilename: input.originalFilename ?? null,
      altText: input.altText ?? null,
      createdBy: input.createdBy ?? null,
    })
    .returning();

  if (!row) {
    await deleteMediaBytes(input.uploadDir, input.workspaceId, mediaId, {
      blobStore: input.blobStore,
    });
    throw new AppError({
      code: 'MEDIA_CREATE_FAILED',
      message: 'Failed to create media row',
      statusCode: 500,
    });
  }
  return row;
}

export async function listWorkspaceMedia(
  database: Database,
  input: {
    workspaceId: string;
    knowledgeRecordId?: string;
    limit?: number;
  },
): Promise<WorkspaceMediaRow[]> {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
  const conditions = [
    eq(workspaceMedia.workspaceId, input.workspaceId),
    isNull(workspaceMedia.archivedAt),
  ];
  if (input.knowledgeRecordId) {
    conditions.push(eq(workspaceMedia.knowledgeRecordId, input.knowledgeRecordId));
  }
  return database.db
    .select()
    .from(workspaceMedia)
    .where(and(...conditions))
    .orderBy(desc(workspaceMedia.createdAt))
    .limit(limit);
}

export async function getWorkspaceMediaById(
  database: Database,
  mediaId: string,
): Promise<WorkspaceMediaRow | null> {
  const [row] = await database.db
    .select()
    .from(workspaceMedia)
    .where(and(eq(workspaceMedia.id, mediaId), isNull(workspaceMedia.archivedAt)))
    .limit(1);
  return row ?? null;
}

export async function updateWorkspaceMedia(
  database: Database,
  mediaId: string,
  input: {
    knowledgeRecordId?: string | null;
    altText?: string | null;
  },
): Promise<WorkspaceMediaRow> {
  const existing = await getWorkspaceMediaById(database, mediaId);
  if (!existing) {
    throw new AppError({
      code: 'MEDIA_NOT_FOUND',
      message: 'Media not found',
      statusCode: 404,
    });
  }

  if (input.knowledgeRecordId !== undefined && input.knowledgeRecordId !== null) {
    await assertRecordInWorkspace(
      database,
      existing.workspaceId,
      input.knowledgeRecordId,
    );
  }

  const [updated] = await database.db
    .update(workspaceMedia)
    .set({
      ...(input.knowledgeRecordId !== undefined
        ? { knowledgeRecordId: input.knowledgeRecordId }
        : {}),
      ...(input.altText !== undefined ? { altText: input.altText } : {}),
    })
    .where(eq(workspaceMedia.id, mediaId))
    .returning();

  if (!updated) {
    throw new AppError({
      code: 'MEDIA_NOT_FOUND',
      message: 'Media not found',
      statusCode: 404,
    });
  }
  return updated;
}

export async function archiveWorkspaceMedia(
  database: Database,
  input: {
    mediaId: string;
    uploadDir: string;
    blobStore?: BlobStore;
  },
): Promise<WorkspaceMediaRow> {
  const existing = await getWorkspaceMediaById(database, input.mediaId);
  if (!existing) {
    throw new AppError({
      code: 'MEDIA_NOT_FOUND',
      message: 'Media not found',
      statusCode: 404,
    });
  }

  await deleteMediaBytes(input.uploadDir, existing.workspaceId, existing.id, {
    blobStore: input.blobStore,
  });

  const [updated] = await database.db
    .update(workspaceMedia)
    .set({ archivedAt: new Date() })
    .where(eq(workspaceMedia.id, existing.id))
    .returning();

  if (!updated) {
    throw new AppError({
      code: 'MEDIA_NOT_FOUND',
      message: 'Media not found',
      statusCode: 404,
    });
  }
  return updated;
}
