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
});
