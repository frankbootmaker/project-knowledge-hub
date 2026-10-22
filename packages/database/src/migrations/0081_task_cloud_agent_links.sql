-- PRO-T-117. One cloud agent may be linked to several tasks.
-- Existing project_tasks.cloud_agent_id values are copied into the link
-- table. The column stays as a mirror of the first sorted id and is no
-- longer unique. Safe to run again.

CREATE TABLE IF NOT EXISTS "project_task_cloud_agent_links" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "task_id" uuid NOT NULL,
  "cloud_agent_id" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "project_task_cloud_agent_links"
    ADD CONSTRAINT "project_task_cloud_agent_links_task_id_project_tasks_id_fk"
    FOREIGN KEY ("task_id") REFERENCES "public"."project_tasks"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "project_task_cloud_agent_links"
    ADD CONSTRAINT "project_task_cloud_agent_links_id_len"
    CHECK (char_length("cloud_agent_id") BETWEEN 1 AND 80);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "project_task_cloud_agent_links"
    ADD CONSTRAINT "project_task_cloud_agent_links_id_nospace"
    CHECK ("cloud_agent_id" !~ '\s');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "project_task_cloud_agent_links_pair_uidx"
  ON "project_task_cloud_agent_links" ("task_id", "cloud_agent_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "project_task_cloud_agent_links_agent_idx"
  ON "project_task_cloud_agent_links" ("cloud_agent_id");
--> statement-breakpoint

INSERT INTO "project_task_cloud_agent_links" ("task_id", "cloud_agent_id")
SELECT "id", "cloud_agent_id"
FROM "project_tasks"
WHERE "cloud_agent_id" IS NOT NULL
ON CONFLICT ("task_id", "cloud_agent_id") DO NOTHING;
--> statement-breakpoint

DROP INDEX IF EXISTS "project_tasks_cloud_agent_id_uidx";
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "project_tasks_cloud_agent_id_idx"
  ON "project_tasks" ("cloud_agent_id");
--> statement-breakpoint

COMMENT ON TABLE "project_task_cloud_agent_links" IS
  'Tasks linked to a Cursor cloud agent. The same agent id may appear on many tasks. Imported usage for that id is split equally across the links.';
--> statement-breakpoint

COMMENT ON COLUMN "project_tasks"."cloud_agent_id" IS
  'Mirror of the first sorted cloud agent link. Not unique. The link table is the source of truth.';
