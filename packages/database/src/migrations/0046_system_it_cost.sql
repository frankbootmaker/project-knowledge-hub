-- IT / catalogue system OpEx fields for project budget AC (non-AI systems).
ALTER TABLE "systems"
  ADD COLUMN IF NOT EXISTS "it_cost_mode" text;
--> statement-breakpoint
ALTER TABLE "systems"
  ADD COLUMN IF NOT EXISTS "it_flat_monthly_fee" numeric(14, 2);
--> statement-breakpoint
ALTER TABLE "systems"
  ADD COLUMN IF NOT EXISTS "it_one_time_cost" numeric(14, 2);
--> statement-breakpoint
ALTER TABLE "systems"
  ADD COLUMN IF NOT EXISTS "it_budget_allocation" numeric(14, 2);
