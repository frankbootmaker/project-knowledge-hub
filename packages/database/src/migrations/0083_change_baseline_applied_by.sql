-- PRO-B-41. Who confirmed an approved change onto the project baseline.
-- Safe to run again.

ALTER TABLE "project_change_items"
  ADD COLUMN IF NOT EXISTS "baseline_applied_by" uuid REFERENCES "users"("id") ON DELETE SET NULL;
