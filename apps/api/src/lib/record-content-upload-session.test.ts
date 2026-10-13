import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Redis from 'ioredis';
import {
  appendRecordContentChunk,
  assertContentUnchanged,
  beginRecordContentUploadSession,
  deleteRecordContentUploadSession,
  loadRecordContentUploadSession,
  RECORD_CONTENT_MAX_CHARS,
  RECORD_CONTENT_MAX_CHUNK_CHARS,
  recordContentUploadKey,
} from './record-content-upload-session.js';

const redisUrl = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';

describe('record-content-upload-session', () => {
  let redis: Redis;

  beforeAll(async () => {
    redis = new Redis(redisUrl, { maxRetriesPerRequest: 1, lazyConnect: true });
    await redis.connect();
  });

  afterAll(async () => {
    if (redis && redis.status !== 'end') {
      await redis.quit();
    }
  });

  it('appends chunks in order and forgets the session after one finalize', async () => {
    const started = await beginRecordContentUploadSession(redis, {
      clientId: 'client-a',
      recordId: '11111111-1111-4111-8111-111111111111',
      workspaceId: '22222222-2222-4222-8222-222222222222',
      contentSha256: 'a'.repeat(64),
    });
    expect(started.maxChunkChars).toBe(RECORD_CONTENT_MAX_CHUNK_CHARS);

    const first = await appendRecordContentChunk(redis, {
      uploadId: started.uploadId,
      clientId: 'client-a',
      chunk: 'hello ',
      index: 0,
    });
    expect(first.nextIndex).toBe(1);
    await appendRecordContentChunk(redis, {
      uploadId: started.uploadId,
      clientId: 'client-a',
      chunk: 'world',
      index: 1,
    });

    const session = await loadRecordContentUploadSession(redis, started.uploadId, 'client-a');
    expect(session.chunks.join('')).toBe('hello world');
    expect(session.totalChars).toBe(11);

    await deleteRecordContentUploadSession(redis, started.uploadId);
    await expect(
      loadRecordContentUploadSession(redis, started.uploadId, 'client-a'),
    ).rejects.toMatchObject({ code: 'RECORD_CONTENT_UPLOAD_NOT_FOUND' });
  });

  it('rejects an empty chunk, a chunk over 40k, a bad index, and a total over 500k', async () => {
    const started = await beginRecordContentUploadSession(redis, {
      clientId: 'client-b',
      recordId: '33333333-3333-4333-8333-333333333333',
      workspaceId: '44444444-4444-4444-8444-444444444444',
      contentSha256: 'b'.repeat(64),
    });

    await expect(
      appendRecordContentChunk(redis, {
        uploadId: started.uploadId,
        clientId: 'client-b',
        chunk: '',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    await expect(
      appendRecordContentChunk(redis, {
        uploadId: started.uploadId,
        clientId: 'client-b',
        chunk: 'x'.repeat(RECORD_CONTENT_MAX_CHUNK_CHARS + 1),
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    await appendRecordContentChunk(redis, {
      uploadId: started.uploadId,
      clientId: 'client-b',
      chunk: 'ok',
    });
    await expect(
      appendRecordContentChunk(redis, {
        uploadId: started.uploadId,
        clientId: 'client-b',
        chunk: 'next',
        index: 0,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    const full = 'y'.repeat(RECORD_CONTENT_MAX_CHUNK_CHARS);
    const chunksNeeded = Math.floor(RECORD_CONTENT_MAX_CHARS / RECORD_CONTENT_MAX_CHUNK_CHARS);
    for (let i = 0; i < chunksNeeded; i += 1) {
      await appendRecordContentChunk(redis, {
        uploadId: started.uploadId,
        clientId: 'client-b',
        chunk: full,
      });
    }
    await expect(
      appendRecordContentChunk(redis, {
        uploadId: started.uploadId,
        clientId: 'client-b',
        chunk: 'z'.repeat(RECORD_CONTENT_MAX_CHARS - chunksNeeded * RECORD_CONTENT_MAX_CHUNK_CHARS + 1),
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    await deleteRecordContentUploadSession(redis, started.uploadId);
  });

  it('treats an expired session as missing', async () => {
    const started = await beginRecordContentUploadSession(redis, {
      clientId: 'client-c',
      recordId: '55555555-5555-4555-8555-555555555555',
      workspaceId: '66666666-6666-4666-8666-666666666666',
      contentSha256: 'c'.repeat(64),
    });
    await redis.expire(recordContentUploadKey(started.uploadId), 1);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    await expect(
      loadRecordContentUploadSession(redis, started.uploadId, 'client-c'),
    ).rejects.toMatchObject({ code: 'RECORD_CONTENT_UPLOAD_NOT_FOUND' });
  });

  it('rejects a hash that no longer matches the body captured at begin', () => {
    expect(() => assertContentUnchanged('aa', 'aa')).not.toThrow();
    expect(() => assertContentUnchanged('aa', 'bb')).toThrowError(
      expect.objectContaining({ code: 'CONTENT_CHANGED', statusCode: 409 }),
    );
  });
});
