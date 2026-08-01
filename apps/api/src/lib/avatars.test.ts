import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BlobStore } from '@project-knowledge-hub/blob-store';
import { readAvatarFile, writeAvatarFile } from './avatars.js';

describe('writeAvatarFile', () => {
  let dir: string;

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('persists locally even when S3 put fails', async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'kh-avatar-'));
    const userId = '11111111-1111-4111-8111-111111111111';
    const buffer = Buffer.from('fake-jpeg');
    const blobStore = {
      provider: 's3',
      put: vi.fn().mockRejectedValue(new Error('AccessDenied')),
      get: vi.fn(),
      delete: vi.fn(),
      list: vi.fn(),
    } as unknown as BlobStore;

    await writeAvatarFile(dir, userId, buffer, {
      blobStore,
      contentType: 'image/jpeg',
    });

    expect(await readFile(path.join(dir, userId))).toEqual(buffer);
    expect(blobStore.put).toHaveBeenCalledOnce();
  });

  it('reads from local disk when S3 get fails', async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'kh-avatar-'));
    const userId = '22222222-2222-4222-8222-222222222222';
    const buffer = Buffer.from('from-disk');
    await writeAvatarFile(dir, userId, buffer);

    const blobStore = {
      provider: 's3',
      put: vi.fn().mockResolvedValue(undefined),
      get: vi.fn().mockRejectedValue(new Error('NetworkingError')),
      delete: vi.fn(),
      list: vi.fn(),
    } as unknown as BlobStore;

    await expect(readAvatarFile(dir, userId, { blobStore })).resolves.toEqual(buffer);
  });
});
