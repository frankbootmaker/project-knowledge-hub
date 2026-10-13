CREATE TABLE IF NOT EXISTS "project_item_media_links" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL,
  "entity_type" text NOT NULL,
  "entity_id" uuid NOT NULL,
  "kind" text NOT NULL,
  "workspace_media_id" uuid,
  "url" text,
  "title" text,
  "description" text,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_item_media_links"
    ADD CONSTRAINT "project_item_media_links_project_id_fkey"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id")
    ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_item_media_links"
    ADD CONSTRAINT "project_item_media_links_workspace_media_id_fkey"
    FOREIGN KEY ("workspace_media_id") REFERENCES "workspace_media"("id")
    ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_item_media_links"
    ADD CONSTRAINT "project_item_media_links_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "users"("id")
    ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_item_media_links"
    ADD CONSTRAINT "project_item_media_links_kind_check"
    CHECK (
      (
        "kind" = 'media'
        AND "workspace_media_id" IS NOT NULL
        AND "url" IS NULL
      )
      OR (
        "kind" = 'url'
        AND "workspace_media_id" IS NULL
        AND "url" IS NOT NULL
        AND "title" IS NOT NULL
        AND length(btrim("title")) > 0
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "project_item_media_links_media_uidx"
  ON "project_item_media_links" ("entity_type", "entity_id", "workspace_media_id")
  WHERE "workspace_media_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "project_item_media_links_url_uidx"
  ON "project_item_media_links" ("entity_type", "entity_id", "url")
  WHERE "url" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_item_media_links_entity_idx"
  ON "project_item_media_links" ("entity_type", "entity_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_item_media_links_media_idx"
  ON "project_item_media_links" ("workspace_media_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_item_media_links_project_idx"
  ON "project_item_media_links" ("project_id");
