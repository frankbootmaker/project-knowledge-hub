import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { resolveDatabaseUrl } from '@project-knowledge-hub/config';
import * as schema from './schema/index.js';

export * from './schema/index.js';
export { resolveDatabaseUrl } from '@project-knowledge-hub/config';
export {
  ensureMigrationJournalAfterRestore,
  type BaselineJournalResult,
} from './baseline-journal.js';
export {
  ensureExchangeRates,
  listExchangeRates,
  loadExchangeRateBook,
  saveManualExchangeRate,
  upsertExchangeRates,
} from './exchange-rates.js';
export {
  preservedBaselineFinish,
  syncEnabledScheduleSlipRisks,
  syncScheduleSlipRisks,
  type ScheduleSlipSyncResult,
} from './schedule-slip-sync.js';
export {
  OPS_ALERT_SETTINGS_KEY,
  OPS_ALERT_TYPES,
  clearStoredOpsAlertSettings,
  configuredUserIds,
  listActiveAdminRecipients,
  listActiveUsersForAlerts,
  listRecipientUsers,
  loadEffectiveAlertSettings,
  parseStoredOpsAlertSettings,
  readAuditRetentionSnapshot,
  readStoredOpsAlertSettings,
  recipientsFromSpec,
  recordAuditRetentionRun,
  resolveEffectiveAlertSettings,
  saveStoredOpsAlertSettings,
  type AlertEnvSource,
  type AlertRecipient,
  type AlertUserOption,
  type AuditRetentionSnapshot,
  type EffectiveAlertSettings,
  type OpsAlertType,
  type RecipientSpec,
  type StoredOpsAlertSettings,
  type WebhookMode,
} from './ops-alert-settings.js';

export type Database = ReturnType<typeof createDatabase>;

export function createDatabase(connectionString: string) {
  const client = postgres(connectionString, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
  });

  const db = drizzle(client, { schema });

  return {
    db,
    client,
    async ping(): Promise<void> {
      await client`select 1`;
    },
    async close(): Promise<void> {
      await client.end({ timeout: 5 });
    },
  };
}

/** Create a client using POSTGRES_* (encoded) when set, else DATABASE_URL. */
export function createDatabaseFromEnv(
  source: NodeJS.ProcessEnv = process.env,
) {
  return createDatabase(resolveDatabaseUrl(source));
}
