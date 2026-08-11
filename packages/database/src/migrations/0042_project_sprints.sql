CREATE TABLE IF NOT EXISTS "project_sprints" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE cascade,
  "name" text NOT NULL,
  "goal" text,
  "status" text DEFAULT 'planned' NOT NULL,
  "start_date" date,
  "end_date" date,
  "capacity_points" integer,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "issue_key_type" text,
  "issue_number" integer,
  "archived_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_sprints_project_id_idx"
  ON "project_sprints" ("project_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_sprints_project_status_idx"
  ON "project_sprints" ("project_id", "status");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "project_sprints_project_key_uidx"
  ON "project_sprints" ("project_id", "issue_key_type", "issue_number");
--> statement-breakpoint

ALTER TABLE "project_tasks"
  ADD COLUMN IF NOT EXISTS "sprint_id" uuid;
--> statement-breakpoint
ALTER TABLE "project_tasks"
  ADD COLUMN IF NOT EXISTS "story_points" integer;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_tasks"
    ADD CONSTRAINT "project_tasks_sprint_id_project_sprints_id_fk"
    FOREIGN KEY ("sprint_id") REFERENCES "public"."project_sprints"("id")
    ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_tasks_sprint_id_idx"
  ON "project_tasks" ("sprint_id");
--> statement-breakpoint

-- At most one active (non-archived) sprint per project.
CREATE UNIQUE INDEX IF NOT EXISTS "project_sprints_one_active_uidx"
  ON "project_sprints" ("project_id")
  WHERE "status" = 'active' AND "archived_at" IS NULL;
