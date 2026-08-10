CREATE TABLE IF NOT EXISTS "project_raid_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL,
  "kind" text NOT NULL,
  "title" text NOT NULL,
  "description" text,
  "status" text DEFAULT 'open' NOT NULL,
  "severity" text DEFAULT 'medium' NOT NULL,
  "owner_user_id" uuid,
  "due_date" date,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "archived_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_raid_items"
    ADD CONSTRAINT "project_raid_items_project_id_projects_id_fk"
    FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_raid_items"
    ADD CONSTRAINT "project_raid_items_owner_user_id_users_id_fk"
    FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_raid_items_project_id_idx"
  ON "project_raid_items" ("project_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_raid_items_project_kind_idx"
  ON "project_raid_items" ("project_id", "kind");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_raid_items_project_status_idx"
  ON "project_raid_items" ("project_id", "status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_raid_task_links" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "raid_item_id" uuid NOT NULL,
  "task_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_raid_task_links"
    ADD CONSTRAINT "project_raid_task_links_raid_item_id_project_raid_items_id_fk"
    FOREIGN KEY ("raid_item_id") REFERENCES "public"."project_raid_items"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_raid_task_links"
    ADD CONSTRAINT "project_raid_task_links_task_id_project_tasks_id_fk"
    FOREIGN KEY ("task_id") REFERENCES "public"."project_tasks"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "project_raid_task_links_raid_task_uidx"
  ON "project_raid_task_links" ("raid_item_id", "task_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_raid_task_links_task_id_idx"
  ON "project_raid_task_links" ("task_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "knowledge_record_delivery_links" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "knowledge_record_id" uuid NOT NULL,
  "entity_type" text NOT NULL,
  "entity_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "knowledge_record_delivery_links"
    ADD CONSTRAINT "knowledge_record_delivery_links_knowledge_record_id_fk"
    FOREIGN KEY ("knowledge_record_id") REFERENCES "public"."knowledge_records"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "knowledge_record_delivery_links_uidx"
  ON "knowledge_record_delivery_links" ("knowledge_record_id", "entity_type", "entity_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_record_delivery_links_entity_idx"
  ON "knowledge_record_delivery_links" ("entity_type", "entity_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_record_delivery_links_record_idx"
  ON "knowledge_record_delivery_links" ("knowledge_record_id");
