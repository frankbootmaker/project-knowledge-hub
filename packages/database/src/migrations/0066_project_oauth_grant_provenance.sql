-- OAuth MCP grants are not api_clients rows. Storing the grant id in
-- created_by_api_client_id violates that foreign key and rolls back create_project.
-- Safe to run again.

ALTER TABLE "projects"
  ADD COLUMN IF NOT EXISTS "created_by_oauth_grant_id" uuid;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "projects"
    ADD CONSTRAINT "projects_created_by_oauth_grant_id_fkey"
    FOREIGN KEY ("created_by_oauth_grant_id") REFERENCES "oauth_grants"("id")
    ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
