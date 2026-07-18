CREATE TABLE "knowledge_record_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"knowledge_record_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"title" text NOT NULL,
	"summary" text,
	"record_type" text NOT NULL,
	"lifecycle_status" text NOT NULL,
	"content_markdown" text NOT NULL,
	"metadata_json" jsonb,
	"change_message" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "knowledge_record_versions" ADD CONSTRAINT "knowledge_record_versions_knowledge_record_id_knowledge_records_id_fk" FOREIGN KEY ("knowledge_record_id") REFERENCES "public"."knowledge_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_record_versions" ADD CONSTRAINT "knowledge_record_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_record_versions_record_version_uidx" ON "knowledge_record_versions" USING btree ("knowledge_record_id","version_number");--> statement-breakpoint
CREATE INDEX "knowledge_record_versions_record_id_idx" ON "knowledge_record_versions" USING btree ("knowledge_record_id");