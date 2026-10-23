-- PRO-T-127. Retired project key prefixes stay resolvable and reserved
-- in the workspace until a workspace admin releases them.
-- Safe to run again.

CREATE TABLE IF NOT EXISTS "project_key_prefix_history" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "key_prefix" text NOT NULL,
  "retired_at" timestamptz DEFAULT now() NOT NULL,
  "retired_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "released_at" timestamptz,
  "released_by" uuid REFERENCES "users"("id") ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "project_key_prefix_history_active_uidx"
  ON "project_key_prefix_history" ("workspace_id", upper("key_prefix"))
  WHERE "released_at" IS NULL;

CREATE INDEX IF NOT EXISTS "project_key_prefix_history_project_idx"
  ON "project_key_prefix_history" ("project_id");

CREATE INDEX IF NOT EXISTS "project_key_prefix_history_prefix_idx"
  ON "project_key_prefix_history" (upper("key_prefix"));
