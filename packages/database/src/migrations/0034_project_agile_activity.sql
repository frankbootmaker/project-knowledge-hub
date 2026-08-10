CREATE TABLE IF NOT EXISTS "project_epics" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL,
  "title" text NOT NULL,
  "description" text,
  "status" text DEFAULT 'planned' NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "archived_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_epics"
    ADD CONSTRAINT "project_epics_project_id_projects_id_fk"
    FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_epics_project_id_idx"
  ON "project_epics" ("project_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_epics_project_status_idx"
  ON "project_epics" ("project_id", "status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_user_stories" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL,
  "epic_id" uuid NOT NULL,
  "title" text NOT NULL,
  "description" text,
  "status" text DEFAULT 'planned' NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "archived_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_user_stories"
    ADD CONSTRAINT "project_user_stories_project_id_projects_id_fk"
    FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_user_stories"
    ADD CONSTRAINT "project_user_stories_epic_id_project_epics_id_fk"
    FOREIGN KEY ("epic_id") REFERENCES "public"."project_epics"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_user_stories_project_id_idx"
  ON "project_user_stories" ("project_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_user_stories_epic_id_idx"
  ON "project_user_stories" ("epic_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_user_stories_project_status_idx"
  ON "project_user_stories" ("project_id", "status");
--> statement-breakpoint
ALTER TABLE "project_tasks"
  ADD COLUMN IF NOT EXISTS "user_story_id" uuid;
--> statement-breakpoint
ALTER TABLE "project_tasks"
  ADD COLUMN IF NOT EXISTS "current_owner_user_id" uuid;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_tasks"
    ADD CONSTRAINT "project_tasks_user_story_id_project_user_stories_id_fk"
    FOREIGN KEY ("user_story_id") REFERENCES "public"."project_user_stories"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_tasks"
    ADD CONSTRAINT "project_tasks_current_owner_user_id_users_id_fk"
    FOREIGN KEY ("current_owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_tasks_user_story_id_idx"
  ON "project_tasks" ("user_story_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_tasks_project_user_story_idx"
  ON "project_tasks" ("project_id", "user_story_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_tasks_current_owner_user_id_idx"
  ON "project_tasks" ("current_owner_user_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_task_activities" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "task_id" uuid NOT NULL,
  "actor_user_id" uuid,
  "type" text NOT NULL,
  "body" text,
  "metadata_json" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_task_activities"
    ADD CONSTRAINT "project_task_activities_task_id_project_tasks_id_fk"
    FOREIGN KEY ("task_id") REFERENCES "public"."project_tasks"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_task_activities"
    ADD CONSTRAINT "project_task_activities_actor_user_id_users_id_fk"
    FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_task_activities_task_id_idx"
  ON "project_task_activities" ("task_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_task_activities_task_created_idx"
  ON "project_task_activities" ("task_id", "created_at");
--> statement-breakpoint
-- Backfill current owner: Responsible (R), else Accountable (A), else created_by
UPDATE "project_tasks" t
SET "current_owner_user_id" = COALESCE(
  (
    SELECT r.user_id
    FROM "project_task_raci" r
    WHERE r.task_id = t.id AND r.role = 'R'
    LIMIT 1
  ),
  (
    SELECT r.user_id
    FROM "project_task_raci" r
    WHERE r.task_id = t.id AND r.role = 'A'
    LIMIT 1
  ),
  t.created_by
)
WHERE t.current_owner_user_id IS NULL;
