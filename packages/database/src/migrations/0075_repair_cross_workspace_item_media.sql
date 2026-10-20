-- PRO-B-31. Repair project_item_media_links whose workspace_media row lives in
-- a different workspace than the item's project (left behind when a project
-- was moved). Idempotent. Never deletes workspace_media rows or files.
--
-- This migration cannot copy S3 objects: the migrate container has no data
-- volume and no bucket credentials. It retargets rows and records the folder
-- that still holds the bytes in storage_workspace_id / storage_media_id.
-- Those columns are a transitional fallback so /api/v1/media/{id} keeps
-- working until the post-deploy relocator runs. They are not the steady state.
--
-- Run apps/api src/scripts/relocate-workspace-media.ts after this migration.
-- For each pointer, that job creates the destination prefix, copies the object
-- to media/{workspaceId}/{id}, verifies size and etag, clears the pointer, and
-- only then deletes the source when no other row still uses it. A shared copy
-- gets its own object. Failures are logged and the source is kept.
--
-- For each mismatched media id, holders are workspaces that still reference it
-- via an item link, knowledge_record_id, markdown/html embed, or doc import:
-- * Nothing remains in the media's workspace and every holder is one other
--   workspace: move the row (same id) and remember the original byte folder.
--   Existing /api/v1/media/{id} urls keep working. This is the bootdave /
--   MIL-T-53 case.
-- * Something still references it from the current workspace, or holders span
--   more than one other workspace: insert one copy row per foreign workspace
--   that has item links, point those links at the copy, and leave the original
--   row (and its file) in place. A re-run reuses a copy with the same storage
--   pointer instead of inserting another.
ALTER TABLE "workspace_media"
  ADD COLUMN IF NOT EXISTS "storage_workspace_id" uuid;
--> statement-breakpoint
ALTER TABLE "workspace_media"
  ADD COLUMN IF NOT EXISTS "storage_media_id" uuid;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workspace_media_storage_idx"
  ON "workspace_media" ("storage_workspace_id", "storage_media_id");
--> statement-breakpoint
-- BEGIN REPAIR
DO $$
DECLARE
  media_rec record;
  holder_count bigint;
  home_count bigint;
  only_target uuid;
  copy_target uuid;
  new_id uuid;
  source_storage_ws uuid;
  source_storage_media uuid;
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS repair_item_media_holders (
    workspace_id uuid PRIMARY KEY
  ) ON COMMIT DROP;

  FOR media_rec IN
    SELECT DISTINCT m.id, m.workspace_id
    FROM project_item_media_links l
    JOIN workspace_media m ON m.id = l.workspace_media_id
    JOIN projects p ON p.id = l.project_id
    WHERE l.kind = 'media'
      AND l.workspace_media_id IS NOT NULL
      AND m.workspace_id IS DISTINCT FROM p.workspace_id
  LOOP
    TRUNCATE repair_item_media_holders;

    INSERT INTO repair_item_media_holders (workspace_id)
    SELECT DISTINCT p.workspace_id
    FROM project_item_media_links l
    JOIN projects p ON p.id = l.project_id
    WHERE l.kind = 'media'
      AND l.workspace_media_id = media_rec.id
    UNION
    SELECT r.workspace_id
    FROM workspace_media m
    JOIN knowledge_records r ON r.id = m.knowledge_record_id
    WHERE m.id = media_rec.id
      AND m.knowledge_record_id IS NOT NULL
    UNION
    SELECT r.workspace_id
    FROM knowledge_records r
    WHERE position(('/api/v1/media/' || media_rec.id::text) IN r.content_markdown) > 0
       OR position(
         ('/api/v1/media/' || media_rec.id::text) IN COALESCE(r.content_html_cache, '')
       ) > 0
    UNION
    SELECT di.workspace_id
    FROM document_import_media dim
    JOIN document_imports di ON di.id = dim.import_id
    WHERE dim.workspace_media_id = media_rec.id
    ON CONFLICT DO NOTHING;

    SELECT COUNT(*) INTO holder_count FROM repair_item_media_holders;
    SELECT COUNT(*) INTO home_count
    FROM repair_item_media_holders
    WHERE workspace_id = media_rec.workspace_id;

    IF home_count = 0 AND holder_count = 1 THEN
      SELECT workspace_id INTO only_target FROM repair_item_media_holders LIMIT 1;
      UPDATE workspace_media
      SET
        storage_workspace_id = COALESCE(storage_workspace_id, workspace_id),
        storage_media_id = COALESCE(storage_media_id, id),
        workspace_id = only_target
      WHERE id = media_rec.id
        AND workspace_id IS DISTINCT FROM only_target;
    ELSE
      FOR copy_target IN
        SELECT DISTINCT p.workspace_id
        FROM project_item_media_links l
        JOIN projects p ON p.id = l.project_id
        WHERE l.kind = 'media'
          AND l.workspace_media_id = media_rec.id
          AND p.workspace_id IS DISTINCT FROM media_rec.workspace_id
      LOOP
        SELECT
          COALESCE(storage_workspace_id, workspace_id),
          COALESCE(storage_media_id, id)
        INTO source_storage_ws, source_storage_media
        FROM workspace_media
        WHERE id = media_rec.id;

        new_id := NULL;
        SELECT id INTO new_id
        FROM workspace_media
        WHERE workspace_id = copy_target
          AND storage_workspace_id = source_storage_ws
          AND storage_media_id = source_storage_media
        LIMIT 1;

        IF new_id IS NULL THEN
          new_id := gen_random_uuid();
          INSERT INTO workspace_media (
            id,
            workspace_id,
            knowledge_record_id,
            content_type,
            byte_size,
            original_filename,
            alt_text,
            created_by,
            archived_at,
            created_at,
            storage_workspace_id,
            storage_media_id
          )
          SELECT
            new_id,
            copy_target,
            CASE
              WHEN kr.workspace_id = copy_target THEN m.knowledge_record_id
              ELSE NULL
            END,
            m.content_type,
            m.byte_size,
            m.original_filename,
            m.alt_text,
            m.created_by,
            m.archived_at,
            m.created_at,
            source_storage_ws,
            source_storage_media
          FROM workspace_media m
          LEFT JOIN knowledge_records kr ON kr.id = m.knowledge_record_id
          WHERE m.id = media_rec.id;

          UPDATE workspace_media AS source
          SET knowledge_record_id = NULL
          FROM knowledge_records kr
          WHERE source.id = media_rec.id
            AND kr.id = source.knowledge_record_id
            AND kr.workspace_id = copy_target;
        END IF;

        UPDATE project_item_media_links AS link
        SET workspace_media_id = new_id
        FROM projects p
        WHERE link.project_id = p.id
          AND link.workspace_media_id = media_rec.id
          AND link.kind = 'media'
          AND p.workspace_id = copy_target;
      END LOOP;
    END IF;
  END LOOP;
END $$;
-- END REPAIR
