ALTER TABLE "ai_model_prices"
  ADD COLUMN IF NOT EXISTS "blended_per_million" numeric(14, 6);
--> statement-breakpoint

ALTER TABLE "ai_model_prices"
  ADD COLUMN IF NOT EXISTS "source_note" text;
--> statement-breakpoint

ALTER TABLE "ai_model_prices"
  ADD COLUMN IF NOT EXISTS "retired_at" timestamp with time zone;
--> statement-breakpoint

UPDATE "ai_model_prices"
SET "blended_per_million" = "input_per_million"
WHERE "blended_per_million" IS NULL;
--> statement-breakpoint

ALTER TABLE "ai_model_prices"
  ALTER COLUMN "blended_per_million" SET NOT NULL;
--> statement-breakpoint

ALTER TABLE "ai_model_prices" DROP CONSTRAINT IF EXISTS "ai_model_prices_nonneg_chk";
--> statement-breakpoint

ALTER TABLE "ai_model_prices"
  ADD CONSTRAINT "ai_model_prices_nonneg_chk"
  CHECK (
    "input_per_million" >= 0
    AND "cache_write_per_million" >= 0
    AND "cache_read_per_million" >= 0
    AND "output_per_million" >= 0
    AND "blended_per_million" >= 0
  );
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "ai_model_prices"
    ADD CONSTRAINT "ai_model_prices_source_note_len_chk"
    CHECK ("source_note" IS NULL OR char_length("source_note") <= 500);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

-- Leading stars so Cursor-prefixed ids (cursor-grok-4.5-high) match the
-- platform default. Skip a rename when the new pattern is already stored.
UPDATE "ai_model_prices" AS row
SET "model" = renamed.model
FROM (VALUES
  ('composer*', '*composer*'),
  ('claude*haiku*', '*claude*haiku*'),
  ('claude*opus*', '*claude*opus*'),
  ('claude*sonnet*', '*claude*sonnet*'),
  ('claude*', '*claude*'),
  ('gpt*mini*', '*gpt*mini*'),
  ('gpt-4o*', '*gpt-4o*'),
  ('gpt*', '*gpt*'),
  ('grok*', '*grok*'),
  ('gemini*flash*', '*gemini*flash*'),
  ('gemini*', '*gemini*')
) AS renamed(old_model, model)
WHERE row."workspace_id" IS NULL
  AND row."model" = renamed.old_model
  AND NOT EXISTS (
    SELECT 1
    FROM "ai_model_prices" AS other
    WHERE other."workspace_id" IS NULL
      AND other."model" = renamed.model
      AND other."effective_from" = row."effective_from"
      AND other."id" <> row."id"
  );
--> statement-breakpoint

UPDATE "ai_model_prices"
SET "source_note" = 'Seeded platform default, effective 2026-01-01. Confirm at the provider price page before editing.'
WHERE "workspace_id" IS NULL
  AND "source_note" IS NULL
  AND "model" IN (
    '*composer*',
    '*claude*haiku*',
    '*claude*opus*',
    '*claude*sonnet*',
    '*claude*',
    '*gpt*mini*',
    '*gpt-4o*',
    '*gpt*',
    '*grok*',
    '*gemini*flash*',
    '*gemini*'
  );
