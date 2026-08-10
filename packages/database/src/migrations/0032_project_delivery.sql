CREATE TABLE IF NOT EXISTS "project_milestones" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL,
  "title" text NOT NULL,
  "description" text,
  "status" text DEFAULT 'planned' NOT NULL,
  "target_date" date,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "archived_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_tasks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL,
  "milestone_id" uuid,
  "title" text NOT NULL,
  "description" text,
  "status" text DEFAULT 'todo' NOT NULL,
  "due_date" date,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "created_by" uuid,
  "archived_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_task_raci" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "task_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "role" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_milestones"
    ADD CONSTRAINT "project_milestones_project_id_projects_id_fk"
    FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_tasks"
    ADD CONSTRAINT "project_tasks_project_id_projects_id_fk"
    FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_tasks"
    ADD CONSTRAINT "project_tasks_milestone_id_project_milestones_id_fk"
    FOREIGN KEY ("milestone_id") REFERENCES "public"."project_milestones"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_tasks"
    ADD CONSTRAINT "project_tasks_created_by_users_id_fk"
    FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_task_raci"
    ADD CONSTRAINT "project_task_raci_task_id_project_tasks_id_fk"
    FOREIGN KEY ("task_id") REFERENCES "public"."project_tasks"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_task_raci"
    ADD CONSTRAINT "project_task_raci_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_milestones_project_id_idx" ON "project_milestones" ("project_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_milestones_project_status_idx"
  ON "project_milestones" ("project_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_tasks_project_id_idx" ON "project_tasks" ("project_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_tasks_milestone_id_idx" ON "project_tasks" ("milestone_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_tasks_project_status_idx"
  ON "project_tasks" ("project_id", "status");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "project_task_raci_task_user_uidx"
  ON "project_task_raci" ("task_id", "user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "project_task_raci_one_accountable_uidx"
  ON "project_task_raci" ("task_id")
  WHERE "role" = 'A';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_task_raci_user_id_idx" ON "project_task_raci" ("user_id");
