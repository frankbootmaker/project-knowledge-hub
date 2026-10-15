-- Project working calendar (PRO-T-75).
-- Hours per workday and Monday-first workdays per week live on the project.
-- Listed dates are never working days. Existing task durations that were
-- stored as calendar-day gaps are rewritten as Monday–Friday working days
-- so the number matches the dates already stored. Dates themselves stay put.
-- Safe to run again.

ALTER TABLE "projects"
  ADD COLUMN IF NOT EXISTS "hours_per_workday" numeric(4, 2) DEFAULT 8 NOT NULL,
  ADD COLUMN IF NOT EXISTS "workdays_per_week" integer DEFAULT 5 NOT NULL;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "projects"
    ADD CONSTRAINT "projects_hours_per_workday_chk"
    CHECK ("hours_per_workday" > 0 AND "hours_per_workday" <= 24);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "projects"
    ADD CONSTRAINT "projects_workdays_per_week_chk"
    CHECK ("workdays_per_week" BETWEEN 1 AND 7);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_non_working_days" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL,
  "day" date NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_non_working_days"
    ADD CONSTRAINT "project_non_working_days_project_id_fkey"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id")
    ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "project_non_working_days_project_day_uidx"
  ON "project_non_working_days" ("project_id", "day");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_non_working_days_project_id_idx"
  ON "project_non_working_days" ("project_id");
--> statement-breakpoint
UPDATE "project_tasks" AS task
SET "duration_days" = span.days
FROM (
  SELECT
    id,
    (
      SELECT COUNT(*)::int
      FROM generate_series(
        ("start_date" + 1)::timestamp,
        "due_date"::timestamp,
        interval '1 day'
      ) AS g(day)
      WHERE EXTRACT(ISODOW FROM g.day) <= 5
    ) AS days
  FROM "project_tasks"
  WHERE "start_date" IS NOT NULL
    AND "due_date" IS NOT NULL
    AND "due_date" >= "start_date"
    AND "duration_days" IS NOT NULL
) AS span
WHERE task.id = span.id
  AND task.duration_days IS DISTINCT FROM span.days;
