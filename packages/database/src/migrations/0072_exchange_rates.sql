ALTER TABLE "workspaces"
  ADD COLUMN IF NOT EXISTS "reporting_currency" text DEFAULT 'EUR' NOT NULL;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "workspaces"
    ADD CONSTRAINT "workspaces_reporting_currency_len"
    CHECK (char_length("reporting_currency") = 3);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "exchange_rates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "rate_date" date NOT NULL,
  "base" text NOT NULL,
  "quote" text NOT NULL,
  "rate" numeric(18, 8) NOT NULL,
  "source" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "exchange_rates"
    ADD CONSTRAINT "exchange_rates_rate_pos"
    CHECK ("rate" > 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "exchange_rates"
    ADD CONSTRAINT "exchange_rates_source_chk"
    CHECK ("source" IN ('ecb', 'mnb', 'manual'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "exchange_rates_pair_uidx"
  ON "exchange_rates" ("rate_date", "base", "quote", "source");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "exchange_rates_pair_date_idx"
  ON "exchange_rates" ("base", "quote", "rate_date");
