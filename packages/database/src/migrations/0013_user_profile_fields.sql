ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "full_name" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "idp_source" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "idp_subject" text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "users_idp_source_subject_uidx" ON "users" USING btree ("idp_source","idp_subject");
