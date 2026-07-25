CREATE TABLE IF NOT EXISTS "document_imports" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "project_id" uuid,
  "system_id" uuid,
  "title" text NOT NULL,
  "lane" text NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "original_filename" text NOT NULL,
  "content_type" text NOT NULL,
  "byte_size" integer NOT NULL,
  "blob_key" text NOT NULL,
  "converted_markdown" text,
  "content_warnings" jsonb,
  "conversion_error" text,
  "conversion_warnings" jsonb,
  "created_by" uuid NOT NULL,
  "archived_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "document_import_records" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "import_id" uuid NOT NULL,
  "knowledge_record_id" uuid NOT NULL,
  "excerpt_note" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "document_import_media" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "import_id" uuid NOT NULL,
  "workspace_media_id" uuid NOT NULL,
  "attachment_index" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "document_imports" ADD CONSTRAINT "document_imports_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "document_imports" ADD CONSTRAINT "document_imports_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "document_imports" ADD CONSTRAINT "document_imports_system_id_systems_id_fk" FOREIGN KEY ("system_id") REFERENCES "public"."systems"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "document_imports" ADD CONSTRAINT "document_imports_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "document_import_records" ADD CONSTRAINT "document_import_records_import_id_document_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."document_imports"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "document_import_records" ADD CONSTRAINT "document_import_records_knowledge_record_id_knowledge_records_id_fk" FOREIGN KEY ("knowledge_record_id") REFERENCES "public"."knowledge_records"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "document_import_media" ADD CONSTRAINT "document_import_media_import_id_document_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."document_imports"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "document_import_media" ADD CONSTRAINT "document_import_media_workspace_media_id_workspace_media_id_fk" FOREIGN KEY ("workspace_media_id") REFERENCES "public"."workspace_media"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_imports_workspace_id_idx" ON "document_imports" ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_imports_status_idx" ON "document_imports" ("status");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "document_import_records_pair_uidx" ON "document_import_records" ("import_id","knowledge_record_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_import_records_import_id_idx" ON "document_import_records" ("import_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "document_import_media_pair_uidx" ON "document_import_media" ("import_id","workspace_media_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "document_import_media_attachment_uidx" ON "document_import_media" ("import_id","attachment_index");
