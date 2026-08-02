ALTER TABLE "document_imports" ADD COLUMN IF NOT EXISTS "progress_stage" text;
--> statement-breakpoint
ALTER TABLE "document_imports" ADD COLUMN IF NOT EXISTS "progress_message" text;
--> statement-breakpoint
ALTER TABLE "document_imports" ADD COLUMN IF NOT EXISTS "progress_log" text;
