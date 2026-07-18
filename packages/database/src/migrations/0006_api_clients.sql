CREATE TABLE "api_clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"token_hash" text NOT NULL,
	"token_prefix" text NOT NULL,
	"scopes" jsonb NOT NULL,
	"allowed_workspace_ids" jsonb NOT NULL,
	"allowed_project_ids" jsonb NOT NULL,
	"expires_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_clients" ADD CONSTRAINT "api_clients_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "api_clients_token_hash_uidx" ON "api_clients" USING btree ("token_hash");
--> statement-breakpoint
CREATE INDEX "api_clients_organization_id_idx" ON "api_clients" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX "api_clients_token_prefix_idx" ON "api_clients" USING btree ("token_prefix");
