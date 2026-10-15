-- Backfill story, epic, and milestone status from included children.
-- Mirrors derivedParentStatus: cancelled children are excluded, all done is
-- done, a non-done blocked child is blocked, progress or a started child is
-- in progress, and nothing started is planned. A parent with no included
-- children keeps its stored status. Safe to run again.

WITH included AS (
  SELECT
    user_story_id,
    status,
    CASE
      WHEN status = 'done' THEN 100
      ELSE COALESCE(completion_percent, 0)
    END AS points
  FROM project_tasks
  WHERE archived_at IS NULL
    AND user_story_id IS NOT NULL
    AND status <> 'cancelled'
),
agg AS (
  SELECT
    user_story_id,
    COUNT(*) AS total,
    COUNT(*) FILTER (WHERE status = 'done' OR points = 100) AS done_count,
    COUNT(*) FILTER (WHERE status = 'blocked' AND points < 100) AS blocked_count,
    ROUND(AVG(points))::int AS percent,
    COUNT(*) FILTER (
      WHERE points > 0 OR status NOT IN ('todo', 'planned')
    ) AS started_count
  FROM included
  GROUP BY user_story_id
),
derived AS (
  SELECT
    user_story_id,
    CASE
      WHEN done_count = total THEN 'done'
      WHEN blocked_count > 0 THEN 'blocked'
      WHEN percent > 0 OR started_count > 0 THEN 'in_progress'
      ELSE 'planned'
    END AS status
  FROM agg
)
UPDATE project_user_stories AS story
SET status = derived.status,
    updated_at = now()
FROM derived
WHERE story.id = derived.user_story_id
  AND story.status IS DISTINCT FROM derived.status;
--> statement-breakpoint
WITH included AS (
  SELECT
    story.epic_id,
    task.status,
    CASE
      WHEN task.status = 'done' THEN 100
      ELSE COALESCE(task.completion_percent, 0)
    END AS points
  FROM project_tasks AS task
  JOIN project_user_stories AS story ON story.id = task.user_story_id
  WHERE task.archived_at IS NULL
    AND task.status <> 'cancelled'
),
agg AS (
  SELECT
    epic_id,
    COUNT(*) AS total,
    COUNT(*) FILTER (WHERE status = 'done' OR points = 100) AS done_count,
    COUNT(*) FILTER (WHERE status = 'blocked' AND points < 100) AS blocked_count,
    ROUND(AVG(points))::int AS percent,
    COUNT(*) FILTER (
      WHERE points > 0 OR status NOT IN ('todo', 'planned')
    ) AS started_count
  FROM included
  GROUP BY epic_id
),
derived AS (
  SELECT
    epic_id,
    CASE
      WHEN done_count = total THEN 'done'
      WHEN blocked_count > 0 THEN 'blocked'
      WHEN percent > 0 OR started_count > 0 THEN 'in_progress'
      ELSE 'planned'
    END AS status
  FROM agg
)
UPDATE project_epics AS epic
SET status = derived.status,
    updated_at = now()
FROM derived
WHERE epic.id = derived.epic_id
  AND epic.status IS DISTINCT FROM derived.status;
--> statement-breakpoint
WITH story_rollup AS (
  SELECT
    user_story_id AS id,
    ROUND(AVG(
      CASE
        WHEN status = 'done' THEN 100
        ELSE COALESCE(completion_percent, 0)
      END
    ))::int AS percent
  FROM project_tasks
  WHERE archived_at IS NULL
    AND user_story_id IS NOT NULL
    AND status <> 'cancelled'
  GROUP BY user_story_id
),
epic_rollup AS (
  SELECT
    story.epic_id AS id,
    ROUND(AVG(
      CASE
        WHEN task.status = 'done' THEN 100
        ELSE COALESCE(task.completion_percent, 0)
      END
    ))::int AS percent
  FROM project_tasks AS task
  JOIN project_user_stories AS story ON story.id = task.user_story_id
  WHERE task.archived_at IS NULL
    AND task.status <> 'cancelled'
  GROUP BY story.epic_id
),
link_points AS (
  SELECT
    link.milestone_id,
    task.status,
    CASE
      WHEN task.status = 'cancelled' THEN NULL
      WHEN task.status = 'done' THEN 100
      ELSE COALESCE(task.completion_percent, 0)
    END AS points
  FROM project_milestone_item_links AS link
  JOIN project_tasks AS task
    ON link.entity_type = 'task' AND task.id = link.entity_id
  UNION ALL
  SELECT
    link.milestone_id,
    story.status,
    CASE
      WHEN story.status = 'cancelled' THEN NULL
      WHEN story.status = 'done' THEN 100
      ELSE rollup.percent
    END AS points
  FROM project_milestone_item_links AS link
  JOIN project_user_stories AS story
    ON link.entity_type = 'user_story' AND story.id = link.entity_id
  LEFT JOIN story_rollup AS rollup ON rollup.id = story.id
  UNION ALL
  SELECT
    link.milestone_id,
    epic.status,
    CASE
      WHEN epic.status = 'cancelled' THEN NULL
      WHEN epic.status = 'done' THEN 100
      ELSE rollup.percent
    END AS points
  FROM project_milestone_item_links AS link
  JOIN project_epics AS epic
    ON link.entity_type = 'epic' AND epic.id = link.entity_id
  LEFT JOIN epic_rollup AS rollup ON rollup.id = epic.id
),
included AS (
  SELECT milestone_id, status, points
  FROM link_points
  WHERE points IS NOT NULL
),
agg AS (
  SELECT
    milestone_id,
    COUNT(*) AS total,
    COUNT(*) FILTER (WHERE status = 'done' OR points = 100) AS done_count,
    COUNT(*) FILTER (WHERE status = 'blocked' AND points < 100) AS blocked_count,
    ROUND(AVG(points))::int AS percent,
    COUNT(*) FILTER (
      WHERE points > 0 OR status NOT IN ('todo', 'planned')
    ) AS started_count
  FROM included
  GROUP BY milestone_id
),
derived AS (
  SELECT
    milestone_id,
    CASE
      WHEN done_count = total THEN 'done'
      WHEN blocked_count > 0 THEN 'blocked'
      WHEN percent > 0 OR started_count > 0 THEN 'in_progress'
      ELSE 'planned'
    END AS status
  FROM agg
)
UPDATE project_milestones AS milestone
SET status = derived.status,
    updated_at = now()
FROM derived
WHERE milestone.id = derived.milestone_id
  AND milestone.status IS DISTINCT FROM derived.status;
