ALTER TABLE "project_tasks"
  ADD COLUMN IF NOT EXISTS "cloud_agent_id" text;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "project_tasks"
    ADD CONSTRAINT "project_tasks_cloud_agent_id_len"
    CHECK ("cloud_agent_id" IS NULL OR char_length("cloud_agent_id") BETWEEN 1 AND 80);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "project_tasks_cloud_agent_id_uidx"
  ON "project_tasks" ("cloud_agent_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "ai_usage_imports" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "source" text NOT NULL,
  "file_name" text,
  "created_by" uuid,
  "row_count_total" integer NOT NULL DEFAULT 0,
  "row_count_inserted" integer NOT NULL DEFAULT 0,
  "row_count_duplicate" integer NOT NULL DEFAULT 0,
  "row_count_linked" integer NOT NULL DEFAULT 0,
  "row_count_errors" integer NOT NULL DEFAULT 0,
  "errors_json" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "ai_usage_imports"
    ADD CONSTRAINT "ai_usage_imports_workspace_id_workspaces_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "ai_usage_imports"
    ADD CONSTRAINT "ai_usage_imports_created_by_users_id_fk"
    FOREIGN KEY ("created_by") REFERENCES "public"."users"("id")
    ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "ai_usage_imports"
    ADD CONSTRAINT "ai_usage_imports_source_chk"
    CHECK ("source" IN ('csv', 'cursor_admin_api'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "ai_usage_imports"
    ADD CONSTRAINT "ai_usage_imports_counts_chk"
    CHECK (
      "row_count_total" >= 0
      AND "row_count_inserted" >= 0
      AND "row_count_duplicate" >= 0
      AND "row_count_linked" >= 0
      AND "row_count_errors" >= 0
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "ai_usage_imports"
    ADD CONSTRAINT "ai_usage_imports_file_name_len"
    CHECK ("file_name" IS NULL OR char_length("file_name") <= 200);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "ai_usage_imports_workspace_created_idx"
  ON "ai_usage_imports" ("workspace_id", "created_at" DESC);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "ai_usage_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "import_id" uuid,
  "source" text NOT NULL,
  "occurred_at" timestamp with time zone NOT NULL,
  "occurred_at_key" text NOT NULL,
  "cloud_agent_id" text,
  "automation_id" text,
  "kind" text,
  "model" text NOT NULL,
  "max_mode" boolean,
  "tokens_input" integer NOT NULL,
  "tokens_cache_write" integer NOT NULL,
  "tokens_cache" integer NOT NULL,
  "tokens_output" integer NOT NULL,
  "tokens_total" integer NOT NULL,
  "cost" text,
  "row_hash" text NOT NULL,
  "project_task_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "ai_usage_events"
    ADD CONSTRAINT "ai_usage_events_workspace_id_workspaces_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "ai_usage_events"
    ADD CONSTRAINT "ai_usage_events_import_id_ai_usage_imports_id_fk"
    FOREIGN KEY ("import_id") REFERENCES "public"."ai_usage_imports"("id")
    ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "ai_usage_events"
    ADD CONSTRAINT "ai_usage_events_project_task_id_project_tasks_id_fk"
    FOREIGN KEY ("project_task_id") REFERENCES "public"."project_tasks"("id")
    ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "ai_usage_events"
    ADD CONSTRAINT "ai_usage_events_source_chk"
    CHECK ("source" IN ('csv', 'cursor_admin_api'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "ai_usage_events"
    ADD CONSTRAINT "ai_usage_events_tokens_nonneg"
    CHECK (
      "tokens_input" >= 0
      AND "tokens_cache_write" >= 0
      AND "tokens_cache" >= 0
      AND "tokens_output" >= 0
      AND "tokens_total" >= 0
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "ai_usage_events_workspace_hash_uidx"
  ON "ai_usage_events" ("workspace_id", "row_hash");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "ai_usage_events_cloud_agent_idx"
  ON "ai_usage_events" ("workspace_id", "cloud_agent_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "ai_usage_events_task_idx"
  ON "ai_usage_events" ("project_task_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "ai_usage_events_import_idx"
  ON "ai_usage_events" ("import_id");
--> statement-breakpoint

COMMENT ON COLUMN "project_tasks"."cloud_agent_id" IS
  'Cursor cloud agent id. Usage rows with this id roll up onto the task. Null means the task is not linked.';
--> statement-breakpoint

COMMENT ON TABLE "ai_usage_imports" IS
  'One CSV (or later Admin API) usage import. Counts are total, inserted, duplicate, linked, and errors.';
--> statement-breakpoint

COMMENT ON TABLE "ai_usage_events" IS
  'Normalized AI usage events. row_hash is Date + Cloud Agent ID + Model + Total Tokens and is unique per workspace.';
--> statement-breakpoint

COMMENT ON COLUMN "ai_usage_events"."tokens_cache_write" IS
  'Cursor CSV column Input (w/ Cache Write). Disjoint from tokens_input (Input w/o Cache Write).';
