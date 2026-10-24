-- PRO-B-51. Workspace catalogue lists filter to live rows. The partial
-- indexes match that predicate so archived history does not sit in the scan.
-- Safe to run again.

CREATE INDEX IF NOT EXISTS "systems_workspace_live_idx"
  ON "systems" ("workspace_id")
  WHERE "archived_at" IS NULL AND "status" <> 'archived';

CREATE INDEX IF NOT EXISTS "knowledge_records_workspace_live_idx"
  ON "knowledge_records" ("workspace_id")
  WHERE "archived_at" IS NULL AND "lifecycle_status" <> 'archived';
