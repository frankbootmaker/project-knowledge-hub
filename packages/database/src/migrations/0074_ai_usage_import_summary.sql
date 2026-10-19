ALTER TABLE "ai_usage_imports"
  ADD COLUMN IF NOT EXISTS "summary_json" jsonb;
--> statement-breakpoint

COMMENT ON COLUMN "ai_usage_imports"."summary_json" IS
  'Snapshot taken when the import is confirmed: usage date range, token totals by type, per-model row counts and totals, and linked versus unassigned counts.';
