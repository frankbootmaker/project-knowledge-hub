-- Nullable created_by so purge can hard-delete rows a system user created.
-- Existing rows stay null and are never treated as system-owned.
DO $$
DECLARE
  spec record;
BEGIN
  FOR spec IN
    SELECT *
    FROM (
      VALUES
        ('systems', 'systems_created_by_users_id_fk', 'systems_created_by_idx'),
        ('tags', 'tags_created_by_users_id_fk', 'tags_created_by_idx'),
        (
          'project_milestones',
          'project_milestones_created_by_users_id_fk',
          'project_milestones_created_by_idx'
        ),
        (
          'project_epics',
          'project_epics_created_by_users_id_fk',
          'project_epics_created_by_idx'
        ),
        (
          'project_user_stories',
          'project_user_stories_created_by_users_id_fk',
          'project_user_stories_created_by_idx'
        ),
        (
          'project_sprints',
          'project_sprints_created_by_users_id_fk',
          'project_sprints_created_by_idx'
        ),
        (
          'project_raid_items',
          'project_raid_items_created_by_users_id_fk',
          'project_raid_items_created_by_idx'
        ),
        (
          'project_change_items',
          'project_change_items_created_by_users_id_fk',
          'project_change_items_created_by_idx'
        ),
        (
          'project_stakeholders',
          'project_stakeholders_created_by_users_id_fk',
          'project_stakeholders_created_by_idx'
        ),
        (
          'project_task_raci',
          'project_task_raci_created_by_users_id_fk',
          'project_task_raci_created_by_idx'
        ),
        (
          'project_raid_task_links',
          'project_raid_task_links_created_by_users_id_fk',
          'project_raid_task_links_created_by_idx'
        ),
        (
          'knowledge_record_delivery_links',
          'knowledge_record_delivery_links_created_by_users_id_fk',
          'knowledge_record_delivery_links_created_by_idx'
        ),
        (
          'project_change_delivery_links',
          'project_change_delivery_links_created_by_users_id_fk',
          'project_change_delivery_links_created_by_idx'
        ),
        (
          'project_initial_stakeholders',
          'project_initial_stakeholders_created_by_users_id_fk',
          'project_initial_stakeholders_created_by_idx'
        )
    ) AS t(table_name, constraint_name, index_name)
  LOOP
    EXECUTE format(
      'ALTER TABLE %I ADD COLUMN IF NOT EXISTS created_by uuid',
      spec.table_name
    );
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = spec.constraint_name
    ) THEN
      EXECUTE format(
        'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL',
        spec.table_name,
        spec.constraint_name
      );
    END IF;
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON %I (created_by)',
      spec.index_name,
      spec.table_name
    );
  END LOOP;
END $$;
