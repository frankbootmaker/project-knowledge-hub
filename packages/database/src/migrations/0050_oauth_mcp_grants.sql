CREATE TABLE "oauth_authorization_codes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "code_hash" text NOT NULL,
  "user_id" uuid NOT NULL,
  "organization_id" uuid NOT NULL,
  "client_id" text NOT NULL,
  "redirect_uri" text NOT NULL,
  "resource" text NOT NULL,
  "scopes" jsonb NOT NULL,
  "allowed_workspace_ids" jsonb NOT NULL,
  "allowed_project_ids" jsonb NOT NULL,
  "code_challenge" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "used_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "oauth_authorization_codes"
  ADD CONSTRAINT "oauth_authorization_codes_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "oauth_authorization_codes"
  ADD CONSTRAINT "oauth_authorization_codes_organization_id_organizations_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_authorization_codes_code_hash_uidx"
  ON "oauth_authorization_codes" USING btree ("code_hash");
--> statement-breakpoint
CREATE INDEX "oauth_authorization_codes_user_id_idx"
  ON "oauth_authorization_codes" USING btree ("user_id");
--> statement-breakpoint
CREATE TABLE "oauth_grants" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "organization_id" uuid NOT NULL,
  "client_id" text NOT NULL,
  "resource" text NOT NULL,
  "scopes" jsonb NOT NULL,
  "allowed_workspace_ids" jsonb NOT NULL,
  "allowed_project_ids" jsonb NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "last_used_at" timestamp with time zone,
  "refresh_expires_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "oauth_grants"
  ADD CONSTRAINT "oauth_grants_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "oauth_grants"
  ADD CONSTRAINT "oauth_grants_organization_id_organizations_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "oauth_grants_user_id_idx" ON "oauth_grants" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX "oauth_grants_organization_id_idx"
  ON "oauth_grants" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX "oauth_grants_status_idx" ON "oauth_grants" USING btree ("status");
--> statement-breakpoint
CREATE TABLE "oauth_refresh_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "grant_id" uuid NOT NULL,
  "token_hash" text NOT NULL,
  "token_prefix" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "rotated_from_id" uuid,
  "revoked_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "oauth_refresh_tokens"
  ADD CONSTRAINT "oauth_refresh_tokens_grant_id_oauth_grants_id_fk"
  FOREIGN KEY ("grant_id") REFERENCES "public"."oauth_grants"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_refresh_tokens_token_hash_uidx"
  ON "oauth_refresh_tokens" USING btree ("token_hash");
--> statement-breakpoint
CREATE INDEX "oauth_refresh_tokens_grant_id_idx"
  ON "oauth_refresh_tokens" USING btree ("grant_id");
