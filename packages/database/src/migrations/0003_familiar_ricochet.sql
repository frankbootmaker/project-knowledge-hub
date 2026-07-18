CREATE TABLE "knowledge_record_tags" (
	"knowledge_record_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid,
	"system_id" uuid,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"summary" text,
	"record_type" text NOT NULL,
	"lifecycle_status" text DEFAULT 'draft' NOT NULL,
	"source_of_truth_mode" text DEFAULT 'hub_managed' NOT NULL,
	"content_markdown" text DEFAULT '' NOT NULL,
	"content_html_cache" text,
	"language" text DEFAULT 'en',
	"metadata_json" jsonb,
	"current_version_number" integer DEFAULT 1 NOT NULL,
	"supersedes_record_id" uuid,
	"created_by" uuid NOT NULL,
	"reviewed_by" uuid,
	"verified_at" timestamp with time zone,
	"last_validated_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"knowledge_record_id" uuid NOT NULL,
	"source_type" text NOT NULL,
	"source_provider" text,
	"source_reference" text,
	"source_title" text,
	"source_uri" text,
	"source_created_at" timestamp with time zone,
	"generated_by_model" text,
	"metadata_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "knowledge_record_tags" ADD CONSTRAINT "knowledge_record_tags_knowledge_record_id_knowledge_records_id_fk" FOREIGN KEY ("knowledge_record_id") REFERENCES "public"."knowledge_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_record_tags" ADD CONSTRAINT "knowledge_record_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_records" ADD CONSTRAINT "knowledge_records_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_records" ADD CONSTRAINT "knowledge_records_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_records" ADD CONSTRAINT "knowledge_records_system_id_systems_id_fk" FOREIGN KEY ("system_id") REFERENCES "public"."systems"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_records" ADD CONSTRAINT "knowledge_records_supersedes_record_id_knowledge_records_id_fk" FOREIGN KEY ("supersedes_record_id") REFERENCES "public"."knowledge_records"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_records" ADD CONSTRAINT "knowledge_records_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_records" ADD CONSTRAINT "knowledge_records_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_sources" ADD CONSTRAINT "knowledge_sources_knowledge_record_id_knowledge_records_id_fk" FOREIGN KEY ("knowledge_record_id") REFERENCES "public"."knowledge_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_record_tags_uidx" ON "knowledge_record_tags" USING btree ("knowledge_record_id","tag_id");--> statement-breakpoint
CREATE INDEX "knowledge_record_tags_tag_id_idx" ON "knowledge_record_tags" USING btree ("tag_id");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_records_workspace_slug_uidx" ON "knowledge_records" USING btree ("workspace_id","slug");--> statement-breakpoint
CREATE INDEX "knowledge_records_workspace_id_idx" ON "knowledge_records" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "knowledge_records_project_id_idx" ON "knowledge_records" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "knowledge_records_system_id_idx" ON "knowledge_records" USING btree ("system_id");--> statement-breakpoint
CREATE INDEX "knowledge_records_lifecycle_status_idx" ON "knowledge_records" USING btree ("lifecycle_status");--> statement-breakpoint
CREATE INDEX "knowledge_sources_record_id_idx" ON "knowledge_sources" USING btree ("knowledge_record_id");