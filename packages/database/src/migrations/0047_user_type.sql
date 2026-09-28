-- User category: human (default) or system. Existing rows become human via the default.
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "user_type" text DEFAULT 'human' NOT NULL;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "users"
    ADD CONSTRAINT "users_user_type_check"
    CHECK ("user_type" IN ('human', 'system'));
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
