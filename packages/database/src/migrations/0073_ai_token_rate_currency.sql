-- Token list prices may be in a currency other than the project currency.
-- Null keeps the previous meaning: the project's currency.
ALTER TABLE "systems"
  ADD COLUMN IF NOT EXISTS "ai_token_rate_currency" text;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "systems"
    ADD CONSTRAINT "systems_ai_token_rate_currency_len"
    CHECK (
      "ai_token_rate_currency" IS NULL
      OR char_length("ai_token_rate_currency") = 3
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
