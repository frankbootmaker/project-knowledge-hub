ALTER TABLE "project_tasks"
  ADD COLUMN IF NOT EXISTS "duration_days" integer;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_tasks"
    ADD CONSTRAINT "project_tasks_duration_days_chk"
    CHECK ("duration_days" IS NULL OR "duration_days" >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_delivery_dependencies" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL,
  "predecessor_type" text NOT NULL,
  "predecessor_id" uuid NOT NULL,
  "successor_type" text NOT NULL,
  "successor_id" uuid NOT NULL,
  "link_type" text NOT NULL,
  "lag_days" integer DEFAULT 0 NOT NULL,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_delivery_dependencies"
    ADD CONSTRAINT "project_delivery_dependencies_project_id_fkey"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id")
    ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_delivery_dependencies"
    ADD CONSTRAINT "project_delivery_dependencies_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "users"("id")
    ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_delivery_dependencies"
    ADD CONSTRAINT "project_delivery_dependencies_link_type_chk"
    CHECK ("link_type" IN ('FS', 'SS', 'FF', 'SF'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_delivery_dependencies"
    ADD CONSTRAINT "project_delivery_dependencies_entity_chk"
    CHECK (
      "predecessor_type" IN ('epic', 'user_story', 'task', 'milestone', 'sprint')
      AND "successor_type" IN ('epic', 'user_story', 'task', 'milestone', 'sprint')
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_delivery_dependencies"
    ADD CONSTRAINT "project_delivery_dependencies_lag_chk"
    CHECK ("lag_days" BETWEEN -3650 AND 3650);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_delivery_dependencies"
    ADD CONSTRAINT "project_delivery_dependencies_not_self_chk"
    CHECK (
      NOT (
        "predecessor_type" = "successor_type"
        AND "predecessor_id" = "successor_id"
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "project_delivery_dependencies_pair_uidx"
  ON "project_delivery_dependencies" (
    "predecessor_type",
    "predecessor_id",
    "successor_type",
    "successor_id"
  );
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_delivery_dependencies_project_idx"
  ON "project_delivery_dependencies" ("project_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_delivery_dependencies_successor_idx"
  ON "project_delivery_dependencies" ("successor_type", "successor_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_delivery_dependencies_predecessor_idx"
  ON "project_delivery_dependencies" ("predecessor_type", "predecessor_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_delivery_dependencies_created_by_idx"
  ON "project_delivery_dependencies" ("created_by");
