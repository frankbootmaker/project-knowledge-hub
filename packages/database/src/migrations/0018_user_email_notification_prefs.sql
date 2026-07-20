ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "email_notification_prefs" jsonb DEFAULT '{}'::jsonb NOT NULL;
