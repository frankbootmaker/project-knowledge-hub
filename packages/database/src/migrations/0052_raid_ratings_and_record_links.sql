ALTER TABLE "project_raid_items"
  ADD COLUMN IF NOT EXISTS "probability" text;
--> statement-breakpoint
ALTER TABLE "project_raid_items"
  ADD COLUMN IF NOT EXISTS "impact" text;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_raid_items"
    ADD CONSTRAINT "project_raid_items_probability_check"
    CHECK (
      "probability" IS NULL
      OR "probability" IN ('low', 'medium', 'high', 'critical')
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_raid_items"
    ADD CONSTRAINT "project_raid_items_impact_check"
    CHECK (
      "impact" IS NULL
      OR "impact" IN ('low', 'medium', 'high', 'critical')
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_raid_record_links" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "raid_item_id" uuid NOT NULL,
  "knowledge_record_id" uuid NOT NULL,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_raid_record_links"
    ADD CONSTRAINT "project_raid_record_links_raid_item_id_fkey"
    FOREIGN KEY ("raid_item_id") REFERENCES "project_raid_items"("id")
    ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_raid_record_links"
    ADD CONSTRAINT "project_raid_record_links_knowledge_record_id_fkey"
    FOREIGN KEY ("knowledge_record_id") REFERENCES "knowledge_records"("id")
    ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_raid_record_links"
    ADD CONSTRAINT "project_raid_record_links_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "users"("id")
    ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "project_raid_record_links_raid_record_uidx"
  ON "project_raid_record_links" ("raid_item_id", "knowledge_record_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_raid_record_links_record_id_idx"
  ON "project_raid_record_links" ("knowledge_record_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_raid_record_links_created_by_idx"
  ON "project_raid_record_links" ("created_by");
