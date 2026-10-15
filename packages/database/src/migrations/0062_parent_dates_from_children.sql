-- Backfill story, epic, and milestone dates from included children.
-- Start is the earliest child start. End is the latest child end.
-- Cancelled children are excluded. A side with no child date is left unchanged.
-- Stories and epics skip archived children. Milestone task links include archived
-- tasks, matching milestone completion. Safe to run again.

WITH included AS (
  SELECT user_story_id, start_date, due_date AS end_date
  FROM project_tasks
  WHERE archived_at IS NULL
    AND user_story_id IS NOT NULL
    AND status <> 'cancelled'
),
agg AS (
  SELECT
    user_story_id,
    MIN(start_date) AS start_date,
    MAX(end_date) AS end_date
  FROM included
  GROUP BY user_story_id
)
UPDATE project_user_stories AS story
SET
  start_date = CASE
    WHEN agg.start_date IS NOT NULL THEN agg.start_date
    ELSE story.start_date
  END,
  end_date = CASE
    WHEN agg.end_date IS NOT NULL THEN agg.end_date
    ELSE story.end_date
  END,
  updated_at = now()
FROM agg
WHERE story.id = agg.user_story_id
  AND (
    (agg.start_date IS NOT NULL AND story.start_date IS DISTINCT FROM agg.start_date)
    OR (agg.end_date IS NOT NULL AND story.end_date IS DISTINCT FROM agg.end_date)
  );
--> statement-breakpoint
WITH included AS (
  SELECT epic_id, start_date, end_date
  FROM project_user_stories
  WHERE archived_at IS NULL
    AND status <> 'cancelled'
),
agg AS (
  SELECT epic_id, MIN(start_date) AS start_date, MAX(end_date) AS end_date
  FROM included
  GROUP BY epic_id
)
UPDATE project_epics AS epic
SET
  start_date = CASE
    WHEN agg.start_date IS NOT NULL THEN agg.start_date
    ELSE epic.start_date
  END,
  end_date = CASE
    WHEN agg.end_date IS NOT NULL THEN agg.end_date
    ELSE epic.end_date
  END,
  updated_at = now()
FROM agg
WHERE epic.id = agg.epic_id
  AND (
    (agg.start_date IS NOT NULL AND epic.start_date IS DISTINCT FROM agg.start_date)
    OR (agg.end_date IS NOT NULL AND epic.end_date IS DISTINCT FROM agg.end_date)
  );
--> statement-breakpoint
WITH link_dates AS (
  SELECT link.milestone_id, task.start_date, task.due_date AS end_date
  FROM project_milestone_item_links AS link
  JOIN project_tasks AS task
    ON link.entity_type = 'task' AND task.id = link.entity_id
  WHERE task.status <> 'cancelled'
  UNION ALL
  SELECT link.milestone_id, story.start_date, story.end_date
  FROM project_milestone_item_links AS link
  JOIN project_user_stories AS story
    ON link.entity_type = 'user_story' AND story.id = link.entity_id
  WHERE story.status <> 'cancelled'
  UNION ALL
  SELECT link.milestone_id, epic.start_date, epic.end_date
  FROM project_milestone_item_links AS link
  JOIN project_epics AS epic
    ON link.entity_type = 'epic' AND epic.id = link.entity_id
  WHERE epic.status <> 'cancelled'
),
agg AS (
  SELECT
    milestone_id,
    MIN(start_date) AS start_date,
    MAX(end_date) AS end_date
  FROM link_dates
  GROUP BY milestone_id
)
UPDATE project_milestones AS milestone
SET
  start_date = CASE
    WHEN agg.start_date IS NOT NULL THEN agg.start_date
    ELSE milestone.start_date
  END,
  target_date = CASE
    WHEN agg.end_date IS NOT NULL THEN agg.end_date
    ELSE milestone.target_date
  END,
  updated_at = now()
FROM agg
WHERE milestone.id = agg.milestone_id
  AND (
    (agg.start_date IS NOT NULL AND milestone.start_date IS DISTINCT FROM agg.start_date)
    OR (agg.end_date IS NOT NULL AND milestone.target_date IS DISTINCT FROM agg.end_date)
  );
