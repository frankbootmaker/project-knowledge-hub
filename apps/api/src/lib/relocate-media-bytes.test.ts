import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { BlobHead, BlobStore } from '@project-knowledge-hub/blob-store';
import { relocateMediaBytes } from './workspace-media.js';

type Stored = { body: Buffer; etag: string };

function md5(body: Buffer): string {
  return createHash('md5').update(body).digest('hex');
}

function memoryStore(options?: {
  failCopy?: boolean;
  badEtag?: boolean;
  failPut?: boolean;
}): BlobStore & { objects: Map<string, Stored>; deleted: string[] } {
  const objects = new Map<string, Stored>();
  const deleted: string[] = [];
  return {
    provider: 's3',
    objects,
    deleted,
    async put(input) {
      if (options?.failPut) throw new Error('s3 down');
      const body = Buffer.from(input.body);
      objects.set(input.key, { body, etag: md5(body) });
    },
    async get(key) {
      return objects.get(key)?.body ?? null;
    },
    async delete(key) {
      deleted.push(key);
      objects.delete(key);
    },
    async list() {
      return [];
    },
    async head(key): Promise<BlobHead | null> {
      const found = objects.get(key);
      if (!found) return null;
      return { sizeBytes: found.body.byteLength, etag: found.etag };
    },
    async copy(fromKey, toKey) {
      if (options?.failCopy) throw new Error('s3 down');
      const source = objects.get(fromKey);
      if (!source) throw new Error('missing');
      objects.set(toKey, {
        body: Buffer.from(source.body),
        etag: options?.badEtag ? 'not-the-source-etag' : source.etag,
      });
    },
  };
}

describe('relocateMediaBytes', () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  async function layout() {
    const root = path.join(tmpdir(), `relocate-media-${randomUUID()}`);
    roots.push(root);
    const sourceWorkspace = randomUUID();
    const destWorkspace = randomUUID();
    const mediaId = randomUUID();
    const bytes = Buffer.from(`png-${randomUUID()}`);
    await mkdir(path.join(root, sourceWorkspace), { recursive: true });
    await writeFile(path.join(root, sourceWorkspace, mediaId), bytes);
    return { root, sourceWorkspace, destWorkspace, mediaId, bytes };
  }

  it('copies into the destination prefix, verifies size and etag, and keeps the source', async () => {
    const { root, sourceWorkspace, destWorkspace, mediaId, bytes } = await layout();
    const store = memoryStore();
    const sourceKey = `media/${sourceWorkspace}/${mediaId}`;
    store.objects.set(sourceKey, { body: Buffer.from(bytes), etag: md5(bytes) });

    const moved = await relocateMediaBytes({
      uploadDir: root,
      fromWorkspaceId: sourceWorkspace,
      fromMediaId: mediaId,
      toWorkspaceId: destWorkspace,
      toMediaId: mediaId,
      expectedByteSize: bytes.byteLength,
      contentType: 'image/png',
      blobStore: store,
    });

    expect(moved.destinationPrefix).toBe(`media/${destWorkspace}/`);
    expect(moved.sizeBytes).toBe(bytes.byteLength);
    expect(moved.etag).toBe(md5(bytes));
    expect(moved.local).toBe('copied');
    expect(moved.blob).toBe('copied');
    const destPath = path.join(root, destWorkspace, mediaId);
    expect(await readFile(destPath)).toEqual(bytes);
    expect(await readFile(path.join(root, sourceWorkspace, mediaId))).toEqual(bytes);
    expect(store.objects.get(`media/${destWorkspace}/${mediaId}`)?.etag).toBe(md5(bytes));
    expect(store.objects.get(sourceKey)?.body.equals(bytes)).toBe(true);
    expect(store.deleted).toEqual([]);

    const again = await relocateMediaBytes({
      uploadDir: root,
      fromWorkspaceId: sourceWorkspace,
      fromMediaId: mediaId,
      toWorkspaceId: destWorkspace,
      toMediaId: mediaId,
      expectedByteSize: bytes.byteLength,
      blobStore: store,
    });
    expect(again.local).toBe('already');
    expect(again.blob).toBe('already');
    expect(store.deleted).toEqual([]);
  });

  it('gives a shared copy its own object and leaves the source object', async () => {
    const { root, sourceWorkspace, destWorkspace, mediaId, bytes } = await layout();
    const copyId = randomUUID();
    const store = memoryStore();
    store.objects.set(`media/${sourceWorkspace}/${mediaId}`, {
      body: Buffer.from(bytes),
      etag: md5(bytes),
    });

    await relocateMediaBytes({
      uploadDir: root,
      fromWorkspaceId: sourceWorkspace,
      fromMediaId: mediaId,
      toWorkspaceId: destWorkspace,
      toMediaId: copyId,
      expectedByteSize: bytes.byteLength,
      blobStore: store,
    });

    expect(await readFile(path.join(root, destWorkspace, copyId))).toEqual(bytes);
    expect(await readFile(path.join(root, sourceWorkspace, mediaId))).toEqual(bytes);
    expect(store.objects.has(`media/${destWorkspace}/${copyId}`)).toBe(true);
    expect(store.objects.has(`media/${sourceWorkspace}/${mediaId}`)).toBe(true);
  });

  it('drops a bad destination object when the etag does not match and keeps the source', async () => {
    const { root, sourceWorkspace, destWorkspace, mediaId, bytes } = await layout();
    const store = memoryStore({ badEtag: true });
    const sourceKey = `media/${sourceWorkspace}/${mediaId}`;
    const destKey = `media/${destWorkspace}/${mediaId}`;
    store.objects.set(sourceKey, { body: Buffer.from(bytes), etag: md5(bytes) });

    await expect(
      relocateMediaBytes({
        uploadDir: root,
        fromWorkspaceId: sourceWorkspace,
        fromMediaId: mediaId,
        toWorkspaceId: destWorkspace,
        toMediaId: mediaId,
        expectedByteSize: bytes.byteLength,
        blobStore: store,
      }),
    ).rejects.toMatchObject({ name: 'MediaRelocateError', code: 'ETAG_MISMATCH' });

    expect(store.objects.has(destKey)).toBe(false);
    expect(store.objects.get(sourceKey)?.body.equals(bytes)).toBe(true);
    expect(await readFile(path.join(root, sourceWorkspace, mediaId))).toEqual(bytes);
    expect(store.deleted).toEqual([destKey]);
  });

  it('does not delete the source when the copy fails', async () => {
    const { root, sourceWorkspace, destWorkspace, mediaId, bytes } = await layout();
    const store = memoryStore({ failCopy: true });
    const sourceKey = `media/${sourceWorkspace}/${mediaId}`;
    store.objects.set(sourceKey, { body: Buffer.from(bytes), etag: md5(bytes) });

    await expect(
      relocateMediaBytes({
        uploadDir: root,
        fromWorkspaceId: sourceWorkspace,
        fromMediaId: mediaId,
        toWorkspaceId: destWorkspace,
        toMediaId: mediaId,
        blobStore: store,
      }),
    ).rejects.toThrow(/s3 down/);

    expect(store.objects.has(sourceKey)).toBe(true);
    expect(store.deleted).toEqual([`media/${destWorkspace}/${mediaId}`]);
    expect(await readFile(path.join(root, sourceWorkspace, mediaId))).toEqual(bytes);
  });
});
