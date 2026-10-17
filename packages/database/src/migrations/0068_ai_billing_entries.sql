ALTER TABLE "systems"
  ADD COLUMN IF NOT EXISTS "ai_token_rate_cache_write_per_1k" numeric(14, 4);
--> statement-breakpoint

ALTER TABLE "project_tasks"
  ADD COLUMN IF NOT EXISTS "tokens_cache_write" integer;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "project_tasks"
    ADD CONSTRAINT "project_tasks_tokens_cache_write_nonneg"
    CHECK ("tokens_cache_write" IS NULL OR "tokens_cache_write" >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "ai_billing_entries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "ai_system_id" uuid,
  "period" text NOT NULL,
  "provider" text NOT NULL,
  "plan" text,
  "type" text NOT NULL,
  "amount" numeric(14, 2) NOT NULL,
  "currency" text NOT NULL,
  "paid_at" timestamp with time zone,
  "note" text,
  "external_ref" text,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "ai_billing_entries"
    ADD CONSTRAINT "ai_billing_entries_workspace_id_workspaces_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "ai_billing_entries"
    ADD CONSTRAINT "ai_billing_entries_ai_system_id_systems_id_fk"
    FOREIGN KEY ("ai_system_id") REFERENCES "public"."systems"("id")
    ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "ai_billing_entries"
    ADD CONSTRAINT "ai_billing_entries_created_by_users_id_fk"
    FOREIGN KEY ("created_by") REFERENCES "public"."users"("id")
    ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "ai_billing_entries"
    ADD CONSTRAINT "ai_billing_entries_period_fmt"
    CHECK ("period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "ai_billing_entries"
    ADD CONSTRAINT "ai_billing_entries_type_chk"
    CHECK ("type" IN ('subscription', 'plan_change', 'on_demand'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "ai_billing_entries"
    ADD CONSTRAINT "ai_billing_entries_amount_chk"
    CHECK ("type" = 'plan_change' OR "amount" >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "ai_billing_entries"
    ADD CONSTRAINT "ai_billing_entries_note_len"
    CHECK ("note" IS NULL OR char_length("note") <= 500);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "ai_billing_entries"
    ADD CONSTRAINT "ai_billing_entries_provider_len"
    CHECK (char_length("provider") BETWEEN 1 AND 80);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "ai_billing_entries"
    ADD CONSTRAINT "ai_billing_entries_plan_len"
    CHECK ("plan" IS NULL OR char_length("plan") <= 80);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "ai_billing_entries"
    ADD CONSTRAINT "ai_billing_entries_external_ref_len"
    CHECK ("external_ref" IS NULL OR char_length("external_ref") <= 120);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "ai_billing_entries_workspace_period_idx"
  ON "ai_billing_entries" ("workspace_id", "period");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "ai_billing_entries_system_idx"
  ON "ai_billing_entries" ("ai_system_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "ai_billing_entries_created_by_idx"
  ON "ai_billing_entries" ("created_by");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "ai_billing_allocation_overrides" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "project_id" uuid NOT NULL,
  "period" text NOT NULL,
  "ai_system_id" uuid,
  "percent" numeric(6, 3) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "ai_billing_allocation_overrides"
    ADD CONSTRAINT "ai_billing_allocation_overrides_workspace_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "ai_billing_allocation_overrides"
    ADD CONSTRAINT "ai_billing_allocation_overrides_project_id_fk"
    FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "ai_billing_allocation_overrides"
    ADD CONSTRAINT "ai_billing_allocation_overrides_ai_system_id_fk"
    FOREIGN KEY ("ai_system_id") REFERENCES "public"."systems"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "ai_billing_allocation_overrides"
    ADD CONSTRAINT "ai_billing_allocation_overrides_period_fmt"
    CHECK ("period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "ai_billing_allocation_overrides"
    ADD CONSTRAINT "ai_billing_allocation_overrides_percent_chk"
    CHECK ("percent" >= 0 AND "percent" <= 100);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "ai_billing_allocation_overrides_uidx"
  ON "ai_billing_allocation_overrides" (
    "workspace_id",
    "project_id",
    "period",
    coalesce("ai_system_id", '00000000-0000-0000-0000-000000000000'::uuid)
  );
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "ai_billing_allocation_overrides_project_idx"
  ON "ai_billing_allocation_overrides" ("project_id");
--> statement-breakpoint

COMMENT ON TABLE "ai_billing_entries" IS
  'Paid AI fees for a workspace month. Multiple rows per period are summed. Allocated to projects by token share, else equally across active projects, else a manual percent. See PROJECT_BUDGET.md.';
--> statement-breakpoint

COMMENT ON COLUMN "systems"."ai_token_rate_cache_write_per_1k" IS
  'Cache-write price per 1k tokens. Null falls back to ai_token_rate_per_1k. Separate from the cache-read rate.';
--> statement-breakpoint

COMMENT ON COLUMN "project_tasks"."tokens_cache_write" IS
  'Input tokens that wrote the cache (Cursor export: Input w/ Cache Write). Included in the token breakdown sum.';
