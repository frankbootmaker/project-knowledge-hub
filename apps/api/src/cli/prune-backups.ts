/**
 * One-off local + S3 backup retention.
 *
 * Dry-run (default) prints the plan and deletes nothing:
 *   pnpm --filter @project-knowledge-hub/api exec tsx src/cli/prune-backups.ts
 *
 * Apply the policy (local files and `<env>/backups/` in the bucket):
 *   pnpm --filter @project-knowledge-hub/api exec tsx src/cli/prune-backups.ts --apply
 *
 * BACKUP_DRY_RUN=1 forces a dry-run even with --apply.
 * Uses env blob settings (not the Admin → Storage database override).
 * Local-only dry-run without Node:
 *   BACKUP_DRY_RUN=1 BACKUP_DIR=./backups ./infrastructure/scripts/rotate-backups.sh
 */
import {
  blobStoreConfigFromEnv,
  loadEnv,
  loadNearestDotEnv,
} from '@project-knowledge-hub/config';
import {
  createBlobStore,
  readOffsiteStamp,
} from '@project-knowledge-hub/blob-store';
import { applyBackupRetention } from '../lib/backup-maintenance.js';
import {
  envRetentionDefaults,
  readRetentionPolicy,
} from '../lib/backup-retention.js';

loadNearestDotEnv();
const env = loadEnv();
const apply = process.argv.includes('--apply');
const dryRun = !apply || process.env.BACKUP_DRY_RUN === '1';

const { policy, source } = await readRetentionPolicy(
  env.BACKUP_DIR,
  envRetentionDefaults(env),
);
const blobStore = createBlobStore(blobStoreConfigFromEnv(env));
const offsite = await readOffsiteStamp(env.BACKUP_DIR);
const result = await applyBackupRetention({
  backupDir: env.BACKUP_DIR,
  policy,
  blobStore,
  dryRun,
});

const summary = {
  dryRun,
  backupDir: env.BACKUP_DIR,
  policySource: source,
  policy: {
    keepDaily: policy.keepDaily,
    keepWeekly: policy.keepWeekly,
    keepMonthly: policy.keepMonthly,
    autoRotate: policy.autoRotate,
  },
  protectedOffsiteKey: offsite?.key ?? null,
  local: {
    kept: result.rotation.kept,
    deleted: result.rotation.deleted,
    error: result.rotation.error,
  },
  s3: result.offsiteRotation
    ? {
        kept: result.offsiteRotation.kept,
        deleted: result.offsiteRotation.deleted,
        error: result.offsiteRotation.error,
      }
    : null,
};

console.log(JSON.stringify(summary, null, 2));
if (result.rotation.error || result.offsiteRotation?.error) {
  process.exitCode = 1;
}
