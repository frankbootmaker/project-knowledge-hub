-- PRO-T-108: service_period_end is the exclusive renewal date (not included).
-- Days covered are end minus start. A one-day window has end = start + 1 day.
--
-- 0069 left no separate marker. It derived both dates from period for every
-- row whose service window was null:
--   start = (period || '-01')::date
--   end   = (that date + 1 month - 1 day)   -- last day of the same month
-- That is a full calendar month stored with the old inclusive end. Only
-- those rows move: end becomes start + 1 month, the first day of the next
-- month. Exclusive [1st, 1st of next month) is that same calendar month, so
-- the paid total does not change.
--   2026-10-01 .. 2026-10-31 becomes 2026-10-01 .. 2026-11-01
--   2024-02-01 .. 2024-02-29 becomes 2024-02-01 .. 2024-03-01
--   2026-12-01 .. 2026-12-31 becomes 2026-12-01 .. 2027-01-01
-- A row someone typed as the 1st through the last day of period matches the
-- same predicate. 0069 wrote nothing else we can key on.
--
-- Rows entered from provider invoices already use renewal-date semantics.
-- The end is the next billing day, not the last billed day. Those dates
-- stay as stored. Cursor Ultimate 2026-10-06 .. 2026-11-06 is unchanged and
-- splits 26/31 in October and 5/31 in November.
--
-- Same-day rows (end = start) were one inclusive day under the old check
-- (end >= start). An exclusive end equal to the start is zero days, and the
-- order check below requires end > start. Leaving them unchanged would make
-- that check fail. Only those rows move forward one day, including a
-- same-day window on the last day of a month (2026-10-31 .. 2026-10-31
-- becomes 2026-10-31 .. 2026-11-01, still that one October day). A one-day
-- invoice that already has end = start + 1 is not a same-day row and is
-- left alone. Every other row whose end is already after the start is left
-- unchanged. Null windows are unchanged.
UPDATE "ai_billing_entries"
SET "service_period_end" = ("service_period_start" + interval '1 month')::date
WHERE "service_period_start" IS NOT NULL
  AND "service_period_end" IS NOT NULL
  AND "period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
  AND "service_period_start" = ("period" || '-01')::date
  AND "service_period_end" = (
    (("period" || '-01')::date + interval '1 month') - interval '1 day'
  )::date;
--> statement-breakpoint

UPDATE "ai_billing_entries"
SET "service_period_end" = ("service_period_end" + interval '1 day')::date
WHERE "service_period_start" IS NOT NULL
  AND "service_period_end" = "service_period_start";
--> statement-breakpoint

ALTER TABLE "ai_billing_entries"
  DROP CONSTRAINT IF EXISTS "ai_billing_entries_service_period_order";
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "ai_billing_entries"
    ADD CONSTRAINT "ai_billing_entries_service_period_order"
    CHECK (
      "service_period_end" IS NULL
      OR "service_period_end" > "service_period_start"
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

COMMENT ON COLUMN "ai_billing_entries"."service_period_start" IS
  'Inclusive first day of the paid service window. Null keeps the whole amount in period. period is this date''s month.';
--> statement-breakpoint

COMMENT ON COLUMN "ai_billing_entries"."service_period_end" IS
  'Exclusive renewal date (not included). Days are end minus start. A one-day entry has end = start + 1 day. Null together with the start.';
