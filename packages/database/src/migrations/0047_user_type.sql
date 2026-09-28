-- Add user_type column with default 'human' and constraint
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "user_type" text DEFAULT 'human' NOT NULL;
--> statement-breakpoint
ALTER TABLE "users"
  ADD CONSTRAINT "users_user_type_check"
    CHECK ("user_type" IN ('human', 'system'));
