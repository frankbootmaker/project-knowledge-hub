ALTER TABLE "project_sprints"
  ADD COLUMN IF NOT EXISTS "closure_snapshot" jsonb;
