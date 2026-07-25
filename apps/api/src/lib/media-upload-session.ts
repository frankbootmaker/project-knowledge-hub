import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import { AppError } from '@project-knowledge-hub/domain';

/** Prefer small chunks so ChatGPT Actions can fit them in a single tool argument. */
export const MEDIA_UPLOAD_RECOMMENDED_CHUNK_CHARS = 8_000;
export const MEDIA_UPLOAD_MAX_CHUNK_CHARS = 12_000;
export const MEDIA_UPLOAD_TTL_SECONDS = 15 * 60;

export type MediaUploadContentType =
  | 'image/jpeg'
  | 'image/png'
  | 'image/webp'
  | 'image/gif';

export type MediaUploadSession = {
  uploadId: string;
  clientId: string;
  workspaceId: string;
  contentType: MediaUploadContentType;
  filename: string | null;
  alt: string | null;
  knowledgeRecordId: string | null;
  insertIntoRecord: boolean;
  /** Ordered raw base64 fragments (no data: prefix). */
  chunks: string[];
  totalBase64Chars: number;
  createdAt: string;
};

function sessionKey(uploadId: string): string {
  return `media-upload:${uploadId}`;
}

export async function beginMediaUploadSession(
  redis: Redis,
  input: {
    clientId: string;
    workspaceId: string;
    contentType: MediaUploadContentType;
    filename?: string | null;
    alt?: string | null;
    knowledgeRecordId?: string | null;
    insertIntoRecord?: boolean;
  },
): Promise<{
  uploadId: string;
  recommendedChunkChars: number;
  maxChunkChars: number;
  expiresInSeconds: number;
}> {
  const uploadId = randomUUID();
  const session: MediaUploadSession = {
    uploadId,
    clientId: input.clientId,
    workspaceId: input.workspaceId,
    contentType: input.contentType,
    filename: input.filename ?? null,
    alt: input.alt ?? null,
    knowledgeRecordId: input.knowledgeRecordId ?? null,
    insertIntoRecord: Boolean(input.insertIntoRecord),
    chunks: [],
    totalBase64Chars: 0,
    createdAt: new Date().toISOString(),
  };
  await redis.set(
    sessionKey(uploadId),
    JSON.stringify(session),
    'EX',
    MEDIA_UPLOAD_TTL_SECONDS,
  );
  return {
    uploadId,
    recommendedChunkChars: MEDIA_UPLOAD_RECOMMENDED_CHUNK_CHARS,
    maxChunkChars: MEDIA_UPLOAD_MAX_CHUNK_CHARS,
    expiresInSeconds: MEDIA_UPLOAD_TTL_SECONDS,
  };
}

export async function loadMediaUploadSession(
  redis: Redis,
  uploadId: string,
  clientId: string,
): Promise<MediaUploadSession> {
  const raw = await redis.get(sessionKey(uploadId));
  if (!raw) {
    throw new AppError({
      code: 'MEDIA_UPLOAD_NOT_FOUND',
      message: 'Upload session not found or expired; call begin_workspace_media_upload again',
      statusCode: 404,
    });
  }
  const session = JSON.parse(raw) as MediaUploadSession;
  if (session.clientId !== clientId) {
    throw new AppError({
      code: 'FORBIDDEN',
      message: 'Upload session belongs to a different API client',
      statusCode: 403,
    });
  }
  return session;
}

async function saveMediaUploadSession(
  redis: Redis,
  session: MediaUploadSession,
): Promise<void> {
  const ttl = await redis.ttl(sessionKey(session.uploadId));
  const seconds = ttl > 0 ? ttl : MEDIA_UPLOAD_TTL_SECONDS;
  await redis.set(
    sessionKey(session.uploadId),
    JSON.stringify(session),
    'EX',
    seconds,
  );
}

export async function appendMediaUploadChunk(
  redis: Redis,
  input: {
    uploadId: string;
    clientId: string;
    chunkBase64: string;
    /** Optional 0-based index; when set, must equal the next chunk index. */
    index?: number;
  },
): Promise<{
  uploadId: string;
  chunkCount: number;
  totalBase64Chars: number;
  nextIndex: number;
}> {
  const chunk = input.chunkBase64.trim();
  if (!chunk) {
    throw new AppError({
      code: 'VALIDATION_ERROR',
      message: 'chunkBase64 must not be empty',
      statusCode: 400,
    });
  }
  if (chunk.length > MEDIA_UPLOAD_MAX_CHUNK_CHARS) {
    throw new AppError({
      code: 'VALIDATION_ERROR',
      message: `chunkBase64 exceeds maxChunkChars (${MEDIA_UPLOAD_MAX_CHUNK_CHARS})`,
      statusCode: 400,
    });
  }
  if (chunk.includes('data:') || chunk.includes(',')) {
    throw new AppError({
      code: 'VALIDATION_ERROR',
      message: 'chunkBase64 must be raw base64 without a data: URL prefix',
      statusCode: 400,
    });
  }

  const session = await loadMediaUploadSession(redis, input.uploadId, input.clientId);
  const nextIndex = session.chunks.length;
  if (input.index !== undefined && input.index !== nextIndex) {
    throw new AppError({
      code: 'VALIDATION_ERROR',
      message: `Unexpected chunk index ${input.index}; expected ${nextIndex}`,
      statusCode: 400,
    });
  }

  session.chunks.push(chunk);
  session.totalBase64Chars += chunk.length;
  await saveMediaUploadSession(redis, session);

  return {
    uploadId: session.uploadId,
    chunkCount: session.chunks.length,
    totalBase64Chars: session.totalBase64Chars,
    nextIndex: session.chunks.length,
  };
}

export async function takeMediaUploadSession(
  redis: Redis,
  uploadId: string,
  clientId: string,
): Promise<MediaUploadSession> {
  const session = await loadMediaUploadSession(redis, uploadId, clientId);
  await redis.del(sessionKey(uploadId));
  return session;
}
