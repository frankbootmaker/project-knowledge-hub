CREATE TABLE IF NOT EXISTS "project_milestone_item_links" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "milestone_id" uuid NOT NULL,
  "entity_type" text NOT NULL,
  "entity_id" uuid NOT NULL,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "project_milestone_item_links_entity_type_check"
    CHECK ("entity_type" IN ('epic', 'user_story', 'task'))
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_milestone_item_links"
    ADD CONSTRAINT "project_milestone_item_links_milestone_id_fkey"
    FOREIGN KEY ("milestone_id") REFERENCES "project_milestones"("id")
    ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_milestone_item_links"
    ADD CONSTRAINT "project_milestone_item_links_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "users"("id")
    ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "project_milestone_item_links_uidx"
  ON "project_milestone_item_links" ("milestone_id", "entity_type", "entity_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_milestone_item_links_entity_idx"
  ON "project_milestone_item_links" ("entity_type", "entity_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_milestone_item_links_created_by_idx"
  ON "project_milestone_item_links" ("created_by");
