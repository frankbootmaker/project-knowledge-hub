ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "display_prefs" jsonb DEFAULT '{}'::jsonb NOT NULL;
