CREATE TABLE IF NOT EXISTS "ai_model_prices" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid,
  "model" text NOT NULL,
  "input_per_million" numeric(14, 6) NOT NULL,
  "cache_write_per_million" numeric(14, 6) NOT NULL,
  "cache_read_per_million" numeric(14, 6) NOT NULL,
  "output_per_million" numeric(14, 6) NOT NULL,
  "currency" text NOT NULL,
  "effective_from" date NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "ai_model_prices"
    ADD CONSTRAINT "ai_model_prices_workspace_id_workspaces_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "ai_model_prices"
    ADD CONSTRAINT "ai_model_prices_currency_chk"
    CHECK (char_length("currency") = 3);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "ai_model_prices"
    ADD CONSTRAINT "ai_model_prices_nonneg_chk"
    CHECK (
      "input_per_million" >= 0
      AND "cache_write_per_million" >= 0
      AND "cache_read_per_million" >= 0
      AND "output_per_million" >= 0
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "ai_model_prices_scope_uidx"
  ON "ai_model_prices" (
    coalesce("workspace_id", '00000000-0000-0000-0000-000000000000'::uuid),
    "model",
    "effective_from"
  );
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "ai_model_prices_workspace_idx"
  ON "ai_model_prices" ("workspace_id");
--> statement-breakpoint

INSERT INTO "ai_model_prices" (
  "workspace_id",
  "model",
  "input_per_million",
  "cache_write_per_million",
  "cache_read_per_million",
  "output_per_million",
  "currency",
  "effective_from"
)
SELECT NULL, v.model, v.input_per_million, v.cache_write_per_million,
       v.cache_read_per_million, v.output_per_million, 'USD', DATE '2026-01-01'
FROM (VALUES
  ('composer*', 1.25, 1.25, 0.125, 10),
  ('claude*haiku*', 1, 1.25, 0.1, 5),
  ('claude*opus*', 15, 18.75, 1.5, 75),
  ('claude*sonnet*', 3, 3.75, 0.3, 15),
  ('claude*', 3, 3.75, 0.3, 15),
  ('gpt*mini*', 0.4, 0, 0.1, 1.6),
  ('gpt-4o*', 2.5, 0, 1.25, 10),
  ('gpt*', 2.5, 0, 1.25, 10),
  ('grok*', 3, 3.75, 0.75, 15),
  ('gemini*flash*', 0.3, 0, 0.03, 2.5),
  ('gemini*', 1.25, 0, 0.125, 10)
) AS v(model, input_per_million, cache_write_per_million, cache_read_per_million, output_per_million)
WHERE NOT EXISTS (
  SELECT 1 FROM "ai_model_prices" existing
  WHERE existing."workspace_id" IS NULL AND existing."model" = v.model
);
