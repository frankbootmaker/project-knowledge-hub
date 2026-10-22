-- PRO-T-124. One-off copy of filled per-system per-1k token rates into
-- workspace catalog overrides (per 1,000,000 tokens). Mirrors
-- planSystemRateCatalogMigration. Idempotent: an active workspace pattern,
-- or a row already stored for 1970-01-01, is left alone.
-- A null split rate is stored as the blended rate. Currency stays on the
-- system, else the linked project, else USD.

WITH filled AS (
  SELECT
    s.id AS system_id,
    s.workspace_id,
    s.name AS system_name,
    w.organization_id,
    CASE
      WHEN upper(btrim(s.ai_token_rate_currency)) ~ '^[A-Z]{3}$'
        THEN upper(btrim(s.ai_token_rate_currency))
      WHEN upper(btrim(p.currency)) ~ '^[A-Z]{3}$'
        THEN upper(btrim(p.currency))
      ELSE 'USD'
    END AS currency,
    COALESCE(s.ai_token_rate_input_per_1k, s.ai_token_rate_per_1k, 0) AS input_per_1k,
    COALESCE(s.ai_token_rate_output_per_1k, s.ai_token_rate_per_1k, 0) AS output_per_1k,
    COALESCE(s.ai_token_rate_cache_per_1k, s.ai_token_rate_per_1k, 0) AS cache_per_1k,
    COALESCE(s.ai_token_rate_cache_write_per_1k, s.ai_token_rate_per_1k, 0) AS cache_write_per_1k,
    COALESCE(s.ai_token_rate_per_1k, 0) AS blended_stored
  FROM systems s
  JOIN workspaces w ON w.id = s.workspace_id
  LEFT JOIN projects p ON p.id = s.project_id
  WHERE s.archived_at IS NULL
    AND (
      s.ai_token_rate_per_1k IS NOT NULL
      OR s.ai_token_rate_input_per_1k IS NOT NULL
      OR s.ai_token_rate_output_per_1k IS NOT NULL
      OR s.ai_token_rate_cache_per_1k IS NOT NULL
      OR s.ai_token_rate_cache_write_per_1k IS NOT NULL
    )
),
task_models AS (
  SELECT
    f.system_id,
    f.workspace_id,
    f.system_name,
    f.organization_id,
    f.currency,
    f.input_per_1k,
    f.output_per_1k,
    f.cache_per_1k,
    f.cache_write_per_1k,
    f.blended_stored,
    btrim(t.ai_model_id) AS model,
    CASE
      WHEN t.tokens_input IS NOT NULL
        OR t.tokens_output IS NOT NULL
        OR t.tokens_cache IS NOT NULL
        OR t.tokens_cache_write IS NOT NULL
      THEN COALESCE(
        t.tokens_used,
        COALESCE(t.tokens_input, 0)
          + COALESCE(t.tokens_output, 0)
          + COALESCE(t.tokens_cache, 0)
          + COALESCE(t.tokens_cache_write, 0)
      )
      ELSE COALESCE(t.tokens_used, 0)
    END AS tokens
  FROM filled f
  JOIN project_tasks t ON t.ai_system_id = f.system_id
  WHERE t.archived_at IS NULL
    AND t.status IS DISTINCT FROM 'cancelled'
    AND t.ai_model_id IS NOT NULL
    AND char_length(btrim(t.ai_model_id)) BETWEEN 1 AND 80
    AND position(E'\n' IN t.ai_model_id) = 0
    AND position(E'\r' IN t.ai_model_id) = 0
),
model_totals AS (
  SELECT
    system_id,
    workspace_id,
    system_name,
    organization_id,
    currency,
    input_per_1k,
    output_per_1k,
    cache_per_1k,
    cache_write_per_1k,
    blended_stored,
    lower(model) AS model_key,
    (array_agg(model ORDER BY char_length(model) DESC, model))[1] AS model,
    SUM(GREATEST(tokens, 0))::bigint AS tokens
  FROM task_models
  GROUP BY
    system_id,
    workspace_id,
    system_name,
    organization_id,
    currency,
    input_per_1k,
    output_per_1k,
    cache_per_1k,
    cache_write_per_1k,
    blended_stored,
    lower(model)
),
ranked AS (
  SELECT
    model_totals.*,
    row_number() OVER (
      PARTITION BY workspace_id, model_key
      ORDER BY tokens DESC, system_id
    ) AS rn
  FROM model_totals
),
winners AS (
  SELECT * FROM ranked WHERE rn = 1
),
modeless AS (
  SELECT filled.*
  FROM filled
  WHERE NOT EXISTS (
    SELECT 1 FROM task_models
    WHERE task_models.system_id = filled.system_id
  )
),
star_ok AS (
  SELECT DISTINCT ON (workspace_id)
    workspace_id,
    system_id,
    system_name,
    organization_id,
    currency,
    input_per_1k,
    output_per_1k,
    cache_per_1k,
    cache_write_per_1k,
    blended_stored,
    '*' AS model
  FROM modeless
  WHERE NOT EXISTS (
    SELECT 1
    FROM modeless other
    WHERE other.workspace_id = modeless.workspace_id
      AND (
        other.currency IS DISTINCT FROM modeless.currency
        OR other.input_per_1k IS DISTINCT FROM modeless.input_per_1k
        OR other.output_per_1k IS DISTINCT FROM modeless.output_per_1k
        OR other.cache_per_1k IS DISTINCT FROM modeless.cache_per_1k
        OR other.cache_write_per_1k IS DISTINCT FROM modeless.cache_write_per_1k
        OR other.blended_stored IS DISTINCT FROM modeless.blended_stored
      )
  )
  ORDER BY workspace_id, system_id
),
planned AS (
  SELECT
    workspace_id,
    system_id,
    system_name,
    organization_id,
    currency,
    input_per_1k,
    output_per_1k,
    cache_per_1k,
    cache_write_per_1k,
    blended_stored,
    model
  FROM winners
  UNION ALL
  SELECT
    workspace_id,
    system_id,
    system_name,
    organization_id,
    currency,
    input_per_1k,
    output_per_1k,
    cache_per_1k,
    cache_write_per_1k,
    blended_stored,
    model
  FROM star_ok
  WHERE NOT EXISTS (
    SELECT 1
    FROM winners
    WHERE winners.workspace_id = star_ok.workspace_id
      AND winners.model_key = '*'
  )
),
inserted AS (
  INSERT INTO ai_model_prices (
    workspace_id,
    model,
    input_per_million,
    output_per_million,
    cache_read_per_million,
    cache_write_per_million,
    blended_per_million,
    currency,
    effective_from,
    source_note
  )
  SELECT
    planned.workspace_id,
    planned.model,
    round(planned.input_per_1k * 1000, 6),
    round(planned.output_per_1k * 1000, 6),
    round(planned.cache_per_1k * 1000, 6),
    round(planned.cache_write_per_1k * 1000, 6),
    round(planned.blended_stored * 1000, 6),
    planned.currency,
    DATE '1970-01-01',
    left(
      'Migrated from system token rates (per 1,000 tokens) for '
        || planned.system_name
        || '.',
      500
    )
  FROM planned
  WHERE NOT EXISTS (
    SELECT 1
    FROM ai_model_prices existing
    WHERE existing.workspace_id = planned.workspace_id
      AND lower(existing.model) = lower(planned.model)
      AND (
        existing.retired_at IS NULL
        OR existing.effective_from = DATE '1970-01-01'
      )
  )
  RETURNING
    id,
    workspace_id,
    model,
    currency,
    effective_from,
    input_per_million,
    output_per_million,
    cache_read_per_million,
    cache_write_per_million,
    blended_per_million
)
INSERT INTO audit_events (
  organization_id,
  actor_type,
  actor_id,
  action,
  entity_type,
  entity_id,
  metadata_json
)
SELECT
  planned.organization_id,
  'system',
  NULL,
  'ai_model_price.migrated_from_system_rate',
  'ai_model_price',
  inserted.id::text,
  jsonb_build_object(
    'scope', 'workspace',
    'workspaceId', inserted.workspace_id,
    'systemId', planned.system_id,
    'model', inserted.model,
    'currency', inserted.currency,
    'unit', 'per_1m_tokens',
    'via', 'migration',
    'migration', '0080_migrate_system_token_rates',
    'effectiveFrom', inserted.effective_from,
    'per1m', jsonb_build_object(
      'input', inserted.input_per_million,
      'output', inserted.output_per_million,
      'cacheRead', inserted.cache_read_per_million,
      'cacheWrite', inserted.cache_write_per_million,
      'blended', inserted.blended_per_million
    )
  )
