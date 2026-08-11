ALTER TABLE "project_stakeholders"
  ADD COLUMN IF NOT EXISTS "engagement_type" text;
--> statement-breakpoint
ALTER TABLE "project_stakeholders"
  ADD COLUMN IF NOT EXISTS "assignment_start" date;
--> statement-breakpoint
ALTER TABLE "project_stakeholders"
  ADD COLUMN IF NOT EXISTS "assignment_end" date;
--> statement-breakpoint
ALTER TABLE "project_stakeholders"
  ADD COLUMN IF NOT EXISTS "allocated_daily_hours" numeric(6, 2);
--> statement-breakpoint
ALTER TABLE "project_stakeholders"
  ADD COLUMN IF NOT EXISTS "contract_ref" text;
--> statement-breakpoint
ALTER TABLE "project_stakeholders"
  ADD COLUMN IF NOT EXISTS "contracted_budget" numeric(14, 2);
--> statement-breakpoint
ALTER TABLE "project_stakeholders"
  ADD COLUMN IF NOT EXISTS "contract_start" date;
--> statement-breakpoint
ALTER TABLE "project_stakeholders"
  ADD COLUMN IF NOT EXISTS "contract_end" date;
--> statement-breakpoint

ALTER TABLE "systems"
  ADD COLUMN IF NOT EXISTS "ai_cost_mode" text;
--> statement-breakpoint
ALTER TABLE "systems"
  ADD COLUMN IF NOT EXISTS "ai_flat_monthly_fee" numeric(14, 2);
--> statement-breakpoint
ALTER TABLE "systems"
  ADD COLUMN IF NOT EXISTS "ai_token_rate_per_1k" numeric(14, 4);
--> statement-breakpoint
ALTER TABLE "systems"
  ADD COLUMN IF NOT EXISTS "ai_budget_allocation" numeric(14, 2);
--> statement-breakpoint

ALTER TABLE "project_tasks"
  ADD COLUMN IF NOT EXISTS "tokens_used" integer;
--> statement-breakpoint
ALTER TABLE "project_tasks"
  ADD COLUMN IF NOT EXISTS "ai_system_id" uuid;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_tasks"
    ADD CONSTRAINT "project_tasks_ai_system_id_systems_id_fk"
    FOREIGN KEY ("ai_system_id")
    REFERENCES "public"."systems"("id")
    ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_tasks_ai_system_id_idx"
  ON "project_tasks" ("ai_system_id");
