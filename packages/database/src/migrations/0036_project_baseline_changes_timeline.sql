ALTER TABLE "projects"
  ADD COLUMN IF NOT EXISTS "start_date" date;
--> statement-breakpoint
ALTER TABLE "projects"
  ADD COLUMN IF NOT EXISTS "end_date" date;
--> statement-breakpoint
ALTER TABLE "projects"
  ADD COLUMN IF NOT EXISTS "charter_record_id" uuid;
--> statement-breakpoint
ALTER TABLE "projects"
  ADD COLUMN IF NOT EXISTS "initial_plan_record_id" uuid;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "projects"
    ADD CONSTRAINT "projects_charter_record_id_knowledge_records_id_fk"
    FOREIGN KEY ("charter_record_id") REFERENCES "public"."knowledge_records"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "projects"
    ADD CONSTRAINT "projects_initial_plan_record_id_knowledge_records_id_fk"
    FOREIGN KEY ("initial_plan_record_id") REFERENCES "public"."knowledge_records"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
ALTER TABLE "project_milestones"
  ADD COLUMN IF NOT EXISTS "start_date" date;
--> statement-breakpoint
ALTER TABLE "project_epics"
  ADD COLUMN IF NOT EXISTS "start_date" date;
--> statement-breakpoint
ALTER TABLE "project_epics"
  ADD COLUMN IF NOT EXISTS "end_date" date;
--> statement-breakpoint
ALTER TABLE "project_user_stories"
  ADD COLUMN IF NOT EXISTS "start_date" date;
--> statement-breakpoint
ALTER TABLE "project_user_stories"
  ADD COLUMN IF NOT EXISTS "end_date" date;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_initial_stakeholders" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "project_role" text DEFAULT 'stakeholder' NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_initial_stakeholders"
    ADD CONSTRAINT "project_initial_stakeholders_project_id_projects_id_fk"
    FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_initial_stakeholders"
    ADD CONSTRAINT "project_initial_stakeholders_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "project_initial_stakeholders_project_user_uidx"
  ON "project_initial_stakeholders" ("project_id", "user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_initial_stakeholders_project_id_idx"
  ON "project_initial_stakeholders" ("project_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_change_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL,
  "kind" text NOT NULL,
  "title" text NOT NULL,
  "description" text,
  "rationale" text,
  "status" text DEFAULT 'proposed' NOT NULL,
  "requested_by_user_id" uuid,
  "approved_by_user_id" uuid,
  "requested_at" timestamp with time zone DEFAULT now() NOT NULL,
  "decided_at" timestamp with time zone,
  "effective_date" date,
  "baseline_start_before" date,
  "baseline_start_after" date,
  "baseline_end_before" date,
  "baseline_end_after" date,
  "knowledge_record_id" uuid,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "archived_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_change_items"
    ADD CONSTRAINT "project_change_items_project_id_projects_id_fk"
    FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_change_items"
    ADD CONSTRAINT "project_change_items_requested_by_user_id_users_id_fk"
    FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_change_items"
    ADD CONSTRAINT "project_change_items_approved_by_user_id_users_id_fk"
    FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_change_items"
    ADD CONSTRAINT "project_change_items_knowledge_record_id_knowledge_records_id_fk"
    FOREIGN KEY ("knowledge_record_id") REFERENCES "public"."knowledge_records"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_change_items_project_id_idx"
  ON "project_change_items" ("project_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_change_items_project_status_idx"
  ON "project_change_items" ("project_id", "status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_change_delivery_links" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "change_id" uuid NOT NULL,
  "entity_type" text NOT NULL,
  "entity_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_change_delivery_links"
    ADD CONSTRAINT "project_change_delivery_links_change_id_project_change_items_id_fk"
    FOREIGN KEY ("change_id") REFERENCES "public"."project_change_items"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "project_change_delivery_links_uidx"
  ON "project_change_delivery_links" ("change_id", "entity_type", "entity_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_change_delivery_links_entity_idx"
  ON "project_change_delivery_links" ("entity_type", "entity_id");
