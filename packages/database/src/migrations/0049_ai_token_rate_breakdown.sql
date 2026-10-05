ALTER TABLE "systems"
  ADD COLUMN IF NOT EXISTS "ai_token_rate_input_per_1k" numeric(14, 4);
--> statement-breakpoint
ALTER TABLE "systems"
  ADD COLUMN IF NOT EXISTS "ai_token_rate_output_per_1k" numeric(14, 4);
--> statement-breakpoint
ALTER TABLE "systems"
  ADD COLUMN IF NOT EXISTS "ai_token_rate_cache_per_1k" numeric(14, 4);
--> statement-breakpoint
ALTER TABLE "systems"
  ADD COLUMN IF NOT EXISTS "ai_cost_notes" text;
--> statement-breakpoint

ALTER TABLE "project_tasks"
  ADD COLUMN IF NOT EXISTS "tokens_input" integer;
--> statement-breakpoint
ALTER TABLE "project_tasks"
  ADD COLUMN IF NOT EXISTS "tokens_output" integer;
--> statement-breakpoint
ALTER TABLE "project_tasks"
  ADD COLUMN IF NOT EXISTS "tokens_cache" integer;
--> statement-breakpoint
ALTER TABLE "project_tasks"
  ADD COLUMN IF NOT EXISTS "ai_model_id" text;
--> statement-breakpoint
ALTER TABLE "project_tasks"
  ADD COLUMN IF NOT EXISTS "ai_pricing_tier" text;
--> statement-breakpoint
ALTER TABLE "project_tasks"
  ADD COLUMN IF NOT EXISTS "usage_occurred_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "project_tasks"
  ADD COLUMN IF NOT EXISTS "billing_period" text;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "systems"
    ADD CONSTRAINT "systems_ai_cost_notes_len"
    CHECK ("ai_cost_notes" IS NULL OR char_length("ai_cost_notes") <= 500);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_tasks"
    ADD CONSTRAINT "project_tasks_tokens_input_nonneg"
    CHECK ("tokens_input" IS NULL OR "tokens_input" >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_tasks"
    ADD CONSTRAINT "project_tasks_tokens_output_nonneg"
    CHECK ("tokens_output" IS NULL OR "tokens_output" >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_tasks"
    ADD CONSTRAINT "project_tasks_tokens_cache_nonneg"
    CHECK ("tokens_cache" IS NULL OR "tokens_cache" >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_tasks"
    ADD CONSTRAINT "project_tasks_ai_model_id_len"
    CHECK ("ai_model_id" IS NULL OR char_length("ai_model_id") <= 80);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_tasks"
    ADD CONSTRAINT "project_tasks_ai_pricing_tier_len"
    CHECK ("ai_pricing_tier" IS NULL OR char_length("ai_pricing_tier") <= 32);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_tasks"
    ADD CONSTRAINT "project_tasks_billing_period_fmt"
    CHECK (
      "billing_period" IS NULL
      OR "billing_period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

COMMENT ON COLUMN "systems"."ai_token_rate_per_1k" IS
  'Blended per-1k token rate. Used when a task has no input/output/cache breakdown, and as the fallback when a split rate is null.';
--> statement-breakpoint
COMMENT ON COLUMN "systems"."ai_token_rate_input_per_1k" IS
  'Input token rate per 1k. Null falls back to ai_token_rate_per_1k.';
--> statement-breakpoint
COMMENT ON COLUMN "systems"."ai_token_rate_output_per_1k" IS
  'Output token rate per 1k. Null falls back to ai_token_rate_per_1k.';
--> statement-breakpoint
COMMENT ON COLUMN "systems"."ai_token_rate_cache_per_1k" IS
  'Cache token rate per 1k. Null falls back to ai_token_rate_per_1k.';
--> statement-breakpoint
COMMENT ON COLUMN "systems"."ai_cost_mode" IS
  'flat: accrued monthly fee only. api: token cost only. mixed: accrued flat fee plus token cost. note_only: record tokens at $0. Mixed and api token cost is the blended rate on tasks with only tokens_used, or input/output/cache rates on a breakdown.';
