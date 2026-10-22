-- PRO-B-41. Marks an approved change request once its schedule
-- has been written onto the project baseline. Safe to run again.

ALTER TABLE "project_change_items"
  ADD COLUMN IF NOT EXISTS "baseline_applied_at" timestamp with time zone;
