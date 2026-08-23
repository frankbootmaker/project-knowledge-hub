import { readdir, stat, statfs } from 'node:fs/promises';
import path from 'node:path';

export type BlobUsagePurposeId =
  | 'media'
  | 'imports'
  | 'avatars'
  | 'docTemplates';

export type BlobUsagePurpose = {
  id: BlobUsagePurposeId;
  bytes: number;
  files: number;
};

export type BlobUsageSummary = {
  purposes: BlobUsagePurpose[];
  totalBytes: number;
  totalFiles: number;
  volume: {
    path: string;
    totalBytes: number | null;
    freeBytes: number | null;
    usedBytes: number | null;
  };
};

export type BlobUsageDirs = {
  avatarUploadDir: string;
  mediaUploadDir: string;
  documentImportDir: string;
  stylePackUploadDir: string;
};

async function dirUsage(rootDir: string): Promise<{ bytes: number; files: number }> {
  const root = path.resolve(rootDir);
  let bytes = 0;
  let files = 0;

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
      if (!entry.isFile()) continue;
      try {
        const info = await stat(absolute);
        bytes += info.size;
        files += 1;
      } catch {
        // Skip unreadable files.
      }
    }
  }

  await walk(root);
  return { bytes, files };
}

async function volumeStats(samplePaths: string[]): Promise<BlobUsageSummary['volume']> {
  for (const samplePath of samplePaths) {
    const resolved = path.resolve(samplePath);
    try {
      const info = await statfs(resolved);
      const totalBytes = Number(info.bsize) * Number(info.blocks);
      const freeBytes = Number(info.bsize) * Number(info.bavail);
      if (!Number.isFinite(totalBytes) || totalBytes <= 0) continue;
      return {
        path: resolved,
        totalBytes,
        freeBytes: Number.isFinite(freeBytes) ? freeBytes : null,
        usedBytes: Number.isFinite(freeBytes)
          ? Math.max(0, totalBytes - freeBytes)
          : null,
      };
    } catch {
      // Try next candidate (missing dirs, unsupported FS, etc.).
    }
  }

  const fallback = path.resolve(samplePaths[0] ?? '.');
  return {
    path: fallback,
    totalBytes: null,
    freeBytes: null,
    usedBytes: null,
  };
}

export async function summarizeLocalBlobUsage(
  dirs: BlobUsageDirs,
): Promise<BlobUsageSummary> {
  const [media, imports, avatars, docTemplates] = await Promise.all([
    dirUsage(dirs.mediaUploadDir),
    dirUsage(dirs.documentImportDir),
    dirUsage(dirs.avatarUploadDir),
    dirUsage(dirs.stylePackUploadDir),
  ]);

  const purposes: BlobUsagePurpose[] = [
    { id: 'media', bytes: media.bytes, files: media.files },
    { id: 'imports', bytes: imports.bytes, files: imports.files },
    { id: 'avatars', bytes: avatars.bytes, files: avatars.files },
    { id: 'docTemplates', bytes: docTemplates.bytes, files: docTemplates.files },
  ];

  const totalBytes = purposes.reduce((sum, row) => sum + row.bytes, 0);
  const totalFiles = purposes.reduce((sum, row) => sum + row.files, 0);
  const volume = await volumeStats([
    dirs.mediaUploadDir,
    dirs.avatarUploadDir,
    dirs.documentImportDir,
    dirs.stylePackUploadDir,
    '.',
  ]);

  return { purposes, totalBytes, totalFiles, volume };
}
