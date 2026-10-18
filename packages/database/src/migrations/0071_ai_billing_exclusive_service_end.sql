-- PRO-T-108: service_period_end is the exclusive renewal date (not included).
-- Days covered are end minus start. A one-day window has end = start + 1 day.
--
-- Before this migration the column was the inclusive last day of service.
-- Migration 0069 backfilled a null window as the first and last day of
-- period, and the form, API, and MCP stored the same inclusive end.
-- Month totals stay the same only when each stored end moves forward one
-- calendar day: exclusive [start, inclusive_end + 1 day) is the same set of
-- days as inclusive [start, inclusive_end].
--
-- Patterns reviewed:
-- 1. Month-end ends, including the 0069 backfill (start = the first of the
--    month, end = the last day of that month). The end becomes the first
--    day of the next month. 2026-10-01 .. 2026-10-31 becomes
--    2026-10-01 .. 2026-11-01, and October still receives the whole amount.
--    Leap day 2024-02-29 becomes 2024-03-01. 2026-12-31 becomes 2027-01-01.
-- 2. Every other inclusive end, including a mid-month end, a same-day
--    window, and a cross-month span such as 2026-10-06 .. 2026-11-06.
--    The end moves one day later (2026-11-07). The day that used to be the
--    inclusive end stays inside the window, so each month's share is
--    unchanged. Shifting only month-end rows would drop that last day from
--    cross-month invoices and move money between months.
-- 3. A same-day window on the last day of a month
--    (2026-10-31 .. 2026-10-31) becomes 2026-10-31 .. 2026-11-01, which is
--    still that one October day.
-- 4. Rows with a null service window are left alone. Their amount stays
--    in period.
--
-- Every existing row was stored with inclusive semantics, so this update
-- shifts every non-null end once. It does not try to detect a row that was
-- already exclusive. After the shift, end is after start, and the order
-- check changes from >= to >.
UPDATE "ai_billing_entries"
SET "service_period_end" = ("service_period_end" + interval '1 day')::date
WHERE "service_period_end" IS NOT NULL;
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
