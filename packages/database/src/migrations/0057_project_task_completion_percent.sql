ALTER TABLE "project_tasks"
  ADD COLUMN IF NOT EXISTS "completion_percent" integer;

UPDATE "project_tasks"
SET "completion_percent" = CASE
  WHEN "status" = 'done' THEN 100
  WHEN "status" = 'cancelled' THEN NULL
  ELSE 0
END
WHERE "completion_percent" IS NULL
   OR "status" IN ('done', 'cancelled');

ALTER TABLE "project_tasks"
  DROP CONSTRAINT IF EXISTS "project_tasks_completion_percent_check";

ALTER TABLE "project_tasks"
  ADD CONSTRAINT "project_tasks_completion_percent_check"
  CHECK (
    "completion_percent" IS NULL
    OR "completion_percent" IN (0, 25, 50, 75, 100)
  );
