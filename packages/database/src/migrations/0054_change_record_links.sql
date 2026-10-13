CREATE TABLE IF NOT EXISTS "project_change_record_links" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "change_id" uuid NOT NULL,
  "knowledge_record_id" uuid NOT NULL,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_change_record_links"
    ADD CONSTRAINT "project_change_record_links_change_id_fkey"
    FOREIGN KEY ("change_id") REFERENCES "project_change_items"("id")
    ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_change_record_links"
    ADD CONSTRAINT "project_change_record_links_knowledge_record_id_fkey"
    FOREIGN KEY ("knowledge_record_id") REFERENCES "knowledge_records"("id")
    ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_change_record_links"
    ADD CONSTRAINT "project_change_record_links_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "users"("id")
    ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "project_change_record_links_uidx"
  ON "project_change_record_links" ("change_id", "knowledge_record_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_change_record_links_record_id_idx"
  ON "project_change_record_links" ("knowledge_record_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_change_record_links_created_by_idx"
  ON "project_change_record_links" ("created_by");
--> statement-breakpoint
INSERT INTO "project_change_record_links" ("change_id", "knowledge_record_id", "created_by")
SELECT "id", "knowledge_record_id", "created_by"
FROM "project_change_items"
WHERE "knowledge_record_id" IS NOT NULL
ON CONFLICT ("change_id", "knowledge_record_id") DO NOTHING;