FROM inserted
JOIN planned
  ON planned.workspace_id = inserted.workspace_id
 AND planned.model = inserted.model;
--> statement-breakpoint

COMMENT ON COLUMN systems.ai_token_rate_per_1k IS
  'Retired. Migration 0080 copied filled rates into ai_model_prices. Not used to price usage.';
--> statement-breakpoint

COMMENT ON COLUMN systems.ai_token_rate_input_per_1k IS
  'Retired. Migration 0080 copied filled rates into ai_model_prices. Not used to price usage.';
--> statement-breakpoint

COMMENT ON COLUMN systems.ai_token_rate_output_per_1k IS
  'Retired. Migration 0080 copied filled rates into ai_model_prices. Not used to price usage.';
--> statement-breakpoint

COMMENT ON COLUMN systems.ai_token_rate_cache_per_1k IS
  'Retired. Migration 0080 copied filled rates into ai_model_prices. Not used to price usage.';
--> statement-breakpoint

COMMENT ON COLUMN systems.ai_token_rate_cache_write_per_1k IS
  'Retired. Migration 0080 copied filled rates into ai_model_prices. Not used to price usage.';
--> statement-breakpoint

COMMENT ON COLUMN systems.ai_token_rate_currency IS
  'Retired currency of the per-1k system rates. Pricing uses ai_model_prices.currency.';
