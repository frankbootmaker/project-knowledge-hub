-- Auto RAID risk when a delivery item's schedule slips (PRO-T-63).
-- Baseline finish is the first saved end so a later move can be measured.
-- Safe to run again.

ALTER TABLE "projects"
  ADD COLUMN IF NOT EXISTS "schedule_slip_risk_enabled" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "projects"
  ADD COLUMN IF NOT EXISTS "schedule_slip_threshold_days" integer NOT NULL DEFAULT 2;
--> statement-breakpoint
ALTER TABLE "projects"
  ADD COLUMN IF NOT EXISTS "schedule_slip_item_types" jsonb NOT NULL
  DEFAULT '["task","user_story","epic","milestone"]'::jsonb;
--> statement-breakpoint
ALTER TABLE "project_tasks"
  ADD COLUMN IF NOT EXISTS "baseline_finish_date" date;
--> statement-breakpoint
ALTER TABLE "project_user_stories"
  ADD COLUMN IF NOT EXISTS "baseline_finish_date" date;
--> statement-breakpoint
ALTER TABLE "project_epics"
  ADD COLUMN IF NOT EXISTS "baseline_finish_date" date;
--> statement-breakpoint
ALTER TABLE "project_milestones"
  ADD COLUMN IF NOT EXISTS "baseline_finish_date" date;
--> statement-breakpoint
ALTER TABLE "project_raid_items"
  ADD COLUMN IF NOT EXISTS "source" text;
--> statement-breakpoint
ALTER TABLE "project_raid_items"
  ADD COLUMN IF NOT EXISTS "source_entity_type" text;
--> statement-breakpoint
ALTER TABLE "project_raid_items"
  ADD COLUMN IF NOT EXISTS "source_entity_id" uuid;
--> statement-breakpoint
ALTER TABLE "project_raid_items"
  ADD COLUMN IF NOT EXISTS "closure_suggested" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "project_raid_items"
  ADD COLUMN IF NOT EXISTS "slip_working_days" integer;
--> statement-breakpoint
UPDATE "project_tasks"
SET "baseline_finish_date" = "due_date"
WHERE "baseline_finish_date" IS NULL
  AND "due_date" IS NOT NULL;
--> statement-breakpoint
UPDATE "project_user_stories"
SET "baseline_finish_date" = "end_date"
WHERE "baseline_finish_date" IS NULL
  AND "end_date" IS NOT NULL;
--> statement-breakpoint
UPDATE "project_epics"
SET "baseline_finish_date" = "end_date"
WHERE "baseline_finish_date" IS NULL
  AND "end_date" IS NOT NULL;
--> statement-breakpoint
UPDATE "project_milestones"
SET "baseline_finish_date" = "target_date"
WHERE "baseline_finish_date" IS NULL
  AND "target_date" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "project_raid_items_one_open_auto_slip_uidx"
  ON "project_raid_items" ("project_id", "source_entity_type", "source_entity_id")
  WHERE "source" = 'auto_schedule_slip'
    AND "archived_at" IS NULL
    AND "status" IN ('open', 'mitigating', 'accepted');
