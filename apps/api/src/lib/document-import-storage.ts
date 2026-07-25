import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  blobObjectKey,
  type BlobStore,
} from '@project-knowledge-hub/blob-store';

function importBlobKey(workspaceId: string, importId: string): string {
  return blobObjectKey('imports', `${workspaceId}/${importId}/original`);
}

function importFilePath(
  uploadDir: string,
  workspaceId: string,
  importId: string,
): string {
  return path.join(path.resolve(uploadDir), workspaceId, importId);
}

export async function writeImportOriginal(input: {
  uploadDir: string;
  workspaceId: string;
  importId: string;
  buffer: Buffer;
  contentType: string;
  blobStore?: BlobStore;
}): Promise<string> {
  const key = importBlobKey(input.workspaceId, input.importId);
  const store = input.blobStore;
  if (store && store.provider !== 'disabled') {
    await store.put({
      key,
      body: input.buffer,
      contentType: input.contentType,
    });
  }
  const filePath = importFilePath(
    input.uploadDir,
    input.workspaceId,
    input.importId,
  );
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, input.buffer);
  return key;
}

export async function readImportOriginal(input: {
  uploadDir: string;
  workspaceId: string;
  importId: string;
  blobKey: string;
  blobStore?: BlobStore;
}): Promise<Buffer | null> {
  const store = input.blobStore;
  if (store && store.provider !== 'disabled') {
    const fromBlob = await store.get(input.blobKey);
    if (fromBlob) return fromBlob;
  }
  try {
    return await readFile(
      importFilePath(input.uploadDir, input.workspaceId, input.importId),
    );
  } catch {
    return null;
  }
}

export async function deleteImportOriginal(input: {
  uploadDir: string;
  workspaceId: string;
  importId: string;
  blobKey: string;
  blobStore?: BlobStore;
}): Promise<void> {
  const store = input.blobStore;
  if (store && store.provider !== 'disabled') {
    await store.delete(input.blobKey).catch(() => undefined);
  }
  try {
    await unlink(
      importFilePath(input.uploadDir, input.workspaceId, input.importId),
    );
  } catch {
    // missing is fine
  }
}
