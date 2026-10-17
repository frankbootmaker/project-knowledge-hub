ALTER TABLE "ai_billing_entries"
  ADD COLUMN IF NOT EXISTS "service_period_start" date;
--> statement-breakpoint

ALTER TABLE "ai_billing_entries"
  ADD COLUMN IF NOT EXISTS "service_period_end" date;
--> statement-breakpoint

UPDATE "ai_billing_entries"
SET
  "service_period_start" = ("period" || '-01')::date,
  "service_period_end" = (
    (("period" || '-01')::date + interval '1 month') - interval '1 day'
  )::date
WHERE "service_period_start" IS NULL
  AND "service_period_end" IS NULL
  AND "period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$';
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "ai_billing_entries"
    ADD CONSTRAINT "ai_billing_entries_service_period_pair"
    CHECK (
      ("service_period_start" IS NULL) = ("service_period_end" IS NULL)
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "ai_billing_entries"
    ADD CONSTRAINT "ai_billing_entries_service_period_order"
    CHECK (
      "service_period_end" IS NULL
      OR "service_period_end" >= "service_period_start"
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "ai_billing_entries"
    ADD CONSTRAINT "ai_billing_entries_service_period_month"
    CHECK (
      "service_period_start" IS NULL
      OR "period" = to_char("service_period_start", 'YYYY-MM')
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

COMMENT ON COLUMN "ai_billing_entries"."service_period_start" IS
  'Inclusive first day of the paid service window. Null keeps the whole amount in period. period is this date''s month.';
--> statement-breakpoint

COMMENT ON COLUMN "ai_billing_entries"."service_period_end" IS
  'Inclusive last day of the paid service window. The amount is split across months by days.';
