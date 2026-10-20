import {
  retainOffsiteBackups,
  type BlobStore,
  type OffsiteRotationResult,
} from '@project-knowledge-hub/blob-store';
import { rotateDumpArtifacts, type RotateResult } from './backups.js';

export async function applyBackupRetention(input: {
  backupDir: string;
  policy: { keepDaily: number; keepWeekly: number; keepMonthly: number };
  blobStore: BlobStore | null;
  dryRun?: boolean;
}): Promise<{
  rotation: RotateResult;
  offsiteRotation: OffsiteRotationResult | null;
}> {
  const rotation = await rotateDumpArtifacts(input.backupDir, input.policy, {
    dryRun: input.dryRun,
  });
  if (!input.blobStore || input.blobStore.provider === 'disabled') {
    return { rotation, offsiteRotation: null };
  }
  const offsiteRotation = await retainOffsiteBackups({
    blobStore: input.blobStore,
    backupDir: input.backupDir,
    policy: input.policy,
    dryRun: input.dryRun,
  });
  return { rotation, offsiteRotation };
}
