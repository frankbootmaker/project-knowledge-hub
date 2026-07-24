ALTER TABLE "conversation_imports"
  ADD COLUMN IF NOT EXISTS "content_warnings" jsonb;
