CREATE TABLE "ai_pairing_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_pairing_codes" ADD CONSTRAINT "ai_pairing_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "ai_pairing_codes_code_hash_uidx" ON "ai_pairing_codes" USING btree ("code_hash");
--> statement-breakpoint
CREATE INDEX "ai_pairing_codes_user_id_idx" ON "ai_pairing_codes" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX "ai_pairing_codes_expires_at_idx" ON "ai_pairing_codes" USING btree ("expires_at");
--> statement-breakpoint
ALTER TABLE "api_clients" ALTER COLUMN "token_hash" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "api_clients" ALTER COLUMN "token_prefix" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "api_clients" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;
--> statement-breakpoint
ALTER TABLE "api_clients" ADD COLUMN "requested_by_user_id" uuid;
--> statement-breakpoint
ALTER TABLE "api_clients" ADD COLUMN "approved_by_user_id" uuid;
--> statement-breakpoint
ALTER TABLE "api_clients" ADD COLUMN "approved_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "api_clients" ADD COLUMN "agent_label" text;
--> statement-breakpoint
ALTER TABLE "api_clients" ADD COLUMN "claim_secret_hash" text;
--> statement-breakpoint
ALTER TABLE "api_clients" ADD COLUMN "unclaimed_token" text;
--> statement-breakpoint
ALTER TABLE "api_clients" ADD COLUMN "token_claimed_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "api_clients" ADD CONSTRAINT "api_clients_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "api_clients" ADD CONSTRAINT "api_clients_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "api_clients_status_idx" ON "api_clients" USING btree ("status");
--> statement-breakpoint
CREATE INDEX "api_clients_requested_by_user_id_idx" ON "api_clients" USING btree ("requested_by_user_id");
