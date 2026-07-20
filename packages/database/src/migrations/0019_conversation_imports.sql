CREATE TABLE IF NOT EXISTS "conversation_imports" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
  "project_id" uuid REFERENCES "projects"("id") ON DELETE set null,
  "system_id" uuid REFERENCES "systems"("id") ON DELETE set null,
  "title" text NOT NULL,
  "content_format" text DEFAULT 'markdown' NOT NULL,
  "raw_content" text NOT NULL,
  "source_provider" text,
  "generated_by_model" text,
  "created_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE restrict,
  "archived_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "conversation_imports_workspace_id_idx"
  ON "conversation_imports" ("workspace_id");
CREATE INDEX IF NOT EXISTS "conversation_imports_project_id_idx"
  ON "conversation_imports" ("project_id");
CREATE INDEX IF NOT EXISTS "conversation_imports_system_id_idx"
  ON "conversation_imports" ("system_id");

CREATE TABLE IF NOT EXISTS "conversation_import_records" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "import_id" uuid NOT NULL REFERENCES "conversation_imports"("id") ON DELETE cascade,
  "knowledge_record_id" uuid NOT NULL REFERENCES "knowledge_records"("id") ON DELETE cascade,
  "excerpt_note" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "conversation_import_records_pair_uidx"
  ON "conversation_import_records" ("import_id", "knowledge_record_id");
CREATE INDEX IF NOT EXISTS "conversation_import_records_import_id_idx"
  ON "conversation_import_records" ("import_id");
CREATE INDEX IF NOT EXISTS "conversation_import_records_record_id_idx"
  ON "conversation_import_records" ("knowledge_record_id");
