-- PRO-T-128. Retired project slugs redirect to the current slug and stay
-- reserved in the workspace until a workspace admin releases them.
-- Safe to run again.

CREATE TABLE IF NOT EXISTS "project_slug_history" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "slug" text NOT NULL,
  "retired_at" timestamptz DEFAULT now() NOT NULL,
  "retired_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "released_at" timestamptz,
  "released_by" uuid REFERENCES "users"("id") ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "project_slug_history_active_uidx"
  ON "project_slug_history" ("workspace_id", "slug")
  WHERE "released_at" IS NULL;

CREATE INDEX IF NOT EXISTS "project_slug_history_project_idx"
  ON "project_slug_history" ("project_id");

CREATE INDEX IF NOT EXISTS "project_slug_history_slug_idx"
  ON "project_slug_history" ("slug");
