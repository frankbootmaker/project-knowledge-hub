CREATE TABLE IF NOT EXISTS "project_stakeholders" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "project_role" text DEFAULT 'stakeholder' NOT NULL,
  "job_title" text,
  "notes" text,
  "reports_to_user_id" uuid,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_stakeholders"
    ADD CONSTRAINT "project_stakeholders_project_id_projects_id_fk"
    FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_stakeholders"
    ADD CONSTRAINT "project_stakeholders_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_stakeholders"
    ADD CONSTRAINT "project_stakeholders_reports_to_user_id_users_id_fk"
    FOREIGN KEY ("reports_to_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "project_stakeholders_project_user_uidx"
  ON "project_stakeholders" ("project_id", "user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_stakeholders_project_id_idx"
  ON "project_stakeholders" ("project_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_stakeholders_reports_to_idx"
  ON "project_stakeholders" ("reports_to_user_id");
