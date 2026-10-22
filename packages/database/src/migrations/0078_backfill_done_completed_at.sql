-- PRO-B-34. One-off backfill. completedAt is not a column: it is the latest
-- status_changed activity whose metadata "to" is done, and only while the
-- task or bug is still done. Rows created or imported as done had no such
-- activity, so completedAt stayed null. Stamp those with created_at =
-- updated_at. Idempotent: a later done transition is left alone.
INSERT INTO "project_task_activities" (
  "task_id",
  "type",
  "metadata_json",
  "created_at"
)
SELECT
  t."id",
  'status_changed',
  '{"from":null,"to":"done"}'::jsonb,
  t."updated_at"
FROM "project_tasks" t
WHERE t."status" = 'done'
  AND NOT EXISTS (
    SELECT 1
    FROM "project_task_activities" a
    WHERE a."task_id" = t."id"
      AND a."type" = 'status_changed'
      AND a."metadata_json"->>'to' = 'done'
  );
