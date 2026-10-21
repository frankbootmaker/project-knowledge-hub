-- PRO-T-116. Last audit-retention purge, shown on Admin → Monitoring.
-- Alert recipients, thresholds, and the retention-days override stay in
-- platform_settings (key ops_alert_settings) so an unconfigured install keeps
-- emailing every active system admin.
CREATE TABLE IF NOT EXISTS "audit_retention_state" (
  "id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
  "last_purged_at" timestamp with time zone,
  "rows_purged" integer DEFAULT 0 NOT NULL,
  "retention_days" integer,
  "cutoff" timestamp with time zone,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
