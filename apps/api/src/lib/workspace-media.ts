import { copyFile, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { and, desc, eq, ilike, inArray, isNull, ne, sql } from 'drizzle-orm';
import { blobObjectKey, type BlobStore } from '@project-knowledge-hub/blob-store';
import {
  knowledgeRecords,
  projectItemMediaLinks,
  workspaceMedia,
  type Database,
} from '@project-knowledge-hub/database';
import type { ItemMediaEntityType } from '@project-knowledge-hub/domain';
import {
  AppError,
  assertMediaBytesMatchContentType,
  isAllowedMediaType,
} from '@project-knowledge-hub/domain';

export function isAllowedMediaContentType(value: string): boolean {
  return isAllowedMediaType(value);
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

/** Folder that holds the bytes. Null storage columns mean workspace_id/id. */
export function mediaByteLocation(row: {
  id: string;
  workspaceId: string;
  storageWorkspaceId?: string | null;
  storageMediaId?: string | null;
}): { workspaceId: string; mediaId: string } {
  return {
    workspaceId: row.storageWorkspaceId ?? row.workspaceId,
    mediaId: row.storageMediaId ?? row.id,
  };
}

export async function liveMediaSharesByteLocation(
  database: Database,
  input: { exceptMediaId: string; workspaceId: string; mediaId: string },
  options?: { includeArchived?: boolean },
): Promise<boolean> {
  const [row] = await database.db
    .select({ id: workspaceMedia.id })
    .from(workspaceMedia)
    .where(
      and(
        ne(workspaceMedia.id, input.exceptMediaId),
        options?.includeArchived ? undefined : isNull(workspaceMedia.archivedAt),
        sql`coalesce(${workspaceMedia.storageWorkspaceId}, ${workspaceMedia.workspaceId}) = ${input.workspaceId}::uuid`,
        sql`coalesce(${workspaceMedia.storageMediaId}, ${workspaceMedia.id}) = ${input.mediaId}::uuid`,
      ),
    )
    .limit(1);
  return Boolean(row);
}

function mediaBlobKey(workspaceId: string, mediaId: string): string {
  return blobObjectKey('media', `${workspaceId}/${mediaId}`);
}

function mediaFilePath(uploadDir: string, workspaceId: string, mediaId: string): string {
  return path.join(path.resolve(uploadDir), workspaceId, mediaId);
}

async function ensureMediaParentDir(uploadDir: string, workspaceId: string): Promise<void> {
  await mkdir(path.join(path.resolve(uploadDir), workspaceId), { recursive: true });
}

export async function writeMediaBytes(
  uploadDir: string,
  workspaceId: string,
  mediaId: string,
  buffer: Buffer,
  options?: { blobStore?: BlobStore; contentType?: string },
): Promise<void> {
  // Local first so shared volumes work when S3 credentials are invalid.
  await ensureMediaParentDir(uploadDir, workspaceId);
  await writeFile(mediaFilePath(uploadDir, workspaceId, mediaId), buffer);

  const store = options?.blobStore;
  if (store && store.provider !== 'disabled') {
    try {
      await store.put({
        key: mediaBlobKey(workspaceId, mediaId),
        body: buffer,
        contentType: options?.contentType,
      });
    } catch {
      // Local file already persisted for api/worker shared volume.
    }
  }
}

export async function readMediaBytes(
  uploadDir: string,
  workspaceId: string,
  mediaId: string,
  options?: { blobStore?: BlobStore },
): Promise<Buffer | null> {
  const store = options?.blobStore;
  if (store && store.provider !== 'disabled') {
    try {
      const fromBlob = await store.get(mediaBlobKey(workspaceId, mediaId));
      if (fromBlob) return fromBlob;
    } catch {
      // Fall through to local (broken S3 credentials, etc.).
    }
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

/** Counts blob/file failures that deleteMediaBytes reports only via onError. */
export async function countMediaStorageFailures(
  uploadDir: string,
  workspaceId: string,
  mediaId: string,
  blobStore?: BlobStore,
): Promise<number> {
  let failures = 0;
  await deleteMediaBytes(uploadDir, workspaceId, mediaId, {
    blobStore,
    onError: () => {
      failures += 1;
    },
  });
  return failures;
}

export async function deleteMediaBytes(
  uploadDir: string,
  workspaceId: string,
  mediaId: string,
  options?: {
    blobStore?: BlobStore;
    onError?: (error: unknown, where: 'blob' | 'file') => void;
  },
): Promise<void> {
  const store = options?.blobStore;
  if (store && store.provider !== 'disabled') {
    await store.delete(mediaBlobKey(workspaceId, mediaId)).catch((error: unknown) => {
      options?.onError?.(error, 'blob');
    });
  }
  try {
    await unlink(mediaFilePath(uploadDir, workspaceId, mediaId));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') options?.onError?.(error, 'file');
  }
}

/**
 * Delete a source object after its copy has been verified and the row updated.
 * A blob failure leaves the local file in place.
 */
export async function deleteRelocatedMediaBytes(
  uploadDir: string,
  workspaceId: string,
  mediaId: string,
  blobStore?: BlobStore,
): Promise<void> {
  if (blobStore && blobStore.provider !== 'disabled') {
    await blobStore.delete(mediaBlobKey(workspaceId, mediaId));
  }
  try {
    await unlink(mediaFilePath(uploadDir, workspaceId, mediaId));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

export type MediaRelocateCode = 'NOT_FOUND' | 'SIZE_MISMATCH' | 'ETAG_MISMATCH' | 'DEST_CONFLICT';

export class MediaRelocateError extends Error {
  readonly code: MediaRelocateCode;

  constructor(code: MediaRelocateCode, message: string) {
    super(message);
    this.name = 'MediaRelocateError';
    this.code = code;
  }
}

export type RelocatedMedia = {
  sizeBytes: number;
  etag: string;
  /** `media/{destinationWorkspaceId}/` — local directory, and the S3 key parent. */
  destinationPrefix: string;
  local: 'copied' | 'already' | 'absent';
  blob: 'copied' | 'already' | 'absent' | 'disabled';
};

type LocalObject = { sizeBytes: number; etag: string };

function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

function md5(buffer: Buffer): string {
  return createHash('md5').update(buffer).digest('hex');
}

async function describeLocalFile(filePath: string): Promise<LocalObject | null> {
  try {
    const buffer = await readFile(filePath);
    return { sizeBytes: buffer.byteLength, etag: sha256(buffer) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

function sameObject(left: LocalObject, right: LocalObject): boolean {
  return left.sizeBytes === right.sizeBytes && left.etag === right.etag;
}

/**
 * Copy one media object onto the destination workspace prefix and verify it.
 * Never deletes the source. A destination written by this call is removed if
 * verification fails, so a retry can copy again.
 */
export async function relocateMediaBytes(input: {
  uploadDir: string;
  fromWorkspaceId: string;
  fromMediaId: string;
  toWorkspaceId: string;
  toMediaId: string;
  expectedByteSize?: number;
  contentType?: string;
  blobStore?: BlobStore;
}): Promise<RelocatedMedia> {
  const destinationPrefix = `media/${input.toWorkspaceId}/`;
  await ensureMediaParentDir(input.uploadDir, input.toWorkspaceId);

  const fromPath = mediaFilePath(input.uploadDir, input.fromWorkspaceId, input.fromMediaId);
  const toPath = mediaFilePath(input.uploadDir, input.toWorkspaceId, input.toMediaId);
  const local = await relocateLocalFile(fromPath, toPath);

  const blob = await relocateBlobObject({
    blobStore: input.blobStore,
    fromKey: mediaBlobKey(input.fromWorkspaceId, input.fromMediaId),
    toKey: mediaBlobKey(input.toWorkspaceId, input.toMediaId),
    contentType: input.contentType,
    localPath: local.status === 'absent' ? null : toPath,
  });

  if (local.status === 'absent' && (blob.status === 'absent' || blob.status === 'disabled')) {
    throw new MediaRelocateError(
      'NOT_FOUND',
      `Media object media/${input.fromWorkspaceId}/${input.fromMediaId} is missing`,
    );
  }

  if (local.status === 'absent' && blob.status !== 'absent' && blob.status !== 'disabled') {
    const bytes = await input.blobStore!.get(mediaBlobKey(input.toWorkspaceId, input.toMediaId));
    if (!bytes) {
      throw new MediaRelocateError(
        'NOT_FOUND',
        `Copied object media/${input.toWorkspaceId}/${input.toMediaId} could not be read back`,
      );
    }
    await writeFile(toPath, bytes);
    const written = await describeLocalFile(toPath);
    if (!written || written.sizeBytes !== bytes.byteLength) {
      await unlink(toPath).catch(() => undefined);
      throw new MediaRelocateError(
        'SIZE_MISMATCH',
        `Local copy of media/${input.toWorkspaceId}/${input.toMediaId} failed verification`,
      );
    }
  }

  const sizeBytes = blob.sizeBytes ?? local.sizeBytes;
  const etag = blob.etag ?? local.etag;
  if (sizeBytes == null || !etag) {
    throw new MediaRelocateError(
      'NOT_FOUND',
      `Media object media/${input.fromWorkspaceId}/${input.fromMediaId} is missing`,
    );
  }
  if (input.expectedByteSize != null && sizeBytes !== input.expectedByteSize) {
    throw new MediaRelocateError(
      'SIZE_MISMATCH',
      `Media ${input.toMediaId} is ${sizeBytes} bytes, expected ${input.expectedByteSize}`,
    );
  }
  if (local.sizeBytes != null && blob.sizeBytes != null && local.sizeBytes !== blob.sizeBytes) {
    throw new MediaRelocateError(
      'SIZE_MISMATCH',
      `Local and object storage sizes differ for media/${input.toWorkspaceId}/${input.toMediaId}`,
    );
  }

  return {
    sizeBytes,
    etag,
    destinationPrefix,
    local: local.status === 'absent' ? 'copied' : local.status,
    blob: blob.status,
  };
}

async function relocateLocalFile(
  fromPath: string,
  toPath: string,
): Promise<{ status: 'copied' | 'already' | 'absent'; sizeBytes?: number; etag?: string }> {
  if (path.resolve(fromPath) === path.resolve(toPath)) {
    const current = await describeLocalFile(toPath);
    if (!current) return { status: 'absent' };
    return { status: 'already', ...current };
  }

  const source = await describeLocalFile(fromPath);
  const destination = await describeLocalFile(toPath);
  if (!source && !destination) return { status: 'absent' };
  if (!source && destination) return { status: 'already', ...destination };
  if (source && destination) {
    if (!sameObject(source, destination)) {
      throw new MediaRelocateError(
        'DEST_CONFLICT',
        `Destination file ${toPath} does not match the source`,
      );
    }
    return { status: 'already', ...destination };
  }

  await mkdir(path.dirname(toPath), { recursive: true });
  await copyFile(fromPath, toPath);
  const copied = await describeLocalFile(toPath);
  if (!copied || !source || !sameObject(source, copied)) {
    await unlink(toPath).catch(() => undefined);
    throw new MediaRelocateError(
      'ETAG_MISMATCH',
      `Local copy ${toPath} failed size or checksum verification`,
    );
  }
  return { status: 'copied', ...copied };
}

async function relocateBlobObject(input: {
  blobStore?: BlobStore;
  fromKey: string;
  toKey: string;
  contentType?: string;
  localPath: string | null;
}): Promise<{
  status: 'copied' | 'already' | 'absent' | 'disabled';
  sizeBytes?: number;
  etag?: string;
}> {
  const store = input.blobStore;
  if (!store || store.provider === 'disabled') return { status: 'disabled' };

  const source = input.fromKey === input.toKey ? null : await store.head(input.fromKey);
  const destination = await store.head(input.toKey);
  if (input.fromKey === input.toKey) {
    if (!destination) return { status: 'absent' };
    if (!destination.etag) {
      throw new MediaRelocateError('ETAG_MISMATCH', `Object ${input.toKey} has no etag`);
    }
    return { status: 'already', sizeBytes: destination.sizeBytes, etag: destination.etag };
  }
  if (source && destination) {
    if (
      destination.sizeBytes !== source.sizeBytes ||
      !source.etag ||
      !destination.etag ||
      destination.etag !== source.etag
    ) {
      throw new MediaRelocateError(
        'DEST_CONFLICT',
        `Destination object ${input.toKey} does not match ${input.fromKey}`,
      );
    }
    return { status: 'already', sizeBytes: destination.sizeBytes, etag: destination.etag };
  }
  if (!source && destination) {
    if (!destination.etag) {
      throw new MediaRelocateError('ETAG_MISMATCH', `Object ${input.toKey} has no etag`);
    }
    return { status: 'already', sizeBytes: destination.sizeBytes, etag: destination.etag };
  }
  if (source) {
    if (!source.etag) {
      throw new MediaRelocateError('ETAG_MISMATCH', `Object ${input.fromKey} has no etag`);
    }
    try {
      await store.copy(input.fromKey, input.toKey);
      const copied = await store.head(input.toKey);
      if (!copied || copied.sizeBytes !== source.sizeBytes || copied.etag !== source.etag) {
        await store.delete(input.toKey).catch(() => undefined);
        throw new MediaRelocateError(
          copied && copied.sizeBytes !== source.sizeBytes ? 'SIZE_MISMATCH' : 'ETAG_MISMATCH',
          `Copied object ${input.toKey} does not match ${input.fromKey}`,
        );
      }
      return { status: 'copied', sizeBytes: copied.sizeBytes, etag: copied.etag ?? source.etag };
    } catch (error) {
      if (error instanceof MediaRelocateError) throw error;
      await store.delete(input.toKey).catch(() => undefined);
      throw error;
    }
  }

  if (!input.localPath) return { status: 'absent' };
  const body = await readFile(input.localPath);
  await store.put({ key: input.toKey, body, contentType: input.contentType });
  const uploaded = await store.head(input.toKey);
  const etag = md5(body);
  if (!uploaded || uploaded.sizeBytes !== body.byteLength || uploaded.etag !== etag) {
    await store.delete(input.toKey).catch(() => undefined);
    throw new MediaRelocateError(
      uploaded && uploaded.sizeBytes !== body.byteLength ? 'SIZE_MISMATCH' : 'ETAG_MISMATCH',
      `Uploaded object ${input.toKey} failed size or etag verification`,
    );
  }
  return { status: 'copied', sizeBytes: uploaded.sizeBytes, etag };
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
  const canonicalContentType = assertMediaBytesMatchContentType(
    new Uint8Array(input.buffer),
    input.contentType,
  );

  if (input.buffer.byteLength === 0 || input.buffer.byteLength > input.maxBytes) {
    throw new AppError({
      code: 'MEDIA_TOO_LARGE',
      message: `Media must be between 1 byte and ${input.maxBytes} bytes`,
      statusCode: 400,
    });
  }

  if (input.knowledgeRecordId) {
    await assertRecordInWorkspace(database, input.workspaceId, input.knowledgeRecordId);
  }

  const mediaId = randomUUID();
  await writeMediaBytes(input.uploadDir, input.workspaceId, mediaId, input.buffer, {
    blobStore: input.blobStore,
    contentType: canonicalContentType,
  });

  const [row] = await database.db
    .insert(workspaceMedia)
    .values({
      id: mediaId,
      workspaceId: input.workspaceId,
      knowledgeRecordId: input.knowledgeRecordId ?? null,
      contentType: canonicalContentType,
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

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

export async function listWorkspaceMedia(
  database: Database,
  input: {
    workspaceId: string;
    knowledgeRecordId?: string;
    query?: string;
    entityType?: ItemMediaEntityType;
    entityId?: string;
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
  const query = input.query?.trim();
  if (query) {
    conditions.push(ilike(workspaceMedia.originalFilename, `%${escapeLike(query)}%`));
  }
  if (input.entityType && input.entityId) {
    const linked = await database.db
      .select({ id: projectItemMediaLinks.workspaceMediaId })
      .from(projectItemMediaLinks)
      .where(
        and(
          eq(projectItemMediaLinks.kind, 'media'),
          eq(projectItemMediaLinks.entityType, input.entityType),
          eq(projectItemMediaLinks.entityId, input.entityId),
        ),
      );
    const ids = linked.flatMap((row) => (row.id ? [row.id] : []));
    if (ids.length === 0) return [];
    conditions.push(inArray(workspaceMedia.id, ids));
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
    await assertRecordInWorkspace(database, existing.workspaceId, input.knowledgeRecordId);
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

  const location = mediaByteLocation(existing);
  const shared = await liveMediaSharesByteLocation(database, {
    exceptMediaId: existing.id,
    workspaceId: location.workspaceId,
    mediaId: location.mediaId,
  });
  if (!shared) {
    await deleteMediaBytes(input.uploadDir, location.workspaceId, location.mediaId, {
      blobStore: input.blobStore,
    });
  }

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
