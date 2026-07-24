/**
 * @deprecated Import runOpsAlerts / alertIfBackupStale from ./ops-alerts.js
 * Kept so existing imports keep resolving during the NF-009 expand.
 */
export {
  alertIfBackupStale,
  runOpsAlerts,
  type OpsAlertRunResult,
} from './ops-alerts.js';
