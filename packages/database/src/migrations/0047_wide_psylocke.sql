CREATE TABLE "ai_pairing_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"token_hash" text,
	"token_prefix" text,
	"scopes" jsonb NOT NULL,
	"allowed_workspace_ids" jsonb NOT NULL,
	"allowed_project_ids" jsonb NOT NULL,
	"acting_user_id" uuid,
	"status" text DEFAULT 'active' NOT NULL,
	"requested_by_user_id" uuid,
	"approved_by_user_id" uuid,
	"approved_at" timestamp with time zone,
	"agent_label" text,
	"claim_secret_hash" text,
	"unclaimed_token" text,
	"token_claimed_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_import_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"import_id" uuid NOT NULL,
	"knowledge_record_id" uuid NOT NULL,
	"excerpt_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid,
	"system_id" uuid,
	"title" text NOT NULL,
	"content_format" text DEFAULT 'markdown' NOT NULL,
	"raw_content" text NOT NULL,
	"content_warnings" jsonb,
	"source_provider" text,
	"generated_by_model" text,
	"created_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_import_media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"import_id" uuid NOT NULL,
	"workspace_media_id" uuid NOT NULL,
	"attachment_index" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_import_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"import_id" uuid NOT NULL,
	"knowledge_record_id" uuid NOT NULL,
	"excerpt_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid,
	"system_id" uuid,
	"title" text NOT NULL,
	"lane" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"ocr_engine" text DEFAULT 'none' NOT NULL,
	"ocr_lang" text DEFAULT 'eng' NOT NULL,
	"original_filename" text NOT NULL,
	"content_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"blob_key" text NOT NULL,
	"converted_markdown" text,
	"content_warnings" jsonb,
	"conversion_error" text,
	"conversion_warnings" jsonb,
	"progress_stage" text,
	"progress_message" text,
	"progress_log" text,
	"created_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "embedding_models" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"model_name" text NOT NULL,
	"dimensions" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "git_repository_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid,
	"provider" text DEFAULT 'github' NOT NULL,
	"owner" text NOT NULL,
	"repo" text NOT NULL,
	"branch" text DEFAULT 'main' NOT NULL,
	"base_url" text,
	"access_token" text NOT NULL,
	"include_paths" jsonb NOT NULL,
	"exclude_paths" jsonb NOT NULL,
	"path_mappings" jsonb NOT NULL,
	"webhook_secret" text,
	"status" text DEFAULT 'active' NOT NULL,
	"last_error" text,
	"last_synced_at" timestamp with time zone,
	"last_synced_commit_sha" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "git_sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"trigger" text NOT NULL,
	"commit_sha" text,
	"stats_json" jsonb,
	"error_message" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_record_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"knowledge_record_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"chunk_index" integer NOT NULL,
	"content" text NOT NULL,
	"token_estimate" integer,
	"embedding_model_id" uuid NOT NULL,
	"embedding" vector(768) NOT NULL,
	"content_hash" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_record_delivery_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"knowledge_record_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "llm_providers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'openai_compatible' NOT NULL,
	"base_url" text NOT NULL,
	"api_key" text,
	"default_model" text NOT NULL,
	"timeout_ms" integer,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "llm_service_bindings" (
	"service" text PRIMARY KEY NOT NULL,
	"provider_id" uuid NOT NULL,
	"model_override" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "platform_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_change_delivery_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"change_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_change_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"rationale" text,
	"status" text DEFAULT 'proposed' NOT NULL,
	"requested_by_user_id" uuid,
	"approved_by_user_id" uuid,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	"effective_date" date,
	"baseline_start_before" date,
	"baseline_start_after" date,
	"baseline_end_before" date,
	"baseline_end_after" date,
	"knowledge_record_id" uuid,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"issue_key_type" text,
	"issue_number" integer,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_cost_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"captured_on" date NOT NULL,
	"bac" numeric(14, 2) NOT NULL,
	"pv" numeric(14, 2),
	"ev" numeric(14, 2) NOT NULL,
	"ac" numeric(14, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_epics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'planned' NOT NULL,
	"start_date" date,
	"end_date" date,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"issue_key_type" text,
	"issue_number" integer,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_initial_stakeholders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"project_role" text DEFAULT 'stakeholder' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_milestones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'planned' NOT NULL,
	"start_date" date,
	"target_date" date,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"issue_key_type" text,
	"issue_number" integer,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_raid_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'open' NOT NULL,
	"severity" text DEFAULT 'medium' NOT NULL,
	"owner_user_id" uuid,
	"due_date" date,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"issue_key_type" text,
	"issue_number" integer,
	"transferred_to_raid_item_id" uuid,
	"transferred_from_raid_item_id" uuid,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_raid_task_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"raid_item_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_sprints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"goal" text,
	"status" text DEFAULT 'planned' NOT NULL,
	"start_date" date,
	"end_date" date,
	"capacity_points" integer,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"issue_key_type" text,
	"issue_number" integer,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_stakeholders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"user_id" uuid,
	"project_role" text DEFAULT 'stakeholder' NOT NULL,
	"job_title" text,
	"role_description" text,
	"competencies" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text,
	"reports_to_user_id" uuid,
	"hourly_rate" numeric(12, 2),
	"engagement_type" text,
	"assignment_start" date,
	"assignment_end" date,
	"allocated_daily_hours" numeric(6, 2),
	"contract_ref" text,
	"contracted_budget" numeric(14, 2),
	"contract_start" date,
	"contract_end" date,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_task_activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"type" text NOT NULL,
	"body" text,
	"metadata_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_task_raci" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"milestone_id" uuid,
	"user_story_id" uuid,
	"sprint_id" uuid,
	"title" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'todo' NOT NULL,
	"due_date" date,
	"forecast_hours" numeric(10, 2),
	"actual_hours" numeric(10, 2),
	"story_points" integer,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"current_owner_user_id" uuid,
	"tokens_used" integer,
	"ai_system_id" uuid,
	"issue_key_type" text,
	"issue_number" integer,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_user_stories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"epic_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'planned' NOT NULL,
	"start_date" date,
	"end_date" date,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"issue_key_type" text,
	"issue_number" integer,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "style_packs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"label" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"formats" jsonb DEFAULT '["pdf","docx"]'::jsonb NOT NULL,
	"typography" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"chrome" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"logo_blob_key" text,
	"logo_content_type" text,
	"docx_template_blob_key" text,
	"docx_template_content_type" text,
	"docx_template_body_anchor" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"knowledge_record_id" uuid,
	"content_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"original_filename" text,
	"alt_text" text,
	"created_by" uuid,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "knowledge_records" ADD COLUMN "translation_group_id" uuid;--> statement-breakpoint
ALTER TABLE "knowledge_records" ADD COLUMN "document_key_type" text;--> statement-breakpoint
ALTER TABLE "knowledge_records" ADD COLUMN "document_number" integer;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "start_date" date;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "end_date" date;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "charter_record_id" uuid;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "initial_plan_record_id" uuid;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "definition_of_done" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "currency" text DEFAULT 'EUR' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "initial_budget" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "approved_budget" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "key_prefix" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "issue_counters" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "systems" ADD COLUMN "it_details" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "systems" ADD COLUMN "it_cost_mode" text;--> statement-breakpoint
ALTER TABLE "systems" ADD COLUMN "it_flat_monthly_fee" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "systems" ADD COLUMN "it_one_time_cost" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "systems" ADD COLUMN "it_budget_allocation" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "systems" ADD COLUMN "ai_cost_mode" text;--> statement-breakpoint
ALTER TABLE "systems" ADD COLUMN "ai_flat_monthly_fee" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "systems" ADD COLUMN "ai_token_rate_per_1k" numeric(14, 4);--> statement-breakpoint
ALTER TABLE "systems" ADD COLUMN "ai_budget_allocation" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "full_name" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "idp_source" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "idp_subject" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "avatar_content_type" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "preferred_locale" text DEFAULT 'en' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_notification_prefs" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "display_prefs" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "signup_pending_escalated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "color" text;--> statement-breakpoint
ALTER TABLE "ai_pairing_codes" ADD CONSTRAINT "ai_pairing_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_clients" ADD CONSTRAINT "api_clients_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_clients" ADD CONSTRAINT "api_clients_acting_user_id_users_id_fk" FOREIGN KEY ("acting_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_clients" ADD CONSTRAINT "api_clients_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_clients" ADD CONSTRAINT "api_clients_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_import_records" ADD CONSTRAINT "conversation_import_records_import_id_conversation_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."conversation_imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_import_records" ADD CONSTRAINT "conversation_import_records_knowledge_record_id_knowledge_records_id_fk" FOREIGN KEY ("knowledge_record_id") REFERENCES "public"."knowledge_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_imports" ADD CONSTRAINT "conversation_imports_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_imports" ADD CONSTRAINT "conversation_imports_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_imports" ADD CONSTRAINT "conversation_imports_system_id_systems_id_fk" FOREIGN KEY ("system_id") REFERENCES "public"."systems"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_imports" ADD CONSTRAINT "conversation_imports_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_import_media" ADD CONSTRAINT "document_import_media_import_id_document_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."document_imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_import_media" ADD CONSTRAINT "document_import_media_workspace_media_id_workspace_media_id_fk" FOREIGN KEY ("workspace_media_id") REFERENCES "public"."workspace_media"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_import_records" ADD CONSTRAINT "document_import_records_import_id_document_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."document_imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_import_records" ADD CONSTRAINT "document_import_records_knowledge_record_id_knowledge_records_id_fk" FOREIGN KEY ("knowledge_record_id") REFERENCES "public"."knowledge_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_imports" ADD CONSTRAINT "document_imports_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_imports" ADD CONSTRAINT "document_imports_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_imports" ADD CONSTRAINT "document_imports_system_id_systems_id_fk" FOREIGN KEY ("system_id") REFERENCES "public"."systems"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_imports" ADD CONSTRAINT "document_imports_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "git_repository_connections" ADD CONSTRAINT "git_repository_connections_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "git_repository_connections" ADD CONSTRAINT "git_repository_connections_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "git_repository_connections" ADD CONSTRAINT "git_repository_connections_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "git_sync_runs" ADD CONSTRAINT "git_sync_runs_connection_id_git_repository_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."git_repository_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_record_chunks" ADD CONSTRAINT "knowledge_record_chunks_knowledge_record_id_knowledge_records_id_fk" FOREIGN KEY ("knowledge_record_id") REFERENCES "public"."knowledge_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_record_chunks" ADD CONSTRAINT "knowledge_record_chunks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_record_chunks" ADD CONSTRAINT "knowledge_record_chunks_embedding_model_id_embedding_models_id_fk" FOREIGN KEY ("embedding_model_id") REFERENCES "public"."embedding_models"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_record_delivery_links" ADD CONSTRAINT "knowledge_record_delivery_links_knowledge_record_id_knowledge_records_id_fk" FOREIGN KEY ("knowledge_record_id") REFERENCES "public"."knowledge_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_providers" ADD CONSTRAINT "llm_providers_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_service_bindings" ADD CONSTRAINT "llm_service_bindings_provider_id_llm_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."llm_providers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_service_bindings" ADD CONSTRAINT "llm_service_bindings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD CONSTRAINT "platform_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_change_delivery_links" ADD CONSTRAINT "project_change_delivery_links_change_id_project_change_items_id_fk" FOREIGN KEY ("change_id") REFERENCES "public"."project_change_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_change_items" ADD CONSTRAINT "project_change_items_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_change_items" ADD CONSTRAINT "project_change_items_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_change_items" ADD CONSTRAINT "project_change_items_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_change_items" ADD CONSTRAINT "project_change_items_knowledge_record_id_knowledge_records_id_fk" FOREIGN KEY ("knowledge_record_id") REFERENCES "public"."knowledge_records"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_cost_snapshots" ADD CONSTRAINT "project_cost_snapshots_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_epics" ADD CONSTRAINT "project_epics_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_initial_stakeholders" ADD CONSTRAINT "project_initial_stakeholders_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_initial_stakeholders" ADD CONSTRAINT "project_initial_stakeholders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_milestones" ADD CONSTRAINT "project_milestones_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_raid_items" ADD CONSTRAINT "project_raid_items_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_raid_items" ADD CONSTRAINT "project_raid_items_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_raid_items" ADD CONSTRAINT "project_raid_items_transferred_to_raid_item_id_project_raid_items_id_fk" FOREIGN KEY ("transferred_to_raid_item_id") REFERENCES "public"."project_raid_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_raid_items" ADD CONSTRAINT "project_raid_items_transferred_from_raid_item_id_project_raid_items_id_fk" FOREIGN KEY ("transferred_from_raid_item_id") REFERENCES "public"."project_raid_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_raid_task_links" ADD CONSTRAINT "project_raid_task_links_raid_item_id_project_raid_items_id_fk" FOREIGN KEY ("raid_item_id") REFERENCES "public"."project_raid_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_raid_task_links" ADD CONSTRAINT "project_raid_task_links_task_id_project_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."project_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_sprints" ADD CONSTRAINT "project_sprints_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_stakeholders" ADD CONSTRAINT "project_stakeholders_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_stakeholders" ADD CONSTRAINT "project_stakeholders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_stakeholders" ADD CONSTRAINT "project_stakeholders_reports_to_user_id_users_id_fk" FOREIGN KEY ("reports_to_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_task_activities" ADD CONSTRAINT "project_task_activities_task_id_project_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."project_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_task_activities" ADD CONSTRAINT "project_task_activities_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_task_raci" ADD CONSTRAINT "project_task_raci_task_id_project_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."project_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_task_raci" ADD CONSTRAINT "project_task_raci_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_tasks" ADD CONSTRAINT "project_tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_tasks" ADD CONSTRAINT "project_tasks_milestone_id_project_milestones_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."project_milestones"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_tasks" ADD CONSTRAINT "project_tasks_user_story_id_project_user_stories_id_fk" FOREIGN KEY ("user_story_id") REFERENCES "public"."project_user_stories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_tasks" ADD CONSTRAINT "project_tasks_sprint_id_project_sprints_id_fk" FOREIGN KEY ("sprint_id") REFERENCES "public"."project_sprints"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_tasks" ADD CONSTRAINT "project_tasks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_tasks" ADD CONSTRAINT "project_tasks_current_owner_user_id_users_id_fk" FOREIGN KEY ("current_owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_tasks" ADD CONSTRAINT "project_tasks_ai_system_id_systems_id_fk" FOREIGN KEY ("ai_system_id") REFERENCES "public"."systems"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_user_stories" ADD CONSTRAINT "project_user_stories_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_user_stories" ADD CONSTRAINT "project_user_stories_epic_id_project_epics_id_fk" FOREIGN KEY ("epic_id") REFERENCES "public"."project_epics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "style_packs" ADD CONSTRAINT "style_packs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "style_packs" ADD CONSTRAINT "style_packs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_media" ADD CONSTRAINT "workspace_media_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_media" ADD CONSTRAINT "workspace_media_knowledge_record_id_knowledge_records_id_fk" FOREIGN KEY ("knowledge_record_id") REFERENCES "public"."knowledge_records"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_media" ADD CONSTRAINT "workspace_media_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_pairing_codes_code_hash_uidx" ON "ai_pairing_codes" USING btree ("code_hash");--> statement-breakpoint
CREATE INDEX "ai_pairing_codes_user_id_idx" ON "ai_pairing_codes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ai_pairing_codes_expires_at_idx" ON "ai_pairing_codes" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "api_clients_token_hash_uidx" ON "api_clients" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "api_clients_organization_id_idx" ON "api_clients" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "api_clients_token_prefix_idx" ON "api_clients" USING btree ("token_prefix");--> statement-breakpoint
CREATE INDEX "api_clients_acting_user_id_idx" ON "api_clients" USING btree ("acting_user_id");--> statement-breakpoint
CREATE INDEX "api_clients_status_idx" ON "api_clients" USING btree ("status");--> statement-breakpoint
CREATE INDEX "api_clients_requested_by_user_id_idx" ON "api_clients" USING btree ("requested_by_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_tokens_token_hash_uidx" ON "auth_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "auth_tokens_user_purpose_idx" ON "auth_tokens" USING btree ("user_id","purpose");--> statement-breakpoint
CREATE INDEX "auth_tokens_expires_at_idx" ON "auth_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_import_records_pair_uidx" ON "conversation_import_records" USING btree ("import_id","knowledge_record_id");--> statement-breakpoint
CREATE INDEX "conversation_import_records_import_id_idx" ON "conversation_import_records" USING btree ("import_id");--> statement-breakpoint
CREATE INDEX "conversation_import_records_record_id_idx" ON "conversation_import_records" USING btree ("knowledge_record_id");--> statement-breakpoint
CREATE INDEX "conversation_imports_workspace_id_idx" ON "conversation_imports" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "conversation_imports_project_id_idx" ON "conversation_imports" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "conversation_imports_system_id_idx" ON "conversation_imports" USING btree ("system_id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_import_media_pair_uidx" ON "document_import_media" USING btree ("import_id","workspace_media_id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_import_media_attachment_uidx" ON "document_import_media" USING btree ("import_id","attachment_index");--> statement-breakpoint
CREATE UNIQUE INDEX "document_import_records_pair_uidx" ON "document_import_records" USING btree ("import_id","knowledge_record_id");--> statement-breakpoint
CREATE INDEX "document_import_records_import_id_idx" ON "document_import_records" USING btree ("import_id");--> statement-breakpoint
CREATE INDEX "document_imports_workspace_id_idx" ON "document_imports" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "document_imports_status_idx" ON "document_imports" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "embedding_models_provider_model_uidx" ON "embedding_models" USING btree ("provider","model_name");--> statement-breakpoint
CREATE INDEX "git_repository_connections_workspace_id_idx" ON "git_repository_connections" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "git_repository_connections_project_id_idx" ON "git_repository_connections" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "git_repository_connections_workspace_repo_uidx" ON "git_repository_connections" USING btree ("workspace_id","provider","owner","repo","branch");--> statement-breakpoint
CREATE INDEX "git_sync_runs_connection_id_idx" ON "git_sync_runs" USING btree ("connection_id");--> statement-breakpoint
CREATE INDEX "git_sync_runs_created_at_idx" ON "git_sync_runs" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_record_chunks_record_index_uidx" ON "knowledge_record_chunks" USING btree ("knowledge_record_id","chunk_index");--> statement-breakpoint
CREATE INDEX "knowledge_record_chunks_workspace_id_idx" ON "knowledge_record_chunks" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "knowledge_record_chunks_record_id_idx" ON "knowledge_record_chunks" USING btree ("knowledge_record_id");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_record_delivery_links_uidx" ON "knowledge_record_delivery_links" USING btree ("knowledge_record_id","entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "knowledge_record_delivery_links_entity_idx" ON "knowledge_record_delivery_links" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "knowledge_record_delivery_links_record_idx" ON "knowledge_record_delivery_links" USING btree ("knowledge_record_id");--> statement-breakpoint
CREATE UNIQUE INDEX "llm_providers_name_uidx" ON "llm_providers" USING btree ("name");--> statement-breakpoint
CREATE INDEX "llm_providers_status_idx" ON "llm_providers" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "project_change_delivery_links_uidx" ON "project_change_delivery_links" USING btree ("change_id","entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "project_change_delivery_links_entity_idx" ON "project_change_delivery_links" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "project_change_items_project_id_idx" ON "project_change_items" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_change_items_project_status_idx" ON "project_change_items" USING btree ("project_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "project_change_items_project_key_uidx" ON "project_change_items" USING btree ("project_id","issue_key_type","issue_number");--> statement-breakpoint
CREATE UNIQUE INDEX "project_cost_snapshots_project_day_uidx" ON "project_cost_snapshots" USING btree ("project_id","captured_on");--> statement-breakpoint
CREATE INDEX "project_cost_snapshots_project_id_idx" ON "project_cost_snapshots" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_epics_project_id_idx" ON "project_epics" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_epics_project_status_idx" ON "project_epics" USING btree ("project_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "project_epics_project_key_uidx" ON "project_epics" USING btree ("project_id","issue_key_type","issue_number");--> statement-breakpoint
CREATE UNIQUE INDEX "project_initial_stakeholders_project_user_uidx" ON "project_initial_stakeholders" USING btree ("project_id","user_id");--> statement-breakpoint
CREATE INDEX "project_initial_stakeholders_project_id_idx" ON "project_initial_stakeholders" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_milestones_project_id_idx" ON "project_milestones" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_milestones_project_status_idx" ON "project_milestones" USING btree ("project_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "project_milestones_project_key_uidx" ON "project_milestones" USING btree ("project_id","issue_key_type","issue_number");--> statement-breakpoint
CREATE INDEX "project_raid_items_project_id_idx" ON "project_raid_items" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_raid_items_project_kind_idx" ON "project_raid_items" USING btree ("project_id","kind");--> statement-breakpoint
CREATE INDEX "project_raid_items_project_status_idx" ON "project_raid_items" USING btree ("project_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "project_raid_items_project_key_uidx" ON "project_raid_items" USING btree ("project_id","issue_key_type","issue_number");--> statement-breakpoint
CREATE UNIQUE INDEX "project_raid_task_links_raid_task_uidx" ON "project_raid_task_links" USING btree ("raid_item_id","task_id");--> statement-breakpoint
CREATE INDEX "project_raid_task_links_task_id_idx" ON "project_raid_task_links" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "project_sprints_project_id_idx" ON "project_sprints" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_sprints_project_status_idx" ON "project_sprints" USING btree ("project_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "project_sprints_project_key_uidx" ON "project_sprints" USING btree ("project_id","issue_key_type","issue_number");--> statement-breakpoint
CREATE UNIQUE INDEX "project_sprints_one_active_uidx" ON "project_sprints" USING btree ("project_id") WHERE "project_sprints"."status" = 'active' AND "project_sprints"."archived_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "project_stakeholders_project_user_uidx" ON "project_stakeholders" USING btree ("project_id","user_id") WHERE "project_stakeholders"."user_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "project_stakeholders_project_id_idx" ON "project_stakeholders" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_stakeholders_reports_to_idx" ON "project_stakeholders" USING btree ("reports_to_user_id");--> statement-breakpoint
CREATE INDEX "project_task_activities_task_id_idx" ON "project_task_activities" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "project_task_activities_task_created_idx" ON "project_task_activities" USING btree ("task_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "project_task_raci_task_user_uidx" ON "project_task_raci" USING btree ("task_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_task_raci_one_accountable_uidx" ON "project_task_raci" USING btree ("task_id") WHERE "project_task_raci"."role" = 'A';--> statement-breakpoint
CREATE INDEX "project_task_raci_user_id_idx" ON "project_task_raci" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "project_tasks_project_id_idx" ON "project_tasks" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_tasks_milestone_id_idx" ON "project_tasks" USING btree ("milestone_id");--> statement-breakpoint
CREATE INDEX "project_tasks_user_story_id_idx" ON "project_tasks" USING btree ("user_story_id");--> statement-breakpoint
CREATE INDEX "project_tasks_sprint_id_idx" ON "project_tasks" USING btree ("sprint_id");--> statement-breakpoint
CREATE INDEX "project_tasks_project_user_story_idx" ON "project_tasks" USING btree ("project_id","user_story_id");--> statement-breakpoint
CREATE INDEX "project_tasks_current_owner_user_id_idx" ON "project_tasks" USING btree ("current_owner_user_id");--> statement-breakpoint
CREATE INDEX "project_tasks_ai_system_id_idx" ON "project_tasks" USING btree ("ai_system_id");--> statement-breakpoint
CREATE INDEX "project_tasks_project_status_idx" ON "project_tasks" USING btree ("project_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "project_tasks_project_key_uidx" ON "project_tasks" USING btree ("project_id","issue_key_type","issue_number");--> statement-breakpoint
CREATE INDEX "project_user_stories_project_id_idx" ON "project_user_stories" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_user_stories_epic_id_idx" ON "project_user_stories" USING btree ("epic_id");--> statement-breakpoint
CREATE INDEX "project_user_stories_project_status_idx" ON "project_user_stories" USING btree ("project_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "project_user_stories_project_key_uidx" ON "project_user_stories" USING btree ("project_id","issue_key_type","issue_number");--> statement-breakpoint
CREATE UNIQUE INDEX "style_packs_organization_slug_uidx" ON "style_packs" USING btree ("organization_id","slug");--> statement-breakpoint
CREATE INDEX "style_packs_organization_status_idx" ON "style_packs" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "workspace_media_workspace_id_idx" ON "workspace_media" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "workspace_media_record_id_idx" ON "workspace_media" USING btree ("knowledge_record_id");--> statement-breakpoint
CREATE INDEX "workspace_media_created_at_idx" ON "workspace_media" USING btree ("created_at");--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_charter_record_id_knowledge_records_id_fk" FOREIGN KEY ("charter_record_id") REFERENCES "public"."knowledge_records"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_initial_plan_record_id_knowledge_records_id_fk" FOREIGN KEY ("initial_plan_record_id") REFERENCES "public"."knowledge_records"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_records_project_doc_key_uidx" ON "knowledge_records" USING btree ("project_id","document_key_type","document_number") WHERE "knowledge_records"."project_id" IS NOT NULL AND "knowledge_records"."document_key_type" IS NOT NULL AND "knowledge_records"."document_number" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "knowledge_records_translation_group_id_idx" ON "knowledge_records" USING btree ("translation_group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_workspace_key_prefix_uidx" ON "projects" USING btree ("workspace_id",upper("key_prefix")) WHERE "projects"."key_prefix" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "users_idp_source_subject_uidx" ON "users" USING btree ("idp_source","idp_subject");