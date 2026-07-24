CREATE TABLE IF NOT EXISTS "workspace_media" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
  "knowledge_record_id" uuid REFERENCES "knowledge_records"("id") ON DELETE set null,
  "content_type" text NOT NULL,
  "byte_size" integer NOT NULL,
  "original_filename" text,
  "alt_text" text,
  "created_by" uuid REFERENCES "users"("id") ON DELETE set null,
  "archived_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "workspace_media_workspace_id_idx"
  ON "workspace_media" ("workspace_id");
CREATE INDEX IF NOT EXISTS "workspace_media_record_id_idx"
  ON "workspace_media" ("knowledge_record_id");
CREATE INDEX IF NOT EXISTS "workspace_media_created_at_idx"
  ON "workspace_media" ("created_at");
