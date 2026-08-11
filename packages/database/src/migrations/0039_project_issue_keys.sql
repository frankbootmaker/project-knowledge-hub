ALTER TABLE "projects"
  ADD COLUMN IF NOT EXISTS "key_prefix" text;
--> statement-breakpoint
ALTER TABLE "projects"
  ADD COLUMN IF NOT EXISTS "issue_counters" jsonb DEFAULT '{}'::jsonb NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "projects_workspace_key_prefix_uidx"
  ON "projects" ("workspace_id", upper("key_prefix"))
  WHERE "key_prefix" IS NOT NULL;
--> statement-breakpoint

ALTER TABLE "project_milestones"
  ADD COLUMN IF NOT EXISTS "issue_key_type" text;
--> statement-breakpoint
ALTER TABLE "project_milestones"
  ADD COLUMN IF NOT EXISTS "issue_number" integer;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "project_milestones_project_key_uidx"
  ON "project_milestones" ("project_id", "issue_key_type", "issue_number");
--> statement-breakpoint

ALTER TABLE "project_epics"
  ADD COLUMN IF NOT EXISTS "issue_key_type" text;
--> statement-breakpoint
ALTER TABLE "project_epics"
  ADD COLUMN IF NOT EXISTS "issue_number" integer;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "project_epics_project_key_uidx"
  ON "project_epics" ("project_id", "issue_key_type", "issue_number");
--> statement-breakpoint

ALTER TABLE "project_user_stories"
  ADD COLUMN IF NOT EXISTS "issue_key_type" text;
--> statement-breakpoint
ALTER TABLE "project_user_stories"
  ADD COLUMN IF NOT EXISTS "issue_number" integer;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "project_user_stories_project_key_uidx"
  ON "project_user_stories" ("project_id", "issue_key_type", "issue_number");
--> statement-breakpoint

ALTER TABLE "project_tasks"
  ADD COLUMN IF NOT EXISTS "issue_key_type" text;
--> statement-breakpoint
ALTER TABLE "project_tasks"
  ADD COLUMN IF NOT EXISTS "issue_number" integer;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "project_tasks_project_key_uidx"
  ON "project_tasks" ("project_id", "issue_key_type", "issue_number");
--> statement-breakpoint

ALTER TABLE "project_raid_items"
  ADD COLUMN IF NOT EXISTS "issue_key_type" text;
--> statement-breakpoint
ALTER TABLE "project_raid_items"
  ADD COLUMN IF NOT EXISTS "issue_number" integer;
--> statement-breakpoint
ALTER TABLE "project_raid_items"
  ADD COLUMN IF NOT EXISTS "transferred_to_raid_item_id" uuid;
--> statement-breakpoint
ALTER TABLE "project_raid_items"
  ADD COLUMN IF NOT EXISTS "transferred_from_raid_item_id" uuid;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_raid_items"
    ADD CONSTRAINT "project_raid_items_transferred_to_raid_item_id_project_raid_items_id_fk"
    FOREIGN KEY ("transferred_to_raid_item_id")
    REFERENCES "public"."project_raid_items"("id")
    ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_raid_items"
    ADD CONSTRAINT "project_raid_items_transferred_from_raid_item_id_project_raid_items_id_fk"
    FOREIGN KEY ("transferred_from_raid_item_id")
    REFERENCES "public"."project_raid_items"("id")
    ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "project_raid_items_project_key_uidx"
  ON "project_raid_items" ("project_id", "issue_key_type", "issue_number");
--> statement-breakpoint

ALTER TABLE "project_change_items"
  ADD COLUMN IF NOT EXISTS "issue_key_type" text;
--> statement-breakpoint
ALTER TABLE "project_change_items"
  ADD COLUMN IF NOT EXISTS "issue_number" integer;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "project_change_items_project_key_uidx"
  ON "project_change_items" ("project_id", "issue_key_type", "issue_number");
--> statement-breakpoint

-- Backfill workspace-unique key prefixes from slug/name.
DO $$
DECLARE
  proj RECORD;
  base text;
  letters text;
  alnum text;
  candidate text;
  attempt integer;
  used boolean;
BEGIN
  FOR proj IN
    SELECT id, workspace_id, slug, name
    FROM projects
    WHERE key_prefix IS NULL
    ORDER BY created_at ASC
  LOOP
    alnum := upper(regexp_replace(coalesce(proj.slug, proj.name, 'PRJ'), '[^A-Za-z0-9]', '', 'g'));
    letters := regexp_replace(alnum, '[^A-Z]', '', 'g');
    IF length(letters) >= 3 THEN
      base := substr(letters, 1, 3);
    ELSIF length(letters) = 2 THEN
      base := letters || coalesce(substring(alnum from '[0-9]'), '1');
    ELSIF length(letters) = 1 THEN
      base := letters || 'X' || coalesce(substring(alnum from '[0-9]'), '1');
    ELSIF length(alnum) >= 3 THEN
      base := substr(alnum, 1, 3);
      IF base !~ '^[A-Z]{3}$' AND base !~ '^[A-Z]{2}[0-9]$' THEN
        base := rpad(substr(regexp_replace(base, '[^A-Z]', '', 'g'), 1, 2), 2, 'X')
          || coalesce(substring(base from '[0-9]'), '1');
      END IF;
    ELSE
      base := 'PRJ';
    END IF;

    attempt := 0;
    LOOP
      IF attempt = 0 THEN
        candidate := base;
      ELSIF attempt < 10 AND base ~ '^[A-Z]{2}' THEN
        candidate := substr(base, 1, 2) || attempt::text;
      ELSE
        candidate := 'P' || substr(md5(proj.id::text || attempt::text), 1, 1)
          || (attempt % 10)::text;
        candidate := upper(candidate);
      END IF;

      IF candidate !~ '^[A-Z]{3}$' AND candidate !~ '^[A-Z]{2}[0-9]$' THEN
        candidate := 'PR' || (attempt % 10)::text;
      END IF;

      SELECT EXISTS (
        SELECT 1 FROM projects p
        WHERE p.workspace_id = proj.workspace_id
          AND p.key_prefix IS NOT NULL
          AND upper(p.key_prefix) = upper(candidate)
      ) INTO used;

      EXIT WHEN NOT used;
      attempt := attempt + 1;
      EXIT WHEN attempt > 40;
    END LOOP;

    UPDATE projects SET key_prefix = candidate WHERE id = proj.id;
  END LOOP;
