import { mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BlobStore } from '@project-knowledge-hub/blob-store';
import { migrateLocalBlobsToS3 } from './blob-migrate.js';

describe('migrateLocalBlobsToS3', () => {
  let root: string;

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  it('uploads local avatars and media; skips same-size remote; counts put failures', async () => {
    root = path.join(os.tmpdir(), `kh-migrate-${process.pid}-${Date.now()}`);
    const avatarDir = path.join(root, 'avatars');
    const mediaDir = path.join(root, 'media');
    const importDir = path.join(root, 'imports');
    const styleDir = path.join(root, 'style-packs');
    await mkdir(avatarDir, { recursive: true });
    await mkdir(path.join(mediaDir, 'ws-1'), { recursive: true });
    await mkdir(path.join(importDir, 'ws-1'), { recursive: true });
    await mkdir(path.join(styleDir, 'org-1', 'pack-1'), { recursive: true });

    const userId = '11111111-1111-4111-8111-111111111111';
    const mediaId = '22222222-2222-4222-8222-222222222222';
    const importId = '33333333-3333-4333-8333-333333333333';
    const avatarBytes = Buffer.from('avatar-bytes');
    const mediaBytes = Buffer.from('media-bytes');
    const importBytes = Buffer.from('import-bytes');
    const logoBytes = Buffer.from('logo-bytes');

    await writeFile(path.join(avatarDir, userId), avatarBytes);
    await writeFile(path.join(mediaDir, 'ws-1', mediaId), mediaBytes);
    await writeFile(path.join(importDir, 'ws-1', importId), importBytes);
    await writeFile(path.join(styleDir, 'org-1', 'pack-1', 'logo.png'), logoBytes);

    const put = vi.fn(async (input: { key: string }) => {
      if (input.key.includes(importId)) {
        throw new Error('AccessDenied');
      }
    });
    const get = vi.fn(async (key: string) => {
      if (key === `avatars/${userId}`) return Buffer.from('avatar-bytes');
      return null;
    });

    const blobStore = {
      provider: 's3',
      put,
      get,
      delete: vi.fn(),
      list: vi.fn(),
    } as unknown as BlobStore;

    const result = await migrateLocalBlobsToS3(blobStore, {
      avatarUploadDir: avatarDir,
      mediaUploadDir: mediaDir,
      documentImportDir: importDir,
      stylePackUploadDir: styleDir,
    });

    expect(result.skipped).toBe(1);
    expect(result.uploaded).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.key).toContain(importId);

    expect(put).toHaveBeenCalledWith(
      expect.objectContaining({ key: `media/ws-1/${mediaId}` }),
    );
    expect(put).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'doc-templates/org-1/pack-1/logo.png',
        contentType: 'image/png',
      }),
    );
    expect(put).not.toHaveBeenCalledWith(
      expect.objectContaining({ key: `avatars/${userId}` }),
    );
  });

  it('rejects when provider is disabled', async () => {
    root = path.join(os.tmpdir(), `kh-migrate-disabled-${Date.now()}`);
    await mkdir(root, { recursive: true });
    const blobStore = {
      provider: 'disabled',
      put: vi.fn(),
      get: vi.fn(),
      delete: vi.fn(),
      list: vi.fn(),
    } as unknown as BlobStore;

    await expect(
      migrateLocalBlobsToS3(blobStore, {
        avatarUploadDir: root,
        mediaUploadDir: root,
        documentImportDir: root,
        stylePackUploadDir: root,
      }),
    ).rejects.toMatchObject({ code: 'BLOB_DISABLED', statusCode: 400 });
  });
});
