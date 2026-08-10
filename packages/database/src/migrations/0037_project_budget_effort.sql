ALTER TABLE "projects"
  ADD COLUMN IF NOT EXISTS "currency" text DEFAULT 'EUR' NOT NULL;
--> statement-breakpoint
ALTER TABLE "projects"
  ADD COLUMN IF NOT EXISTS "initial_budget" numeric(14, 2);
--> statement-breakpoint
ALTER TABLE "projects"
  ADD COLUMN IF NOT EXISTS "approved_budget" numeric(14, 2);
--> statement-breakpoint
ALTER TABLE "project_stakeholders"
  ADD COLUMN IF NOT EXISTS "hourly_rate" numeric(12, 2);
--> statement-breakpoint
ALTER TABLE "project_tasks"
  ADD COLUMN IF NOT EXISTS "forecast_hours" numeric(10, 2);
--> statement-breakpoint
ALTER TABLE "project_tasks"
  ADD COLUMN IF NOT EXISTS "actual_hours" numeric(10, 2);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_cost_snapshots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL,
  "captured_on" date NOT NULL,
  "bac" numeric(14, 2) NOT NULL,
  "pv" numeric(14, 2),
  "ev" numeric(14, 2) NOT NULL,
  "ac" numeric(14, 2) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_cost_snapshots"
    ADD CONSTRAINT "project_cost_snapshots_project_id_projects_id_fk"
    FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "project_cost_snapshots_project_day_uidx"
  ON "project_cost_snapshots" ("project_id", "captured_on");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_cost_snapshots_project_id_idx"
  ON "project_cost_snapshots" ("project_id");
