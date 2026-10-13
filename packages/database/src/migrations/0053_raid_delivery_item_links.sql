CREATE TABLE IF NOT EXISTS "project_raid_delivery_links" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "raid_item_id" uuid NOT NULL,
  "entity_type" text NOT NULL,
  "entity_id" uuid NOT NULL,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "project_raid_delivery_links_entity_type_check"
    CHECK ("entity_type" IN ('epic', 'user_story', 'milestone'))
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_raid_delivery_links"
    ADD CONSTRAINT "project_raid_delivery_links_raid_item_id_fkey"
    FOREIGN KEY ("raid_item_id") REFERENCES "project_raid_items"("id")
    ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_raid_delivery_links"
    ADD CONSTRAINT "project_raid_delivery_links_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "users"("id")
    ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "project_raid_delivery_links_uidx"
  ON "project_raid_delivery_links" ("raid_item_id", "entity_type", "entity_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_raid_delivery_links_entity_idx"
  ON "project_raid_delivery_links" ("entity_type", "entity_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_raid_delivery_links_created_by_idx"
  ON "project_raid_delivery_links" ("created_by");
