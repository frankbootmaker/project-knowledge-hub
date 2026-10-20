import { readOffsiteStamp, syncPendingOffsiteDump } from './backup-sync.js';
import { writeOffsiteErrorStamp, writeRotationStamp } from './backup-status.js';
import { selectRetainedBackupIds, type RetentionPolicy } from './retention.js';
import type { BlobStore } from './types.js';

const DUMP_KEY_RE = /(^|\/)knowledge-hub-[A-Za-z0-9._-]+\.dump$/;

export type OffsiteRotationResult = {
  kept: number;
  deleted: string[];
  dryRun: boolean;
  error: string | null;
};

export type OffsiteCycleResult = {
  upload:
    | { uploaded: false; reason: string }
    | { uploaded: true; key: string };
  uploadError: string | null;
  rotation: OffsiteRotationResult | null;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function keyMatches(candidate: string, protect: string): boolean {
  if (candidate === protect) return true;
  const base = candidate.split('/').pop();
  const protectBase = protect.split('/').pop();
  return Boolean(base && protectBase && base === protectBase);
}

/**
 * List `<prefix>/backups/` (the store applies the env prefix) and delete dump
 * objects outside the retention policy. The newest object and any protected
 * successful key are never deleted. `dryRun` reports the plan only.
 */
export async function pruneOffsiteBackups(input: {
  blobStore: BlobStore;
  policy: RetentionPolicy;
  dryRun?: boolean;
  nowMs?: number;
  protectKeys?: string[];
}): Promise<OffsiteRotationResult> {
  const dryRun = Boolean(input.dryRun);
  if (input.blobStore.provider === 'disabled') {
    return { kept: 0, deleted: [], dryRun, error: null };
  }

  const listed = await input.blobStore.list('backups/');
  const dumps = listed.filter((item) => DUMP_KEY_RE.test(item.key));
  const nowMs = input.nowMs ?? Date.now();
  const candidates = dumps.map((item) => ({
    id: item.key,
    mtimeMs: item.lastModified?.getTime() ?? nowMs,
  }));
  const keep = selectRetainedBackupIds(candidates, input.policy, nowMs);
  const known = new Set(candidates.map((item) => item.id));
  for (const protect of input.protectKeys ?? []) {
    if (!protect) continue;
    for (const id of known) {
      if (keyMatches(id, protect)) keep.add(id);
    }
  }

  const deleted: string[] = [];
  for (const item of dumps) {
    if (keep.has(item.key)) continue;
    if (!dryRun) {
      await input.blobStore.delete(item.key);
    }
    deleted.push(item.key);
  }

  return { kept: keep.size, deleted, dryRun, error: null };
}

/** Prune S3 and record `last-s3-rotation.json` (skipped on dry-run). */
export async function retainOffsiteBackups(input: {
  blobStore: BlobStore;
  backupDir: string;
  policy: RetentionPolicy;
  dryRun?: boolean;
  nowMs?: number;
}): Promise<OffsiteRotationResult> {
  const dryRun = Boolean(input.dryRun);
  try {
    const offsite = await readOffsiteStamp(input.backupDir);
    const rotation = await pruneOffsiteBackups({
      blobStore: input.blobStore,
      policy: input.policy,
      dryRun,
      nowMs: input.nowMs,
      protectKeys: offsite?.key ? [offsite.key] : [],
    });
    if (!dryRun && input.blobStore.provider !== 'disabled') {
      await writeRotationStamp(input.backupDir, 's3', {
        kept: rotation.kept,
        deleted: rotation.deleted.length,
        error: null,
        dryRun: false,
      });
    }
    return rotation;
  } catch (error) {
    const message = errorMessage(error);
    const failed: OffsiteRotationResult = {
      kept: 0,
      deleted: [],
      dryRun,
      error: message,
    };
    if (!dryRun && input.blobStore.provider !== 'disabled') {
      await writeRotationStamp(input.backupDir, 's3', {
        kept: null,
        deleted: null,
        error: message,
        dryRun: false,
      }).catch(() => undefined);
    }
    return failed;
  }
}

/**
 * Upload the pending local dump, then prune S3 even when that upload throws.
 * Pass `prune: false` to skip deletion (auto-rotate off).
 */
export async function runOffsiteBackupCycle(input: {
  blobStore: BlobStore;
  backupDir: string;
  schemaVersion: string;
  policy: RetentionPolicy;
  prune?: boolean;
  dryRun?: boolean;
  nowMs?: number;
}): Promise<OffsiteCycleResult> {
  let upload: OffsiteCycleResult['upload'] = {
    uploaded: false,
    reason: 'not_attempted',
  };
  let uploadError: string | null = null;

  if (input.blobStore.provider === 'disabled') {
    upload = { uploaded: false, reason: 'blob_disabled' };
  } else {
    try {
      const result = await syncPendingOffsiteDump({
        blobStore: input.blobStore,
        backupDir: input.backupDir,
        schemaVersion: input.schemaVersion,
      });
      upload = result.uploaded
        ? { uploaded: true, key: result.stamp.key }
        : { uploaded: false, reason: result.reason };
    } catch (error) {
      uploadError = errorMessage(error);
      upload = { uploaded: false, reason: 'upload_failed' };
      await writeOffsiteErrorStamp(input.backupDir, {
        message: uploadError,
        artifact: '',
      }).catch(() => undefined);
    }
  }

  if (input.prune === false) {
    return { upload, uploadError, rotation: null };
  }

  const rotation = await retainOffsiteBackups({
    blobStore: input.blobStore,
    backupDir: input.backupDir,
    policy: input.policy,
    dryRun: input.dryRun,
    nowMs: input.nowMs,
  });
  return { upload, uploadError, rotation };
}
