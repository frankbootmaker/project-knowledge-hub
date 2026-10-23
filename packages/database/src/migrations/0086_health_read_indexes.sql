-- PRO-B-46. Health and budget reads look up the latest EUR quote and the
-- latest quote of each pair, and the latest done-transition per task.
-- Safe to run again.

CREATE INDEX IF NOT EXISTS "exchange_rates_base_date_idx"
  ON "exchange_rates" ("base", "rate_date" DESC);

CREATE INDEX IF NOT EXISTS "exchange_rates_pair_latest_idx"
  ON "exchange_rates" ("base", "quote", "source", "rate_date" DESC);

CREATE INDEX IF NOT EXISTS "project_task_activities_task_type_created_idx"
  ON "project_task_activities" ("task_id", "type", "created_at" DESC);
