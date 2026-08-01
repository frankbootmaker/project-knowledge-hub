import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  blobObjectKey,
  type BlobStore,
} from '@project-knowledge-hub/blob-store';
import { AppError } from '@project-knowledge-hub/domain';

const MAX_ERRORS = 20;

export type BlobMigrateDirs = {
  avatarUploadDir: string;
  mediaUploadDir: string;
  documentImportDir: string;
  stylePackUploadDir: string;
};

export type BlobMigrateResult = {
  uploaded: number;
  skipped: number;
  failed: number;
  errors: Array<{ key: string; message: string }>;
};

type PendingObject = {
  key: string;
  absolutePath: string;
  contentType?: string;
};

async function listFilesRecursive(rootDir: string): Promise<string[]> {
  const root = path.resolve(rootDir);
  const out: string[] = [];

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      const code =
        error && typeof error === 'object' && 'code' in error
          ? String((error as { code: unknown }).code)
          : '';
      if (code === 'ENOENT') return;
      throw error;
    }

    for (const entry of entries) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(absolute);
        continue;
      }
      if (entry.isFile()) {
        out.push(absolute);
      }
    }
  }

  await walk(root);
  return out;
}

function guessContentType(filePath: string): string | undefined {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.docx') {
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }
  return undefined;
}

async function collectAvatarObjects(uploadDir: string): Promise<PendingObject[]> {
  const root = path.resolve(uploadDir);
  const files = await listFilesRecursive(root);
  return files
    .filter((absolute) => path.dirname(absolute) === root)
    .map((absolute) => ({
      key: blobObjectKey('avatars', path.basename(absolute)),
      absolutePath: absolute,
      contentType: guessContentType(absolute) ?? 'application/octet-stream',
    }));
}

async function collectNestedObjects(
  uploadDir: string,
  purpose: 'media' | 'imports',
): Promise<PendingObject[]> {
  const root = path.resolve(uploadDir);
  const files = await listFilesRecursive(root);
  const out: PendingObject[] = [];

  for (const absolute of files) {
    const relative = path.relative(root, absolute).split(path.sep).join('/');
    const parts = relative.split('/').filter(Boolean);
    if (parts.length !== 2) continue;
    const [workspaceId, objectId] = parts;
    const key =
      purpose === 'media'
        ? blobObjectKey('media', `${workspaceId}/${objectId}`)
        : blobObjectKey('imports', `${workspaceId}/${objectId}/original`);
    out.push({
      key,
      absolutePath: absolute,
      contentType: guessContentType(absolute) ?? 'application/octet-stream',
    });
  }

  return out;
}

async function collectStylePackObjects(uploadDir: string): Promise<PendingObject[]> {
  const root = path.resolve(uploadDir);
  const files = await listFilesRecursive(root);
  return files.map((absolute) => {
    const relative = path.relative(root, absolute).split(path.sep).join('/');
    return {
      key: blobObjectKey('doc-templates', relative),
      absolutePath: absolute,
      contentType: guessContentType(absolute),
    };
  });
}

async function uploadPending(
  store: BlobStore,
  pending: PendingObject[],
  result: BlobMigrateResult,
): Promise<void> {
  for (const item of pending) {
    try {
      const buffer = await readFile(item.absolutePath);
      const existing = await store.get(item.key);
      if (existing && existing.byteLength === buffer.byteLength) {
        result.skipped += 1;
        continue;
      }
      await store.put({
        key: item.key,
        body: buffer,
        contentType: item.contentType,
      });
      result.uploaded += 1;
    } catch (error) {
      result.failed += 1;
      if (result.errors.length < MAX_ERRORS) {
        result.errors.push({
          key: item.key,
          message: error instanceof Error ? error.message : 'unknown error',
        });
      }
    }
  }
}

/**
 * Copy local avatar/media/import/style-pack files into S3. Leaves local files in place.
 */
export async function migrateLocalBlobsToS3(
  store: BlobStore,
  dirs: BlobMigrateDirs,
): Promise<BlobMigrateResult> {
  if (store.provider !== 's3') {
    throw new AppError({
      code: 'BLOB_DISABLED',
      message: 'Migrate requires an S3-compatible storage provider',
      statusCode: 400,
    });
  }

  const result: BlobMigrateResult = {
    uploaded: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };

  const pending = [
    ...(await collectAvatarObjects(dirs.avatarUploadDir)),
    ...(await collectNestedObjects(dirs.mediaUploadDir, 'media')),
    ...(await collectNestedObjects(dirs.documentImportDir, 'imports')),
    ...(await collectStylePackObjects(dirs.stylePackUploadDir)),
  ];

  await uploadPending(store, pending, result);
  return result;
}
