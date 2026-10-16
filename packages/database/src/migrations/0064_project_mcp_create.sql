-- PRO-T-25: agents may create projects, but only as idea-stage proposals.
-- Existing rows used the historical idea default even when a human created
-- them as live work. Those rows become active. MCP inserts set idea explicitly.
-- Safe to run again.

ALTER TABLE "projects"
  ADD COLUMN IF NOT EXISTS "methodology" text,
  ADD COLUMN IF NOT EXISTS "created_via" text,
  ADD COLUMN IF NOT EXISTS "created_by_api_client_id" uuid,
  ADD COLUMN IF NOT EXISTS "created_by_user_id" uuid,
  ADD COLUMN IF NOT EXISTS "generated_by_model" text;
--> statement-breakpoint
UPDATE "projects"
SET "status" = 'active'
WHERE "status" = 'idea';
--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "status" SET DEFAULT 'active';
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "projects"
    ADD CONSTRAINT "projects_methodology_chk"
    CHECK (
      "methodology" IS NULL
      OR "methodology" IN ('scrum', 'kanban', 'waterfall', 'hybrid')
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "projects"
    ADD CONSTRAINT "projects_created_via_chk"
    CHECK ("created_via" IS NULL OR "created_via" = 'mcp');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "projects"
    ADD CONSTRAINT "projects_created_by_api_client_id_fkey"
    FOREIGN KEY ("created_by_api_client_id") REFERENCES "api_clients"("id")
    ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "projects"
    ADD CONSTRAINT "projects_created_by_user_id_fkey"
    FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id")
    ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
