import {
  readOffsiteStamp,
  syncPendingOffsiteDump,
  uploadDumpOffsite,
  type BlobStore,
  type OffsiteStamp,
} from '@project-knowledge-hub/blob-store';
import { AppError } from '@project-knowledge-hub/domain';

export type { OffsiteStamp };

export { readOffsiteStamp, syncPendingOffsiteDump };

export async function uploadDumpOffsiteOrThrow(input: {
  blobStore: BlobStore;
  backupDir: string;
  name: string;
  schemaVersion: string;
}): Promise<{ stamp: OffsiteStamp; key: string }> {
  if (input.blobStore.provider === 'disabled') {
    throw new AppError({
      code: 'BLOB_DISABLED',
      message:
        'BLOB_PROVIDER is disabled; configure S3-compatible storage for offsite backups',
      statusCode: 503,
    });
  }
  try {
    return await uploadDumpOffsite(input);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Offsite upload failed';
    if (message.includes('not look like') || message.includes('empty')) {
      throw new AppError({
        code: 'BACKUP_INVALID_NAME',
        message,
        statusCode: 400,
      });
    }
    if (
      typeof error === 'object' &&
      error &&
      'code' in error &&
      (error as { code?: string }).code === 'ENOENT'
    ) {
      throw new AppError({
        code: 'BACKUP_NOT_FOUND',
        message: 'Dump artifact not found',
        statusCode: 404,
      });
    }
    throw new AppError({
      code: 'BACKUP_OFFSITE_FAILED',
      message,
      statusCode: 500,
    });
  }
}
