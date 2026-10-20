import { and, asc, eq, inArray, isNotNull, isNull, notInArray } from 'drizzle-orm';
import type { BlobStore } from '@project-knowledge-hub/blob-store';
import { workspaceMedia, type Database } from '@project-knowledge-hub/database';
import {
  deleteRelocatedMediaBytes,
  liveMediaSharesByteLocation,
  mediaByteLocation,
  relocateMediaBytes,
  type WorkspaceMediaRow,
} from './workspace-media.js';

export type RelocateLogger = {
  info: (message: string) => void;
  error: (message: string) => void;
};

export type RelocateFailure = {
  mediaId: string;
  fromKey: string;
  toKey: string;
  message: string;
};

export type RelocateWorkspaceMediaResult = {
  relocated: number;
  failed: number;
  planned: number;
  sourceDeleteFailed: number;
  failures: RelocateFailure[];
};

const consoleLogger: RelocateLogger = {
  info: (message) => console.log(message),
  error: (message) => console.error(message),
};

function mediaKey(workspaceId: string, mediaId: string): string {
  return `media/${workspaceId}/${mediaId}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}

/**
 * Move bytes for rows whose storage pointer is not the row's own workspace path.
 * Migration 0075 sets that pointer and does not copy objects. This job copies
 * into `media/{workspaceId}/{mediaId}`, verifies size and etag, clears the
 * pointer, and only then deletes the source when no other row still uses it.
 * A failure is logged and the source is left in place.
 */
export async function relocatePendingWorkspaceMedia(input: {
  database: Database;
  uploadDir: string;
  blobStore?: BlobStore;
  /** Stop after this many rows, including failures. */
  limit?: number;
  mediaIds?: string[];
  dryRun?: boolean;
  log?: RelocateLogger;
}): Promise<RelocateWorkspaceMediaResult> {
  const log = input.log ?? consoleLogger;
  const cap = input.limit ?? Number.POSITIVE_INFINITY;
  const result: RelocateWorkspaceMediaResult = {
    relocated: 0,
    failed: 0,
    planned: 0,
    sourceDeleteFailed: 0,
    failures: [],
  };
  const attempted = new Set<string>();

  while (result.relocated + result.failed + result.planned < cap) {
    const batch = await input.database.db
      .select()
      .from(workspaceMedia)
      .where(
        and(
          isNotNull(workspaceMedia.storageWorkspaceId),
          input.mediaIds && input.mediaIds.length > 0
            ? inArray(workspaceMedia.id, input.mediaIds)
            : undefined,
          attempted.size > 0 ? notInArray(workspaceMedia.id, [...attempted]) : undefined,
        ),
      )
      .orderBy(asc(workspaceMedia.createdAt))
      .limit(100);
    if (batch.length === 0) break;

    for (const row of batch) {
      if (result.relocated + result.failed + result.planned >= cap) break;
      attempted.add(row.id);
      const from = mediaByteLocation(row);
      const fromKey = mediaKey(from.workspaceId, from.mediaId);
      const toKey = mediaKey(row.workspaceId, row.id);
      if (input.dryRun) {
        result.planned += 1;
        log.info(
          `plan workspace media ${row.id} from ${fromKey} to ${toKey} prefix media/${row.workspaceId}/`,
        );
        continue;
      }
      try {
        const cleared = await relocateOne(input.database, input.uploadDir, input.blobStore, row);
        if (!cleared) continue;
        result.relocated += 1;
        if (from.workspaceId === row.workspaceId && from.mediaId === row.id) {
          log.info(
            `cleared fallback pointer on workspace media ${row.id}; bytes already at ${toKey}`,
          );
          continue;
        }
        try {
          const shared = await liveMediaSharesByteLocation(
            input.database,
            {
              exceptMediaId: row.id,
              workspaceId: from.workspaceId,
              mediaId: from.mediaId,
            },
            { includeArchived: true },
          );
          if (shared) {
            log.info(
              `relocated workspace media ${row.id} to ${toKey}; kept ${fromKey} because another row uses it`,
            );
            continue;
          }
          await deleteRelocatedMediaBytes(
            input.uploadDir,
            from.workspaceId,
            from.mediaId,
            input.blobStore,
          );
          log.info(
            `relocated workspace media ${row.id} from ${fromKey} to ${toKey} and deleted source`,
          );
        } catch (error) {
          result.sourceDeleteFailed += 1;
          const message = `source delete failed: ${errorMessage(error)}`;
          result.failures.push({ mediaId: row.id, fromKey, toKey, message });
          log.error(
            `workspace media ${row.id} is at ${toKey} but ${fromKey} was kept: ${errorMessage(error)}`,
          );
        }
      } catch (error) {
        result.failed += 1;
        const message = errorMessage(error);
        result.failures.push({ mediaId: row.id, fromKey, toKey, message });
        log.error(
          `workspace media ${row.id} relocation failed from ${fromKey} to ${toKey}: ${message}; source kept`,
        );
      }
    }
  }

  return result;
}

async function relocateOne(
  database: Database,
  uploadDir: string,
  blobStore: BlobStore | undefined,
  row: WorkspaceMediaRow,
): Promise<boolean> {
  const from = mediaByteLocation(row);
  const samePlace = from.workspaceId === row.workspaceId && from.mediaId === row.id;
  if (!samePlace) {
    await relocateMediaBytes({
      uploadDir,
      fromWorkspaceId: from.workspaceId,
      fromMediaId: from.mediaId,
      toWorkspaceId: row.workspaceId,
      toMediaId: row.id,
      expectedByteSize: row.byteSize,
      contentType: row.contentType,
      blobStore,
    });
  }

  const storageMediaPredicate =
    row.storageMediaId == null
      ? isNull(workspaceMedia.storageMediaId)
      : eq(workspaceMedia.storageMediaId, row.storageMediaId);
  const [claimed] = await database.db
    .update(workspaceMedia)
    .set({ storageWorkspaceId: null, storageMediaId: null })
    .where(
      and(
        eq(workspaceMedia.id, row.id),
        eq(workspaceMedia.storageWorkspaceId, from.workspaceId),
        storageMediaPredicate,
      ),
    )
    .returning({ id: workspaceMedia.id });
  return Boolean(claimed);
}