END $$;
--> statement-breakpoint

-- Number existing delivery/RAID/change rows by created_at and rebuild counters.
DO $$
DECLARE
  proj RECORD;
  counters jsonb;
BEGIN
  FOR proj IN SELECT id FROM projects LOOP
    counters := '{}'::jsonb;

    WITH numbered AS (
      SELECT id, row_number() OVER (ORDER BY created_at ASC, id ASC) AS n
      FROM project_epics WHERE project_id = proj.id AND issue_number IS NULL
    )
    UPDATE project_epics e
    SET issue_key_type = 'E', issue_number = numbered.n
    FROM numbered WHERE e.id = numbered.id;
    counters := counters || jsonb_build_object(
      'E',
      coalesce((SELECT max(issue_number) FROM project_epics WHERE project_id = proj.id), 0)
    );

    WITH numbered AS (
      SELECT id, row_number() OVER (ORDER BY created_at ASC, id ASC) AS n
      FROM project_user_stories WHERE project_id = proj.id AND issue_number IS NULL
    )
    UPDATE project_user_stories e
    SET issue_key_type = 'S', issue_number = numbered.n
    FROM numbered WHERE e.id = numbered.id;
    counters := counters || jsonb_build_object(
      'S',
      coalesce((SELECT max(issue_number) FROM project_user_stories WHERE project_id = proj.id), 0)
    );

    WITH numbered AS (
      SELECT id, row_number() OVER (ORDER BY created_at ASC, id ASC) AS n
      FROM project_milestones WHERE project_id = proj.id AND issue_number IS NULL
    )
    UPDATE project_milestones e
    SET issue_key_type = 'M', issue_number = numbered.n
    FROM numbered WHERE e.id = numbered.id;
    counters := counters || jsonb_build_object(
      'M',
      coalesce((SELECT max(issue_number) FROM project_milestones WHERE project_id = proj.id), 0)
    );

    WITH numbered AS (
      SELECT id, row_number() OVER (ORDER BY created_at ASC, id ASC) AS n
      FROM project_tasks WHERE project_id = proj.id AND issue_number IS NULL
    )
    UPDATE project_tasks e
    SET issue_key_type = 'T', issue_number = numbered.n
    FROM numbered WHERE e.id = numbered.id;
    counters := counters || jsonb_build_object(
      'T',
      coalesce((SELECT max(issue_number) FROM project_tasks WHERE project_id = proj.id), 0)
    );

    WITH numbered AS (
      SELECT id, row_number() OVER (ORDER BY created_at ASC, id ASC) AS n
      FROM project_change_items WHERE project_id = proj.id AND issue_number IS NULL
    )
    UPDATE project_change_items e
    SET issue_key_type = 'C', issue_number = numbered.n
    FROM numbered WHERE e.id = numbered.id;
    counters := counters || jsonb_build_object(
      'C',
      coalesce((SELECT max(issue_number) FROM project_change_items WHERE project_id = proj.id), 0)
    );

    WITH numbered AS (
      SELECT id,
        CASE kind
          WHEN 'risk' THEN 'RR'
          WHEN 'issue' THEN 'RI'
          WHEN 'assumption' THEN 'RA'
          WHEN 'dependency' THEN 'RD'
          ELSE 'RR'
        END AS ktype,
        row_number() OVER (
          PARTITION BY CASE kind
            WHEN 'risk' THEN 'RR'
            WHEN 'issue' THEN 'RI'
            WHEN 'assumption' THEN 'RA'
            WHEN 'dependency' THEN 'RD'
            ELSE 'RR'
          END
          ORDER BY created_at ASC, id ASC
        ) AS n
      FROM project_raid_items
      WHERE project_id = proj.id AND issue_number IS NULL
    )
    UPDATE project_raid_items e
    SET issue_key_type = numbered.ktype, issue_number = numbered.n
    FROM numbered WHERE e.id = numbered.id;

    counters := counters
      || jsonb_build_object('RR', coalesce((SELECT max(issue_number) FROM project_raid_items WHERE project_id = proj.id AND issue_key_type = 'RR'), 0))
      || jsonb_build_object('RI', coalesce((SELECT max(issue_number) FROM project_raid_items WHERE project_id = proj.id AND issue_key_type = 'RI'), 0))
      || jsonb_build_object('RA', coalesce((SELECT max(issue_number) FROM project_raid_items WHERE project_id = proj.id AND issue_key_type = 'RA'), 0))
      || jsonb_build_object('RD', coalesce((SELECT max(issue_number) FROM project_raid_items WHERE project_id = proj.id AND issue_key_type = 'RD'), 0));

    UPDATE projects SET issue_counters = counters WHERE id = proj.id;
  END LOOP;
END $$;
