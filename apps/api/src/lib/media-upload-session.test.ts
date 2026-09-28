import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Redis from 'ioredis';
import {
  appendMediaUploadChunk,
  beginMediaUploadSession,
  takeMediaUploadSession,
} from './media-upload-session.js';

const redisUrl = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';

describe('media-upload-session', () => {
  let redis: Redis;

  beforeAll(() => {
    redis = new Redis(redisUrl, { maxRetriesPerRequest: 1, lazyConnect: true });
  });

  afterAll(async () => {
    await redis.quit();
  });

  it('assembles chunks in order and consumes the session on finalize', async () => {
    await redis.connect();
    const started = await beginMediaUploadSession(redis, {
      clientId: 'client-a',
      workspaceId: '11111111-1111-4111-8111-111111111111',
      contentType: 'image/png',
      insertIntoRecord: false,
    });
    expect(started.recommendedChunkChars).toBe(8_000);

    const part1 = 'YWJj'; // abc
    const part2 = 'ZGVm'; // def
    const a1 = await appendMediaUploadChunk(redis, {
      uploadId: started.uploadId,
      clientId: 'client-a',
      chunkBase64: part1,
      index: 0,
    });
    expect(a1.nextIndex).toBe(1);
    const a2 = await appendMediaUploadChunk(redis, {
      uploadId: started.uploadId,
      clientId: 'client-a',
      chunkBase64: part2,
      index: 1,
    });
    expect(a2.totalBase64Chars).toBe(part1.length + part2.length);

    const session = await takeMediaUploadSession(
      redis,
      started.uploadId,
      'client-a',
    );
    expect(session.chunks.join('')).toBe(part1 + part2);
    expect(Buffer.from(session.chunks.join(''), 'base64').toString('utf8')).toBe(
      'abcdef',
    );

    await expect(
      takeMediaUploadSession(redis, started.uploadId, 'client-a'),
    ).rejects.toMatchObject({ code: 'MEDIA_UPLOAD_NOT_FOUND' });
  });

  it('stores valid PNG chunks for later validation on finalize', async () => {
    await redis.connect();

    const pngBytes = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
      0x49, 0x48, 0x44, 0x52,
    ]);
    const pngBase64 = pngBytes.toString('base64');

    const started = await beginMediaUploadSession(redis, {
      clientId: 'client-b',
      workspaceId: '22222222-2222-4222-8222-222222222222',
      contentType: 'image/png',
      insertIntoRecord: false,
    });

    await appendMediaUploadChunk(redis, {
      uploadId: started.uploadId,
      clientId: 'client-b',
      chunkBase64: pngBase64,
    });

    const session = await takeMediaUploadSession(
      redis,
      started.uploadId,
      'client-b',
    );
    expect(session.chunks.join('')).toBe(pngBase64);
    const decoded = Buffer.from(session.chunks.join(''), 'base64');
    expect(decoded).toEqual(pngBytes);
  });

  it('stores invalid (non-image) chunks but does not validate them until finalize', async () => {
    await redis.connect();

    const textBytes = Buffer.from('This is plain text, not a PNG', 'utf8');
    const textBase64 = textBytes.toString('base64');

    const started = await beginMediaUploadSession(redis, {
      clientId: 'client-c',
      workspaceId: '33333333-3333-4333-8333-333333333333',
      contentType: 'image/png',
      insertIntoRecord: false,
    });

    await appendMediaUploadChunk(redis, {
      uploadId: started.uploadId,
      clientId: 'client-c',
      chunkBase64: textBase64,
    });

    const session = await takeMediaUploadSession(
      redis,
      started.uploadId,
      'client-c',
    );
    expect(session.chunks.join('')).toBe(textBase64);
  });
});
