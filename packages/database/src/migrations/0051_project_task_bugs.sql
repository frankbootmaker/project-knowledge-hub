ALTER TABLE "project_tasks"
  ADD COLUMN IF NOT EXISTS "item_type" text NOT NULL DEFAULT 'task';
--> statement-breakpoint
ALTER TABLE "project_tasks"
  ADD COLUMN IF NOT EXISTS "severity" text;
--> statement-breakpoint
ALTER TABLE "project_tasks"
  ADD COLUMN IF NOT EXISTS "found_in" text;
--> statement-breakpoint
ALTER TABLE "project_tasks"
  ADD COLUMN IF NOT EXISTS "found_in_note" text;
--> statement-breakpoint
ALTER TABLE "project_tasks"
  ADD COLUMN IF NOT EXISTS "steps_to_reproduce" text;
--> statement-breakpoint
ALTER TABLE "project_tasks"
  ADD COLUMN IF NOT EXISTS "expected_behavior" text;
--> statement-breakpoint
ALTER TABLE "project_tasks"
  ADD COLUMN IF NOT EXISTS "actual_behavior" text;
--> statement-breakpoint
ALTER TABLE "project_tasks"
  ADD COLUMN IF NOT EXISTS "resolution" text;
--> statement-breakpoint
ALTER TABLE "project_tasks"
  ADD COLUMN IF NOT EXISTS "regression" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "project_tasks"
  ADD COLUMN IF NOT EXISTS "affected_system_id" uuid;
--> statement-breakpoint
ALTER TABLE "project_tasks"
  ADD COLUMN IF NOT EXISTS "duplicate_of_task_id" uuid;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "project_tasks"
    ADD CONSTRAINT "project_tasks_affected_system_id_fkey"
    FOREIGN KEY ("affected_system_id") REFERENCES "systems"("id")
    ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_tasks"
    ADD CONSTRAINT "project_tasks_duplicate_of_task_id_fkey"
    FOREIGN KEY ("duplicate_of_task_id") REFERENCES "project_tasks"("id")
    ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_tasks"
    ADD CONSTRAINT "project_tasks_item_type_check"
    CHECK ("item_type" IN ('task', 'bug'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_tasks"
    ADD CONSTRAINT "project_tasks_severity_check"
    CHECK (
      "severity" IS NULL
      OR "severity" IN ('low', 'medium', 'high', 'critical')
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_tasks"
    ADD CONSTRAINT "project_tasks_found_in_check"
    CHECK (
      "found_in" IS NULL
      OR "found_in" IN ('development', 'test', 'staging', 'production')
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_tasks"
    ADD CONSTRAINT "project_tasks_resolution_check"
    CHECK (
      "resolution" IS NULL
      OR "resolution" IN (
        'fixed',
        'duplicate',
        'wont_fix',
        'cannot_reproduce',
        'works_as_designed'
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_tasks"
    ADD CONSTRAINT "project_tasks_found_in_note_len"
    CHECK ("found_in_note" IS NULL OR char_length("found_in_note") <= 200);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_tasks"
    ADD CONSTRAINT "project_tasks_steps_len"
    CHECK (
      "steps_to_reproduce" IS NULL
      OR char_length("steps_to_reproduce") <= 10000
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_tasks"
    ADD CONSTRAINT "project_tasks_expected_len"
    CHECK (
      "expected_behavior" IS NULL
      OR char_length("expected_behavior") <= 10000
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_tasks"
    ADD CONSTRAINT "project_tasks_actual_len"
    CHECK (
      "actual_behavior" IS NULL
      OR char_length("actual_behavior") <= 10000
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_tasks"
    ADD CONSTRAINT "project_tasks_bug_fields_check"
    CHECK (
      "item_type" = 'bug'
      OR (
        "severity" IS NULL
        AND "found_in" IS NULL
        AND "found_in_note" IS NULL
        AND "steps_to_reproduce" IS NULL
        AND "expected_behavior" IS NULL
        AND "actual_behavior" IS NULL
        AND "resolution" IS NULL
        AND "affected_system_id" IS NULL
        AND "duplicate_of_task_id" IS NULL
        AND "regression" = false
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_tasks"
    ADD CONSTRAINT "project_tasks_duplicate_resolution_check"
    CHECK (
      "duplicate_of_task_id" IS NULL
      OR "resolution" = 'duplicate'
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_tasks"
    ADD CONSTRAINT "project_tasks_duplicate_not_self_check"
    CHECK (
      "duplicate_of_task_id" IS NULL
      OR "duplicate_of_task_id" <> "id"
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "project_tasks_project_item_type_idx"
  ON "project_tasks" ("project_id", "item_type");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_tasks_affected_system_id_idx"
  ON "project_tasks" ("affected_system_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_tasks_duplicate_of_task_id_idx"
  ON "project_tasks" ("duplicate_of_task_id");
--> statement-breakpoint

COMMENT ON COLUMN "project_tasks"."item_type" IS
  'task or bug. Chosen at create. T and B human keys are not converted in place.';
