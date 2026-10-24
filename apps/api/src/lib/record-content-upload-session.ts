import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import { AppError } from '@project-knowledge-hub/domain';

/** Max characters of markdown in one append call. */
export const RECORD_CONTENT_MAX_CHUNK_CHARS = 40_000;

/** Matches the knowledge-record content max (UTF-16 units). */
export const RECORD_CONTENT_MAX_CHARS = 500_000;

export const RECORD_CONTENT_UPLOAD_TTL_SECONDS = 15 * 60;

export type RecordContentUploadSession = {
  uploadId: string;
  clientId: string;
  recordId: string;
  workspaceId: string;
  /** SHA-256 hex of the stored body at begin. */
  contentSha256: string;
  /** Stored when begin_record_content_upload includes changeMessage. */
  changeMessage?: string;
  chunks: string[];
  totalChars: number;
  createdAt: string;
};

export function recordContentUploadKey(uploadId: string): string {
  return `record-content-upload:${uploadId}`;
}

export function assertContentUnchanged(capturedSha256: string, currentSha256: string): void {
  if (capturedSha256 === currentSha256) return;
  throw new AppError({
    code: 'CONTENT_CHANGED',
    message: 'Record content changed since begin_record_content_upload',
    statusCode: 409,
  });
}

export async function beginRecordContentUploadSession(
  redis: Redis,
  input: {
    clientId: string;
    recordId: string;
    workspaceId: string;
    contentSha256: string;
    changeMessage?: string;
  },
): Promise<{
  uploadId: string;
  maxChunkChars: number;
  expiresInSeconds: number;
}> {
  const uploadId = randomUUID();
  const session: RecordContentUploadSession = {
    uploadId,
    clientId: input.clientId,
    recordId: input.recordId,
    workspaceId: input.workspaceId,
    contentSha256: input.contentSha256,
    ...(input.changeMessage ? { changeMessage: input.changeMessage } : {}),
    chunks: [],
    totalChars: 0,
    createdAt: new Date().toISOString(),
  };
  await redis.set(
    recordContentUploadKey(uploadId),
    JSON.stringify(session),
    'EX',
    RECORD_CONTENT_UPLOAD_TTL_SECONDS,
  );
  return {
    uploadId,
    maxChunkChars: RECORD_CONTENT_MAX_CHUNK_CHARS,
    expiresInSeconds: RECORD_CONTENT_UPLOAD_TTL_SECONDS,
  };
}

export async function loadRecordContentUploadSession(
  redis: Redis,
  uploadId: string,
  clientId: string,
): Promise<RecordContentUploadSession> {
  const raw = await redis.get(recordContentUploadKey(uploadId));
  if (!raw) {
    throw new AppError({
      code: 'RECORD_CONTENT_UPLOAD_NOT_FOUND',
      message: 'Upload session not found or expired; call begin_record_content_upload again',
      statusCode: 404,
    });
  }
  const session = JSON.parse(raw) as RecordContentUploadSession;
  if (session.clientId !== clientId) {
    throw new AppError({
      code: 'FORBIDDEN',
      message: 'Upload session belongs to a different API client',
      statusCode: 403,
    });
  }
  return session;
}

async function saveRecordContentUploadSession(
  redis: Redis,
  session: RecordContentUploadSession,
): Promise<void> {
  const ttl = await redis.ttl(recordContentUploadKey(session.uploadId));
  const seconds = ttl > 0 ? ttl : RECORD_CONTENT_UPLOAD_TTL_SECONDS;
  await redis.set(recordContentUploadKey(session.uploadId), JSON.stringify(session), 'EX', seconds);
}

export async function appendRecordContentChunk(
  redis: Redis,
  input: {
    uploadId: string;
    clientId: string;
    chunk: string;
    index?: number;
  },
): Promise<{
  uploadId: string;
  chunkCount: number;
  totalChars: number;
  nextIndex: number;
}> {
  if (input.chunk.length === 0) {
    throw new AppError({
      code: 'VALIDATION_ERROR',
      message: 'chunk must not be empty',
      statusCode: 400,
    });
  }
  if (input.chunk.length > RECORD_CONTENT_MAX_CHUNK_CHARS) {
    throw new AppError({
      code: 'VALIDATION_ERROR',
      message: `chunk exceeds maxChunkChars (${RECORD_CONTENT_MAX_CHUNK_CHARS})`,
      statusCode: 400,
    });
  }

  const session = await loadRecordContentUploadSession(redis, input.uploadId, input.clientId);
  const nextIndex = session.chunks.length;
  if (input.index !== undefined && input.index !== nextIndex) {
    throw new AppError({
      code: 'VALIDATION_ERROR',
      message: `Unexpected chunk index ${input.index}; expected ${nextIndex}`,
      statusCode: 400,
    });
  }
  if (session.totalChars + input.chunk.length > RECORD_CONTENT_MAX_CHARS) {
    throw new AppError({
      code: 'VALIDATION_ERROR',
      message: `Joined content would exceed ${RECORD_CONTENT_MAX_CHARS} characters`,
      statusCode: 400,
    });
  }

  session.chunks.push(input.chunk);
  session.totalChars += input.chunk.length;
  await saveRecordContentUploadSession(redis, session);

  return {
    uploadId: session.uploadId,
    chunkCount: session.chunks.length,
    totalChars: session.totalChars,
    nextIndex: session.chunks.length,
  };
}

export async function deleteRecordContentUploadSession(
  redis: Redis,
  uploadId: string,
): Promise<void> {
  await redis.del(recordContentUploadKey(uploadId));
}
