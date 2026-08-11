-- Structured IT inventory details for catalogue systems.
ALTER TABLE "systems"
  ADD COLUMN IF NOT EXISTS "it_details" jsonb DEFAULT '{}'::jsonb NOT NULL;
