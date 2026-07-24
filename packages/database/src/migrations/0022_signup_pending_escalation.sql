ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "signup_pending_escalated_at" timestamp with time zone;
