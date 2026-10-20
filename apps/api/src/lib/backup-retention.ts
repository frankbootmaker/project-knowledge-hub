import type { AppEnv } from '@project-knowledge-hub/config';
import {
  readRetentionPolicy,
  writeRetentionPolicy,
  RETENTION_FILE,
  type BackupRetentionPolicy,
} from '@project-knowledge-hub/blob-store';

export { readRetentionPolicy, writeRetentionPolicy, RETENTION_FILE };
export type { BackupRetentionPolicy };

export function envRetentionDefaults(env: AppEnv): BackupRetentionPolicy {
  return {
    keepDaily: env.BACKUP_KEEP_DAILY,
    keepWeekly: env.BACKUP_KEEP_WEEKLY,
    keepMonthly: env.BACKUP_KEEP_MONTHLY,
    autoRotate: env.BACKUP_AUTO_ROTATE,
  };
}
