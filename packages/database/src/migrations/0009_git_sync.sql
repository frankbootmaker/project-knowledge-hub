CREATE TABLE IF NOT EXISTS "git_repository_connections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
  "project_id" uuid REFERENCES "projects"("id") ON DELETE set null,
  "provider" text DEFAULT 'github' NOT NULL,
  "owner" text NOT NULL,
  "repo" text NOT NULL,
  "branch" text DEFAULT 'main' NOT NULL,
  "access_token" text NOT NULL,
  "include_paths" jsonb NOT NULL,
  "exclude_paths" jsonb NOT NULL,
  "path_mappings" jsonb NOT NULL,
  "webhook_secret" text,
  "status" text DEFAULT 'active' NOT NULL,
  "last_error" text,
  "last_synced_at" timestamp with time zone,
  "last_synced_commit_sha" text,
  "created_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE restrict,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "git_sync_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "connection_id" uuid NOT NULL REFERENCES "git_repository_connections"("id") ON DELETE cascade,
  "status" text DEFAULT 'queued' NOT NULL,
  "trigger" text NOT NULL,
  "commit_sha" text,
  "stats_json" jsonb,
  "error_message" text,
  "started_at" timestamp with time zone,
  "finished_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "git_repository_connections_workspace_id_idx"
  ON "git_repository_connections" ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "git_repository_connections_project_id_idx"
  ON "git_repository_connections" ("project_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "git_repository_connections_workspace_repo_uidx"
  ON "git_repository_connections" ("workspace_id", "provider", "owner", "repo", "branch");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "git_sync_runs_connection_id_idx"
  ON "git_sync_runs" ("connection_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "git_sync_runs_created_at_idx"
  ON "git_sync_runs" ("created_at");
