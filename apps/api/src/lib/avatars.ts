import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  blobObjectKey,
  type BlobStore,
} from '@project-knowledge-hub/blob-store';

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export function isAllowedAvatarContentType(value: string): boolean {
  return ALLOWED_TYPES.has(value);
}

export function resolveAvatarDir(uploadDir: string): string {
  return path.resolve(uploadDir);
}

export function avatarFilePath(uploadDir: string, userId: string): string {
  return path.join(resolveAvatarDir(uploadDir), userId);
}

export async function ensureAvatarDir(uploadDir: string): Promise<void> {
  await mkdir(resolveAvatarDir(uploadDir), { recursive: true });
}

function avatarBlobKey(userId: string): string {
  return blobObjectKey('avatars', userId);
}

export async function writeAvatarFile(
  uploadDir: string,
  userId: string,
  buffer: Buffer,
  options?: { blobStore?: BlobStore; contentType?: string },
): Promise<void> {
  // Local first (same as workspace media) so uploads succeed when S3 is
  // misconfigured; shared /data volume is the source of truth for api reads.
  await ensureAvatarDir(uploadDir);
  await writeFile(avatarFilePath(uploadDir, userId), buffer);

  const store = options?.blobStore;
  if (store && store.provider !== 'disabled') {
    try {
      await store.put({
        key: avatarBlobKey(userId),
        body: buffer,
        contentType: options?.contentType,
      });
    } catch {
      // Local file already persisted; read path falls back to disk.
    }
  }
}

export async function readAvatarFile(
  uploadDir: string,
  userId: string,
  options?: { blobStore?: BlobStore },
): Promise<Buffer | null> {
  const store = options?.blobStore;
  if (store && store.provider !== 'disabled') {
    try {
      const fromBlob = await store.get(avatarBlobKey(userId));
      if (fromBlob) {
        return fromBlob;
      }
    } catch {
      // Fall through to local (broken S3 credentials, etc.).
    }
    // Local fallback + optional backfill when migrating to S3.
    const local = await readLocalAvatar(uploadDir, userId);
    if (local) {
      await store
        .put({ key: avatarBlobKey(userId), body: local })
        .catch(() => undefined);
      return local;
    }
    return null;
  }

  return readLocalAvatar(uploadDir, userId);
}

async function readLocalAvatar(
  uploadDir: string,
  userId: string,
): Promise<Buffer | null> {
  try {
    return await readFile(avatarFilePath(uploadDir, userId));
  } catch {
    return null;
  }
}

export async function deleteAvatarFile(
  uploadDir: string,
  userId: string,
  options?: { blobStore?: BlobStore },
): Promise<void> {
  const store = options?.blobStore;
  if (store && store.provider !== 'disabled') {
    await store.delete(avatarBlobKey(userId)).catch(() => undefined);
  }
  try {
    await unlink(avatarFilePath(uploadDir, userId));
  } catch {
    // missing file is fine
  }
}
