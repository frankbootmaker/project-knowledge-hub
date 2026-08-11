-- Open job roles (nullable user_id) + role description / competencies on roster.
ALTER TABLE "project_stakeholders"
  ALTER COLUMN "user_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "project_stakeholders"
  DROP CONSTRAINT IF EXISTS "project_stakeholders_user_id_users_id_fk";
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_stakeholders"
    ADD CONSTRAINT "project_stakeholders_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DROP INDEX IF EXISTS "project_stakeholders_project_user_uidx";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "project_stakeholders_project_user_uidx"
  ON "project_stakeholders" ("project_id", "user_id")
  WHERE "user_id" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "project_stakeholders"
  ADD COLUMN IF NOT EXISTS "role_description" text;
--> statement-breakpoint
ALTER TABLE "project_stakeholders"
  ADD COLUMN IF NOT EXISTS "competencies" jsonb DEFAULT '[]'::jsonb NOT NULL;
